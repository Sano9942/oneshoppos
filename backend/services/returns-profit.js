'use strict';

/**
 * Profit given back by customer returns in a period — the one definition every
 * profit report subtracts (One Toy Store pilot D17; owner decision 2026-09-26).
 *
 * Per returned line:
 *   refund        = the line's share of the return's total_refund (lines are
 *                   weighted by qty × refund_price, so a header total that
 *                   differs from the line sum is still what left the till)
 *   cost_back     = qty × the cost booked on the ORIGINAL sale line, only when
 *                   the item went back into stock (restock_flag). A written-off
 *                   item's cost is gone, so the whole refund comes off profit.
 *                   Falls back to the variant's / product's current cost when
 *                   the original line can't be found (e.g. a web-order return).
 *   profit_back   = refund − cost_back
 *
 * A return is dated by when it happened (returns.timestamp), not by the sale:
 * profit for a period is what the shop kept in that period.
 *
 * Filters mirror the profit reports: outlet(s) and employee apply to the
 * return; a category filter keeps the matching lines but still allocates the
 * refund across the whole return first.
 *
 * `ex_tax` figures strip each line's tax the same way the dashboard strips it
 * from sales (product tax rate, else products.gst).
 */

/**
 * SQL for a `ret_lines` CTE (no leading WITH) — one row per returned line with
 * return_id, product_id, variant_id, outlet_id, category_id, refund, cost_back,
 * tax_rate. Placeholders are numbered from `startIdx` so the block can sit in
 * front of a report's own parameters.
 */
function returnLinesCte({ from, to, outletIds = [], employeeId = null, categoryIds = null } = {}, startIdx = 1) {
  const values = [];
  const ph = (v) => { values.push(v); return `$${startIdx + values.length - 1}`; };
  const where = [`r.timestamp >= ${ph(from)}`, `r.timestamp < ${ph(to)}`];
  const ids = (outletIds || []).map(Number).filter(Boolean);
  if (ids.length) where.push(`r.outlet_id = ANY(${ph(ids)}::int[])`);
  if (employeeId) where.push(`r.employee_id = ${ph(Number(employeeId))}`);
  const categoryClause = Array.isArray(categoryIds)
    ? `WHERE category_id = ANY(${ph(categoryIds.map(Number))}::int[])`
    : '';

  const sql = `ret_lines AS (
       SELECT return_id, product_id, variant_id, outlet_id, category_id, tax_rate, cost_back,
              CASE WHEN return_value > 0 THEN line_value * total_refund / return_value ELSE 0 END AS refund
         FROM (
           SELECT r.id AS return_id,
                  r.outlet_id,
                  r.total_refund,
                  ri.product_id,
                  ri.variant_id,
                  p.category_id,
                  ri.quantity * ri.refund_price AS line_value,
                  SUM(ri.quantity * ri.refund_price) OVER (PARTITION BY r.id) AS return_value,
                  CASE WHEN t.id IS NOT NULL THEN t.rate ELSE COALESCE(p.gst, 0) END AS tax_rate,
                  CASE WHEN ri.restock_flag THEN ri.quantity * COALESCE(
                    (SELECT AVG(si.cost_price_at_sale) FROM sale_items si
                      WHERE si.sale_id = r.original_sale_id
                        AND si.product_id = ri.product_id
                        AND si.variant_id IS NOT DISTINCT FROM ri.variant_id),
                    pv.cost_price, p.cost_price, 0)
                  ELSE 0 END AS cost_back
             FROM returns r
             JOIN return_items ri ON ri.return_id = r.id
             JOIN products p ON p.id = ri.product_id
             LEFT JOIN product_variants pv ON pv.id = ri.variant_id
             LEFT JOIN taxes t ON t.id = p.tax_id
            WHERE ${where.join(' AND ')}
         ) lines
       ${categoryClause}
     )`;
  return { sql, values };
}

async function returnsProfit(db, opts = {}) {
  const cte = returnLinesCte(opts);
  const { rows: [row] } = await db.query(
    `WITH ${cte.sql}
     SELECT COUNT(DISTINCT return_id)::int AS returns_count,
            ROUND(COALESCE(SUM(refund), 0)::numeric, 2) AS refunds,
            ROUND(COALESCE(SUM(refund / (1 + tax_rate / 100.0)), 0)::numeric, 2) AS refunds_ex_tax,
            ROUND(COALESCE(SUM(cost_back), 0)::numeric, 2) AS cost_back
       FROM ret_lines`,
    cte.values,
  );

  const refunds = Number(row.refunds || 0);
  const refundsExTax = Number(row.refunds_ex_tax || 0);
  const costBack = Number(row.cost_back || 0);
  return {
    returns_count: row.returns_count,
    refunds,
    refunds_ex_tax: refundsExTax,
    cost_back: costBack,
    profit_back: round2(refunds - costBack),
    profit_back_ex_tax: round2(refundsExTax - costBack),
  };
}

/**
 * Build the returnLinesCte options from a profit report's query string, using
 * the same filters buildReportFilterParts applies to the sales side.
 */
async function returnFiltersFromQuery(query, tz, { toUtcStart, toUtcEnd, getDescendantLeafIds, db }) {
  const { date_from, date_to, outlet_id, employee_id, category_id } = query || {};
  return {
    from: date_from ? toUtcStart(date_from, tz) : '-infinity',
    to: date_to ? toUtcEnd(date_to, tz) : 'infinity',
    outletIds: outlet_id ? String(outlet_id).split(',') : [],
    employeeId: employee_id || null,
    categoryIds: category_id ? await getDescendantLeafIds(db, Number(category_id)) : null,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { returnsProfit, returnLinesCte, returnFiltersFromQuery };
