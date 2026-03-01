module.exports = function registerPurchaseOrderRoutes(app, deps) {
  const { db, requirePerm, createNotification } = deps;

  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const fn = deps.enqueueInventorySyncEvents;
      if (typeof fn === "function") return fn(changes, context, cb);
    } catch {
      /* ignore */
    }
    if (typeof cb === "function")
      cb(null, { queued: 0, skipped: changes.length });
  }

  // --- ROUTES: PURCHASE ORDERS ---

  // Get all purchase orders (with supplier names)
  app.get("/api/purchase-orders", (req, res) => {
    db.all(
      `
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        ORDER BY po.created_at DESC
    `,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ purchaseOrders: rows });
      },
    );
  });

  // Get a single purchase order with its items
  app.get("/api/purchase-orders/:id", (req, res) => {
    const { id } = req.params;
    db.get(
      `
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ?
    `,
      [id],
      (err, po) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!po)
          return res.status(404).json({ error: "Purchase order not found" });

        db.all(
          `
            SELECT poi.*, p.name, p.barcode
            FROM purchase_order_items poi
            JOIN products p ON poi.product_id = p.id
            WHERE poi.po_id = ?
        `,
          [id],
          (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ purchaseOrder: po, items });
          },
        );
      },
    );
  });

  // Create a new purchase order
  app.post("/api/purchase-orders", requirePerm("manage_orders"), (req, res) => {
    const { supplier_id, total_cost, items, due_date } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Purchase order must have items" });
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      db.run(
        "INSERT INTO purchase_orders (supplier_id, total_cost, status, due_date) VALUES (?, ?, 'Draft', ?)",
        [supplier_id, total_cost, due_date || null],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: "Failed to create PO" });
          }

          const poId = this.lastID;
          const stmt = db.prepare(
            "INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)",
          );
          let hasError = false;

          items.forEach((item) => {
            stmt.run(
              poId,
              item.product_id,
              item.quantity,
              item.cost_price,
              (err) => {
                if (err) hasError = true;
              },
            );
          });

          stmt.finalize();

          if (hasError) {
            db.run("ROLLBACK");
            return res
              .status(500)
              .json({ error: "Transaction failed while adding items" });
          }

          db.run("COMMIT", (err) => {
            if (err)
              return res.status(500).json({ error: "Failed to commit PO" });
            res.json({ message: "Purchase order created", id: poId });
          });
        },
      );
    });
  });

  // Receive a purchase order (Updates Inventory Stock & Cost Price)
  app.post(
    "/api/purchase-orders/:id/receive",
    requirePerm("manage_orders"),
    (req, res) => {
      const { id } = req.params;
      const { outlet_id, received_by, items: receivedItems, notes } = req.body;

      if (!outlet_id) {
        return res
          .status(400)
          .json({ error: "Outlet ID is required to receive PO" });
      }

      db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status === "Received")
          return res.status(400).json({ error: "PO already received" });
        if (po.status !== "Approved")
          return res
            .status(400)
            .json({ error: "Only Approved POs can be received" });

        db.all(
          "SELECT poi.*, p.name as product_name FROM purchase_order_items poi JOIN products p ON poi.product_id = p.id WHERE poi.po_id = ?",
          [id],
          (err, poItems) => {
            if (err) return res.status(500).json({ error: err.message });

            // Build a map of qty_received: use provided items or default to full quantity
            const receivedMap = {};
            if (receivedItems && Array.isArray(receivedItems)) {
              receivedItems.forEach((ri) => {
                receivedMap[ri.product_id] = parseFloat(ri.qty_received) || 0;
              });
            }

            const grnNumber = `GRN-${Date.now()}`;

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");

              // 1. Update PO status
              db.run(
                "UPDATE purchase_orders SET status = 'Received' WHERE id = ?",
                [id],
              );

              // 2. Create GRN header
              db.run(
                "INSERT INTO goods_received_notes (grn_number, po_id, outlet_id, received_by, notes) VALUES (?, ?, ?, ?, ?)",
                [grnNumber, id, outlet_id, received_by || null, notes || null],
                function (err) {
                  if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                  }

                  const grnId = this.lastID;
                  const grnItemStmt = db.prepare(
                    "INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price) VALUES (?, ?, ?, ?, ?)",
                  );
                  const updateCostStmt = db.prepare(
                    "UPDATE products SET cost_price = ? WHERE id = ?",
                  );
                  const updateStockStmt = db.prepare(`
                INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                VALUES (?, ?, ?)
                ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?
              `);

                  poItems.forEach((item) => {
                    const qtyReceived =
                      receivedMap[item.product_id] ?? item.quantity;
                    grnItemStmt.run(
                      grnId,
                      item.product_id,
                      item.quantity,
                      qtyReceived,
                      item.cost_price,
                    );
                    updateCostStmt.run(item.cost_price, item.product_id);
                    updateStockStmt.run(
                      item.product_id,
                      outlet_id,
                      qtyReceived,
                      qtyReceived,
                    );
                  });

                  grnItemStmt.finalize();
                  updateCostStmt.finalize();
                  updateStockStmt.finalize();

                  db.run("COMMIT", (err) => {
                    if (err)
                      return res.status(500).json({ error: err.message });
                    const syncChanges = poItems.map((item) => ({
                      product_id: item.product_id,
                      outlet_id,
                      delta: Number(
                        receivedMap[item.product_id] ?? item.quantity ?? 0,
                      ),
                      reason: "po_receive",
                      reference_type: "purchase_order",
                      reference_id: po.id,
                    }));
                    enqueueInventorySyncEvents(syncChanges, {}, () => {});
                    // Auto-create supplier invoice for this GRN
                    if (po.supplier_id && po.total_cost > 0) {
                      const invNumber = `INV-${grnNumber}`;
                      db.run(
                        "INSERT INTO supplier_invoices (supplier_id, po_id, grn_id, invoice_number, amount, due_date) VALUES (?, ?, ?, ?, ?, ?)",
                        [
                          po.supplier_id,
                          po.id,
                          grnId,
                          invNumber,
                          po.total_cost,
                          po.due_date || null,
                        ],
                        () => {}, // best-effort, don't fail the response
                      );
                    }
                    createNotification(
                      "po_received",
                      "PO Received",
                      `GRN ${grnNumber} received for PO #${id}`,
                      "/purchase-orders",
                    );
                    res.json({
                      message: "PO received. GRN created.",
                      grn_number: grnNumber,
                      grn_id: grnId,
                    });
                  });
                },
              );
            });
          },
        );
      });
    },
  );
};
