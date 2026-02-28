module.exports = function registerSupplierReturnsRoutes(app, deps) {
  const { db, requirePerm, createNotification } = deps;

// --- SUPPLIER RETURNS (RMA) ---

  app.get("/api/supplier-returns", (req, res) => {
    db.all(
      `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name, (SELECT COUNT(id) FROM supplier_return_items WHERE supplier_return_id = sr.id) as item_count 
     FROM supplier_returns sr
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     LEFT JOIN outlets o ON sr.outlet_id = o.id
     LEFT JOIN employees e ON sr.employee_id = e.id
     ORDER BY sr.return_date DESC`,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ returns: rows });
      },
    );
  });

  app.get("/api/supplier-returns/:id", (req, res) => {
    const { id } = req.params;
    db.get(
      `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name 
     FROM supplier_returns sr 
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     LEFT JOIN outlets o ON sr.outlet_id = o.id
     LEFT JOIN employees e ON sr.employee_id = e.id
     WHERE sr.id = ?`,
      [id],
      (err, returnRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!returnRow) return res.status(404).json({ error: "RMA not found" });

        db.all(
          `SELECT sri.*, p.name as product_name, p.barcode 
         FROM supplier_return_items sri 
         JOIN products p ON sri.product_id = p.id 
         WHERE sri.supplier_return_id = ?`,
          [id],
          (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ returnData: returnRow, items });
          },
        );
      },
    );
  });

  app.post("/api/supplier-returns", (req, res) => {
    const {
      supplier_id,
      employee_id,
      outlet_id,
      reason,
      reference_number,
      items,
    } = req.body;
    if (!supplier_id || !outlet_id || !items || items.length === 0) {
      return res.status(400).json({ error: "Missing required return payload" });
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      const totalValue = items.reduce(
        (sum, item) => sum + item.quantity * (item.unit_price || 0),
        0,
      );

      db.run(
        "INSERT INTO supplier_returns (supplier_id, employee_id, outlet_id, reason, total_value, reference_number, status) VALUES (?, ?, ?, ?, ?, ?, 'Completed')",
        [
          supplier_id,
          employee_id || null,
          outlet_id,
          reason || null,
          totalValue,
          reference_number || null,
        ],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }

          const returnId = this.lastID;
          const itemsStmt = db.prepare(
            "INSERT INTO supplier_return_items (supplier_return_id, product_id, variant_id, quantity, unit_price, reason) VALUES (?, ?, ?, ?, ?, ?)",
          );
          const stockStmt = db.prepare(
            "UPDATE outlet_stock SET quantity = quantity - ? WHERE product_id = ? AND outlet_id = ?",
          );
          const variantStockStmt = db.prepare(
            "UPDATE product_variants SET stock = stock - ? WHERE id = ?",
          );

          let hasError = false;

          items.forEach((item) => {
            itemsStmt.run(
              returnId,
              item.product_id || item.id,
              item.variant_id || null,
              item.quantity,
              item.unit_price || item.cost_price || 0,
              item.reason || null,
              (err) => {
                if (err) hasError = true;
              },
            );

            if (item.variant_id) {
              variantStockStmt.run(item.quantity, item.variant_id, (err) => {
                if (err) hasError = true;
              });
            } else {
              stockStmt.run(
                item.quantity,
                item.product_id || item.id,
                outlet_id,
                (err) => {
                  if (err) hasError = true;
                },
              );
            }
          });

          itemsStmt.finalize();
          stockStmt.finalize();
          variantStockStmt.finalize();

          if (hasError) {
            db.run("ROLLBACK");
            return res
              .status(500)
              .json({ error: "Transaction processed with failures" });
          }

          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            const syncChanges = items.map((item) => ({
              product_id: item.product_id || item.id,
              variant_id: item.variant_id || null,
              outlet_id,
              delta: -1 * Number(item.quantity || 0),
              reason: "supplier_return",
              reference_type: "supplier_return",
              reference_id: returnId,
            }));
            enqueueInventorySyncEvents(syncChanges, {}, () => {});
            res.json({ message: "Supplier return processed", id: returnId });
          });
        },
      );
    });
  });
};
