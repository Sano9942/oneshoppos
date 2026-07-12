"use strict";

/**
 * F01 recipe costing + theoretical usage reports.
 *
 *  GET /api/reports/recipe-costing?from&to[&outlet_id]
 *    Per kit/assembled product: plate cost (Σ component qty × current component
 *    cost), sell price, margin, units sold in range, theoretical food cost, and
 *    food-cost %. The "food cost per menu item" headline.
 *
 *  GET /api/reports/recipe-usage?from&to[&outlet_id]
 *    Per component: theoretical quantity consumed = Σ(recipe qty × kit units
 *    sold) across all kits containing it, plus theoretical cost. Only 'kit'
 *    products count here — 'assembled' products consume their recipe at
 *    PRODUCTION time (recorded directly in stock_conversion_lines), not at sale.
 *
 * Costing reads the CURRENT recipe + CURRENT component cost (no per-sale recipe
 * snapshot in v1) — surfaced in the `basis` field of each response so the UI can
 * state the limitation.
 *
 * Gate: kit_bom_engine + view_financial_reports (margin rule) (recipes span retail + food service, so
 * no restaurant-mode gate).
 */

const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function registerRecipeCostingReports(app, deps) {
  const { requireFeature, requirePerm } = deps;

  const gate = [requireFeature("kit_bom_engine"), requirePerm("view_financial_reports")];

  function dateFilters(req) {
    const tz = req.company?.timezone || "UTC";
    const { from, to, outlet_id } = req.query;
    const params = [];
    const where = ["s.voided = false"];
    if (from) { params.push(toUtcStart(from, tz)); where.push(`s.timestamp >= $${params.length}`); }
    if (to)   { params.push(toUtcEnd(to, tz));     where.push(`s.timestamp < $${params.length}`); }
    if (outlet_id) { params.push(Number(outlet_id)); where.push(`s.outlet_id = $${params.length}`); }
    return { params, where };
  }

  app.get("/api/reports/recipe-costing", ...gate, async (req, res) => {
    try {
      const { params, where } = dateFilters(req);
      const sql = `
        WITH kit_sales AS (
          SELECT si.product_id,
                 SUM(si.quantity)::numeric AS units_sold,
                 SUM(si.price_at_sale * si.quantity)::numeric AS revenue
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            JOIN products p ON p.id = si.product_id
           WHERE ${where.join(" AND ")}
             AND COALESCE(p.bom_type, 'standard') IN ('kit', 'assembled')
           GROUP BY si.product_id
        ),
        plate AS (
          SELECT pb.product_id,
                 SUM(pb.quantity * COALESCE(cp.cost_price, 0))::numeric AS plate_cost
            FROM product_bundles pb
            JOIN products cp ON cp.id = pb.component_product_id
           GROUP BY pb.product_id
        )
        SELECT p.id AS product_id, p.name, COALESCE(p.bom_type,'standard') AS bom_type,
               p.price::numeric AS sell_price,
               ROUND(COALESCE(pl.plate_cost, 0), 4)::float AS plate_cost,
               ROUND((p.price - COALESCE(pl.plate_cost, 0)), 4)::float AS margin_per_unit,
               CASE WHEN p.price > 0
                    THEN ROUND(((p.price - COALESCE(pl.plate_cost,0)) / p.price) * 100, 2)::float
                    ELSE 0 END AS margin_pct,
               COALESCE(ks.units_sold, 0)::float AS units_sold,
               ROUND(COALESCE(ks.revenue, 0), 2)::float AS revenue,
               ROUND(COALESCE(ks.units_sold, 0) * COALESCE(pl.plate_cost, 0), 2)::float AS theoretical_food_cost
          FROM products p
          JOIN plate pl ON pl.product_id = p.id
          LEFT JOIN kit_sales ks ON ks.product_id = p.id
         WHERE COALESCE(p.bom_type,'standard') IN ('kit','assembled')
           AND p.deleted_at IS NULL
         ORDER BY theoretical_food_cost DESC, p.name ASC
      `;
      const { rows } = await deps.db.query(sql, params);
      const items = rows.map((r) => ({
        ...r,
        food_cost_pct: r.revenue > 0
          ? Math.round((r.theoretical_food_cost / r.revenue) * 10000) / 100
          : 0,
      }));
      res.json({
        basis: "current recipe × current component cost (no per-sale recipe snapshot in v1)",
        items,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/reports/recipe-usage", ...gate, async (req, res) => {
    try {
      const { params, where } = dateFilters(req);
      const sql = `
        WITH kit_units AS (
          SELECT si.product_id AS kit_id, SUM(si.quantity)::numeric AS units_sold
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            JOIN products p ON p.id = si.product_id
           WHERE ${where.join(" AND ")}
             AND COALESCE(p.bom_type, 'standard') = 'kit'
           GROUP BY si.product_id
        )
        SELECT pb.component_product_id AS product_id,
               cp.name AS component_name, cp.unit AS component_unit,
               ROUND(SUM(pb.quantity * ku.units_sold), 4)::float AS theoretical_qty,
               ROUND(SUM(pb.quantity * ku.units_sold * COALESCE(cp.cost_price, 0)), 2)::float AS theoretical_cost
          FROM kit_units ku
          JOIN product_bundles pb ON pb.product_id = ku.kit_id
          JOIN products cp ON cp.id = pb.component_product_id
         GROUP BY pb.component_product_id, cp.name, cp.unit
         ORDER BY theoretical_cost DESC, cp.name ASC
      `;
      const { rows } = await deps.db.query(sql, params);
      res.json({
        basis: "theoretical = current recipe × units of each kit sold in range. "
          + "'assembled' products are excluded (they consume components at production time — see stock_conversions). "
          + "Actual physical usage requires cycle counts.",
        components: rows,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
