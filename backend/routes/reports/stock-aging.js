/**
 * Stock aging report — shows how long inventory has been sitting,
 * based on most recent GRN received date (fallback: product.created_at).
 * Feature #14, Wave 3.
 */
module.exports = function registerStockAgingReport(app, deps, helpers) {
  const { db, requireAnyPerm } = deps;

  app.get(
    "/api/reports/stock-aging",
    requireAnyPerm(["view_reports", "manage_inventory"]),
    async (req, res) => {
      try {
        const { outlet_id, bucket, category_id, brand_id, supplier_id, search } =
          req.query;

        const where = ["os.quantity > 0"];
        const params = [];
        let idx = 0;

        if (outlet_id) {
          const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
          if (ids.length === 1) {
            where.push(`os.outlet_id = $${++idx}`);
            params.push(ids[0]);
          } else if (ids.length > 1) {
            where.push(
              `os.outlet_id IN (${ids.map(() => `$${++idx}`).join(",")})`,
            );
            params.push(...ids);
          }
        }

        if (category_id) {
          where.push(`p.category_id = $${++idx}`);
          params.push(Number(category_id));
        }
        if (brand_id) {
          where.push(`p.brand_id = $${++idx}`);
          params.push(Number(brand_id));
        }
        if (supplier_id) {
          where.push(`p.supplier_id = $${++idx}`);
          params.push(Number(supplier_id));
        }
        if (search) {
          const sv = `%${search}%`;
          const a = ++idx, b = ++idx, c = ++idx;
          where.push(
            `(p.name ILIKE $${a} OR COALESCE(p.barcode,'') ILIKE $${b} OR COALESCE(p.sku,'') ILIKE $${c})`,
          );
          params.push(sv, sv, sv);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const sql = `
          SELECT
            p.id AS product_id,
            p.name,
            COALESCE(p.sku, '') AS sku,
            COALESCE(p.barcode, '') AS barcode,
            os.quantity AS current_stock,
            COALESCE(p.cost_price, 0) AS cost_price,
            ROUND((os.quantity * COALESCE(p.cost_price, 0))::numeric, 2) AS stock_value,
            o.name AS outlet_name,
            os.outlet_id,
            COALESCE(cat.name, '') AS category,
            COALESCE(b.name, '') AS brand,
            COALESCE(s.name, '') AS supplier,
            grn_date.last_received,
            COALESCE(grn_date.last_received, p.created_at) AS age_reference_date,
            EXTRACT(DAY FROM NOW() - COALESCE(grn_date.last_received, p.created_at))::int AS age_days
          FROM outlet_stock os
          JOIN products p ON p.id = os.product_id
          JOIN outlets o ON o.id = os.outlet_id
          LEFT JOIN categories cat ON cat.id = p.category_id
          LEFT JOIN brands b ON b.id = p.brand_id
          LEFT JOIN suppliers s ON s.id = p.supplier_id
          LEFT JOIN LATERAL (
            SELECT MAX(grn.received_at) AS last_received
            FROM goods_received_notes grn
            JOIN grn_items gi ON gi.grn_id = grn.id
            WHERE gi.product_id = p.id
          ) grn_date ON true
          ${whereSql}
          ORDER BY age_days DESC NULLS LAST
        `;

        const { rows } = await db.query(sql, params);

        // Assign buckets
        const buckets = { fresh: [], aging: [], old: [], critical: [] };
        const summary = {
          fresh: { count: 0, value: 0 },
          aging: { count: 0, value: 0 },
          old: { count: 0, value: 0 },
          critical: { count: 0, value: 0 },
        };

        for (const row of rows) {
          const days = Number(row.age_days) || 0;
          let b;
          if (days <= 30) b = "fresh";
          else if (days <= 60) b = "aging";
          else if (days <= 90) b = "old";
          else b = "critical";

          row.age_bucket = b;
          buckets[b].push(row);
          summary[b].count++;
          summary[b].value = Number(
            (summary[b].value + Number(row.stock_value || 0)).toFixed(2),
          );
        }

        // Filter by bucket if requested
        const items = bucket && buckets[bucket] ? buckets[bucket] : rows;

        res.json({ items, summary });
      } catch (err) {
        console.error("stock-aging report error:", err);
        res.status(500).json({ error: "Failed to generate stock aging report" });
      }
    },
  );
};
