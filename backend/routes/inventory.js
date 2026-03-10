module.exports = function registerInventoryRoutes(app, deps) {
  const { db, requirePerm, createNotification } = deps;

  // Safe column addition — Postgres: use DO block to check if column exists
  (async () => {
    try {
      await db.query(`
        DO $$ BEGIN
          ALTER TABLE inventory_transfers ADD COLUMN reversed BOOLEAN DEFAULT false;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
      `);
    } catch { /* ignore */ }
  })();

  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const fn = deps.enqueueInventorySyncEvents;
      if (typeof fn === "function") return fn(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

// --- INVENTORY TRANSFERS ---

  // Get all transfers (with product, outlet, employee names)
  app.get("/api/transfers", async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT it.*,
               p.name as product_name, p.barcode,
               fo.name as from_outlet_name,
               to_o.name as to_outlet_name,
               e.name as employee_name
        FROM inventory_transfers it
        JOIN products p ON it.product_id = p.id
        JOIN outlets fo ON it.from_outlet_id = fo.id
        JOIN outlets to_o ON it.to_outlet_id = to_o.id
        LEFT JOIN employees e ON it.employee_id = e.id
        ORDER BY it.timestamp DESC
      `);
      res.json({ transfers: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new inventory transfer (atomically moves stock between outlets)
  app.post("/api/transfers", requirePerm("manage_inventory"), async (req, res) => {
    const {
      product_id,
      from_outlet_id,
      to_outlet_id,
      quantity,
      employee_id,
      note,
    } = req.body;

    if (!product_id || !from_outlet_id || !to_outlet_id || !quantity) {
      return res.status(400).json({
        error:
          "product_id, from_outlet_id, to_outlet_id, and quantity are required",
      });
    }
    if (from_outlet_id === to_outlet_id) {
      return res
        .status(400)
        .json({ error: "Source and destination outlets must be different" });
    }
    if (quantity <= 0) {
      return res
        .status(400)
        .json({ error: "Quantity must be greater than zero" });
    }

    try {
      // Validate sufficient stock in source outlet
      const { rows: stockRows } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2",
        [product_id, from_outlet_id],
      );
      const currentStock = stockRows.length ? stockRows[0].quantity : 0;
      if (currentStock < quantity) {
        return res.status(400).json({
          error: `Insufficient stock. Only ${currentStock} available at source outlet.`,
        });
      }

      await db.transaction(async (client) => {
        // 1. Record the transfer
        await client.query(
          `INSERT INTO inventory_transfers (product_id, from_outlet_id, to_outlet_id, quantity, employee_id, note)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [product_id, from_outlet_id, to_outlet_id, quantity, employee_id || null, note || null],
        );

        // 2. Deduct from source outlet
        await client.query(
          "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
          [quantity, product_id, from_outlet_id],
        );

        // 3. Add to destination outlet (upsert)
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
          [product_id, to_outlet_id, quantity, quantity],
        );
      });

      enqueueInventorySyncEvents(
        [
          {
            product_id,
            outlet_id: from_outlet_id,
            delta: -1 * Number(quantity || 0),
            reason: "transfer_out",
            reference_type: "transfer",
            reference_id: null,
          },
          {
            product_id,
            outlet_id: to_outlet_id,
            delta: Number(quantity || 0),
            reason: "transfer_in",
            reference_type: "transfer",
            reference_id: null,
          },
        ],
        {},
        () => {},
      );
      res.json({ message: "Transfer completed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reverse a completed inventory transfer
  app.post("/api/transfers/:id/reverse", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: transferRows } = await db.query(
        "SELECT * FROM inventory_transfers WHERE id = $1",
        [id],
      );
      if (!transferRows.length) return res.status(404).json({ error: "Transfer not found" });
      const transfer = transferRows[0];
      if (transfer.reversed) return res.status(400).json({ error: "Transfer has already been reversed" });

      const { product_id, from_outlet_id, to_outlet_id, quantity } = transfer;

      await db.transaction(async (client) => {
        // Mark original as reversed
        await client.query(
          "UPDATE inventory_transfers SET reversed = true WHERE id = $1",
          [id],
        );

        // Deduct from to_outlet (reversal)
        await client.query(
          "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
          [quantity, product_id, to_outlet_id],
        );

        // Add back to from_outlet
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
          [product_id, from_outlet_id, quantity, quantity],
        );

        // Insert reversal transfer record
        await client.query(
          `INSERT INTO inventory_transfers (product_id, from_outlet_id, to_outlet_id, quantity, employee_id, note, reversed)
           VALUES ($1, $2, $3, $4, $5, $6, false)`,
          [product_id, to_outlet_id, from_outlet_id, quantity, transfer.employee_id || null, `Reversal of transfer #${id}`],
        );
      });

      res.json({ message: "Transfer reversed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- STOCK ADJUSTMENTS ---

  app.get("/api/adjustments", async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT sa.*, p.name as product_name, p.barcode, o.name as outlet_name, e.name as employee_name
        FROM stock_adjustments sa
        JOIN products p ON sa.product_id = p.id
        JOIN outlets o ON sa.outlet_id = o.id
        LEFT JOIN employees e ON sa.employee_id = e.id
        ORDER BY sa.timestamp DESC
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/adjustments", requirePerm("manage_inventory"), async (req, res) => {
    const { product_id, outlet_id, employee_id, quantity_change, reason } =
      req.body;

    if (!product_id || !outlet_id || quantity_change === undefined || !reason) {
      return res
        .status(400)
        .json({ error: "Missing required fields for stock adjustment" });
    }

    try {
      let adjustmentId;
      await db.transaction(async (client) => {
        // Insert adjustment record
        const { rows } = await client.query(
          `INSERT INTO stock_adjustments (product_id, outlet_id, employee_id, quantity_change, reason)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [product_id, outlet_id, employee_id || null, quantity_change, reason],
        );
        adjustmentId = rows[0].id;

        // Upsert outlet_stock
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT(product_id, outlet_id)
           DO UPDATE SET quantity = outlet_stock.quantity + $4`,
          [product_id, outlet_id, quantity_change, quantity_change],
        );
      });

      enqueueInventorySyncEvents(
        [
          {
            product_id,
            outlet_id,
            delta: Number(quantity_change || 0),
            reason: "adjustment",
            reference_type: "adjustment",
            reference_id: adjustmentId || null,
          },
        ],
        {},
        () => {},
      );
      res.json({ message: "Stock adjusted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update adjustment notes/reason only (no stock recalculation)
  app.put("/api/adjustments/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { reason, notes } = req.body;
    try {
      const { rowCount } = await db.query(
        `UPDATE stock_adjustments
         SET reason = COALESCE($1, reason),
             notes  = COALESCE($2, notes)
         WHERE id = $3`,
        [reason || null, notes || null, id],
      );
      if (rowCount === 0) return res.status(404).json({ error: "Adjustment not found" });
      res.json({ message: "Adjustment updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete adjustment and reverse stock effect
  app.delete("/api/adjustments/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: adjRows } = await db.query("SELECT * FROM stock_adjustments WHERE id = $1", [id]);
      if (!adjRows.length) return res.status(404).json({ error: "Adjustment not found" });
      const adj = adjRows[0];

      const reversal = -Number(adj.quantity_change || 0);
      await db.transaction(async (client) => {
        await client.query(
          "UPDATE outlet_stock SET quantity = quantity + $1 WHERE product_id = $2 AND outlet_id = $3",
          [reversal, adj.product_id, adj.outlet_id],
        );
        await client.query("DELETE FROM stock_adjustments WHERE id = $1", [id]);
      });

      res.json({ message: "Adjustment deleted and stock reversed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
