module.exports = function registerInventoryRoutes(app, deps) {
  const { db, requirePerm, createNotification } = deps;

// --- INVENTORY TRANSFERS ---

  // Get all transfers (with product, outlet, employee names)
  app.get("/api/transfers", (req, res) => {
    const query = `
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
    `;
    db.all(query, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ transfers: rows });
    });
  });

  // Create a new inventory transfer (atomically moves stock between outlets)
  app.post("/api/transfers", requirePerm("manage_inventory"), (req, res) => {
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

    // First: validate sufficient stock in source outlet
    db.get(
      "SELECT quantity FROM outlet_stock WHERE product_id = ? AND outlet_id = ?",
      [product_id, from_outlet_id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const currentStock = row ? row.quantity : 0;
        if (currentStock < quantity) {
          return res.status(400).json({
            error: `Insufficient stock. Only ${currentStock} available at source outlet.`,
          });
        }

        // All valid — perform atomic transfer
        db.serialize(() => {
          db.run("BEGIN TRANSACTION");

          // 1. Record the transfer
          db.run(
            `INSERT INTO inventory_transfers (product_id, from_outlet_id, to_outlet_id, quantity, employee_id, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
            [
              product_id,
              from_outlet_id,
              to_outlet_id,
              quantity,
              employee_id || null,
              note || null,
            ],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res
                  .status(500)
                  .json({ error: "Failed to record transfer" });
              }
            },
          );

          // 2. Deduct from source outlet
          db.run(
            "UPDATE outlet_stock SET quantity = quantity - ? WHERE product_id = ? AND outlet_id = ?",
            [quantity, product_id, from_outlet_id],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res
                  .status(500)
                  .json({ error: "Failed to deduct stock from source outlet" });
              }
            },
          );

          // 3. Add to destination outlet (upsert)
          db.run(
            `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES (?, ?, ?)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
            [product_id, to_outlet_id, quantity, quantity],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res
                  .status(500)
                  .json({ error: "Failed to add stock to destination outlet" });
              }
            },
          );

          // 4. Commit
          db.run("COMMIT", (err) => {
            if (err)
              return res
                .status(500)
                .json({ error: "Failed to commit transfer transaction" });
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
          });
        });
      },
    );
  });

  // --- STOCK ADJUSTMENTS ---

  app.get("/api/adjustments", (req, res) => {
    const query = `
        SELECT sa.*, p.name as product_name, p.barcode, o.name as outlet_name, e.name as employee_name
        FROM stock_adjustments sa
        JOIN products p ON sa.product_id = p.id
        JOIN outlets o ON sa.outlet_id = o.id
        LEFT JOIN employees e ON sa.employee_id = e.id
        ORDER BY sa.timestamp DESC
    `;
    db.all(query, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  app.post("/api/adjustments", requirePerm("manage_inventory"), (req, res) => {
    const { product_id, outlet_id, employee_id, quantity_change, reason } =
      req.body;

    if (!product_id || !outlet_id || quantity_change === undefined || !reason) {
      return res
        .status(400)
        .json({ error: "Missing required fields for stock adjustment" });
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      // Insert adjustment record
      db.run(
        `INSERT INTO stock_adjustments (product_id, outlet_id, employee_id, quantity_change, reason)
             VALUES (?, ?, ?, ?, ?)`,
        [product_id, outlet_id, employee_id || null, quantity_change, reason],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res
              .status(500)
              .json({ error: "Failed to record adjustment" });
          }
          const adjustmentId = this.lastID;

          // Upsert outlet_stock
          db.run(
            `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                     VALUES (?, ?, ?)
                     ON CONFLICT(product_id, outlet_id) 
                     DO UPDATE SET quantity = quantity + ?`,
            [product_id, outlet_id, quantity_change, quantity_change],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res
                  .status(500)
                  .json({ error: "Failed to update stock" });
              }

              db.run("COMMIT", (err) => {
                if (err)
                  return res
                    .status(500)
                    .json({ error: "Failed to commit adjustment transaction" });
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
              });
            },
          );
        },
      );
    });
  });
};
