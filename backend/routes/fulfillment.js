/**
 * backend/routes/fulfillment.js — Pick / Pack / Dispatch workflow.
 *
 * Tables: picklists, picklist_items (migration v16).
 * All endpoints require manage_orders permission.
 */
module.exports = function registerFulfillmentRoutes(app, deps) {
  const { db, requirePerm } = deps;

  const perm = requirePerm("manage_orders");

  // ── helpers ───────────────────────────────────────────────────────

  async function generatePicklistNumber(client) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM picklists WHERE picklist_number LIKE $1`,
      [`PL-${today}-%`]
    );
    const seq = String((rows[0].cnt || 0) + 1).padStart(3, "0");
    return `PL-${today}-${seq}`;
  }

  // Find picklist item matching a barcode (product or variant barcode)
  async function findItemByBarcode(client, picklistId, barcode) {
    // Try picklist_items.barcode first (stored at creation)
    const { rows } = await client.query(
      `SELECT pi.* FROM picklist_items pi
       WHERE pi.picklist_id = $1 AND pi.barcode = $2
       LIMIT 1`,
      [picklistId, barcode]
    );
    if (rows.length) return rows[0];

    // Fallback: match against products.barcode or product_variants.barcode
    const { rows: r2 } = await client.query(
      `SELECT pi.* FROM picklist_items pi
       LEFT JOIN products p ON pi.product_id = p.id
       LEFT JOIN product_variants pv ON pi.variant_id = pv.id
       WHERE pi.picklist_id = $1
         AND (p.barcode = $2 OR pv.barcode = $2)
       LIMIT 1`,
      [picklistId, barcode]
    );
    return r2[0] || null;
  }

  // ── POST /api/fulfillment/picklists ───────────────────────────────

  app.post("/api/fulfillment/picklists", perm, async (req, res) => {
    try {
      const { order_ids, outlet_id } = req.body;
      if (!Array.isArray(order_ids) || !order_ids.length) {
        return res.status(400).json({ error: "order_ids required" });
      }
      if (!outlet_id) {
        return res.status(400).json({ error: "outlet_id required" });
      }

      const result = await db.transaction(async (client) => {
        const plNumber = await generatePicklistNumber(client);

        const { rows: [pl] } = await client.query(
          `INSERT INTO picklists (picklist_number, outlet_id, status, created_by)
           VALUES ($1, $2, 'pending', $3)
           RETURNING *`,
          [plNumber, outlet_id, req.employee?.id || null]
        );

        // Gather items from web_order_items for the selected orders
        const { rows: orderItems } = await client.query(
          `SELECT woi.*, wo.id AS wo_id
           FROM web_order_items woi
           JOIN web_orders wo ON woi.web_order_id = wo.id
           WHERE wo.id = ANY($1) AND wo.fulfillment_status = 'unfulfilled'`,
          [order_ids]
        );

        if (!orderItems.length) {
          throw Object.assign(new Error("No unfulfilled order items found"), { statusCode: 400 });
        }

        for (const item of orderItems) {
          await client.query(
            `INSERT INTO picklist_items (picklist_id, web_order_id, product_id, variant_id, qty_to_pick, barcode)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [pl.id, item.wo_id, item.product_id, item.variant_id, item.qty, item.barcode]
          );
        }

        return pl;
      });

      res.status(201).json({ picklist: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/picklists ────────────────────────────────

  app.get("/api/fulfillment/picklists", perm, async (req, res) => {
    try {
      const { status, outlet_id, from, to } = req.query;
      const conds = [];
      const params = [];
      let idx = 0;

      if (status) { conds.push(`pl.status = $${++idx}`); params.push(status); }
      if (outlet_id) { conds.push(`pl.outlet_id = $${++idx}`); params.push(outlet_id); }
      if (from) { conds.push(`pl.created_at >= $${++idx}`); params.push(from); }
      if (to) { conds.push(`pl.created_at <= $${++idx}`); params.push(to); }

      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { rows } = await db.query(
        `SELECT pl.*,
                o.name AS outlet_name,
                e.name AS created_by_name,
                (SELECT COUNT(*)::int FROM picklist_items WHERE picklist_id = pl.id) AS item_count,
                (SELECT COUNT(*)::int FROM picklist_items WHERE picklist_id = pl.id AND qty_picked >= qty_to_pick) AS items_picked,
                (SELECT COUNT(DISTINCT web_order_id)::int FROM picklist_items WHERE picklist_id = pl.id) AS order_count
         FROM picklists pl
         LEFT JOIN outlets o ON pl.outlet_id = o.id
         LEFT JOIN employees e ON pl.created_by = e.id
         ${where}
         ORDER BY pl.created_at DESC`,
        params
      );
      res.json({ picklists: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/picklists/:id ────────────────────────────

  app.get("/api/fulfillment/picklists/:id", perm, async (req, res) => {
    try {
      const { rows: [pl] } = await db.query(
        `SELECT pl.*, o.name AS outlet_name, e.name AS created_by_name
         FROM picklists pl
         LEFT JOIN outlets o ON pl.outlet_id = o.id
         LEFT JOIN employees e ON pl.created_by = e.id
         WHERE pl.id = $1`,
        [req.params.id]
      );
      if (!pl) return res.status(404).json({ error: "Picklist not found" });

      const { rows: items } = await db.query(
        `SELECT pi.*, p.name AS product_name, p.barcode AS product_barcode,
                pv.name AS variant_name, pv.barcode AS variant_barcode,
                wo.external_order_number
         FROM picklist_items pi
         LEFT JOIN products p ON pi.product_id = p.id
         LEFT JOIN product_variants pv ON pi.variant_id = pv.id
         LEFT JOIN web_orders wo ON pi.web_order_id = wo.id
         WHERE pi.picklist_id = $1
         ORDER BY pi.id`,
        [req.params.id]
      );

      res.json({ picklist: { ...pl, items } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/picklists/:id/pick-scan ─────────────────

  app.post("/api/fulfillment/picklists/:id/pick-scan", perm, async (req, res) => {
    try {
      const { barcode } = req.body;
      if (!barcode) return res.status(400).json({ error: "barcode required" });

      const result = await db.transaction(async (client) => {
        // Lock the picklist row
        const { rows: [pl] } = await client.query(
          `SELECT * FROM picklists WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (!pl) throw Object.assign(new Error("Picklist not found"), { statusCode: 404 });
        if (!["pending", "picking"].includes(pl.status)) {
          throw Object.assign(new Error("Picklist is not in a pickable state"), { statusCode: 400 });
        }

        const item = await findItemByBarcode(client, pl.id, barcode);
        if (!item) throw Object.assign(new Error("Item not found in picklist"), { statusCode: 404 });
        if (item.qty_picked >= item.qty_to_pick) {
          throw Object.assign(new Error("Item already fully picked"), { statusCode: 400 });
        }

        // Increment qty_picked
        const { rows: [updated] } = await client.query(
          `UPDATE picklist_items
           SET qty_picked = qty_picked + 1,
               picked_at = CASE WHEN qty_picked + 1 >= qty_to_pick THEN NOW() ELSE picked_at END
           WHERE id = $1
           RETURNING *`,
          [item.id]
        );

        // Advance picklist to 'picking' if still pending
        if (pl.status === "pending") {
          await client.query(
            `UPDATE picklists SET status = 'picking' WHERE id = $1`,
            [pl.id]
          );
        }

        return updated;
      });

      res.json({ item: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/picklists/:id/complete-picking ──────────

  app.post("/api/fulfillment/picklists/:id/complete-picking", perm, async (req, res) => {
    try {
      const result = await db.transaction(async (client) => {
        const { rows: [pl] } = await client.query(
          `SELECT * FROM picklists WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (!pl) throw Object.assign(new Error("Picklist not found"), { statusCode: 404 });
        if (!["pending", "picking"].includes(pl.status)) {
          throw Object.assign(new Error("Picklist cannot be completed for picking"), { statusCode: 400 });
        }

        // Validate all items are picked
        const { rows: unpicked } = await client.query(
          `SELECT id FROM picklist_items WHERE picklist_id = $1 AND qty_picked < qty_to_pick`,
          [pl.id]
        );
        if (unpicked.length) {
          throw Object.assign(new Error(`${unpicked.length} item(s) not fully picked`), { statusCode: 400 });
        }

        const { rows: [updated] } = await client.query(
          `UPDATE picklists SET status = 'picked', picked_at = NOW() WHERE id = $1 RETURNING *`,
          [pl.id]
        );
        return updated;
      });

      res.json({ picklist: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/picklists/:id/pack-scan ─────────────────

  app.post("/api/fulfillment/picklists/:id/pack-scan", perm, async (req, res) => {
    try {
      const { barcode } = req.body;
      if (!barcode) return res.status(400).json({ error: "barcode required" });

      const result = await db.transaction(async (client) => {
        const { rows: [pl] } = await client.query(
          `SELECT * FROM picklists WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (!pl) throw Object.assign(new Error("Picklist not found"), { statusCode: 404 });
        if (!["picked", "packing"].includes(pl.status)) {
          throw Object.assign(new Error("Picklist is not in a packable state"), { statusCode: 400 });
        }

        const item = await findItemByBarcode(client, pl.id, barcode);
        if (!item) throw Object.assign(new Error("Item not found in picklist"), { statusCode: 404 });
        if (item.qty_packed >= item.qty_to_pick) {
          throw Object.assign(new Error("Item already fully packed"), { statusCode: 400 });
        }

        const { rows: [updated] } = await client.query(
          `UPDATE picklist_items
           SET qty_packed = qty_packed + 1,
               packed_at = CASE WHEN qty_packed + 1 >= qty_to_pick THEN NOW() ELSE packed_at END
           WHERE id = $1
           RETURNING *`,
          [item.id]
        );

        // Advance picklist to 'packing' if still 'picked'
        if (pl.status === "picked") {
          await client.query(
            `UPDATE picklists SET status = 'packing' WHERE id = $1`,
            [pl.id]
          );
        }

        return updated;
      });

      res.json({ item: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/picklists/:id/complete-packing ──────────

  app.post("/api/fulfillment/picklists/:id/complete-packing", perm, async (req, res) => {
    try {
      const result = await db.transaction(async (client) => {
        const { rows: [pl] } = await client.query(
          `SELECT * FROM picklists WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (!pl) throw Object.assign(new Error("Picklist not found"), { statusCode: 404 });
        if (!["picked", "packing"].includes(pl.status)) {
          throw Object.assign(new Error("Picklist cannot be completed for packing"), { statusCode: 400 });
        }

        const { rows: unpacked } = await client.query(
          `SELECT id FROM picklist_items WHERE picklist_id = $1 AND qty_packed < qty_to_pick`,
          [pl.id]
        );
        if (unpacked.length) {
          throw Object.assign(new Error(`${unpacked.length} item(s) not fully packed`), { statusCode: 400 });
        }

        const { rows: [updated] } = await client.query(
          `UPDATE picklists SET status = 'packed', packed_at = NOW() WHERE id = $1 RETURNING *`,
          [pl.id]
        );
        return updated;
      });

      res.json({ picklist: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/picklists/:id/dispatch ──────────────────

  app.post("/api/fulfillment/picklists/:id/dispatch", perm, async (req, res) => {
    try {
      const result = await db.transaction(async (client) => {
        const { rows: [pl] } = await client.query(
          `SELECT * FROM picklists WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (!pl) throw Object.assign(new Error("Picklist not found"), { statusCode: 404 });
        if (pl.status !== "packed") {
          throw Object.assign(new Error("Picklist must be packed before dispatch"), { statusCode: 400 });
        }

        // Update picklist
        const { rows: [updated] } = await client.query(
          `UPDATE picklists SET status = 'dispatched', dispatched_at = NOW() WHERE id = $1 RETURNING *`,
          [pl.id]
        );

        // Update all associated web_orders to fulfilled
        const { rows: orderIds } = await client.query(
          `SELECT DISTINCT web_order_id FROM picklist_items WHERE picklist_id = $1`,
          [pl.id]
        );
        if (orderIds.length) {
          await client.query(
            `UPDATE web_orders
             SET fulfillment_status = 'fulfilled', shipped_at = NOW(), updated_at = NOW()
             WHERE id = ANY($1)`,
            [orderIds.map((r) => r.web_order_id)]
          );
        }

        return updated;
      });

      res.json({ picklist: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── DELETE /api/fulfillment/picklists/:id ──────────────────────────

  app.delete("/api/fulfillment/picklists/:id", perm, async (req, res) => {
    try {
      const { rows: [pl] } = await db.query(
        `SELECT status FROM picklists WHERE id = $1`,
        [req.params.id]
      );
      if (!pl) return res.status(404).json({ error: "Picklist not found" });
      if (pl.status !== "pending") {
        return res.status(400).json({ error: "Only pending picklists can be cancelled" });
      }

      await db.query(
        `UPDATE picklists SET status = 'cancelled' WHERE id = $1`,
        [req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/unfulfilled-orders ───────────────────────
  // Helper: list orders available for picklist creation

  app.get("/api/fulfillment/unfulfilled-orders", perm, async (req, res) => {
    try {
      const { outlet_id } = req.query;
      const conds = [`wo.fulfillment_status = 'unfulfilled'`, `wo.order_status != 'cancelled'`];
      const params = [];
      let idx = 0;

      if (outlet_id) { conds.push(`wo.outlet_id = $${++idx}`); params.push(outlet_id); }

      const { rows } = await db.query(
        `SELECT wo.id, wo.external_order_number, wo.grand_total, wo.ordered_at,
                wo.payment_status, wo.customer_id, c.name AS customer_name,
                (SELECT COUNT(*)::int FROM web_order_items WHERE web_order_id = wo.id) AS item_count
         FROM web_orders wo
         LEFT JOIN customers c ON wo.customer_id = c.id
         WHERE ${conds.join(" AND ")}
         ORDER BY wo.ordered_at ASC`,
        params
      );
      res.json({ orders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
