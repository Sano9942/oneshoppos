// Phase 2-G Wave 3 — 2-G.6 serialized inventory.
// Richer serial lookup + management endpoints. Supersedes the minimal
// GET/POST pair at barcode-expenses.js:767 (left in place for backwards
// compat; new callers hit these routes).
module.exports = function registerProductSerialRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm } = deps;

  // Lookup available serials for a product (POS serial-entry modal reads
  // this). ?status=available is the default; pass ?status=all to see every
  // serial for stock-management UIs. ?variant_id= narrows to a specific
  // variant when the product has variants.
  app.get(
    "/api/products/:id/serials",
    requireAnyPerm(["view_reports", "manage_inventory", "all_access"]),
    async (req, res) => {
      const { id } = req.params;
      const status = req.query.status || "available";
      const variantId = req.query.variant_id ? Number(req.query.variant_id) : null;
      try {
        const params = [id];
        let sql = `
          SELECT id, product_id, variant_id, serial_number, status,
                 warranty_months, warranty_start_date, warranty_end_date,
                 grn_id, sale_id, created_at
            FROM product_serial_numbers
           WHERE product_id = $1
        `;
        if (status !== "all") {
          params.push(status);
          sql += ` AND status = $${params.length}`;
        }
        if (variantId) {
          params.push(variantId);
          sql += ` AND (variant_id = $${params.length} OR variant_id IS NULL)`;
        }
        sql += " ORDER BY created_at DESC";
        const { rows } = await db.query(sql, params);
        res.json({ serials: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // Lookup all serials tied to a sale (for the returns UI when returning a
  // serialized item — show the cashier the specific units sold on that
  // original invoice so they pick the right serial to return).
  app.get(
    "/api/sales/:id/serials",
    requireAnyPerm(["view_reports", "manage_inventory", "all_access"]),
    async (req, res) => {
      const { id } = req.params;
      try {
        const { rows } = await db.query(
          `SELECT psn.id, psn.serial_number, psn.status,
                  psn.warranty_start_date, psn.warranty_end_date,
                  sis.sale_item_id,
                  si.product_id, si.variant_id
             FROM sale_item_serials sis
             JOIN product_serial_numbers psn ON psn.id = sis.serial_id
             JOIN sale_items si ON si.id = sis.sale_item_id
            WHERE si.sale_id = $1
            ORDER BY sis.id ASC`,
          [id],
        );
        res.json({ serials: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // Toggle serial_required on a product. Admin-only — flipping this on for
  // an existing SKU with no pre-existing serials will force the next GRN
  // receive to scan in IMEIs/serials.
  app.put(
    "/api/products/:id/serial-required",
    requirePerm("all_access"),
    async (req, res) => {
      const { id } = req.params;
      const { serial_required, default_warranty_months } = req.body;
      try {
        const { rowCount } = await db.query(
          `UPDATE products
              SET serial_required = COALESCE($1, serial_required),
                  default_warranty_months = COALESCE($2, default_warranty_months)
            WHERE id = $3`,
          [
            serial_required == null ? null : Boolean(serial_required),
            default_warranty_months == null ? null : Number(default_warranty_months),
            id,
          ],
        );
        if (rowCount === 0) return res.status(404).json({ error: "Product not found" });
        res.json({ updated: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
