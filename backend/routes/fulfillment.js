/**
 * backend/routes/fulfillment.js — Pick / Pack / Dispatch workflow.
 *
 * Tables: picklists, picklist_items (migration v16).
 * All endpoints require manage_orders permission.
 */
module.exports = function registerFulfillmentRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

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
      const { order_ids, outlet_id, include_shipping_allocations } = req.body;
      if (!outlet_id) {
        return res.status(400).json({ error: "outlet_id required" });
      }
      const hasOrderIds = Array.isArray(order_ids) && order_ids.length > 0;
      if (!hasOrderIds && !include_shipping_allocations) {
        return res.status(400).json({ error: "order_ids or include_shipping_allocations required" });
      }

      const result = await db.transaction(async (client) => {
        const plNumber = await generatePicklistNumber(client);

        const { rows: [pl] } = await client.query(
          `INSERT INTO picklists (picklist_number, outlet_id, status, created_by)
           VALUES ($1, $2, 'pending', $3)
           RETURNING *`,
          [plNumber, outlet_id, req.employee?.id || null]
        );

        let totalItems = 0;

        // Gather items from web_order_items for the selected orders
        if (hasOrderIds) {
          const { rows: orderItems } = await client.query(
            `SELECT woi.*, wo.id AS wo_id
             FROM web_order_items woi
             JOIN web_orders wo ON woi.web_order_id = wo.id
             WHERE wo.id = ANY($1) AND wo.fulfillment_status = 'unfulfilled'`,
            [order_ids]
          );

          for (const item of orderItems) {
            await client.query(
              `INSERT INTO picklist_items (picklist_id, web_order_id, product_id, variant_id, qty_to_pick, barcode)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [pl.id, item.wo_id, item.product_id, item.variant_id, item.qty, item.barcode]
            );
          }
          totalItems += orderItems.length;
        }

        // Include storefront shipping orders allocated to this outlet
        if (include_shipping_allocations) {
          const { rows: allocItems } = await client.query(
            `SELECT woa.id AS allocation_id, woa.web_order_id, woa.web_order_item_id,
                    woa.allocated_qty, woa.fulfillment_method,
                    woi.product_id, woi.variant_id, woi.title, woi.qty, woi.barcode,
                    wo.external_order_id
             FROM web_order_allocations woa
             JOIN web_order_items woi ON woi.id = woa.web_order_item_id
             JOIN web_orders wo ON wo.id = woa.web_order_id
             WHERE woa.fulfillment_outlet_id = $1
               AND woa.fulfillment_method = 'ship_to_customer'
               AND woa.status = 'pending'
               AND wo.fulfillment_status IN ('unfulfilled', 'partially_fulfilled')`,
            [outlet_id]
          );

          const allocationIds = [];
          for (const item of allocItems) {
            await client.query(
              `INSERT INTO picklist_items (picklist_id, web_order_id, product_id, variant_id, qty_to_pick, barcode, allocation_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [pl.id, item.web_order_id, item.product_id, item.variant_id, item.allocated_qty, item.barcode, item.allocation_id]
            );
            allocationIds.push(item.allocation_id);
          }

          // Advance allocation status to 'picking'
          if (allocationIds.length) {
            await client.query(
              `UPDATE web_order_allocations SET status = 'picking', updated_at = NOW()
               WHERE id = ANY($1)`,
              [allocationIds]
            );
          }
          totalItems += allocItems.length;
        }

        if (!totalItems) {
          throw Object.assign(new Error("No unfulfilled order items found"), { statusCode: 400 });
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
                pv.sku AS variant_name, pv.barcode AS variant_barcode,
                wo.external_order_number,
                woa.fulfillment_method AS allocation_method, woa.status AS allocation_status
         FROM picklist_items pi
         LEFT JOIN products p ON pi.product_id = p.id
         LEFT JOIN product_variants pv ON pi.variant_id = pv.id
         LEFT JOIN web_orders wo ON pi.web_order_id = wo.id
         LEFT JOIN web_order_allocations woa ON pi.allocation_id = woa.id
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

        // Advance any linked shipping allocations to 'shipped'
        const { rows: allocRows } = await client.query(
          `SELECT DISTINCT allocation_id FROM picklist_items
           WHERE picklist_id = $1 AND allocation_id IS NOT NULL`,
          [pl.id]
        );
        if (allocRows.length) {
          await client.query(
            `UPDATE web_order_allocations SET status = 'shipped', updated_at = NOW()
             WHERE id = ANY($1)`,
            [allocRows.map((r) => r.allocation_id)]
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

      // Revert any linked shipping allocations back to 'pending'
      const { rows: allocRows } = await db.query(
        `SELECT DISTINCT allocation_id FROM picklist_items
         WHERE picklist_id = $1 AND allocation_id IS NOT NULL`,
        [req.params.id]
      );
      if (allocRows.length) {
        await db.query(
          `UPDATE web_order_allocations SET status = 'pending', updated_at = NOW()
           WHERE id = ANY($1)`,
          [allocRows.map((r) => r.allocation_id)]
        );
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

  // ── POST /api/fulfillment/scan-dispatch ────────────────────────────
  // Quick dispatch: scan a tracking number, order number, or order ID

  app.post("/api/fulfillment/scan-dispatch", perm, async (req, res) => {
    try {
      const { scan_value } = req.body;
      if (!scan_value || !scan_value.trim()) {
        return res.status(400).json({ error: "scan_value required" });
      }

      const val = scan_value.trim();

      // Try multiple lookups: tracking_number → external_order_number → id
      let order = null;

      // 1. By tracking_number
      const { rows: r1 } = await db.query(
        `SELECT wo.id, wo.external_order_number, wo.fulfillment_status,
                wo.tracking_number, wo.grand_total, c.name AS customer_name
         FROM web_orders wo
         LEFT JOIN customers c ON wo.customer_id = c.id
         WHERE wo.tracking_number = $1
         LIMIT 1`,
        [val]
      );
      if (r1.length) order = r1[0];

      // 2. By external_order_number
      if (!order) {
        const { rows: r2 } = await db.query(
          `SELECT wo.id, wo.external_order_number, wo.fulfillment_status,
                  wo.tracking_number, wo.grand_total, c.name AS customer_name
           FROM web_orders wo
           LEFT JOIN customers c ON wo.customer_id = c.id
           WHERE wo.external_order_number = $1
           LIMIT 1`,
          [val]
        );
        if (r2.length) order = r2[0];
      }

      // 3. By id (numeric only)
      if (!order && /^\d+$/.test(val)) {
        const { rows: r3 } = await db.query(
          `SELECT wo.id, wo.external_order_number, wo.fulfillment_status,
                  wo.tracking_number, wo.grand_total, c.name AS customer_name
           FROM web_orders wo
           LEFT JOIN customers c ON wo.customer_id = c.id
           WHERE wo.id = $1
           LIMIT 1`,
          [Number(val)]
        );
        if (r3.length) order = r3[0];
      }

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Already dispatched?
      if (order.fulfillment_status === "fulfilled") {
        return res.json({
          warning: "Order already dispatched",
          order: {
            order_id: order.id,
            order_number: order.external_order_number || `#${order.id}`,
            customer_name: order.customer_name || null,
            status: "fulfilled",
          },
        });
      }

      // Mark as dispatched
      await db.query(
        `UPDATE web_orders
         SET fulfillment_status = 'fulfilled', shipped_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [order.id]
      );

      res.json({
        order: {
          order_id: order.id,
          order_number: order.external_order_number || `#${order.id}`,
          customer_name: order.customer_name || null,
          status: "fulfilled",
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Loadsheet helpers ─────────────────────────────────────────────

  async function generateLoadsheetNumber(client) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM loadsheets WHERE loadsheet_number LIKE $1`,
      [`LS-${today}-%`]
    );
    const seq = String((rows[0].cnt || 0) + 1).padStart(3, "0");
    return `LS-${today}-${seq}`;
  }

  // ── POST /api/fulfillment/loadsheets ─────────────────────────────

  app.post("/api/fulfillment/loadsheets", perm, async (req, res) => {
    try {
      const { order_ids, courier_id, outlet_id } = req.body;
      if (!Array.isArray(order_ids) || !order_ids.length) {
        return res.status(400).json({ error: "order_ids required" });
      }
      if (!outlet_id) {
        return res.status(400).json({ error: "outlet_id required" });
      }

      const result = await db.transaction(async (client) => {
        // Verify orders exist and are fulfilled (dispatched)
        const { rows: orders } = await client.query(
          `SELECT id, tracking_number, courier_id, grand_total, payment_status
           FROM web_orders
           WHERE id = ANY($1) AND fulfillment_status = 'fulfilled'`,
          [order_ids]
        );
        if (!orders.length) {
          throw Object.assign(new Error("No fulfilled/dispatched orders found"), { statusCode: 400 });
        }

        const lsNumber = await generateLoadsheetNumber(client);

        const { rows: [ls] } = await client.query(
          `INSERT INTO loadsheets (loadsheet_number, courier_id, outlet_id, status, created_by)
           VALUES ($1, $2, $3, 'draft', $4)
           RETURNING *`,
          [lsNumber, courier_id || null, outlet_id, req.employee?.id || null]
        );

        for (const order of orders) {
          const isCod = order.payment_status === "cod" || order.payment_status === "pending";
          await client.query(
            `INSERT INTO loadsheet_orders (loadsheet_id, web_order_id, tracking_number, is_cod, cod_amount)
             VALUES ($1, $2, $3, $4, $5)`,
            [ls.id, order.id, order.tracking_number || null, isCod, isCod ? Number(order.grand_total) : 0]
          );
        }

        return ls;
      });

      res.status(201).json({ loadsheet: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/loadsheets ──────────────────────────────

  app.get("/api/fulfillment/loadsheets", perm, async (req, res) => {
    try {
      const { status } = req.query;
      const conds = [];
      const params = [];
      let idx = 0;

      if (status) { conds.push(`ls.status = $${++idx}`); params.push(status); }

      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { rows } = await db.query(
        `SELECT ls.*,
                ci.name AS courier_name,
                o.name AS outlet_name,
                e.name AS created_by_name,
                (SELECT COUNT(*)::int FROM loadsheet_orders WHERE loadsheet_id = ls.id) AS order_count
         FROM loadsheets ls
         LEFT JOIN courier_integrations ci ON ls.courier_id = ci.id
         LEFT JOIN outlets o ON ls.outlet_id = o.id
         LEFT JOIN employees e ON ls.created_by = e.id
         ${where}
         ORDER BY ls.created_at DESC`,
        params
      );
      res.json({ loadsheets: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/loadsheets/:id ──────────────────────────

  app.get("/api/fulfillment/loadsheets/:id", perm, async (req, res) => {
    try {
      const { rows: [ls] } = await db.query(
        `SELECT ls.*, ci.name AS courier_name, o.name AS outlet_name, e.name AS created_by_name
         FROM loadsheets ls
         LEFT JOIN courier_integrations ci ON ls.courier_id = ci.id
         LEFT JOIN outlets o ON ls.outlet_id = o.id
         LEFT JOIN employees e ON ls.created_by = e.id
         WHERE ls.id = $1`,
        [req.params.id]
      );
      if (!ls) return res.status(404).json({ error: "Loadsheet not found" });

      const { rows: orders } = await db.query(
        `SELECT lo.*, wo.external_order_number, wo.grand_total, wo.payment_status,
                wo.tracking_number AS wo_tracking, wo.fulfillment_status,
                c.name AS customer_name, c.mobile AS customer_phone, c.address AS customer_address
         FROM loadsheet_orders lo
         JOIN web_orders wo ON lo.web_order_id = wo.id
         LEFT JOIN customers c ON wo.customer_id = c.id
         WHERE lo.loadsheet_id = $1
         ORDER BY lo.id`,
        [req.params.id]
      );

      res.json({ loadsheet: { ...ls, orders } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/fulfillment/loadsheets/:id/finalize ─────────────────

  app.put("/api/fulfillment/loadsheets/:id/finalize", perm, async (req, res) => {
    try {
      const result = await db.transaction(async (client) => {
        const { rows: [ls] } = await client.query(
          `SELECT * FROM loadsheets WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (!ls) throw Object.assign(new Error("Loadsheet not found"), { statusCode: 404 });
        if (ls.status !== "draft") {
          throw Object.assign(new Error("Only draft loadsheets can be finalized"), { statusCode: 400 });
        }

        const { rows: [agg] } = await client.query(
          `SELECT COUNT(*)::int AS total_orders,
                  COALESCE(SUM(CASE WHEN is_cod THEN cod_amount ELSE 0 END), 0)::numeric AS total_cod
           FROM loadsheet_orders WHERE loadsheet_id = $1`,
          [ls.id]
        );

        const { rows: [updated] } = await client.query(
          `UPDATE loadsheets
           SET status = 'finalized', finalized_at = NOW(),
               total_orders = $2, total_cod = $3
           WHERE id = $1
           RETURNING *`,
          [ls.id, agg.total_orders, agg.total_cod]
        );
        return updated;
      });

      res.json({ loadsheet: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── PUT /api/fulfillment/loadsheets/:id/handover ─────────────────

  app.put("/api/fulfillment/loadsheets/:id/handover", perm, async (req, res) => {
    try {
      const { handed_over_to } = req.body;
      if (!handed_over_to?.trim()) {
        return res.status(400).json({ error: "handed_over_to required" });
      }

      const result = await db.transaction(async (client) => {
        const { rows: [ls] } = await client.query(
          `SELECT * FROM loadsheets WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        if (!ls) throw Object.assign(new Error("Loadsheet not found"), { statusCode: 404 });
        if (ls.status !== "finalized") {
          throw Object.assign(new Error("Loadsheet must be finalized before handover"), { statusCode: 400 });
        }

        const { rows: [updated] } = await client.query(
          `UPDATE loadsheets
           SET status = 'handed_over', handed_over_at = NOW(), handed_over_to = $2
           WHERE id = $1
           RETURNING *`,
          [ls.id, handed_over_to.trim()]
        );
        return updated;
      });

      res.json({ loadsheet: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/loadsheets/:id/export ───────────────────

  app.get("/api/fulfillment/loadsheets/:id/export", perm, async (req, res) => {
    try {
      const { rows: [ls] } = await db.query(
        `SELECT ls.*, ci.name AS courier_name
         FROM loadsheets ls
         LEFT JOIN courier_integrations ci ON ls.courier_id = ci.id
         WHERE ls.id = $1`,
        [req.params.id]
      );
      if (!ls) return res.status(404).json({ error: "Loadsheet not found" });

      const { rows: orders } = await db.query(
        `SELECT lo.*, wo.external_order_number, wo.grand_total,
                c.name AS customer_name, c.mobile AS customer_phone, c.address AS customer_address
         FROM loadsheet_orders lo
         JOIN web_orders wo ON lo.web_order_id = wo.id
         LEFT JOIN customers c ON wo.customer_id = c.id
         WHERE lo.loadsheet_id = $1
         ORDER BY lo.id`,
        [req.params.id]
      );

      const header = "Order #,Customer,Address,Phone,Items,COD Amount,Tracking #,Courier";
      const rows = orders.map((o) => {
        const cols = [
          o.external_order_number || `#${o.web_order_id}`,
          (o.customer_name || "").replace(/,/g, " "),
          (o.customer_address || "").replace(/,/g, " ").replace(/\n/g, " "),
          o.customer_phone || "",
          "",
          o.is_cod ? Number(o.cod_amount).toFixed(2) : "0.00",
          o.tracking_number || "",
          ls.courier_name || "",
        ];
        return cols.map((c) => `"${c}"`).join(",");
      });

      const csv = [header, ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${ls.loadsheet_number}.csv"`);
      res.send(csv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/dispatched-orders ───────────────────────
  // Helper: list fulfilled orders available for loadsheet creation

  app.get("/api/fulfillment/dispatched-orders", perm, async (req, res) => {
    try {
      const { outlet_id, courier_id } = req.query;
      const conds = [
        `wo.fulfillment_status = 'fulfilled'`,
        `wo.order_status != 'cancelled'`,
        `wo.id NOT IN (SELECT web_order_id FROM loadsheet_orders)`,
      ];
      const params = [];
      let idx = 0;

      if (outlet_id) { conds.push(`wo.outlet_id = $${++idx}`); params.push(outlet_id); }
      if (courier_id) { conds.push(`wo.courier_id = $${++idx}`); params.push(courier_id); }

      const { rows } = await db.query(
        `SELECT wo.id, wo.external_order_number, wo.grand_total, wo.payment_status,
                wo.tracking_number, wo.shipped_at, wo.courier_id,
                c.name AS customer_name, c.mobile AS customer_phone,
                ci.name AS courier_name
         FROM web_orders wo
         LEFT JOIN customers c ON wo.customer_id = c.id
         LEFT JOIN courier_integrations ci ON wo.courier_id = ci.id
         WHERE ${conds.join(" AND ")}
         ORDER BY wo.shipped_at DESC`,
        params
      );
      res.json({ orders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/pickup-orders ─────────────────────────────
  // Pickup orders with status filtering for in-store/curbside pickup workflow

  app.get("/api/fulfillment/pickup-orders", perm, async (req, res) => {
    try {
      const { outlet_id, status } = req.query;
      let sql = `
        SELECT wo.id, wo.external_order_id, wo.external_order_number,
               wo.customer_name_snapshot AS customer_name,
               wo.customer_phone_snapshot AS customer_phone,
               wo.fulfillment_status, wo.order_status,
               wo.grand_total, wo.ordered_at,
               wo.pickup_ready_at, wo.picked_up_at, wo.curbside_arrived_at,
               wo.pickup_outlet_id,
               o.name AS outlet_name
        FROM web_orders wo
        LEFT JOIN outlets o ON o.id = wo.pickup_outlet_id
        WHERE wo.delivery_method = 'pickup'
          AND wo.order_status != 'cancelled'
      `;
      const params = [];

      if (outlet_id) {
        params.push(outlet_id);
        sql += ` AND wo.pickup_outlet_id = $${params.length}`;
      }

      if (status === "pending") {
        sql += ` AND wo.pickup_ready_at IS NULL AND wo.picked_up_at IS NULL`;
      } else if (status === "ready") {
        sql += ` AND wo.pickup_ready_at IS NOT NULL AND wo.picked_up_at IS NULL AND wo.curbside_arrived_at IS NULL`;
      } else if (status === "arrived") {
        sql += ` AND wo.curbside_arrived_at IS NOT NULL AND wo.picked_up_at IS NULL`;
      } else if (status === "completed") {
        sql += ` AND wo.picked_up_at IS NOT NULL`;
      }

      sql += ` ORDER BY wo.ordered_at DESC`;

      const { rows } = await db.query(sql, params);
      res.json({ orders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/shipping-orders ────────────────────────────
  // Returns storefront shipping orders allocated to an outlet (pending picking)

  app.get("/api/fulfillment/shipping-orders", perm, async (req, res) => {
    try {
      const { outlet_id } = req.query;
      if (!outlet_id) {
        return res.status(400).json({ error: "outlet_id required" });
      }

      const { rows } = await db.query(
        `SELECT woa.id AS allocation_id, woa.web_order_id, woa.web_order_item_id,
                woa.allocated_qty, woa.fulfillment_method, woa.status AS allocation_status,
                woi.product_id, woi.variant_id, woi.title, woi.qty AS ordered_qty, woi.unit_price,
                wo.external_order_id, wo.external_order_number, wo.fulfillment_status,
                wo.customer_name_snapshot AS customer_name,
                wo.ordered_at, wo.grand_total,
                p.name AS product_name, p.barcode AS product_barcode,
                pv.sku AS variant_name
         FROM web_order_allocations woa
         JOIN web_order_items woi ON woi.id = woa.web_order_item_id
         JOIN web_orders wo ON wo.id = woa.web_order_id
         LEFT JOIN products p ON woi.product_id = p.id
         LEFT JOIN product_variants pv ON woi.variant_id = pv.id
         WHERE woa.fulfillment_outlet_id = $1
           AND woa.fulfillment_method = 'ship_to_customer'
           AND woa.status = 'pending'
           AND wo.fulfillment_status IN ('unfulfilled', 'partially_fulfilled')
         ORDER BY wo.ordered_at ASC`,
        [outlet_id]
      );
      res.json({ orders: rows });
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

  // ══════════════════════════════════════════════════════════════════════
  // COD Reconciliation (Phase 5B)
  // ══════════════════════════════════════════════════════════════════════

  const codPerm = [requirePerm("manage_orders"), requireFeature("phase5_cod_reconciliation")];

  // ── GET /api/fulfillment/cod/settlements ────────────────────────────
  app.get("/api/fulfillment/cod/settlements", ...codPerm, async (req, res) => {
    try {
      const { courier_id, status } = req.query;
      const conds = [];
      const params = [];
      if (courier_id) { conds.push(`b.courier_id = $${params.length + 1}`); params.push(courier_id); }
      if (status) { conds.push(`b.status = $${params.length + 1}`); params.push(status); }

      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { rows } = await db.query(
        `SELECT b.*, ci.name AS courier_name
         FROM cod_settlement_batches b
         LEFT JOIN courier_integrations ci ON b.courier_id = ci.id
         ${where}
         ORDER BY b.imported_at DESC`,
        params
      );
      res.json({ batches: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/cod/settlements/import ────────────────────
  app.post("/api/fulfillment/cod/settlements/import", ...codPerm, async (req, res) => {
    try {
      const { courier_id, batch_ref, lines } = req.body || {};
      if (!courier_id) return res.status(400).json({ error: "courier_id required" });
      if (!lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ error: "lines array required (tracking_number, remitted_amount)" });
      }

      const result = await db.transaction(async (client) => {
        const totalAmount = lines.reduce((s, l) => s + (Number(l.remitted_amount) || 0), 0);

        const { rows: [batch] } = await client.query(
          `INSERT INTO cod_settlement_batches
            (courier_id, batch_ref, import_source, total_lines, total_amount, status, imported_by)
           VALUES ($1, $2, $3, $4, $5, 'imported', $6)
           RETURNING *`,
          [courier_id, batch_ref || null, req.body.import_source || "csv", lines.length, totalAmount, req.employee?.id || null]
        );

        for (const line of lines) {
          await client.query(
            `INSERT INTO cod_settlement_lines
              (batch_id, courier_tracking_number, courier_order_ref, remitted_amount, courier_fee)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              batch.id,
              line.tracking_number || line.courier_tracking_number || null,
              line.order_ref || line.courier_order_ref || null,
              Number(line.remitted_amount) || 0,
              Number(line.courier_fee) || 0,
            ]
          );
        }

        return batch;
      });

      res.json({ batch: result, lines_imported: lines.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/fulfillment/cod/settlements/:id ────────────────────────
  app.get("/api/fulfillment/cod/settlements/:id", ...codPerm, async (req, res) => {
    try {
      const { rows: [batch] } = await db.query(
        `SELECT b.*, ci.name AS courier_name
         FROM cod_settlement_batches b
         LEFT JOIN courier_integrations ci ON b.courier_id = ci.id
         WHERE b.id = $1`,
        [req.params.id]
      );
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      const { rows: lines } = await db.query(
        `SELECT sl.*,
                wo.external_order_number, wo.grand_total AS order_total, wo.payment_status
         FROM cod_settlement_lines sl
         LEFT JOIN web_orders wo ON sl.matched_order_id = wo.id
         WHERE sl.batch_id = $1
         ORDER BY sl.id`,
        [req.params.id]
      );

      res.json({ batch, lines });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/cod/settlements/:id/match ─────────────────
  app.post("/api/fulfillment/cod/settlements/:id/match", ...codPerm, async (req, res) => {
    try {
      const batchId = req.params.id;

      const result = await db.transaction(async (client) => {
        const { rows: [batch] } = await client.query(
          "SELECT * FROM cod_settlement_batches WHERE id = $1 FOR UPDATE",
          [batchId]
        );
        if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });

        await client.query(
          "UPDATE cod_settlement_batches SET status = 'matching' WHERE id = $1",
          [batchId]
        );

        const { rows: lines } = await client.query(
          "SELECT * FROM cod_settlement_lines WHERE batch_id = $1",
          [batchId]
        );

        let matchedCount = 0;
        let matchedAmount = 0;
        let unmatchedCount = 0;
        let shortAmount = 0;

        for (const line of lines) {
          // Try matching by tracking number first
          let matchedOrder = null;

          if (line.courier_tracking_number) {
            // Match against loadsheet_orders
            const { rows: lsMatch } = await client.query(
              `SELECT lo.id AS lo_id, lo.web_order_id, lo.cod_amount
               FROM loadsheet_orders lo
               WHERE lo.tracking_number = $1 AND lo.is_cod = true
               LIMIT 1`,
              [line.courier_tracking_number]
            );

            if (lsMatch.length) {
              matchedOrder = lsMatch[0];
            } else {
              // Try matching against web_orders.tracking_number
              const { rows: woMatch } = await client.query(
                `SELECT id AS web_order_id, grand_total AS cod_amount
                 FROM web_orders
                 WHERE tracking_number = $1 AND (payment_status = 'cod' OR payment_status = 'pending')
                 LIMIT 1`,
                [line.courier_tracking_number]
              );
              if (woMatch.length) {
                matchedOrder = woMatch[0];
              }
            }
          }

          // Fallback: match by order ref
          if (!matchedOrder && line.courier_order_ref) {
            const { rows: refMatch } = await client.query(
              `SELECT id AS web_order_id, grand_total AS cod_amount
               FROM web_orders
               WHERE external_order_number = $1 AND (payment_status = 'cod' OR payment_status = 'pending')
               LIMIT 1`,
              [line.courier_order_ref]
            );
            if (refMatch.length) matchedOrder = refMatch[0];
          }

          if (matchedOrder) {
            const expected = Number(matchedOrder.cod_amount);
            const remitted = Number(line.remitted_amount);
            const diff = remitted - expected;
            let matchStatus = "matched";
            if (diff < -0.01) matchStatus = "short";
            else if (diff > 0.01) matchStatus = "over";

            await client.query(
              `UPDATE cod_settlement_lines SET
                 match_status = $1, matched_order_id = $2,
                 matched_loadsheet_order_id = $3,
                 expected_amount = $4, difference = $5
               WHERE id = $6`,
              [
                matchStatus,
                matchedOrder.web_order_id,
                matchedOrder.lo_id || null,
                expected, diff,
                line.id,
              ]
            );

            matchedCount++;
            matchedAmount += remitted;
            if (matchStatus === "short") shortAmount += Math.abs(diff);
          } else {
            await client.query(
              "UPDATE cod_settlement_lines SET match_status = 'unmatched' WHERE id = $1",
              [line.id]
            );
            unmatchedCount++;
          }
        }

        // Check for duplicates (same tracking number matched to same order multiple times)
        await client.query(
          `UPDATE cod_settlement_lines SET match_status = 'duplicate'
           WHERE batch_id = $1 AND id NOT IN (
             SELECT MIN(id) FROM cod_settlement_lines
             WHERE batch_id = $1 AND matched_order_id IS NOT NULL
             GROUP BY matched_order_id
           ) AND matched_order_id IS NOT NULL`,
          [batchId]
        );

        // Update batch summary
        await client.query(
          `UPDATE cod_settlement_batches SET
             status = 'review',
             matched_count = $1, matched_amount = $2,
             unmatched_count = $3, short_amount = $4
           WHERE id = $5`,
          [matchedCount, matchedAmount, unmatchedCount, shortAmount, batchId]
        );

        return { matched: matchedCount, unmatched: unmatchedCount, short_amount: shortAmount };
      });

      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/cod/settlements/:id/resolve ───────────────
  app.post("/api/fulfillment/cod/settlements/:id/resolve", ...codPerm, async (req, res) => {
    try {
      const { line_id, resolution_note } = req.body || {};
      if (!line_id) return res.status(400).json({ error: "line_id required" });

      await db.query(
        `UPDATE cod_settlement_lines SET
           resolution_note = $1, resolved_by = $2, resolved_at = NOW()
         WHERE id = $3 AND batch_id = $4`,
        [resolution_note || "", req.employee?.id || null, line_id, req.params.id]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/fulfillment/cod/settlements/:id/approve ───────────────
  app.post("/api/fulfillment/cod/settlements/:id/approve", ...codPerm, async (req, res) => {
    try {
      const batchId = req.params.id;

      const result = await db.transaction(async (client) => {
        const { rows: [batch] } = await client.query(
          "SELECT * FROM cod_settlement_batches WHERE id = $1 FOR UPDATE",
          [batchId]
        );
        if (!batch) throw Object.assign(new Error("Batch not found"), { statusCode: 404 });
        if (batch.status !== "review") {
          throw Object.assign(new Error("Batch must be in review status to approve"), { statusCode: 400 });
        }

        await client.query(
          `UPDATE cod_settlement_batches SET
             status = 'approved', approved_by = $1, approved_at = NOW()
           WHERE id = $2`,
          [req.employee?.id || null, batchId]
        );

        // Update reconciliation status on associated loadsheets
        const { rows: matchedOrders } = await client.query(
          `SELECT DISTINCT lo.loadsheet_id
           FROM cod_settlement_lines sl
           JOIN loadsheet_orders lo ON sl.matched_loadsheet_order_id = lo.id
           WHERE sl.batch_id = $1 AND sl.matched_loadsheet_order_id IS NOT NULL`,
          [batchId]
        );

        for (const { loadsheet_id } of matchedOrders) {
          // Check if all COD orders in this loadsheet are now reconciled
          const { rows: [stats] } = await client.query(
            `SELECT
               SUM(lo.cod_amount) AS expected,
               COALESCE(SUM(sl.remitted_amount), 0) AS received
             FROM loadsheet_orders lo
             LEFT JOIN cod_settlement_lines sl ON sl.matched_loadsheet_order_id = lo.id
               AND sl.match_status IN ('matched','short','over')
             WHERE lo.loadsheet_id = $1 AND lo.is_cod = true`,
            [loadsheet_id]
          );

          const expected = Number(stats?.expected || 0);
          const received = Number(stats?.received || 0);
          const diff = received - expected;

          await client.query(
            `UPDATE loadsheets SET
               reconciliation_status = 'reconciled',
               reconciled_at = NOW(),
               reconciled_by = $1,
               expected_cod = $2,
               received_cod = $3,
               cod_difference = $4
             WHERE id = $5`,
            [req.employee?.id || null, expected, received, diff, loadsheet_id]
          );
        }

        return { approved: true, loadsheets_reconciled: matchedOrders.length };
      });

      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
