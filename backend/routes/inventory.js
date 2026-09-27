const { validate } = require("../middleware/validate");
const { CreateTransferSchema, CreateAdjustmentSchema } = require("../schemas/inventory");
const kitEngine = require("../services/kit-engine");
const batchStock = require("../services/batch-stock");
const stockLedger = require("../services/stock-ledger");
const productHistory = require("../services/product-history");

module.exports = function registerInventoryRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, createNotification } = deps;

  // NOTE: `inventory_transfers.reversed` is declared in schema-pg.sql (the DDL
  // source of truth). A previous inline `ALTER TABLE … ADD COLUMN` IIFE lived
  // here but ran against the ALS proxy at module-load time with no tenant
  // context, so it always threw and was silently discarded — a no-op. Removed.

  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const fn = deps.enqueueInventorySyncEvents;
      if (typeof fn === "function") return fn(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

// --- INVENTORY TRANSFERS ---

  // Get all transfers (with product, outlet, employee names)
  app.get("/api/transfers", requireAnyPerm(["manage_inventory", "view_inventory_reports", "all_access"]), async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT it.*,
               p.name as product_name, p.barcode,
               pv.sku as variant_sku,
               fo.name as from_outlet_name,
               to_o.name as to_outlet_name,
               e.name as employee_name
        FROM inventory_transfers it
        JOIN products p ON it.product_id = p.id
        LEFT JOIN product_variants pv ON it.variant_id = pv.id
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
  // 2-G.1 follow-up: when variant_id is supplied, the transfer gates on
  // variant_outlet_stock at the source outlet and updates all three tables
  // (variant_outlet_stock, product_variants.stock rollup, outlet_stock) in
  // sync. When variant_id is null, legacy product-level behavior is unchanged.
  app.post("/api/transfers", requirePerm("manage_inventory"), validate(CreateTransferSchema), async (req, res) => {
    const {
      product_id,
      variant_id,
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
    // F01: kits hold no stock of their own — transfer the components instead.
    if ((await kitEngine.getBomType(db, product_id)) === "kit") {
      return res.status(400).json({
        error: "Kits have no stock of their own — transfer their components instead.",
        code: "kit_no_stock",
      });
    }

    try {
      if (variant_id) {
        // Variant-aware stock check (prefer per-outlet, fall back to rollup)
        const { rows: vosRows } = await db.query(
          "SELECT quantity FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = $2",
          [variant_id, from_outlet_id],
        );
        const currentStock = vosRows.length
          ? Number(vosRows[0].quantity)
          : null;
        if (currentStock === null) {
          const { rows: rollupRows } = await db.query(
            "SELECT stock FROM product_variants WHERE id = $1",
            [variant_id],
          );
          const rollup = rollupRows.length ? Number(rollupRows[0].stock) : 0;
          if (rollup < quantity) {
            return res.status(400).json({
              error: `Insufficient stock. Only ${rollup} available for this variant.`,
            });
          }
        } else if (currentStock < quantity) {
          return res.status(400).json({
            error: `Insufficient stock. Only ${currentStock} available at source outlet.`,
          });
        }
      } else {
        // Product-level stock check (unchanged)
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
      }

      let transferId = null;
      await db.transaction(async (client) => {
        // 1. Record the transfer (with optional variant_id)
        const { rows: [transferRow] } = await client.query(
          `INSERT INTO inventory_transfers (product_id, variant_id, from_outlet_id, to_outlet_id, quantity, employee_id, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [product_id, variant_id || null, from_outlet_id, to_outlet_id, quantity, employee_id || null, note || null],
        );
        transferId = transferRow.id;

        // 2. WS1a: move the on-hand total through the shared stock helper.
        // decrementStock at source takes the FOR UPDATE + availability gate the
        // old in-tx decrement lacked (closing the oversell race) and writes all
        // three tables when a variant is present; incrementStock mirrors it at
        // the destination. Because the source subtracts and the destination adds
        // the same qty to product_variants.stock, the cross-outlet rollup nets to
        // zero — correct for a transfer. Batch identity is moved separately below
        // (transferBatches preserves batch_number/expiry), so skip the helper's
        // own batch handling on both legs.
        await stockLedger.decrementStock(client, {
          productId: product_id,
          variantId: variant_id || null,
          outletId: from_outlet_id,
          qty: quantity,
          manageBatch: false,
          refType: "transfer",
          refId: transferRow.id,
        });
        await stockLedger.incrementStock(client, {
          productId: product_id,
          variantId: variant_id || null,
          outletId: to_outlet_id,
          qty: quantity,
          manageBatch: false,
          refType: "transfer",
          refId: transferRow.id,
        });

        // 4. F07: move batch IDENTITY, not just quantity. FEFO-consume at source
        // and recreate the consumed slices at the destination preserving
        // batch_number/expiry/unit_cost — so mithai keeps its 2-day expiry when
        // it moves between branches. No-op for untracked products.
        await batchStock.transferBatches(client, {
          productId: product_id,
          variantId: variant_id || null,
          fromOutletId: from_outlet_id,
          toOutletId: to_outlet_id,
          qty: quantity,
          refType: "transfer",
          refId: transferRow.id,
        });
        await productHistory.tagChanges(client, {
          kind: "transfer", refType: "transfer", refId: transferRow.id,
          employeeId: productHistory.actorOf(req) ?? (employee_id || null), note: note || null,
        });
      });

      enqueueInventorySyncEvents(
        [
          {
            product_id,
            variant_id: variant_id || null,
            outlet_id: from_outlet_id,
            delta: -1 * Number(quantity || 0),
            reason: "transfer_out",
            reference_type: "transfer",
            reference_id: transferId,
          },
          {
            product_id,
            variant_id: variant_id || null,
            outlet_id: to_outlet_id,
            delta: Number(quantity || 0),
            reason: "transfer_in",
            reference_type: "transfer",
            reference_id: transferId,
          },
        ],
        {},
        () => {},
      );
      res.json({ message: "Transfer completed successfully" });
    } catch (err) {
      // WS1a: the in-tx availability gate throws a typed 400 (insufficient_stock);
      // surface it instead of masking every failure as a 500.
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });

  // Reverse a completed inventory transfer
  // 2-G.1 follow-up: if the original transfer carried a variant_id, the
  // reversal mirrors the variant_outlet_stock adjustments at both outlets.
  app.post("/api/transfers/:id/reverse", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: transferRows } = await db.query(
        "SELECT * FROM inventory_transfers WHERE id = $1",
        [id],
      );
      if (!transferRows.length) return res.status(404).json({ error: "Transfer not found" });
      const transfer = transferRows[0];
      if (transfer.reversed) return res.status(400).json({ error: "Transfer has already been reversed" });

      const { product_id, variant_id, from_outlet_id, to_outlet_id, quantity } = transfer;

      await db.transaction(async (client) => {
        // Mark original as reversed
        await client.query(
          "UPDATE inventory_transfers SET reversed = true WHERE id = $1",
          [id],
        );

        // Product-level reversal
        await client.query(
          "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
          [quantity, product_id, to_outlet_id],
        );
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $3`,
          [product_id, from_outlet_id, quantity],
        );

        // Variant-level reversal (mirrors the original direction)
        if (variant_id) {
          await client.query(
            `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
               VALUES ($1, $2, 0 - $3::numeric)
               ON CONFLICT (variant_id, outlet_id)
               DO UPDATE SET quantity = variant_outlet_stock.quantity - $3::numeric`,
            [variant_id, to_outlet_id, quantity],
          );
          await client.query(
            `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
               VALUES ($1, $2, $3::numeric)
               ON CONFLICT (variant_id, outlet_id)
               DO UPDATE SET quantity = variant_outlet_stock.quantity + $3::numeric`,
            [variant_id, from_outlet_id, quantity],
          );
        }

        // Insert reversal transfer record (preserves variant_id for audit)
        await client.query(
          `INSERT INTO inventory_transfers (product_id, variant_id, from_outlet_id, to_outlet_id, quantity, employee_id, note, reversed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
          [product_id, variant_id || null, to_outlet_id, from_outlet_id, quantity, transfer.employee_id || null, `Reversal of transfer #${id}`],
        );
      });

      res.json({ message: "Transfer reversed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- STOCK ADJUSTMENTS ---

  app.get("/api/adjustments", requireAnyPerm(["manage_inventory", "view_inventory_reports", "all_access"]), async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT sa.*, p.name as product_name, p.barcode,
               pv.sku as variant_sku,
               o.name as outlet_name, e.name as employee_name
        FROM stock_adjustments sa
        JOIN products p ON sa.product_id = p.id
        LEFT JOIN product_variants pv ON sa.variant_id = pv.id
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
    const { product_id, variant_id, outlet_id, employee_id, quantity_change, reason } =
      req.body;

    if (!product_id || !outlet_id || quantity_change === undefined || !reason) {
      return res
        .status(400)
        .json({ error: "Missing required fields for stock adjustment" });
    }
    // F01: kits hold no stock of their own — adjust the components instead.
    if ((await kitEngine.getBomType(db, product_id)) === "kit") {
      return res.status(400).json({
        error: "Kits have no stock of their own — adjust their components instead.",
        code: "kit_no_stock",
      });
    }

    try {
      let adjustmentId;
      await db.transaction(async (client) => {
        // Insert adjustment record (with optional variant_id)
        const { rows } = await client.query(
          `INSERT INTO stock_adjustments (product_id, variant_id, outlet_id, employee_id, quantity_change, reason)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [product_id, variant_id || null, outlet_id, employee_id || null, quantity_change, reason],
        );
        adjustmentId = rows[0].id;

        // Upsert product-level outlet_stock (always)
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT(product_id, outlet_id)
           DO UPDATE SET quantity = outlet_stock.quantity + $3`,
          [product_id, outlet_id, quantity_change],
        );

        // 2-G.1 follow-up: variant-scoped adjustment also updates
        // variant_outlet_stock (upsert) + product_variants.stock rollup.
        if (variant_id) {
          await client.query(
            `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
               VALUES ($1, $2, $3::numeric)
               ON CONFLICT (variant_id, outlet_id)
               DO UPDATE SET quantity = variant_outlet_stock.quantity + $3::numeric`,
            [variant_id, outlet_id, quantity_change],
          );
          await client.query(
            "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
            [quantity_change, variant_id],
          );
        }

        // F07: mirror the adjustment into the batch ledger. Negative deltas
        // FEFO-consume; positive add to the newest batch. Expiry/damage/spoilage
        // reasons flip fully-consumed batches to 'written_off' (vs 'depleted')
        // so the write-off report can distinguish them. No-op for untracked.
        const isWriteOff =
          Number(quantity_change) < 0 &&
          /expir|write.?off|damage|spoil|scrap/i.test(String(reason || ""));
        await batchStock.adjustBatches(client, {
          productId: product_id,
          variantId: variant_id || null,
          outletId: outlet_id,
          delta: Number(quantity_change),
          movementType: isWriteOff ? "write_off" : "adjust",
          refType: "adjustment",
          refId: adjustmentId,
        });
        await productHistory.tagChanges(client, {
          kind: "adjustment", refType: "adjustment", refId: adjustmentId,
          employeeId: productHistory.actorOf(req) ?? (employee_id || null), note: reason,
        });
      });

      enqueueInventorySyncEvents(
        [
          {
            product_id,
            variant_id: variant_id || null,
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
               (SELECT COUNT(*) FROM stock_count_items sci WHERE sci.stock_count_id = sc.id AND sci.last_scanned_at IS NOT NULL) as items_counted,
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

      // Find product by barcode or SKU, then a variant by its own barcode/SKU
      // (e.g. one car in a Hot Wheels assortment).
      let { rows: [product] } = await db.query(
        "SELECT id, name, barcode, sku, NULL::int AS variant_id FROM products WHERE deleted_at IS NULL AND (barcode = $1 OR sku = $1)",
        [barcode]
      );
      if (!product) {
        ({ rows: [product] } = await db.query(
          `SELECT p.id, p.name, pv.barcode, pv.sku, pv.id AS variant_id
             FROM product_variants pv JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
            WHERE pv.barcode = $1 OR pv.sku = $1
            ORDER BY (pv.barcode = $1) DESC, pv.id LIMIT 1`,
          [barcode]
        ));
      }
      if (!product) return res.status(404).json({ error: "Product not found for barcode: " + barcode });

      // Add to the existing count line. Not ON CONFLICT: the unique index is on
      // (stock_count_id, product_id, variant_id) and NULLs never conflict, so for
      // every plain product each scan inserted a fresh line with system_qty 0.
      const { rows: [existing] } = await db.query(
        `SELECT id FROM stock_count_items
          WHERE stock_count_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3
          ORDER BY id LIMIT 1`,
        [req.params.id, product.id, product.variant_id]
      );
      let item;
      if (existing) {
        ({ rows: [item] } = await db.query(
          `UPDATE stock_count_items SET counted_qty = counted_qty + 1, last_scanned_at = NOW()
            WHERE id = $1 RETURNING *, (counted_qty - system_qty) AS variance`,
          [existing.id]
        ));
      } else {
        // A line the opening snapshot didn't include (a variant, or a product
        // created after the count started): snapshot its on-hand now.
        const { rows: [onHand] } = product.variant_id
          ? await db.query("SELECT COALESCE(quantity, 0) AS qty FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = $2", [product.variant_id, count.outlet_id])
          : await db.query("SELECT COALESCE(quantity, 0) AS qty FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2", [product.id, count.outlet_id]);
        ({ rows: [item] } = await db.query(
          `INSERT INTO stock_count_items (stock_count_id, product_id, variant_id, system_qty, counted_qty, last_scanned_at)
           VALUES ($1, $2, $3, $4, 1, NOW())
           RETURNING *, (counted_qty - system_qty) AS variance`,
          [req.params.id, product.id, product.variant_id, Number(onHand?.qty || 0)]
        ));
      }

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

  // Complete count — finalize, calculate variances, optionally auto-adjust.
  //
  // A line is "counted" once it has been scanned or had a quantity typed in
  // (last_scanned_at IS NOT NULL); a line counted as 0 is still counted. By
  // default only counted lines are adjusted, so counting one shelf leaves the
  // rest of the shop alone. ?full_count=true is the wall-to-wall count: every
  // line not counted is taken as 0, including each variant with stock.
  //
  // A product with variants keeps its stock on the variant rows; its own
  // (variant_id NULL) line is never adjusted directly, otherwise the product
  // total and the variants would drift apart.
  app.post("/api/stock-counts/:id/complete", requirePerm("manage_inventory"), async (req, res) => {
    const autoAdjust = req.query.auto_adjust === "true";
    const fullCount = req.query.full_count === "true";
    try {
      const { rows: [count] } = await db.query(
        "SELECT * FROM stock_counts WHERE id = $1", [req.params.id]
      );
      if (!count) return res.status(404).json({ error: "Stock count not found" });
      if (count.status !== "in_progress") return res.status(400).json({ error: "Stock count is not in progress" });

      await db.transaction(async (client) => {
        // Claim the count atomically so two completes can't both adjust.
        const { rowCount: claimed } = await client.query(
          `UPDATE stock_counts SET status = 'completed', completed_by = $1, completed_at = NOW()
            WHERE id = $2 AND status = 'in_progress'`,
          [req.employee?.id || null, req.params.id]
        );
        if (!claimed) {
          throw Object.assign(new Error("Stock count is not in progress"), { statusCode: 400 });
        }

        if (autoAdjust && fullCount) {
          // Variants are only snapshotted when scanned; a full count must also
          // zero the ones nobody scanned.
          await client.query(`
            INSERT INTO stock_count_items (stock_count_id, product_id, variant_id, system_qty, counted_qty)
            SELECT $1, pv.product_id, vos.variant_id, vos.quantity, 0
              FROM variant_outlet_stock vos
              JOIN product_variants pv ON pv.id = vos.variant_id
              JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
             WHERE vos.outlet_id = $2 AND vos.quantity <> 0
               AND NOT EXISTS (SELECT 1 FROM stock_count_items x
                                WHERE x.stock_count_id = $1 AND x.variant_id = vos.variant_id)
          `, [req.params.id, count.outlet_id]);
        }

        if (autoAdjust) {
          // Get items with variance. WS1a: carry variant_id so a variant/batch
          // catalog no longer silently desyncs on a cycle count.
          const { rows: variances } = await client.query(`
            SELECT sci.product_id, sci.variant_id, sci.system_qty, sci.counted_qty, (sci.counted_qty - sci.system_qty) as variance
            FROM stock_count_items sci
            WHERE sci.stock_count_id = $1 AND sci.counted_qty != sci.system_qty
              AND (sci.last_scanned_at IS NOT NULL OR $2::boolean)
              AND NOT (sci.variant_id IS NULL
                       AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = sci.product_id))
          `, [req.params.id, fullCount]);

          for (const v of variances) {
            const variance = Number(v.variance);
            // Create stock adjustment
            await client.query(
              `INSERT INTO stock_adjustments (product_id, variant_id, outlet_id, employee_id, quantity_change, reason)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [v.product_id, v.variant_id || null, count.outlet_id, req.employee?.id || null, variance,
                `Stock count ${count.count_number}${fullCount ? " (full count)" : ""}`]
            );
            // WS1a: route the on-hand correction through the shared stock helper so
            // variant_outlet_stock + the product_variants rollup move in lockstep
            // with outlet_stock. A count is an authoritative correction, so the
            // downward path skips the availability gate (gate:false). The batch
            // ledger is reconciled separately via adjustBatches ('adjust' movement),
            // so the helper skips its own batch handling (manageBatch:false).
            if (variance > 0) {
              await stockLedger.incrementStock(client, {
                productId: v.product_id,
                variantId: v.variant_id || null,
                outletId: count.outlet_id,
                qty: variance,
                manageBatch: false,
                refType: "stock_count",
                refId: Number(req.params.id),
              });
            } else {
              await stockLedger.decrementStock(client, {
                productId: v.product_id,
                variantId: v.variant_id || null,
                outletId: count.outlet_id,
                qty: -variance,
                gate: false,
                manageBatch: false,
                refType: "stock_count",
                refId: Number(req.params.id),
              });
            }
            await batchStock.adjustBatches(client, {
              productId: v.product_id,
              variantId: v.variant_id || null,
              outletId: count.outlet_id,
              delta: variance,
              movementType: "adjust",
              refType: "stock_count",
              refId: Number(req.params.id),
            });
          }
        }
        await productHistory.tagChanges(client, {
          kind: "count", refType: "stock_count", refId: Number(req.params.id),
          employeeId: productHistory.actorOf(req),
        });
      });

      // Return variance summary. Variance figures cover the lines the count
      // decided on: counted lines, plus every line on a full count.
      const { rows: summary } = await db.query(`
        WITH decided AS (
          SELECT * FROM stock_count_items
           WHERE stock_count_id = $1 AND (last_scanned_at IS NOT NULL OR $2::boolean)
        )
        SELECT
          (SELECT COUNT(*) FILTER (WHERE counted_qty != system_qty) FROM decided)::int as items_with_variance,
          (SELECT COUNT(*) FILTER (WHERE counted_qty > system_qty) FROM decided)::int as items_over,
          (SELECT COUNT(*) FILTER (WHERE counted_qty < system_qty) FROM decided)::int as items_under,
          (SELECT COUNT(*) FROM stock_count_items WHERE stock_count_id = $1 AND last_scanned_at IS NULL)::int as items_not_counted,
          (SELECT COALESCE(SUM(counted_qty - system_qty) FILTER (WHERE counted_qty > system_qty), 0) FROM decided)::int as total_over,
          (SELECT COALESCE(SUM(system_qty - counted_qty) FILTER (WHERE counted_qty < system_qty), 0) FROM decided)::int as total_under,
          (SELECT COUNT(*) FROM stock_count_items WHERE stock_count_id = $1)::int as total_items
      `, [req.params.id, fullCount]);

      res.json({ message: "Stock count completed", autoAdjusted: autoAdjust, fullCount, summary: summary[0] });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
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
        // 2-G.1 follow-up: if the original adjustment targeted a variant,
        // reverse the variant_outlet_stock + rollup change too.
        if (adj.variant_id) {
          await client.query(
            `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
               VALUES ($1, $2, $3::numeric)
               ON CONFLICT (variant_id, outlet_id)
               DO UPDATE SET quantity = variant_outlet_stock.quantity + $3::numeric`,
            [adj.variant_id, adj.outlet_id, reversal],
          );
          await client.query(
            "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
            [reversal, adj.variant_id],
          );
        }
        await client.query("DELETE FROM stock_adjustments WHERE id = $1", [id]);
      });

      res.json({ message: "Adjustment deleted and stock reversed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
