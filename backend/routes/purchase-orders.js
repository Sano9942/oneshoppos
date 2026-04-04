const { validate } = require("../middleware/validate");
const { CreatePOSchema } = require("../schemas/purchase-orders");

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
          `SELECT poi.*, p.name as product_name
           FROM purchase_order_items poi
           JOIN products p ON poi.product_id = p.id
           WHERE poi.po_id = $1`,
          [id]
        );

        // Build a map of qty_received: use provided items or default to full quantity
        const receivedMap = {};
        const hasPartialReceive = receivedItems && Array.isArray(receivedItems) && receivedItems.length > 0;
        if (hasPartialReceive) {
          receivedItems.forEach((ri) => {
            receivedMap[ri.product_id] = parseFloat(ri.qty_received) || 0;
          });
        }

        const grnNumber = `GRN-${Date.now()}`;

        const grnId = await db.transaction(async (client) => {
          // 1. Update PO status
          await client.query(
            "UPDATE purchase_orders SET status = 'Received' WHERE id = $1",
            [id]
          );

          // 2. Create GRN header
          const { rows: [grnRow] } = await client.query(
            `INSERT INTO goods_received_notes (grn_number, po_id, outlet_id, received_by, notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [grnNumber, id, outlet_id, received_by || null, notes || null]
          );
          const newGrnId = grnRow.id;

          for (const item of poItems) {
            const qtyReceived = hasPartialReceive
              ? (receivedMap[item.product_id] ?? 0)
              : item.quantity;

            await client.query(
              `INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price)
               VALUES ($1, $2, $3, $4, $5)`,
              [newGrnId, item.product_id, item.quantity, qtyReceived, item.cost_price]
            );

            await client.query(
              "UPDATE products SET cost_price = $1 WHERE id = $2",
              [item.cost_price, item.product_id]
            );

            await client.query(
              `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
               VALUES ($1, $2, $3)
               ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
              [item.product_id, outlet_id, qtyReceived, qtyReceived]
            );
          }

          return newGrnId;
        });

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
          try {
            const invNumber = `INV-${grnNumber}`;
            const { rows: [supplier] } = await db.query(
              "SELECT payment_terms, credit_days FROM suppliers WHERE id = $1",
              [po.supplier_id]
            );
            let dueDate = po.due_date || null;
            if (supplier && supplier.payment_terms === "credit" && Number(supplier.credit_days || 0) > 0) {
              const d = new Date();
              d.setDate(d.getDate() + Number(supplier.credit_days));
              dueDate = d.toISOString().slice(0, 10);
            }
            await db.query(
              `INSERT INTO supplier_invoices (supplier_id, po_id, grn_id, invoice_number, amount, due_date)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [po.supplier_id, po.id, grnId, invNumber, po.total_cost, dueDate]
            );
          } catch {
            // best-effort
          }
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
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
