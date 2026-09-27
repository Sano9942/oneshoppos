const stockLedger = require("../services/stock-ledger");
const productHistory = require("../services/product-history");

module.exports = function registerSupplierReturnsRoutes(app, deps) {
  const { db, requirePerm, createNotification } = deps;

  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const fn = deps.enqueueInventorySyncEvents;
      if (typeof fn === "function") return fn(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

  // --- SUPPLIER RETURNS (RMA) ---

  app.get("/api/supplier-returns", async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name,
         (SELECT COUNT(id) FROM supplier_return_items WHERE supplier_return_id = sr.id) as item_count
         FROM supplier_returns sr
         LEFT JOIN suppliers s ON sr.supplier_id = s.id
         LEFT JOIN outlets o ON sr.outlet_id = o.id
         LEFT JOIN employees e ON sr.employee_id = e.id
         ORDER BY sr.return_date DESC`
      );
      res.json({ returns: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/supplier-returns/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: returnRows } = await db.query(
        `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name
         FROM supplier_returns sr
         LEFT JOIN suppliers s ON sr.supplier_id = s.id
         LEFT JOIN outlets o ON sr.outlet_id = o.id
         LEFT JOIN employees e ON sr.employee_id = e.id
         WHERE sr.id = $1`,
        [id]
      );
      if (!returnRows[0]) return res.status(404).json({ error: "RMA not found" });

      const { rows: items } = await db.query(
        `SELECT sri.*, p.name as product_name, p.barcode
         FROM supplier_return_items sri
         JOIN products p ON sri.product_id = p.id
         WHERE sri.supplier_return_id = $1`,
        [id]
      );
      res.json({ returnData: returnRows[0], items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/supplier-returns", requirePerm("manage_inventory"), async (req, res) => {
    try {
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

      const result = await db.transaction(async (client) => {
        const totalValue = items.reduce(
          (sum, item) => sum + item.quantity * (item.unit_price || 0),
          0,
        );

        const { rows: inserted } = await client.query(
          `INSERT INTO supplier_returns (supplier_id, employee_id, outlet_id, reason, total_value, reference_number, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'Completed') RETURNING id`,
          [supplier_id, employee_id || null, outlet_id, reason || null, totalValue, reference_number || null]
        );
        const returnId = inserted[0].id;

        for (const item of items) {
          await client.query(
            `INSERT INTO supplier_return_items (supplier_return_id, product_id, variant_id, quantity, unit_price, reason)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [returnId, item.product_id || item.id, item.variant_id || null, item.quantity, item.unit_price || item.cost_price || 0, item.reason || null]
          );

          // WS1a: route through the shared stock helper. The old variant path
          // touched ONLY product_variants.stock, leaving variant_outlet_stock and
          // outlet_stock (and the batch ledger) drifting; the product path took no
          // lock and no negative guard. decrementStock fixes all three: FOR UPDATE,
          // availability gate, all-three-tables, and FEFO batch consumption.
          await stockLedger.decrementStock(client, {
            productId: item.product_id || item.id,
            variantId: item.variant_id || null,
            outletId: outlet_id,
            qty: item.quantity,
            movementType: "adjust",
            refType: "supplier_return",
            refId: returnId,
          });
        }

        await productHistory.tagChanges(client, {
          kind: "supplier_return", refType: "supplier_return", refId: returnId,
          employeeId: productHistory.actorOf(req) ?? (employee_id || null), note: reason || null,
        });
        return returnId;
      });

      const syncChanges = items.map((item) => ({
        product_id: item.product_id || item.id,
        variant_id: item.variant_id || null,
        outlet_id: req.body.outlet_id,
        delta: -1 * Number(item.quantity || 0),
        reason: "supplier_return",
        reference_type: "supplier_return",
        reference_id: result,
      }));
      enqueueInventorySyncEvents(syncChanges, {}, () => {});

      res.json({ message: "Supplier return processed", id: result });
    } catch (err) {
      // WS1a: surface the typed insufficient_stock 400 from the stock helper.
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });
};
