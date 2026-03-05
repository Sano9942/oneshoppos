module.exports = function registerReturnsRoutes(app, deps) {
  const { db, requirePerm, createNotification, notifyLowStockForSale } = deps;

  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const fn = deps.enqueueInventorySyncEvents;
      if (typeof fn === "function") return fn(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

// --- ROUTES: RETURNS ---

  // Create a new return
  app.post("/api/returns", requirePerm("manage_orders"), (req, res) => {
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

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      db.run(
        "INSERT INTO returns (original_sale_id, outlet_id, employee_id, customer_id, total_refund, refund_method, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          original_sale_id || null,
          outlet_id,
          employee_id || null,
          customer_id || null,
          total_refund,
          refund_method,
          reason || null,
        ],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res
              .status(500)
              .json({ error: "Failed to create return: " + err.message });
          }

          const returnId = this.lastID;
          const insertItemStmt = db.prepare(
            "INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES (?, ?, ?, ?)",
          );
          const updateStockStmt = db.prepare(`
          INSERT INTO outlet_stock (product_id, outlet_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?
        `);

          let hasError = false;

          items.forEach((item) => {
            insertItemStmt.run(
              returnId,
              item.product_id,
              item.quantity,
              item.refund_price,
              (err) => {
                if (err) hasError = true;
              },
            );
            // Restock the returned items
            updateStockStmt.run(
              item.product_id,
              outlet_id,
              item.quantity,
              item.quantity,
              (err) => {
                if (err) hasError = true;
              },
            );
          });

          insertItemStmt.finalize();
          updateStockStmt.finalize();

          if (hasError) {
            db.run("ROLLBACK");
            return res.status(500).json({
              error: "Transaction failed while processing return items",
            });
          }

          db.run("COMMIT", (err) => {
            if (err)
              return res
                .status(500)
                .json({ error: "Failed to commit return transaction" });
            const syncChanges = items.map((item) => ({
              product_id: item.product_id,
              outlet_id,
              delta: Number(item.quantity || 0),
              reason: "return",
              reference_type: "return",
              reference_id: returnId,
            }));
            enqueueInventorySyncEvents(syncChanges, {}, () => {});
            res.json({
              message: "Return processed successfully",
              id: returnId,
            });
          });
        },
      );
    });
  });

  // Get all returns (with details)
  app.get("/api/returns", (req, res) => {
    const { date_from, date_to } = req.query;
    const where = [];
    const params = [];

    if (date_from) {
      where.push("date(r.timestamp, 'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(r.timestamp, 'localtime') <= ?");
      params.push(date_to);
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
    GROUP BY r.id
    ORDER BY r.timestamp DESC
  `;

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ returns: rows });
    });
  });

  // Get a single return with items
  app.get("/api/returns/:id", (req, res) => {
    const { id } = req.params;

    const sql = `
    SELECT r.*, o.name as outlet_name, e.name as employee_name, c.name as customer_name
    FROM returns r
    LEFT JOIN outlets o ON r.outlet_id = o.id
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `;

    db.get(sql, [id], (err, returnRow) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!returnRow)
        return res.status(404).json({ error: "Return not found" });

      db.all(
        `SELECT ri.*, p.name as product_name, p.barcode
       FROM return_items ri
       JOIN products p ON ri.product_id = p.id
       WHERE ri.return_id = ?`,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ returnData: returnRow, items });
        },
      );
    });
  });
};
