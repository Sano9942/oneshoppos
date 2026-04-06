const { validate } = require("../middleware/validate");
const { CreateTransferSchema, CreateAdjustmentSchema } = require("../schemas/inventory");

module.exports = function registerInventoryRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, createNotification } = deps;

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
  app.get("/api/transfers", requireAnyPerm(["manage_inventory", "view_reports", "all_access"]), async (req, res) => {
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
  app.post("/api/transfers", requirePerm("manage_inventory"), validate(CreateTransferSchema), async (req, res) => {
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

  app.get("/api/adjustments", requireAnyPerm(["manage_inventory", "view_reports", "all_access"]), async (req, res) => {
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

  app.post("/api/adjustments", requirePerm("manage_inventory"), validate(CreateAdjustmentSchema), async (req, res) => {
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

  // --- STOCK COUNTS (Inventory Audit) ---

  // List stock count sessions
  app.get("/api/stock-counts", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { status } = req.query;
      let sql = `
        SELECT sc.*, o.name as outlet_name, e.name as started_by_name,
               ce.name as completed_by_name,
               (SELECT COUNT(*) FROM stock_count_items sci WHERE sci.stock_count_id = sc.id AND sci.counted_qty > 0) as items_counted,
               (SELECT COUNT(*) FROM stock_count_items sci WHERE sci.stock_count_id = sc.id) as total_items
        FROM stock_counts sc
        JOIN outlets o ON sc.outlet_id = o.id
        LEFT JOIN employees e ON sc.started_by = e.id
        LEFT JOIN employees ce ON sc.completed_by = ce.id
      `;
      const params = [];
      if (status) {
        params.push(status);
        sql += ` WHERE sc.status = $1`;
      }
      sql += ` ORDER BY sc.started_at DESC`;
      const { rows } = await db.query(sql, params);
      res.json({ stockCounts: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single stock count with all items
  app.get("/api/stock-counts/:id", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rows: [count] } = await db.query(`
        SELECT sc.*, o.name as outlet_name, e.name as started_by_name, ce.name as completed_by_name
        FROM stock_counts sc
        JOIN outlets o ON sc.outlet_id = o.id
        LEFT JOIN employees e ON sc.started_by = e.id
        LEFT JOIN employees ce ON sc.completed_by = ce.id
        WHERE sc.id = $1
      `, [req.params.id]);
      if (!count) return res.status(404).json({ error: "Stock count not found" });

      const { rows: countItems } = await db.query(`
        SELECT sci.*, p.name as product_name, p.barcode, p.sku,
               (sci.counted_qty - sci.system_qty) as variance
        FROM stock_count_items sci
        JOIN products p ON sci.product_id = p.id
        WHERE sci.stock_count_id = $1
        ORDER BY sci.last_scanned_at DESC NULLS LAST, p.name
      `, [req.params.id]);

      res.json({ stockCount: count, items: countItems });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create new stock count — snapshots all products at the outlet
  app.post("/api/stock-counts", requirePerm("manage_inventory"), async (req, res) => {
    const { outlet_id, notes } = req.body;
    if (!outlet_id) return res.status(400).json({ error: "outlet_id is required" });

    try {
      // Generate count number: SC-YYYYMMDD-NNN
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const { rows: [{ cnt }] } = await db.query(
        `SELECT COUNT(*)::int as cnt FROM stock_counts WHERE count_number LIKE $1`,
        [`SC-${today}-%`]
      );
      const countNumber = `SC-${today}-${String(cnt + 1).padStart(3, "0")}`;

      let countId;
      await db.transaction(async (client) => {
        const { rows: [created] } = await client.query(
          `INSERT INTO stock_counts (count_number, outlet_id, started_by, notes)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [countNumber, outlet_id, req.employee?.id || null, notes || null]
        );
        countId = created.id;

        // Snapshot current stock for all products at this outlet
        await client.query(`
          INSERT INTO stock_count_items (stock_count_id, product_id, system_qty)
          SELECT $1, p.id, COALESCE(os.quantity, 0)
          FROM products p
          LEFT JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = $2
          WHERE p.deleted_at IS NULL AND p.status = 'active'
        `, [countId, outlet_id]);
      });

      const { rows: [count] } = await db.query(
        `SELECT sc.*, o.name as outlet_name FROM stock_counts sc JOIN outlets o ON sc.outlet_id = o.id WHERE sc.id = $1`,
        [countId]
      );
      res.json({ stockCount: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Scan barcode — increment counted_qty for the matching product
  app.post("/api/stock-counts/:id/scan", requirePerm("manage_inventory"), async (req, res) => {
    const { barcode } = req.body;
    if (!barcode) return res.status(400).json({ error: "barcode is required" });

    try {
      // Verify count exists and is in_progress
      const { rows: [count] } = await db.query(
        "SELECT * FROM stock_counts WHERE id = $1", [req.params.id]
      );
      if (!count) return res.status(404).json({ error: "Stock count not found" });
      if (count.status !== "in_progress") return res.status(400).json({ error: "Stock count is not in progress" });

      // Find product by barcode or SKU
      const { rows: [product] } = await db.query(
        "SELECT id, name, barcode, sku FROM products WHERE deleted_at IS NULL AND (barcode = $1 OR sku = $1)",
        [barcode]
      );
      if (!product) return res.status(404).json({ error: "Product not found for barcode: " + barcode });

      // Upsert into count items (increment counted_qty)
      const { rows: [item] } = await db.query(`
        INSERT INTO stock_count_items (stock_count_id, product_id, system_qty, counted_qty, last_scanned_at)
        VALUES ($1, $2, 0, 1, NOW())
        ON CONFLICT (stock_count_id, product_id, variant_id)
        DO UPDATE SET counted_qty = stock_count_items.counted_qty + 1, last_scanned_at = NOW()
        RETURNING *, (stock_count_items.counted_qty - stock_count_items.system_qty) as variance
      `, [req.params.id, product.id]);

      res.json({ item: { ...item, product_name: product.name, barcode: product.barcode, sku: product.sku } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manually set counted_qty for a specific item
  app.put("/api/stock-counts/:id/items/:itemId", requirePerm("manage_inventory"), async (req, res) => {
    const { counted_qty } = req.body;
    if (counted_qty === undefined || counted_qty < 0) {
      return res.status(400).json({ error: "counted_qty must be a non-negative number" });
    }
    try {
      const { rows: [count] } = await db.query(
        "SELECT status FROM stock_counts WHERE id = $1", [req.params.id]
      );
      if (!count) return res.status(404).json({ error: "Stock count not found" });
      if (count.status !== "in_progress") return res.status(400).json({ error: "Stock count is not in progress" });

      const { rows: [item], rowCount } = await db.query(`
        UPDATE stock_count_items SET counted_qty = $1, last_scanned_at = NOW()
        WHERE id = $2 AND stock_count_id = $3
        RETURNING *, (counted_qty - system_qty) as variance
      `, [counted_qty, req.params.itemId, req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Item not found" });
      res.json({ item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Complete count — finalize, calculate variances, optionally auto-adjust
  app.post("/api/stock-counts/:id/complete", requirePerm("manage_inventory"), async (req, res) => {
    const autoAdjust = req.query.auto_adjust === "true";
    try {
      const { rows: [count] } = await db.query(
        "SELECT * FROM stock_counts WHERE id = $1", [req.params.id]
      );
      if (!count) return res.status(404).json({ error: "Stock count not found" });
      if (count.status !== "in_progress") return res.status(400).json({ error: "Stock count is not in progress" });

      await db.transaction(async (client) => {
        // Mark completed
        await client.query(
          `UPDATE stock_counts SET status = 'completed', completed_by = $1, completed_at = NOW() WHERE id = $2`,
          [req.employee?.id || null, req.params.id]
        );

        if (autoAdjust) {
          // Get items with variance
          const { rows: variances } = await client.query(`
            SELECT sci.product_id, sci.system_qty, sci.counted_qty, (sci.counted_qty - sci.system_qty) as variance
            FROM stock_count_items sci
            WHERE sci.stock_count_id = $1 AND sci.counted_qty != sci.system_qty
          `, [req.params.id]);

          for (const v of variances) {
            // Create stock adjustment
            await client.query(
              `INSERT INTO stock_adjustments (product_id, outlet_id, employee_id, quantity_change, reason)
               VALUES ($1, $2, $3, $4, $5)`,
              [v.product_id, count.outlet_id, req.employee?.id || null, v.variance, `Stock count ${count.count_number}`]
            );
            // Update outlet_stock
            await client.query(
              `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
               VALUES ($1, $2, $3)
               ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
              [v.product_id, count.outlet_id, v.variance, v.variance]
            );
          }
        }
      });

      // Return variance summary
      const { rows: summary } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE counted_qty != system_qty)::int as items_with_variance,
          COUNT(*) FILTER (WHERE counted_qty > system_qty)::int as items_over,
          COUNT(*) FILTER (WHERE counted_qty < system_qty)::int as items_under,
          COUNT(*) FILTER (WHERE counted_qty = 0 AND system_qty > 0)::int as items_not_counted,
          COALESCE(SUM(counted_qty - system_qty) FILTER (WHERE counted_qty > system_qty), 0)::int as total_over,
          COALESCE(SUM(system_qty - counted_qty) FILTER (WHERE counted_qty < system_qty), 0)::int as total_under,
          COUNT(*)::int as total_items
        FROM stock_count_items WHERE stock_count_id = $1
      `, [req.params.id]);

      res.json({ message: "Stock count completed", autoAdjusted: autoAdjust, summary: summary[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Variance report — export-ready data
  app.get("/api/stock-counts/:id/variance-report", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rows: [count] } = await db.query(
        "SELECT * FROM stock_counts WHERE id = $1", [req.params.id]
      );
      if (!count) return res.status(404).json({ error: "Stock count not found" });

      const { rows } = await db.query(`
        SELECT sci.product_id, p.name as product_name, p.barcode, p.sku,
               sci.system_qty, sci.counted_qty,
               (sci.counted_qty - sci.system_qty) as variance,
               sci.last_scanned_at
        FROM stock_count_items sci
        JOIN products p ON sci.product_id = p.id
        WHERE sci.stock_count_id = $1
        ORDER BY ABS(sci.counted_qty - sci.system_qty) DESC, p.name
      `, [req.params.id]);

      res.json({ countNumber: count.count_number, status: count.status, items: rows });
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
