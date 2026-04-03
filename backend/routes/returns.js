const { toUtcStart, toUtcEnd } = require("../utils/tz");
const logger = require("../services/logger");
const { validate } = require("../middleware/validate");
const { CreateReturnSchema } = require("../schemas/returns");

module.exports = function registerReturnsRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, createNotification, notifyLowStockForSale } = deps;

  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const fn = deps.enqueueInventorySyncEvents;
      if (typeof fn === "function") return fn(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

// --- ROUTES: RETURNS ---

  // Create a new return
  app.post("/api/returns", requirePerm("manage_orders"), validate(CreateReturnSchema), async (req, res) => {
    const {
      original_sale_id,
      outlet_id,
      employee_id,
      customer_id,
      total_refund,
      refund_method,
      reason,
      items,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Return must have items" });
    }
    if (!outlet_id) {
      return res
        .status(400)
        .json({ error: "Outlet ID is required for restocking" });
    }

    // B16 fix: validate each returned item against original sale
    if (original_sale_id) {
      try {
        const { rows: saleItems } = await db.query(
          `SELECT product_id, variant_id, SUM(quantity) AS sold_qty
           FROM sale_items WHERE sale_id = $1
           GROUP BY product_id, variant_id`,
          [original_sale_id],
        );
        if (!saleItems || saleItems.length === 0) {
          return res.status(400).json({ error: "Original sale not found or has no items" });
        }

        const soldMap = {};
        saleItems.forEach((r) => {
          const key = `${r.product_id}_${r.variant_id ?? "null"}`;
          soldMap[key] = Number(r.sold_qty);
        });

        for (const item of items) {
          const key = `${item.product_id}_${item.variant_id ?? "null"}`;
          if (!(key in soldMap)) {
            return res.status(400).json({
              error: item.variant_id
                ? `Variant ${item.variant_id} of product ${item.product_id} was not part of the original sale`
                : `Product ${item.product_id} was not part of the original sale`,
            });
          }
          if (item.quantity > soldMap[key]) {
            return res.status(400).json({
              error: `Return quantity ${item.quantity} exceeds sold quantity for this variant`,
            });
          }
        }
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    try {
      // Look up the open shift for this outlet
      const { rows: shiftRows } = await db.query(
        "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
        [outlet_id],
      );
      const shiftId = shiftRows.length ? shiftRows[0].id : null;

      const returnId = await db.transaction(async (client) => {
        const { rows } = await client.query(
          "INSERT INTO returns (original_sale_id, outlet_id, employee_id, customer_id, total_refund, refund_method, reason, shift_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
          [
            original_sale_id || null,
            outlet_id,
            employee_id || null,
            customer_id || null,
            total_refund,
            refund_method,
            reason || null,
            shiftId,
          ],
        );
        const retId = rows[0].id;

        for (const item of items) {
          await client.query(
            "INSERT INTO return_items (return_id, product_id, variant_id, quantity, refund_price) VALUES ($1, $2, $3, $4, $5)",
            [retId, item.product_id, item.variant_id || null, item.quantity, item.refund_price],
          );
          // Restock outlet_stock
          await client.query(
            `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
            [item.product_id, outlet_id, item.quantity, item.quantity],
          );
          // Restock variant stock if applicable
          if (item.variant_id) {
            await client.query(
              "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
              [item.quantity, item.variant_id],
            );
          }
        }

        return retId;
      });

      const syncChanges = items.map((item) => ({
        product_id: item.product_id,
        outlet_id,
        delta: Number(item.quantity || 0),
        reason: "return",
        reference_type: "return",
        reference_id: returnId,
      }));
      enqueueInventorySyncEvents(syncChanges, {}, () => {});

      // FBR Digital Invoicing — enqueue credit note if enabled
      try {
        const { rows: [ff] } = await db.query(
          "SELECT enabled FROM feature_flags WHERE key = 'fbr_integration'"
        );
        if (ff?.enabled) {
          const { buildCreditNotePayload, enqueueFbrInvoice } = require("../services/fbr");
          const { fetchCategoryIndexes } = require("../category-tree");
          const categoryTree = await fetchCategoryIndexes(db);
          const { rows: returnItems } = await db.query(
            `SELECT ri.*, p.name as product_name, p.category_id
             FROM return_items ri LEFT JOIN products p ON ri.product_id = p.id
             WHERE ri.return_id = $1`, [returnId]
          );
          const { rows: [cust] } = customer_id
            ? await db.query("SELECT name, ntn_cnic FROM customers WHERE id = $1", [customer_id])
            : { rows: [null] };
          const payload = buildCreditNotePayload(
            { id: returnId, timestamp: new Date() },
            returnItems, req.company, cust, categoryTree
          );
          await enqueueFbrInvoice(db, { returnId, invoiceType: "credit_note", payload, tenantSlug: req.tenantSlug });
          await db.query("UPDATE returns SET fbr_status = 'pending' WHERE id = $1", [returnId]);
        }
      } catch (fbrErr) {
        logger.error({ err: fbrErr, returnId }, "FBR return enqueue failed (non-blocking)");
      }

      res.json({
        message: "Return processed successfully",
        id: returnId,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all returns (with details)
  app.get("/api/returns", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { date_from, date_to } = req.query;
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];
    let paramIdx = 1;

    if (date_from) {
      where.push(`r.timestamp >= $${paramIdx++}`);
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push(`r.timestamp < $${paramIdx++}`);
      params.push(toUtcEnd(date_to, tz));
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const sql = `
    SELECT r.*,
           o.name as outlet_name,
           e.name as employee_name,
           c.name as customer_name,
           COUNT(ri.id) as item_count
    FROM returns r
    LEFT JOIN outlets o ON r.outlet_id = o.id
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN customers c ON r.customer_id = c.id
    LEFT JOIN return_items ri ON r.id = ri.return_id
    ${whereClause}
    GROUP BY r.id, o.name, e.name, c.name
    ORDER BY r.timestamp DESC
  `;

    try {
      const { rows } = await db.query(sql, params);
      res.json({ returns: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get a single return with items
  app.get("/api/returns/:id", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { id } = req.params;

    try {
      const { rows: returnRows } = await db.query(
        `SELECT r.*, o.name as outlet_name, e.name as employee_name, c.name as customer_name
       FROM returns r
       LEFT JOIN outlets o ON r.outlet_id = o.id
       LEFT JOIN employees e ON r.employee_id = e.id
       LEFT JOIN customers c ON r.customer_id = c.id
       WHERE r.id = $1`,
        [id],
      );
      if (!returnRows.length)
        return res.status(404).json({ error: "Return not found" });

      const { rows: items } = await db.query(
        `SELECT ri.*, p.name as product_name, p.barcode
       FROM return_items ri
       JOIN products p ON ri.product_id = p.id
       WHERE ri.return_id = $1`,
        [id],
      );
      res.json({ returnData: returnRows[0], items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
