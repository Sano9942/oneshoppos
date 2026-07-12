"use strict";

/**
 * Menu engineering (Boston Matrix) report — Phase 2-R Wave C / 2-R.10.
 *
 * Classifies each product in a date range into one of four quadrants based
 * on popularity (units sold) + margin per unit:
 *   - star       = high popularity, high margin
 *   - plowhorse  = high popularity, low margin
 *   - puzzle     = low popularity, high margin
 *   - dog        = low popularity, low margin
 *
 * Voids are excluded twice:
 *   - `sales.voided = false` filters out whole-sale voids
 *   - sale_item_adjustments of type 'void' subtract the voided line quantity
 *     and amount from popularity/profit so a comp'd-out item doesn't inflate
 *     popularity or misclassify the product.
 *
 * Gate: restaurant mode + phase4_restaurant_menu_engineering + view_financial_reports (margin rule).
 */

const { toUtcStart, toUtcEnd } = require("../../utils/tz");
const { menuEngineeringQuerySchema } = require("../../schemas/menu-engineering");

module.exports = function registerMenuEngineeringReport(app, deps /* , helpers */) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");

  const gate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_menu_engineering"),
    requirePerm("view_financial_reports"),
  ];

  app.get("/api/reports/menu-engineering", ...gate, async (req, res) => {
    try {
      const parsed = menuEngineeringQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
      }
      const { from, to, outlet_id, category_id } = parsed.data;
      const tz = req.company?.timezone || "UTC";

      const params = [];
      const saleWhere = ["s.voided = false"];
      if (from) { params.push(toUtcStart(from, tz)); saleWhere.push(`s.timestamp >= $${params.length}`); }
      if (to)   { params.push(toUtcEnd(to, tz));     saleWhere.push(`s.timestamp < $${params.length}`); }
      if (outlet_id) { params.push(Number(outlet_id)); saleWhere.push(`s.outlet_id = $${params.length}`); }
      if (category_id) { params.push(Number(category_id)); saleWhere.push(`p.category_id = $${params.length}`); }

      // Subquery per sale_item_id: how many units were voided via
      // sale_item_adjustments. Each void row carries an amount (currency);
      // we only need "was this line voided" (counts as 1 line off the top)
      // — but quantity isn't stored on the adjustment, so we treat any
      // 'void' adjustment as a full-line removal (matches Wave B semantics:
      // void cancels the whole line). COALESCE to 0 for unvoided lines.
      //
      // For comps we still count the item sold (customer received it) but
      // the profit is zero — handled by subtracting the comp amount from
      // (price * qty) rather than removing the line.
      const sql = `
        WITH line_data AS (
          SELECT
            si.id AS sale_item_id,
            si.product_id,
            si.quantity::numeric AS qty,
            si.price_at_sale::numeric AS unit_price,
            si.cost_price_at_sale::numeric AS unit_cost,
            COALESCE((
              SELECT COUNT(*)::int FROM sale_item_adjustments a
              WHERE a.sale_item_id = si.id AND a.adjustment_type = 'void'
            ), 0) AS void_count,
            COALESCE((
              SELECT SUM(a.amount)::numeric FROM sale_item_adjustments a
              WHERE a.sale_item_id = si.id AND a.adjustment_type IN ('comp','discount')
            ), 0) AS discount_amount,
            p.name AS product_name,
            p.category_id,
            c.name AS category_name
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE ${saleWhere.join(" AND ")}
        ),
        -- A voided line contributes 0 to both popularity and profit.
        -- A comped/discounted line contributes its quantity to popularity
        -- but the discount/comp amount is subtracted from gross to get
        -- net revenue, and profit = net_revenue - cogs.
        line_effective AS (
          SELECT
            sale_item_id,
            product_id,
            product_name,
            category_id,
            category_name,
            CASE WHEN void_count > 0 THEN 0 ELSE qty END AS effective_qty,
            CASE WHEN void_count > 0 THEN 0 ELSE (qty * unit_price - discount_amount) END AS net_revenue,
            CASE WHEN void_count > 0 THEN 0 ELSE (qty * unit_cost) END AS cogs
          FROM line_data
        ),
        per_product AS (
          SELECT
            product_id,
            MAX(product_name) AS name,
            MAX(category_id) AS category_id,
            MAX(category_name) AS category_name,
            SUM(effective_qty)::numeric AS popularity,
            SUM(net_revenue)::numeric AS revenue,
            SUM(cogs)::numeric AS cogs,
            (SUM(net_revenue) - SUM(cogs))::numeric AS profit,
            CASE
              WHEN SUM(effective_qty) > 0 THEN ((SUM(net_revenue) - SUM(cogs)) / SUM(effective_qty))::numeric
              ELSE 0
            END AS avg_margin_per_unit,
            -- Plate cost per unit (avg captured cost_price_at_sale — for recipe
            -- items this is the resolved ingredient plate cost) + food-cost %,
            -- the #1 back-of-house profit lever for kitchens (V03 P1).
            CASE
              WHEN SUM(effective_qty) > 0 THEN (SUM(cogs) / SUM(effective_qty))::numeric
              ELSE 0
            END AS plate_cost_per_unit,
            CASE
              WHEN SUM(net_revenue) > 0 THEN (SUM(cogs) / SUM(net_revenue) * 100)::numeric
              ELSE 0
            END AS food_cost_pct
          FROM line_effective
          GROUP BY product_id
          HAVING SUM(effective_qty) > 0
        )
        SELECT
          product_id,
          name,
          category_id,
          category_name,
          popularity::float AS popularity,
          ROUND(revenue, 2)::float AS revenue,
          ROUND(cogs, 2)::float AS cogs,
          ROUND(profit, 2)::float AS profit,
          ROUND(avg_margin_per_unit, 2)::float AS avg_margin_per_unit,
          ROUND(plate_cost_per_unit, 2)::float AS plate_cost_per_unit,
          ROUND(food_cost_pct, 1)::float AS food_cost_pct
        FROM per_product
        ORDER BY popularity DESC
      `;

      const { rows: products } = await deps.db.query(sql, params);

      // Medians across the returned set. If fewer than 2 rows, classification
      // is still well-defined (everything compares to itself).
      let popularityMedian = 0;
      let marginMedian = 0;
      if (products.length > 0) {
        const popularities = products.map((p) => p.popularity).sort((a, b) => a - b);
        const margins = products.map((p) => p.avg_margin_per_unit).sort((a, b) => a - b);
        popularityMedian = median(popularities);
        marginMedian = median(margins);
      }

      const classified = products.map((p) => ({
        ...p,
        classification: classify(p.popularity, p.avg_margin_per_unit, popularityMedian, marginMedian),
      }));

      res.json({
        thresholds: {
          popularity_median: popularityMedian,
          margin_median: marginMedian,
        },
        products: classified,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};

function median(sortedNumbers) {
  if (!sortedNumbers.length) return 0;
  const n = sortedNumbers.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2 : sortedNumbers[mid];
}

function classify(pop, margin, popThr, marginThr) {
  const highPop = pop >= popThr;
  const highMargin = margin >= marginThr;
  if (highPop && highMargin) return "star";
  if (highPop && !highMargin) return "plowhorse";
  if (!highPop && highMargin) return "puzzle";
  return "dog";
}
