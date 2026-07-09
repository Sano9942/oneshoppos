const { validate } = require("../middleware/validate");
const { CreatePOSchema } = require("../schemas/purchase-orders");
const batchStock = require("../services/batch-stock");
const stockLedger = require("../services/stock-ledger");

module.exports = function registerPurchaseOrderRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, createNotification } = deps;

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
  app.get("/api/purchase-orders", requireAnyPerm(["manage_orders", "view_reports", "all_access"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT po.*, s.name as supplier_name
         FROM purchase_orders po
         JOIN suppliers s ON po.supplier_id = s.id
         ORDER BY po.created_at DESC`
      );
      res.json({ purchaseOrders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get a single purchase order with its items
  app.get("/api/purchase-orders/:id", requireAnyPerm(["manage_orders", "view_reports", "all_access"]), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [po] } = await db.query(
        `SELECT po.*, s.name as supplier_name
         FROM purchase_orders po
         JOIN suppliers s ON po.supplier_id = s.id
         WHERE po.id = $1`,
        [id]
      );
      if (!po)
        return res.status(404).json({ error: "Purchase order not found" });

      const { rows: items } = await db.query(
        `SELECT poi.*, p.name, p.barcode
         FROM purchase_order_items poi
         JOIN products p ON poi.product_id = p.id
         WHERE poi.po_id = $1`,
        [id]
      );
      res.json({ purchaseOrder: po, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new purchase order
  app.post("/api/purchase-orders", requirePerm("manage_orders"), validate(CreatePOSchema), async (req, res) => {
    try {
      const { supplier_id, total_cost, items, due_date } = req.body;

      if (!items || items.length === 0) {
        return res.status(400).json({ error: "Purchase order must have items" });
      }

      if (!supplier_id) {
        return res.status(400).json({ error: "supplier_id is required" });
      }

      const { rows: [supplier] } = await db.query(
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
         WHERE s.id = $1`,
        [supplier_id]
      );

      let warningMsg = null;
      if (
        supplier &&
        supplier.payment_terms === "credit" &&
        Number(supplier.credit_limit) > 0 &&
        Number(supplier.running_balance) + Number(total_cost) > Number(supplier.credit_limit)
      ) {
        warningMsg = `Credit limit exceeded. Outstanding: ${Number(supplier.running_balance).toFixed(2)}, Limit: ${Number(supplier.credit_limit).toFixed(2)}`;
      }

      const poId = await db.transaction(async (client) => {
        const { rows: [poRow] } = await client.query(
          `INSERT INTO purchase_orders (supplier_id, total_cost, status, due_date)
           VALUES ($1, $2, 'Draft', $3) RETURNING id`,
          [supplier_id, total_cost, due_date || null]
        );
        const newPoId = poRow.id;

        for (const item of items) {
          await client.query(
            `INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price)
             VALUES ($1, $2, $3, $4)`,
            [newPoId, item.product_id, item.quantity, item.cost_price]
          );
        }

        return newPoId;
      });

      res.json({ message: "Purchase order created", id: poId, ...(warningMsg && { warning: warningMsg }) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- ROUTES: PO TEMPLATES ---

  // List all PO templates with item count
  app.get("/api/po-templates", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT t.*, s.name as supplier_name,
                COUNT(ti.id) as item_count
         FROM po_templates t
         LEFT JOIN suppliers s ON t.supplier_id = s.id
         LEFT JOIN po_template_items ti ON ti.template_id = t.id
         GROUP BY t.id, t.name, t.supplier_id, t.notes, t.created_at, s.name
         ORDER BY t.created_at DESC`
      );
      res.json({ templates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new PO template
  app.post("/api/po-templates", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { name, supplier_id, notes, items } = req.body;
      if (!name) return res.status(400).json({ error: "Template name is required" });

      const { rows: [tmplRow] } = await db.query(
        `INSERT INTO po_templates (name, supplier_id, notes)
         VALUES ($1, $2, $3) RETURNING id`,
        [name, supplier_id || null, notes || null]
      );
      const templateId = tmplRow.id;

      if (!items || !items.length) {
        return res.json({ id: templateId, message: "Template created" });
      }

      for (const item of items) {
        await db.query(
          `INSERT INTO po_template_items (template_id, product_id, quantity, unit_cost)
           VALUES ($1, $2, $3, $4)`,
          [templateId, item.product_id || null, item.quantity || 1, item.unit_cost || 0]
        );
      }

      res.json({ id: templateId, message: "Template created" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Use a template — creates a new draft PO from the template
  app.post("/api/po-templates/:id/use", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [tmpl] } = await db.query(
        `SELECT t.*, string_agg(ti.product_id||':'||ti.quantity||':'||ti.unit_cost, ',') as items_raw
         FROM po_templates t
         LEFT JOIN po_template_items ti ON ti.template_id = t.id
         WHERE t.id = $1
         GROUP BY t.id, t.name, t.supplier_id, t.notes, t.created_at`,
        [id]
      );
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

      const poId = await db.transaction(async (client) => {
        const { rows: [poRow] } = await client.query(
          `INSERT INTO purchase_orders (supplier_id, total_cost, status)
           VALUES ($1, $2, 'Draft') RETURNING id`,
          [tmpl.supplier_id, total_cost]
        );
        const newPoId = poRow.id;

        for (const item of items) {
          await client.query(
            `INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price)
             VALUES ($1, $2, $3, $4)`,
            [newPoId, item.product_id, item.quantity, item.cost_price]
          );
        }

        return newPoId;
      });

      res.json({ id: poId, message: "Draft PO created from template" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a template and its items
  app.delete("/api/po-templates/:id", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { id } = req.params;
      await db.query("DELETE FROM po_template_items WHERE template_id = $1", [id]);
      const { rowCount } = await db.query("DELETE FROM po_templates WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Template not found" });
      res.json({ message: "Template deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Edit a draft purchase order
  app.put("/api/purchase-orders/:id", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { id } = req.params;
      const { supplier_id, expected_date, notes, items } = req.body;

      const { rows: [po] } = await db.query(
        "SELECT * FROM purchase_orders WHERE id = $1",
        [id]
      );
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

      await db.transaction(async (client) => {
        await client.query(
          "UPDATE purchase_orders SET supplier_id = $1, total_cost = $2, due_date = $3 WHERE id = $4",
          [newSupplierId, newTotal, newDueDate, id]
        );

        await client.query(
          "DELETE FROM purchase_order_items WHERE po_id = $1",
          [id]
        );

        for (const item of items) {
          await client.query(
            `INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price)
             VALUES ($1, $2, $3, $4)`,
            [id, item.product_id, Number(item.quantity || 0), Number(item.unit_cost || item.cost_price || 0)]
          );
        }
      });

      // Return updated PO with items
      const { rows: [updatedPo] } = await db.query(
        `SELECT po.*, s.name as supplier_name
         FROM purchase_orders po
         JOIN suppliers s ON po.supplier_id = s.id
         WHERE po.id = $1`,
        [id]
      );
      const { rows: updatedItems } = await db.query(
        `SELECT poi.*, p.name, p.barcode
         FROM purchase_order_items poi
         JOIN products p ON poi.product_id = p.id
         WHERE poi.po_id = $1`,
        [id]
      );
      res.json({ purchaseOrder: updatedPo, items: updatedItems });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Approve a draft purchase order
  app.post("/api/purchase-orders/:id/approve", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { id } = req.params;

      const { rows: [po] } = await db.query(
        "SELECT * FROM purchase_orders WHERE id = $1",
        [id]
      );
      if (!po) return res.status(404).json({ error: "Purchase order not found" });
      if (po.status !== "Draft") {
        return res.status(400).json({ error: `Purchase order is already ${po.status} — only Draft POs can be approved` });
      }

      await db.query(
        "UPDATE purchase_orders SET status = 'Approved' WHERE id = $1",
        [id]
      );
      res.json({ success: true, status: "Approved" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Receive a purchase order (Updates Inventory Stock & Cost Price)
  app.post(
    "/api/purchase-orders/:id/receive",
    requirePerm("manage_orders"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { outlet_id, received_by, items: receivedItems, notes } = req.body;

        if (!outlet_id) {
          return res
            .status(400)
            .json({ error: "Outlet ID is required to receive PO" });
        }

        const { rows: [po] } = await db.query(
          "SELECT * FROM purchase_orders WHERE id = $1",
          [id]
        );
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status === "Received")
          return res.status(400).json({ error: "PO already received" });
        if (po.status !== "Approved")
          return res
            .status(400)
            .json({ error: "Only Approved POs can be received" });

        const { rows: poItems } = await db.query(
          `SELECT poi.*, p.name as product_name,
                  COALESCE(p.track_batches, false) AS track_batches,
                  p.shelf_life_days
           FROM purchase_order_items poi
           JOIN products p ON poi.product_id = p.id
           WHERE poi.po_id = $1`,
          [id]
        );

        // Build a map of qty_received: use provided items or default to full quantity
        // F07: receivedItems entries may also carry batch_number + expiry_date for
        // batch-tracked products (captured per line on the GRN editor).
        const receivedMap = {};
        const batchInfoMap = {};
        const hasPartialReceive = receivedItems && Array.isArray(receivedItems) && receivedItems.length > 0;
        if (hasPartialReceive) {
          receivedItems.forEach((ri) => {
            receivedMap[ri.product_id] = parseFloat(ri.qty_received) || 0;
            if (ri.batch_number || ri.expiry_date) {
              batchInfoMap[ri.product_id] = {
                batch_number: ri.batch_number ? String(ri.batch_number).trim() : null,
                expiry_date: ri.expiry_date || null,
              };
            }
          });
        }

        const grnNumber = `GRN-${Date.now()}`;

        const grnResult = await db.transaction(async (client) => {
          // 1. Create GRN header. PO status is decided at the END of the tx,
          //    once we know how much of the PO has now been received
          //    cumulatively (M5: no blanket status→'Received' on a partial).
          const { rows: [grnRow] } = await client.query(
            `INSERT INTO goods_received_notes (grn_number, po_id, outlet_id, received_by, notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [grnNumber, id, outlet_id, received_by || null, notes || null]
          );
          const newGrnId = grnRow.id;

          // M5: value RECEIVED on THIS GRN — the payable to book. Billing the
          // full po.total_cost on a partial receipt over-invoiced the supplier.
          let receivedValue = 0;

          for (const item of poItems) {
            const qtyReceived = hasPartialReceive
              ? (receivedMap[item.product_id] ?? 0)
              : item.quantity;

            receivedValue += Number(qtyReceived) * Number(item.cost_price || 0);

            await client.query(
              `INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price)
               VALUES ($1, $2, $3, $4, $5)`,
              [newGrnId, item.product_id, item.quantity, qtyReceived, item.cost_price]
            );

            await client.query(
              "UPDATE products SET cost_price = $1 WHERE id = $2",
              [item.cost_price, item.product_id]
            );

            // WS1a: route the on-hand bump through the shared stock helper (upsert
            // outlet_stock; PO lines are product-level only — no variant column).
            // manageBatch:false because GRN receipt creates a fresh lot via
            // receiveBatch below rather than returning to an existing batch.
            await stockLedger.incrementStock(client, {
              productId: item.product_id,
              outletId: outlet_id,
              qty: qtyReceived,
              manageBatch: false,
              refType: "po_receive",
              refId: newGrnId,
            });

            // F07: for batch-tracked products, decompose the received qty into a
            // stock_batches lot inside the SAME tx that bumped outlet_stock — so
            // the invariant (Σ batch.remaining = outlet_stock) holds from receipt.
            // Skip zero-qty partial-receive lines (nothing to batch).
            if (item.track_batches === true && Number(qtyReceived) > 0) {
              const info = batchInfoMap[item.product_id] || {};
              let expiry = info.expiry_date || null;
              // Auto-suggest expiry from shelf_life_days when not supplied.
              if (!expiry && item.shelf_life_days != null && Number(item.shelf_life_days) > 0) {
                // Shelf life counts from the tenant-local receiving day (the
                // old local-now + toISOString() mix was a day off before ~5 AM).
                const { tenantToday, addDaysStr } = require("../utils/tz");
                expiry = addDaysStr(tenantToday(req.company?.timezone), Number(item.shelf_life_days));
              }
              await batchStock.receiveBatch(client, {
                productId: item.product_id,
                outletId: outlet_id,
                batchNumber: info.batch_number, // receiveBatch defaults GRN-derived if null
                expiryDate: expiry,
                qty: qtyReceived,
                unitCost: item.cost_price,
                grnId: newGrnId,
              });
            }
          }

          // M5: decide PO status from CUMULATIVE received across every GRN for
          // this PO, not a blanket 'Received'. A partial receipt keeps the PO
          // 'Approved' so the outstanding remainder stays receivable (only
          // 'Approved' POs can be received, per the guard above) — no orphaned
          // back-order.
          const { rows: lines } = await client.query(
            `SELECT poi.quantity AS ordered,
                    COALESCE((
                      SELECT SUM(gi.qty_received)
                      FROM grn_items gi
                      JOIN goods_received_notes g ON g.id = gi.grn_id
                      WHERE g.po_id = $1 AND gi.product_id = poi.product_id
                    ), 0) AS received
             FROM purchase_order_items poi
             WHERE poi.po_id = $1`,
            [id]
          );
          const fullyReceived = lines.every(
            (r) => Number(r.received) >= Number(r.ordered)
          );
          await client.query(
            "UPDATE purchase_orders SET status = $1 WHERE id = $2",
            [fullyReceived ? "Received" : "Approved", id]
          );

          // M5: auto-create the supplier invoice INSIDE the tx (was a silent
          // try/catch OUTSIDE the tx — a throw there left stock received with
          // no payable). Bill the value received on THIS GRN, so a partial
          // receipt books only its own payable; each later receipt adds its own.
          if (po.supplier_id && receivedValue > 0) {
            const invNumber = `INV-${grnNumber}`;
            const { rows: [supplier] } = await client.query(
              "SELECT payment_terms, credit_days FROM suppliers WHERE id = $1",
              [po.supplier_id]
            );
            let dueDate = po.due_date || null;
            if (supplier && supplier.payment_terms === "credit" && Number(supplier.credit_days || 0) > 0) {
              // Credit terms count from the tenant-local receiving day.
              const { tenantToday, addDaysStr } = require("../utils/tz");
              dueDate = addDaysStr(tenantToday(req.company?.timezone), Number(supplier.credit_days));
            }
            await client.query(
              `INSERT INTO supplier_invoices (supplier_id, po_id, grn_id, invoice_number, amount, due_date)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [po.supplier_id, po.id, newGrnId, invNumber, Math.round(receivedValue * 100) / 100, dueDate]
            );
          }

          return { grnId: newGrnId, fullyReceived };
        });

        const grnId = grnResult.grnId;

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

        createNotification(
          "po_received",
          "PO Received",
          `GRN ${grnNumber} received for PO #${id}${grnResult.fullyReceived ? "" : " (partial)"}`,
          "/purchase-orders",
        );
        res.json({
          message: grnResult.fullyReceived
            ? "PO received in full. GRN created."
            : "PO partially received. GRN created; remaining quantity still receivable.",
          grn_number: grnNumber,
          grn_id: grnId,
          fully_received: grnResult.fullyReceived,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
