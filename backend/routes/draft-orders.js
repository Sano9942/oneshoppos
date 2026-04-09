module.exports = function registerDraftOrderRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  const feat = requireFeature("phase2_draft_orders");

  // List draft orders
  app.get("/api/draft-orders", feat, async (req, res) => {
    try {
      const { outlet_id, status, created_by } = req.query;
      let sql = `
        SELECT d.*, e.name AS created_by_name, cl.name AS claimed_by_name,
               c.name AS customer_name, o.name AS outlet_name,
               COUNT(di.id)::int AS item_count
        FROM draft_orders d
        LEFT JOIN employees e ON d.created_by = e.id
        LEFT JOIN employees cl ON d.claimed_by = cl.id
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN outlets o ON d.outlet_id = o.id
        LEFT JOIN draft_order_items di ON di.draft_order_id = d.id
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;
      if (outlet_id) { sql += ` AND d.outlet_id = $${idx++}`; params.push(outlet_id); }
      if (status) {
        const statuses = status.split(",").map(s => s.trim());
        sql += ` AND d.status = ANY($${idx++})`;
        params.push(statuses);
      }
      if (created_by) { sql += ` AND d.created_by = $${idx++}`; params.push(created_by); }
      sql += " GROUP BY d.id, e.name, cl.name, c.name, o.name ORDER BY d.updated_at DESC";
      const { rows } = await db.query(sql, params);
      res.json({ draftOrders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get draft order detail
  app.get("/api/draft-orders/:id", feat, async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: [order] } = await db.query(
        `SELECT d.*, e.name AS created_by_name, cl.name AS claimed_by_name,
                c.name AS customer_name, o.name AS outlet_name
         FROM draft_orders d
         LEFT JOIN employees e ON d.created_by = e.id
         LEFT JOIN employees cl ON d.claimed_by = cl.id
         LEFT JOIN customers c ON d.customer_id = c.id
         LEFT JOIN outlets o ON d.outlet_id = o.id
         WHERE d.id = $1`,
        [id]
      );
      if (!order) return res.status(404).json({ error: "Draft order not found" });
      const { rows: items } = await db.query(
        "SELECT * FROM draft_order_items WHERE draft_order_id = $1 ORDER BY id",
        [id]
      );
      res.json({ draftOrder: order, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create draft order
  app.post("/api/draft-orders", feat, async (req, res) => {
    const { outlet_id, customer_id, notes, items } = req.body;
    const createdBy = Number(req.headers["x-employee-id"] || 0);
    if (!createdBy) return res.status(401).json({ error: "Unauthorized" });
    if (!outlet_id) return res.status(400).json({ error: "outlet_id is required" });
    if (!items || items.length === 0) return res.status(400).json({ error: "items are required" });

    try {
      const result = await db.transaction(async (client) => {
        let subtotal = 0, taxTotal = 0, discountTotal = 0;
        for (const item of items) {
          const lineSubtotal = Number(item.price) * Number(item.quantity);
          const lineTax = lineSubtotal * (Number(item.effective_tax_rate || 0) / 100);
          subtotal += lineSubtotal;
          taxTotal += lineTax;
          discountTotal += Number(item.discount || 0);
        }
        const total = subtotal + taxTotal - discountTotal;

        const { rows: [order] } = await client.query(
          `INSERT INTO draft_orders (outlet_id, customer_id, created_by, notes, subtotal, tax_total, discount_total, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [outlet_id, customer_id || null, createdBy, notes || null,
           subtotal.toFixed(2), taxTotal.toFixed(2), discountTotal.toFixed(2), total.toFixed(2)]
        );

        for (const item of items) {
          await client.query(
            `INSERT INTO draft_order_items (draft_order_id, product_id, variant_id, product_name, quantity, price, discount, effective_tax_rate, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [order.id, item.product_id || null, item.variant_id || null,
             item.product_name || item.name || "", item.quantity, item.price,
             item.discount || 0, item.effective_tax_rate || 0, item.notes || null]
          );
        }
        return order;
      });
      res.status(201).json({ draftOrder: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update draft order
  app.put("/api/draft-orders/:id", feat, async (req, res) => {
    const { id } = req.params;
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    const { customer_id, notes, items } = req.body;

    try {
      const { rows: [existing] } = await db.query("SELECT * FROM draft_orders WHERE id = $1", [id]);
      if (!existing) return res.status(404).json({ error: "Draft order not found" });
      if (existing.status === "completed" || existing.status === "cancelled") {
        return res.status(400).json({ error: "Cannot edit a completed or cancelled draft" });
      }
      if (existing.status === "claimed" && existing.claimed_by !== employeeId) {
        return res.status(403).json({ error: "This draft is claimed by another employee" });
      }

      const result = await db.transaction(async (client) => {
        if (items && items.length > 0) {
          await client.query("DELETE FROM draft_order_items WHERE draft_order_id = $1", [id]);
          let subtotal = 0, taxTotal = 0, discountTotal = 0;
          for (const item of items) {
            const lineSubtotal = Number(item.price) * Number(item.quantity);
            const lineTax = lineSubtotal * (Number(item.effective_tax_rate || 0) / 100);
            subtotal += lineSubtotal;
            taxTotal += lineTax;
            discountTotal += Number(item.discount || 0);
            await client.query(
              `INSERT INTO draft_order_items (draft_order_id, product_id, variant_id, product_name, quantity, price, discount, effective_tax_rate, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [id, item.product_id || null, item.variant_id || null,
               item.product_name || item.name || "", item.quantity, item.price,
               item.discount || 0, item.effective_tax_rate || 0, item.notes || null]
            );
          }
          const total = subtotal + taxTotal - discountTotal;
          await client.query(
            `UPDATE draft_orders SET customer_id = $1, notes = $2, subtotal = $3, tax_total = $4, discount_total = $5, total = $6, updated_at = NOW()
             WHERE id = $7`,
            [customer_id ?? existing.customer_id, notes ?? existing.notes,
             subtotal.toFixed(2), taxTotal.toFixed(2), discountTotal.toFixed(2), total.toFixed(2), id]
          );
        } else {
          await client.query(
            "UPDATE draft_orders SET customer_id = COALESCE($1, customer_id), notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $3",
            [customer_id, notes, id]
          );
        }
        const { rows: [updated] } = await client.query("SELECT * FROM draft_orders WHERE id = $1", [id]);
        return updated;
      });
      res.json({ draftOrder: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Claim draft order
  app.post("/api/draft-orders/:id/claim", feat, async (req, res) => {
    const { id } = req.params;
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { rows, rowCount } = await db.query(
        `UPDATE draft_orders
         SET claimed_by = $1, claimed_at = NOW(), status = 'claimed', updated_at = NOW()
         WHERE id = $2 AND (status = 'open' OR (status = 'claimed' AND claimed_by = $1))
         RETURNING *`,
        [employeeId, id]
      );
      if (rowCount === 0) {
        const { rows: [current] } = await db.query("SELECT status, claimed_by FROM draft_orders WHERE id = $1", [id]);
        if (!current) return res.status(404).json({ error: "Draft order not found" });
        if (current.status === "claimed" && current.claimed_by !== employeeId) {
          return res.status(409).json({ error: "Already claimed by another employee" });
        }
        return res.status(400).json({ error: "Cannot claim this draft order" });
      }
      res.json({ draftOrder: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Complete draft order (convert to sale)
  app.post("/api/draft-orders/:id/complete", feat, async (req, res) => {
    const { id } = req.params;
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { rows: [draft] } = await db.query(
        "SELECT * FROM draft_orders WHERE id = $1", [id]
      );
      if (!draft) return res.status(404).json({ error: "Draft order not found" });
      if (draft.status !== "claimed" || draft.claimed_by !== employeeId) {
        return res.status(400).json({ error: "Only the claiming employee can complete this draft" });
      }

      await db.query(
        "UPDATE draft_orders SET status = 'completed', updated_at = NOW() WHERE id = $1",
        [id]
      );

      // Return draft data for POS to create the sale
      const { rows: items } = await db.query(
        "SELECT * FROM draft_order_items WHERE draft_order_id = $1", [id]
      );
      res.json({ completed: true, draftOrder: draft, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cancel draft order
  app.delete("/api/draft-orders/:id", feat, async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query(
        "UPDATE draft_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('open','claimed')",
        [id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Draft order not found or already completed" });
      res.json({ message: "Draft order cancelled" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
