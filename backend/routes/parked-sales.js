module.exports = function registerParkedSalesRoutes(app, deps) {
  const { db, requirePerm } = deps;

// --- ROUTES: PARKED SALES (Phase 3) ---

  // List all parked sales (with item count)
  app.get("/api/parked-sales", async (req, res) => {
    const { outlet_id } = req.query;
    let sql = `
    SELECT ps.*, e.name as employee_name, c.name as customer_name, o.name as outlet_name,
           COUNT(psi.id) as item_count
    FROM parked_sales ps
    LEFT JOIN employees e ON ps.employee_id = e.id
    LEFT JOIN customers c ON ps.customer_id = c.id
    LEFT JOIN outlets o ON ps.outlet_id = o.id
    LEFT JOIN parked_sale_items psi ON psi.parked_sale_id = ps.id
    `;
    const params = [];
    let paramIdx = 1;
    if (outlet_id) {
      sql += ` WHERE ps.outlet_id = $${paramIdx}`;
      params.push(outlet_id);
      paramIdx++;
    }
    sql += " GROUP BY ps.id, e.name, c.name, o.name ORDER BY ps.parked_at DESC";
    try {
      const { rows } = await db.query(sql, params);
      res.json({ parkedSales: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get a single parked sale with all items
  app.get("/api/parked-sales/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: saleRows } = await db.query(
        `SELECT ps.*, e.name as employee_name, c.name as customer_name, o.name as outlet_name
         FROM parked_sales ps
         LEFT JOIN employees e ON ps.employee_id = e.id
         LEFT JOIN customers c ON ps.customer_id = c.id
         LEFT JOIN outlets o ON ps.outlet_id = o.id
         WHERE ps.id = $1`,
        [id]
      );
      if (!saleRows.length) return res.status(404).json({ error: "Parked sale not found" });
      const { rows: items } = await db.query(
        "SELECT * FROM parked_sale_items WHERE parked_sale_id = $1",
        [id]
      );
      res.json({ parkedSale: saleRows[0], items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Park a sale (create)
  app.post("/api/parked-sales", requirePerm("pos_park"), async (req, res) => {
    const { employee_id, outlet_id, customer_id, label, notes, items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Cannot park an empty cart" });
    }
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query(
          "INSERT INTO parked_sales (employee_id, outlet_id, customer_id, label, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [employee_id || null, outlet_id || null, customer_id || null, label || null, notes || null]
        );
        const parkedId = rows[0].id;
        for (const item of items) {
          await client.query(
            "INSERT INTO parked_sale_items (parked_sale_id, product_id, variant_id, product_name, quantity, price, effective_tax_rate) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [parkedId, item.product_id || null, item.variant_id || null, item.product_name || item.name || "", item.quantity, item.price, item.effective_tax_rate || 0]
          );
        }
        return parkedId;
      });
      res.json({ message: "Sale parked successfully", id: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete (unpark/restore) a parked sale
  app.delete("/api/parked-sales/:id", requirePerm("pos_park"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query("DELETE FROM parked_sales WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Parked sale not found" });
      res.json({ message: "Parked sale removed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
