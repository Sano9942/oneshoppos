module.exports = function registerPurchaseOrderRoutes(app, deps) {
  const { db, requirePerm, createNotification } = deps;

  // --- PO TEMPLATES TABLES ---
  db.run(`CREATE TABLE IF NOT EXISTS po_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    supplier_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS po_template_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    product_id INTEGER,
    quantity INTEGER DEFAULT 1,
    unit_cost REAL DEFAULT 0
  )`);

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

    if (!supplier_id) {
      return res.status(400).json({ error: "supplier_id is required" });
    }

    db.get(
      `SELECT s.payment_terms, s.credit_limit,
              COALESCE(outstanding.balance, 0) AS running_balance
       FROM suppliers s
       LEFT JOIN (
         SELECT si.supplier_id,
                SUM(si.amount - COALESCE(sp.paid_amount, 0)) AS balance
         FROM supplier_invoices si
         LEFT JOIN (
           SELECT supplier_invoice_id, SUM(amount) AS paid_amount
           FROM supplier_payments GROUP BY supplier_invoice_id
         ) sp ON sp.supplier_invoice_id = si.id
         WHERE si.status != 'paid'
         GROUP BY si.supplier_id
       ) outstanding ON outstanding.supplier_id = s.id
       WHERE s.id = ?`,
      [supplier_id],
      (sErr, supplier) => {
        if (sErr) return res.status(500).json({ error: sErr.message });
        let warningMsg = null;
        if (
          supplier &&
          supplier.payment_terms === "credit" &&
          Number(supplier.credit_limit) > 0 &&
          Number(supplier.running_balance) + Number(total_cost) > Number(supplier.credit_limit)
        ) {
          warningMsg = `Credit limit exceeded. Outstanding: ${Number(supplier.running_balance).toFixed(2)}, Limit: ${Number(supplier.credit_limit).toFixed(2)}`;
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

              stmt.finalize((finalizeErr) => {
                if (finalizeErr || hasError) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: "Transaction failed while adding items" });
                }

                db.run("COMMIT", (err) => {
                  if (err) return res.status(500).json({ error: "Failed to commit PO" });
                  res.json({ message: "Purchase order created", id: poId, ...(warningMsg && { warning: warningMsg }) });
                });
              });
            },
          );
        });
      },
    );
  });

  // --- ROUTES: PO TEMPLATES ---

  // List all PO templates with item count
  app.get("/api/po-templates", requirePerm("manage_orders"), (req, res) => {
    db.all(
      `SELECT t.*, s.name as supplier_name,
              COUNT(ti.id) as item_count
       FROM po_templates t
       LEFT JOIN suppliers s ON t.supplier_id = s.id
       LEFT JOIN po_template_items ti ON ti.template_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ templates: rows });
      },
    );
  });

  // Create a new PO template
  app.post("/api/po-templates", requirePerm("manage_orders"), (req, res) => {
    const { name, supplier_id, notes, items } = req.body;
    if (!name) return res.status(400).json({ error: "Template name is required" });

    db.run(
      "INSERT INTO po_templates (name, supplier_id, notes) VALUES (?, ?, ?)",
      [name, supplier_id || null, notes || null],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        const templateId = this.lastID;
        if (!items || !items.length) {
          return res.json({ id: templateId, message: "Template created" });
        }
        const stmt = db.prepare(
          "INSERT INTO po_template_items (template_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)",
        );
        items.forEach((item) => {
          stmt.run(templateId, item.product_id || null, item.quantity || 1, item.unit_cost || 0);
        });
        stmt.finalize((finalizeErr) => {
          if (finalizeErr) return res.status(500).json({ error: "Failed to save template items" });
          res.json({ id: templateId, message: "Template created" });
        });
      },
    );
  });

  // Use a template — creates a new draft PO from the template
  app.post("/api/po-templates/:id/use", requirePerm("manage_orders"), (req, res) => {
    const { id } = req.params;
    db.get(
      `SELECT t.*, GROUP_CONCAT(ti.product_id||':'||ti.quantity||':'||ti.unit_cost) as items_raw
       FROM po_templates t
       LEFT JOIN po_template_items ti ON ti.template_id = t.id
       WHERE t.id = ?
       GROUP BY t.id`,
      [id],
      (err, tmpl) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!tmpl) return res.status(404).json({ error: "Template not found" });

        const items = tmpl.items_raw
          ? tmpl.items_raw.split(",").map((s) => {
              const [product_id, quantity, unit_cost] = s.split(":");
              return { product_id: Number(product_id), quantity: Number(quantity), cost_price: Number(unit_cost) };
            })
          : [];

        if (!tmpl.supplier_id) {
          return res.status(400).json({ error: "Template has no supplier — cannot create PO" });
        }
        if (!items.length) {
          return res.status(400).json({ error: "Template has no items — cannot create PO" });
        }

        const total_cost = items.reduce((sum, i) => sum + i.quantity * i.cost_price, 0);

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run(
            "INSERT INTO purchase_orders (supplier_id, total_cost, status) VALUES (?, ?, 'Draft')",
            [tmpl.supplier_id, total_cost],
            function (insertErr) {
              if (insertErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "Failed to create PO" });
              }
              const poId = this.lastID;
              const stmt = db.prepare(
                "INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)",
              );
              items.forEach((item) => {
                stmt.run(poId, item.product_id, item.quantity, item.cost_price);
              });
              stmt.finalize((finalizeErr) => {
                if (finalizeErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: "Failed to add items to PO" });
                }
                db.run("COMMIT", (commitErr) => {
                  if (commitErr) return res.status(500).json({ error: "Failed to commit PO" });
                  res.json({ id: poId, message: "Draft PO created from template" });
                });
              });
            },
          );
        });
      },
    );
  });

  // Delete a template and its items
  app.delete("/api/po-templates/:id", requirePerm("manage_orders"), (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
      db.run("DELETE FROM po_template_items WHERE template_id = ?", [id]);
      db.run("DELETE FROM po_templates WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Template not found" });
        res.json({ message: "Template deleted" });
      });
    });
  });

  // Edit a draft purchase order
  app.put("/api/purchase-orders/:id", requirePerm("manage_orders"), (req, res) => {
    const { id } = req.params;
    const { supplier_id, expected_date, notes, items } = req.body;

    db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!po) return res.status(404).json({ error: "Purchase order not found" });
      if (po.status !== "Draft") {
        return res.status(400).json({ error: "Only Draft purchase orders can be edited" });
      }

      if (!items || !items.length) {
        return res.status(400).json({ error: "Purchase order must have at least one item" });
      }

      const newSupplierId = supplier_id ? Number(supplier_id) : po.supplier_id;
      const newDueDate = expected_date !== undefined ? (expected_date || null) : po.due_date;
      const newTotal = items.reduce(
        (sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_cost || i.cost_price || 0),
        0,
      );

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        db.run(
          "UPDATE purchase_orders SET supplier_id = ?, total_cost = ?, due_date = ? WHERE id = ?",
          [newSupplierId, newTotal, newDueDate, id],
          function (updateErr) {
            if (updateErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: "Failed to update purchase order" });
            }

            db.run("DELETE FROM purchase_order_items WHERE po_id = ?", [id], (delErr) => {
              if (delErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "Failed to clear existing items" });
              }

              const stmt = db.prepare(
                "INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)",
              );
              let hasError = false;

              items.forEach((item) => {
                stmt.run(
                  id,
                  item.product_id,
                  Number(item.quantity || 0),
                  Number(item.unit_cost || item.cost_price || 0),
                  (runErr) => {
                    if (runErr) hasError = true;
                  },
                );
              });

              stmt.finalize((finalizeErr) => {
                if (finalizeErr || hasError) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: "Failed to insert updated items" });
                }

                db.run("COMMIT", (commitErr) => {
                  if (commitErr) return res.status(500).json({ error: "Failed to commit update" });

                  // Return updated PO with items
                  db.get(
                    `SELECT po.*, s.name as supplier_name
                     FROM purchase_orders po
                     JOIN suppliers s ON po.supplier_id = s.id
                     WHERE po.id = ?`,
                    [id],
                    (poErr, updatedPo) => {
                      if (poErr) return res.status(500).json({ error: poErr.message });
                      db.all(
                        `SELECT poi.*, p.name, p.barcode
                         FROM purchase_order_items poi
                         JOIN products p ON poi.product_id = p.id
                         WHERE poi.po_id = ?`,
                        [id],
                        (itemsErr, updatedItems) => {
                          if (itemsErr) return res.status(500).json({ error: itemsErr.message });
                          res.json({ purchaseOrder: updatedPo, items: updatedItems });
                        },
                      );
                    },
                  );
                });
              });
            });
          },
        );
      });
    });
  });

  // Approve a draft purchase order
  app.post("/api/purchase-orders/:id/approve", requirePerm("manage_orders"), (req, res) => {
    const { id } = req.params;

    db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!po) return res.status(404).json({ error: "Purchase order not found" });
      if (po.status !== "Draft") {
        return res.status(400).json({ error: `Purchase order is already ${po.status} — only Draft POs can be approved` });
      }

      db.run(
        "UPDATE purchase_orders SET status = 'Approved' WHERE id = ?",
        [id],
        function (updateErr) {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          res.json({ success: true, status: "Approved" });
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
            const hasPartialReceive = receivedItems && Array.isArray(receivedItems) && receivedItems.length > 0;
            if (hasPartialReceive) {
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
                    const qtyReceived = hasPartialReceive
                      ? (receivedMap[item.product_id] ?? 0)
                      : item.quantity;
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
                        hasPartialReceive
                          ? (receivedMap[item.product_id] ?? 0)
                          : (item.quantity ?? 0),
                      ),
                      reason: "po_receive",
                      reference_type: "purchase_order",
                      reference_id: po.id,
                    }));
                    enqueueInventorySyncEvents(syncChanges, {}, () => {});
                    // Auto-create supplier invoice for this GRN
                    if (po.supplier_id && po.total_cost > 0) {
                      const invNumber = `INV-${grnNumber}`;
                      // Lookup supplier credit terms to set due_date accurately
                      db.get(
                        "SELECT payment_terms, credit_days FROM suppliers WHERE id = ?",
                        [po.supplier_id],
                        (sErr, supplier) => {
                          let dueDate = po.due_date || null;
                          if (supplier && supplier.payment_terms === "credit" && Number(supplier.credit_days || 0) > 0) {
                            const d = new Date();
                            d.setDate(d.getDate() + Number(supplier.credit_days));
                            dueDate = d.toISOString().slice(0, 10);
                          }
                          db.run(
                            "INSERT INTO supplier_invoices (supplier_id, po_id, grn_id, invoice_number, amount, due_date) VALUES (?, ?, ?, ?, ?, ?)",
                            [po.supplier_id, po.id, grnId, invNumber, po.total_cost, dueDate],
                            () => {}, // best-effort
                          );
                        },
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
