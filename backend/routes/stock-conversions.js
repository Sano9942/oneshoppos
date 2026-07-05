// F01: production (assembly) + disassembly runs.
//
//   assembly     — consume an assembled product's recipe (product_bundles) and
//                  produce output stock (e.g. pre-made sweet trays, gift boxes).
//   disassembly  — consume 1 source unit (e.g. a butcher carcass) and produce N
//                  outputs (cuts) with per-line yield qty + optional unit_cost.
//
// Gated by kit_bom_engine. All writes run in ONE transaction; component/source
// stock is locked FOR UPDATE and rejected on shortfall (same discipline as
// sales.js). Component consumption reuses the shared kit-engine so rounding and
// stable lock order are identical to the sale path.
const kitEngine = require("../services/kit-engine");

module.exports = function registerStockConversionRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  const gate = [requireFeature("kit_bom_engine"), requirePerm("manage_inventory")];

  // POST /api/stock-conversions — run an assembly or disassembly.
  app.post("/api/stock-conversions", ...gate, async (req, res) => {
    const { conversion_type, outlet_id, notes } = req.body || {};
    const employeeId = req.employee?.id || Number(req.headers["x-employee-id"]) || null;

    if (!["assembly", "disassembly"].includes(conversion_type)) {
      return res.status(400).json({ error: "conversion_type must be 'assembly' or 'disassembly'" });
    }
    if (!outlet_id) {
      return res.status(400).json({ error: "outlet_id is required" });
    }

    try {
      const result = await db.transaction(async (client) => {
        if (conversion_type === "assembly") {
          const outputProductId = Number(req.body.output_product_id);
          const outputQty = kitEngine.roundQty(req.body.output_qty);
          if (!outputProductId || !(outputQty > 0)) {
            throw Object.assign(new Error("output_product_id and a positive output_qty are required"), { statusCode: 400 });
          }
          const bomType = await kitEngine.getBomType(client, outputProductId);
          if (bomType === "kit") {
            throw Object.assign(
              new Error("Kits are assembled on the fly at sale time — run production only for 'assembled' products."),
              { statusCode: 400, code: "kit_not_producible" }
            );
          }
          const comps = await kitEngine.loadComponents(client, outputProductId);
          if (!comps.length) {
            throw Object.assign(
              new Error("This product has no recipe/components to consume — add components before running production."),
              { statusCode: 400, code: "no_recipe" }
            );
          }

          // Consume components (locks in stable order, rejects on shortfall).
          const decrements = await kitEngine.reserveAndDecrement(client, {
            productId: outputProductId,
            outletId: outlet_id,
            saleQty: outputQty,
            components: comps,
          });

          // Produce the assembled output stock.
          await client.query(
            `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
               ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $3`,
            [outputProductId, outlet_id, outputQty]
          );

          const { rows: [conv] } = await client.query(
            `INSERT INTO stock_conversions
               (conversion_type, outlet_id, employee_id, output_product_id, output_qty, notes, status)
             VALUES ('assembly', $1, $2, $3, $4, $5, 'completed') RETURNING *`,
            [outlet_id, employeeId, outputProductId, outputQty, notes || null]
          );

          for (const d of decrements) {
            await client.query(
              `INSERT INTO stock_conversion_lines
                 (conversion_id, product_id, variant_id, quantity, direction)
               VALUES ($1, $2, $3, $4, 'consume')`,
              [conv.id, d.component_product_id, d.component_variant_id || null, d.needed]
            );
          }
          await client.query(
            `INSERT INTO stock_conversion_lines (conversion_id, product_id, quantity, direction)
             VALUES ($1, $2, $3, 'produce')`,
            [conv.id, outputProductId, outputQty]
          );
          return conv;
        }

        // ── disassembly ──────────────────────────────────────────────────
        const sourceProductId = Number(req.body.source_product_id);
        const sourceQty = kitEngine.roundQty(req.body.source_qty);
        const outputs = Array.isArray(req.body.outputs) ? req.body.outputs : [];
        if (!sourceProductId || !(sourceQty > 0)) {
          throw Object.assign(new Error("source_product_id and a positive source_qty are required"), { statusCode: 400 });
        }
        if (!outputs.length) {
          throw Object.assign(new Error("At least one output line is required"), { statusCode: 400 });
        }

        // Consume the source (lock + shortfall check).
        const { rows: [src] } = await client.query(
          `SELECT COALESCE(quantity, 0) AS available
             FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
          [sourceProductId, outlet_id]
        );
        const available = Number(src?.available ?? 0);
        if (available < sourceQty) {
          throw Object.assign(new Error("Insufficient stock of the source product to disassemble"), {
            statusCode: 400,
            code: "insufficient_stock",
            product_id: sourceProductId,
            available,
            requested: sourceQty,
          });
        }
        await client.query(
          `UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3`,
          [sourceQty, sourceProductId, outlet_id]
        );

        const { rows: [conv] } = await client.query(
          `INSERT INTO stock_conversions
             (conversion_type, outlet_id, employee_id, source_product_id, source_qty, notes, status)
           VALUES ('disassembly', $1, $2, $3, $4, $5, 'completed') RETURNING *`,
          [outlet_id, employeeId, sourceProductId, sourceQty, notes || null]
        );
        await client.query(
          `INSERT INTO stock_conversion_lines (conversion_id, product_id, quantity, direction)
           VALUES ($1, $2, $3, 'consume')`,
          [conv.id, sourceProductId, sourceQty]
        );

        for (const o of outputs) {
          const pid = Number(o.product_id);
          const q = kitEngine.roundQty(o.quantity);
          if (!pid || !(q > 0)) {
            throw Object.assign(new Error("Each output line needs a valid product_id and positive quantity"), { statusCode: 400 });
          }
          const vid = o.variant_id ? Number(o.variant_id) : null;
          const unitCost = o.unit_cost != null && o.unit_cost !== "" ? kitEngine.roundQty(o.unit_cost) : null;

          await client.query(
            `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
               ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $3`,
            [pid, outlet_id, q]
          );
          if (vid) {
            await client.query(
              `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, $2, $3)
                 ON CONFLICT (variant_id, outlet_id) DO UPDATE SET quantity = variant_outlet_stock.quantity + $3`,
              [vid, outlet_id, q]
            );
            await client.query(`UPDATE product_variants SET stock = stock + $1 WHERE id = $2`, [q, vid]);
          }
          await client.query(
            `INSERT INTO stock_conversion_lines
               (conversion_id, product_id, variant_id, quantity, direction, unit_cost)
             VALUES ($1, $2, $3, $4, 'produce', $5)`,
            [conv.id, pid, vid, q, unitCost]
          );
        }
        return conv;
      });

      res.status(201).json({ conversion: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });

  // GET /api/stock-conversions — recent runs with product names + line detail.
  app.get("/api/stock-conversions", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;
      const params = [];
      let where = "";
      if (outletId) {
        params.push(outletId);
        where = `WHERE sc.outlet_id = $${params.length}`;
      }
      const { rows } = await db.query(
        `SELECT sc.*,
                sp.name AS source_product_name, op.name AS output_product_name,
                e.name AS employee_name,
                COALESCE(
                  (SELECT json_agg(json_build_object(
                     'id', scl.id, 'product_id', scl.product_id, 'variant_id', scl.variant_id,
                     'product_name', lp.name, 'quantity', scl.quantity,
                     'direction', scl.direction, 'unit_cost', scl.unit_cost) ORDER BY scl.direction, scl.id)
                   FROM stock_conversion_lines scl
                   JOIN products lp ON lp.id = scl.product_id
                   WHERE scl.conversion_id = sc.id), '[]'::json) AS lines
           FROM stock_conversions sc
           LEFT JOIN products sp ON sp.id = sc.source_product_id
           LEFT JOIN products op ON op.id = sc.output_product_id
           LEFT JOIN employees e ON e.id = sc.employee_id
           ${where}
          ORDER BY sc.created_at DESC
          LIMIT 100`,
        params
      );
      res.json({ conversions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
