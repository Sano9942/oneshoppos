const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requireFeature } = deps;
  const { buildCategoryMetaMap, withCategoryPaths, buildReportFilterParts, pgWhere } =
    helpers;

  function applyOutletFilter(where, params, rawId, col = "s.outlet_id") {
    if (!rawId) return;
    const ids = String(rawId).split(",").map(Number).filter(Boolean);
    if (ids.length === 1) {
      where.push(`${col} = ?`);
      params.push(ids[0]);
    } else if (ids.length > 1) {
      where.push(`${col} IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
  }

  // Comparative Trends: Revenue comparison across periods
  app.get("/api/reports/comparative-trends", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { period1_from, period1_to, period2_from, period2_to, outlet_id } =
        req.query;

      const outletIds = outlet_id
        ? String(outlet_id).split(",").map(Number).filter(Boolean)
        : [];

      const buildSql = () => {
        const where = ["voided = false"];
        const params = [];
        where.push("timestamp >= ?");
        where.push("timestamp < ?");
        // params filled per-call below
        if (outletIds.length === 1) {
          where.push("outlet_id = ?");
        } else if (outletIds.length > 1) {
          where.push(`outlet_id IN (${outletIds.map(() => "?").join(",")})`);
        }
        let idx = 1;
        const whereStr = where.join(" AND ").replace(/\?/g, () => `$${idx++}`);
        return { whereStr, paramCount: idx - 1 };
      };

      const { whereStr } = buildSql();
      const sql = `
        SELECT SUM(total_amount) as revenue, COUNT(id) as orders
        FROM sales
        WHERE ${whereStr}
      `;

      const p1Params = [
        toUtcStart(period1_from, tz),
        toUtcEnd(period1_to, tz),
        ...outletIds,
      ];
      const p2Params = [
        toUtcStart(period2_from, tz),
        toUtcEnd(period2_to, tz),
        ...outletIds,
      ];

      const [p1Result, p2Result] = await Promise.all([
        db.query(sql, p1Params),
        db.query(sql, p2Params),
      ]);

      const data1 = p1Result.rows[0] || { revenue: 0, orders: 0 };
      const data2 = p2Result.rows[0] || { revenue: 0, orders: 0 };

      const calcDiff = (v1, v2) => {
        if (!v2) return v1 > 0 ? 100 : 0;
        return Number((((v1 - v2) / v2) * 100).toFixed(1));
      };

      res.json({
        data: {
          today: data1, // Frontend calls it "today" even if it's period 1
          yesterday: data2,
        },
        comparisons: {
          revenue_diff: data1.revenue - data2.revenue,
          revenue_pct: calcDiff(data1.revenue, data2.revenue),
          orders_diff: data1.orders - data2.orders,
          orders_pct: calcDiff(data1.orders, data2.orders),
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to compare trends" });
    }
  });

  // Heatmaps: Day/Hour sales density
  app.get("/api/reports/heatmaps", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id } = req.query;

      let where = ["voided = false"];
      const params = [];

      if (date_from) {
        where.push("timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      }
      if (date_to) {
        where.push("timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      applyOutletFilter(where, params, outlet_id, "outlet_id");

      let idx = 1;
      const whereStr = where.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
        SELECT
            EXTRACT(DOW FROM timestamp)::int as day_of_week,
            EXTRACT(HOUR FROM timestamp)::int as hour_of_day,
            SUM(total_amount) as revenue,
            COUNT(id) as order_count
        FROM sales
        WHERE ${whereStr}
        GROUP BY EXTRACT(DOW FROM timestamp)::int, EXTRACT(HOUR FROM timestamp)::int
        ORDER BY day_of_week, hour_of_day
      `;

      const { rows } = await db.query(sql, params);
      res.json({ heatmap: rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to load heatmap data" });
    }
  });

  // Revenue Leaks: Deep Dive on Discounts, Comps, and Voids
  app.get("/api/reports/revenue-leaks", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id } = req.query;

      let where = [];
      const params = [];

      if (date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      } else {
        const defaultFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const defaultFromStr = defaultFrom.toISOString().slice(0, 10);
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(defaultFromStr, tz));
      }
      if (date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      applyOutletFilter(where, params, outlet_id);

      let idx = 1;
      const whereStr = where.length > 0 ? "WHERE " + where.join(" AND ").replace(/\?/g, () => `$${idx++}`) : "";

      const sql = `
        SELECT
            SUM(total_amount) as total_gross_sales,
            SUM(CASE WHEN voided = true THEN total_amount ELSE 0 END) as total_voided_value,
            SUM(CASE WHEN voided = false AND COALESCE(discount_amount, 0) > 0 THEN discount_amount ELSE 0 END) as total_discounts,
            COUNT(id) as total_transactions,
            SUM(CASE WHEN voided = true THEN 1 ELSE 0 END) as voided_transactions,
            SUM(CASE WHEN voided = false AND COALESCE(discount_amount, 0) > 0 THEN 1 ELSE 0 END) as discounted_transactions
        FROM sales s
        ${whereStr}
      `;

      const { rows } = await db.query(sql, params);
      const data = rows[0] || {};

      const summary = {
        gross_sales: data.total_gross_sales || 0,
        voids: data.total_voided_value || 0,
        discounts: data.total_discounts || 0,
        leakage_total:
          (data.total_voided_value || 0) + (data.total_discounts || 0),
      };

      // Employee leakage breakdown — needs the same date params again
      let empWhere = [
        "(COALESCE(s.discount_amount, 0) > 0 OR s.voided = true)",
        "s.employee_id IS NOT NULL",
      ];
      empWhere = empWhere.concat(where);

      let empIdx = 1;
      const empWhereStr = empWhere.join(" AND ").replace(/\?/g, () => `$${empIdx++}`);

      const empSql = `
        SELECT
            e.id as employee_id,
            e.name as employee_name,
            SUM(CASE WHEN s.voided = true THEN s.total_amount ELSE 0 END) as void_value,
            SUM(CASE WHEN s.voided = false THEN COALESCE(s.discount_amount, 0) ELSE 0 END) as discount_value,
            SUM(CASE WHEN s.voided = true THEN s.total_amount ELSE 0 END) + SUM(CASE WHEN s.voided = false THEN COALESCE(s.discount_amount, 0) ELSE 0 END) as total_leakage
        FROM sales s
        JOIN employees e ON s.employee_id = e.id
        WHERE ${empWhereStr}
        GROUP BY e.id, e.name
        ORDER BY total_leakage DESC
        LIMIT 10
      `;

      const empResult = await db.query(empSql, params);

      res.json({
        summary,
        transactions: {
          total: data.total_transactions || 0,
          voided: data.voided_transactions || 0,
          discounted: data.discounted_transactions || 0,
        },
        top_leak_employees: empResult.rows,
      });
    } catch (err) {
      console.error("Revenue Leaks Error:", err);
      res.status(500).json({ error: "Failed to load revenue leaks data" });
    }
  });

  // Product Mix Analysis (Market Basket)
  app.get("/api/reports/product-mix", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id, limit = 20 } = req.query;

      let where = ["s.voided = false"];
      const params = [];

      if (date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      } else {
        const defaultFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const defaultFromStr = defaultFrom.toISOString().slice(0, 10);
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(defaultFromStr, tz));
      }
      if (date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      applyOutletFilter(where, params, outlet_id);

      // LIMIT param goes at the end
      params.push(Number(limit));
      const limitIdx = params.length;

      let idx = 1;
      const whereStr = where.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
        WITH SharedTransactions AS (
          SELECT si1.sale_id, si1.product_id as pid1, p1.name as pname1,
                 si2.product_id as pid2, p2.name as pname2
          FROM sale_items si1
          JOIN sale_items si2 ON si1.sale_id = si2.sale_id AND si1.product_id < si2.product_id
          JOIN sales s ON si1.sale_id = s.id
          JOIN products p1 ON si1.product_id = p1.id
          JOIN products p2 ON si2.product_id = p2.id
          WHERE ${whereStr}
        )
        SELECT
           pid1, pname1, pid2, pname2, COUNT(sale_id) as co_occurrences
        FROM SharedTransactions
        GROUP BY pid1, pname1, pid2, pname2
        ORDER BY co_occurrences DESC
        LIMIT $${limitIdx}
      `;

      const { rows } = await db.query(sql, params);
      res.json({ product_mix: rows });
    } catch (err) {
      console.error("Product Mix Error:", err);
      res.status(500).json({ error: "Failed to load product mix data" });
    }
  });

  // Retail Matrix / Menu Engineering
  app.get("/api/reports/retail-matrix", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id } = req.query;

      let where = ["s.voided = false"];
      const params = [];

      if (date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      } else {
        const defaultFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const defaultFromStr = defaultFrom.toISOString().slice(0, 10);
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(defaultFromStr, tz));
      }
      if (date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      applyOutletFilter(where, params, outlet_id);

      let idx = 1;
      const whereStr = where.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const averagesSql = `
        WITH ProductStats AS (
          SELECT
            p.id,
            SUM(si.quantity) as volume,
            ROUND(SUM(si.quantity * (si.price_at_sale - si.cost_price_at_sale)) / NULLIF(SUM(si.quantity), 0), 2) as avg_unit_margin
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE ${whereStr}
          GROUP BY p.id
        )
        SELECT
          AVG(volume) as threshold_volume,
          AVG(avg_unit_margin) as threshold_margin
        FROM ProductStats
      `;

      const avgResult = await db.query(averagesSql, params);
      const thresholdVolume = avgResult.rows[0]?.threshold_volume || 0;
      const thresholdMargin = avgResult.rows[0]?.threshold_margin || 0;

      // For the matrix query, we need the same where params plus 6 threshold params
      const matrixParams = [
        ...params,
        thresholdVolume,
        thresholdMargin,
        thresholdVolume,
        thresholdMargin,
        thresholdVolume,
        thresholdMargin,
      ];

      let mIdx = 1;
      const mWhereStr = where.join(" AND ").replace(/\?/g, () => `$${mIdx++}`);
      // mIdx is now past the where params; threshold params start at mIdx

      const matrixSql = `
        WITH ProductStats AS (
          SELECT
            p.id as product_id,
            p.name as product_name,
            p.barcode,
            SUM(si.quantity) as volume,
            SUM(si.quantity * si.price_at_sale) as total_revenue,
            ROUND(SUM(si.quantity * (si.price_at_sale - si.cost_price_at_sale)) / NULLIF(SUM(si.quantity), 0), 2) as avg_unit_margin
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE ${mWhereStr}
          GROUP BY p.id, p.name, p.barcode
        )
        SELECT
          *,
          CASE
            WHEN volume >= $${mIdx} AND avg_unit_margin >= $${mIdx + 1} THEN 'Star'
            WHEN volume >= $${mIdx + 2} AND avg_unit_margin < $${mIdx + 3} THEN 'Plowhorse'
            WHEN volume < $${mIdx + 4} AND avg_unit_margin >= $${mIdx + 5} THEN 'Puzzle'
            ELSE 'Dog'
          END as matrix_category
        FROM ProductStats
        ORDER BY total_revenue DESC
      `;

      const matrixResult = await db.query(matrixSql, matrixParams);

      res.json({
        thresholds: { volume: thresholdVolume, margin: thresholdMargin },
        matrix: matrixResult.rows,
      });
    } catch (err) {
      console.error("Retail Matrix Error:", err);
      res.status(500).json({ error: "Failed to calculate retail matrix data" });
    }
  });

  // Customer RFM data
  app.get("/api/reports/customer-rfm", async (req, res) => {
    try {
      const sql = `
      SELECT c.id, c.name, c.mobile, c.email,
             COUNT(DISTINCT s.id) AS order_count,
             COALESCE(SUM(s.total_amount), 0) AS total_spent,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - MAX(s.timestamp))) / 86400.0)::int AS recency_days,
             MAX(s.timestamp) AS last_order_at
      FROM customers c
      INNER JOIN sales s ON s.customer_id = c.id AND s.voided = false
      GROUP BY c.id, c.name, c.mobile, c.email
      HAVING COUNT(DISTINCT s.id) > 0
      ORDER BY total_spent DESC`;
      const { rows } = await db.query(sql, []);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Customer Details report
  app.get("/api/reports/customer-details", async (req, res) => {
    try {
      const { search = "" } = req.query;
      let query = `
      SELECT c.id, c.name, c.mobile, c.email, c.created_at,
             COUNT(s.id) as order_count,
             COALESCE(SUM(s.total_amount), 0) as total_spent
      FROM customers c
      LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = false
    `;
      const params = [];
      if (search) {
        query += " WHERE c.name ILIKE $1 OR c.mobile ILIKE $2";
        params.push(`%${search}%`, `%${search}%`);
      }
      query += " GROUP BY c.id, c.name, c.mobile, c.email, c.created_at ORDER BY total_spent DESC";
      const { rows } = await db.query(query, params);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Customer Retention
  app.get("/api/reports/customer-retention", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id } = req.query;

      let where = ["s.voided = false"];
      const params = [];

      if (date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      } else {
        const defaultFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const defaultFromStr = defaultFrom.toISOString().slice(0, 10);
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(defaultFromStr, tz));
      }
      if (date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      applyOutletFilter(where, params, outlet_id);

      let idx = 1;
      const whereStr = where.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
        WITH CustomerFirstPurchase AS (
          SELECT customer_id, MIN(timestamp::date) as first_purchase_date
          FROM sales
          WHERE voided = false AND customer_id IS NOT NULL
          GROUP BY customer_id
        )
        SELECT
          s.timestamp::date as sale_date,
          CASE
            WHEN s.customer_id IS NULL THEN 'walk_in'
            WHEN s.timestamp::date = cfp.first_purchase_date THEN 'new_customer'
            ELSE 'returning_customer'
          END as customer_type,
          SUM(s.total_amount) as revenue,
          COUNT(s.id) as orders
        FROM sales s
        LEFT JOIN CustomerFirstPurchase cfp ON s.customer_id = cfp.customer_id
        WHERE ${whereStr}
        GROUP BY s.timestamp::date,
          CASE
            WHEN s.customer_id IS NULL THEN 'walk_in'
            WHEN s.timestamp::date = cfp.first_purchase_date THEN 'new_customer'
            ELSE 'returning_customer'
          END
        ORDER BY sale_date ASC
      `;

      const { rows } = await db.query(sql, params);

      const summary = {
        walk_in: { revenue: 0, orders: 0 },
        new_customer: { revenue: 0, orders: 0 },
        returning_customer: { revenue: 0, orders: 0 },
      };

      rows.forEach((row) => {
        if (summary[row.customer_type]) {
          summary[row.customer_type].revenue += Number(row.revenue);
          summary[row.customer_type].orders += Number(row.orders);
        }
      });

      res.json({ timeline: rows, summary });
    } catch (err) {
      console.error("Customer Retention Error:", err);
      res.status(500).json({ error: "Failed to load customer retention data" });
    }
  });

  // Customer Capture Rate
  app.get("/api/reports/customer-capture-rate", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id } = req.query;

      let where = ["s.voided = false"];
      const params = [];

      if (date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      } else {
        const defaultFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const defaultFromStr = defaultFrom.toISOString().slice(0, 10);
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(defaultFromStr, tz));
      }
      if (date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      applyOutletFilter(where, params, outlet_id);

      let idx = 1;
      const whereStr = where.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
        SELECT
            COALESCE(e.name, 'Unknown Staff') as employee_name,
            e.id as employee_id,
            COUNT(s.id) as total_transactions,
            SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) as profiled_transactions,
            SUM(CASE WHEN s.customer_id IS NULL THEN 1 ELSE 0 END) as walk_in_transactions,
            ROUND(SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END)::float / COUNT(s.id) * 100, 1) as capture_rate_pct,
            SUM(s.total_amount) as total_revenue,
            SUM(CASE WHEN s.customer_id IS NOT NULL THEN s.total_amount ELSE 0 END) as profiled_revenue
        FROM sales s
        LEFT JOIN employees e ON s.employee_id = e.id
        WHERE ${whereStr}
        GROUP BY e.id, e.name
        ORDER BY capture_rate_pct DESC
      `;

      const { rows } = await db.query(sql, params);

      const totals = rows.reduce(
        (acc, row) => {
          acc.total_transactions += Number(row.total_transactions);
          acc.profiled_transactions += Number(row.profiled_transactions);
          return acc;
        },
        { total_transactions: 0, profiled_transactions: 0 },
      );

      const store_capture_rate =
        totals.total_transactions > 0
          ? Number(
              (
                (totals.profiled_transactions / totals.total_transactions) *
                100
              ).toFixed(1),
            )
          : 0;

      res.json({
        staff_breakdown: rows,
        store_capture_rate,
        total_transactions: totals.total_transactions,
      });
    } catch (err) {
      console.error("Capture Rate Error:", err);
      res.status(500).json({ error: "Failed to load capture rate data" });
    }
  });

  // Discount Leakage
  app.get(
    "/api/reports/discount-leakage",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
      try {
        const { where, params } = await buildReportFilterParts(req, {
          sale: "s",
          product: "p",
          item: "si",
        });

        let idx = 1;
        const whereStr = where.length
          ? `WHERE ${where.join(" AND ").replace(/\?/g, () => `$${idx++}`)}`
          : "";

        const sql = `
        SELECT
          s.id AS sale_id,
          s.timestamp,
          COALESCE(o.name, '—') AS outlet_name,
          COALESCE(e.name, '—') AS employee_name,
          ROUND(COALESCE(s.total_amount, 0), 2) AS total_amount,
          ROUND(COALESCE(s.discount_amount, 0), 2) AS discount_amount,
          ROUND(0::numeric, 2) AS promo_discount,
          ROUND(COALESCE(s.discount_amount, 0), 2) AS total_discount
        FROM sales s
        LEFT JOIN outlets o ON s.outlet_id = o.id
        LEFT JOIN employees e ON s.employee_id = e.id
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        ${whereStr}
        GROUP BY s.id, s.timestamp, o.name, e.name, s.total_amount, s.discount_amount
        HAVING ROUND(COALESCE(s.discount_amount, 0), 2) > 0
        ORDER BY ROUND(COALESCE(s.discount_amount, 0), 2) DESC, s.timestamp DESC
        LIMIT 200
      `;
        const { rows } = await db.query(sql, params);
        const totals = rows.reduce(
          (acc, r) => {
            acc.total_discount += Number(r.total_discount || 0);
            acc.total_sales += Number(r.total_amount || 0);
            return acc;
          },
          { total_discount: 0, total_sales: 0 },
        );
        res.json({
          rows,
          totals: {
            total_discount: Number(totals.total_discount.toFixed(2)),
            total_sales: Number(totals.total_sales.toFixed(2)),
          },
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Exceptions
  app.get(
    "/api/reports/exceptions",
    requireFeature("reports_exceptions"),
    async (req, res) => {
      try {
        const type = String(req.query.type || "negative_margin_sales");

        if (type === "negative_margin_sales") {
          const sql = `
          SELECT
            s.id AS sale_id,
            s.timestamp,
            p.id AS product_id,
            p.name AS product_name,
            p.barcode,
            o.name AS outlet_name,
            e.name AS employee_name,
            si.quantity,
            si.price_at_sale,
            si.cost_price_at_sale,
            ROUND((si.price_at_sale - si.cost_price_at_sale), 2) AS unit_margin
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id AND s.voided = false
          JOIN products p ON p.id = si.product_id
          LEFT JOIN outlets o ON o.id = s.outlet_id
          LEFT JOIN employees e ON e.id = s.employee_id
          WHERE si.price_at_sale < si.cost_price_at_sale
          ORDER BY s.timestamp DESC
          LIMIT 300
        `;
          const { rows } = await db.query(sql, []);
          return res.json({ type, rows });
        }

        if (type === "high_discount_orders") {
          const thresholdPct = Math.max(
            0,
            Math.min(100, Number(req.query.threshold_pct || 20)),
          );
          const sql = `
          SELECT
            s.id AS sale_id,
            s.timestamp,
            COALESCE(o.name, '—') AS outlet_name,
            COALESCE(e.name, '—') AS employee_name,
            ROUND(COALESCE(s.total_amount, 0), 2) AS total_amount,
            ROUND(COALESCE(s.discount_amount, 0), 2) AS total_discount,
            ROUND(
              CASE
                WHEN (COALESCE(s.total_amount, 0) + COALESCE(s.discount_amount, 0)) > 0
                THEN (COALESCE(s.discount_amount, 0) * 100.0)
                     / (COALESCE(s.total_amount, 0) + COALESCE(s.discount_amount, 0))
                ELSE 0
              END,
              2
            ) AS discount_pct
          FROM sales s
          LEFT JOIN outlets o ON o.id = s.outlet_id
          LEFT JOIN employees e ON e.id = s.employee_id
          WHERE s.voided = false
          GROUP BY s.id, s.timestamp, o.name, e.name, s.total_amount, s.discount_amount
          HAVING ROUND(
            CASE
              WHEN (COALESCE(s.total_amount, 0) + COALESCE(s.discount_amount, 0)) > 0
              THEN (COALESCE(s.discount_amount, 0) * 100.0)
                   / (COALESCE(s.total_amount, 0) + COALESCE(s.discount_amount, 0))
              ELSE 0
            END,
            2
          ) >= $1
          ORDER BY discount_pct DESC, s.timestamp DESC
          LIMIT 300
        `;
          const { rows } = await db.query(sql, [thresholdPct]);
          return res.json({ type, threshold_pct: thresholdPct, rows });
        }

        if (type === "frequent_voids_by_employee") {
          const sql = `
          SELECT
            COALESCE(e.id, 0) AS employee_id,
            COALESCE(e.name, 'Unknown') AS employee_name,
            COUNT(*) AS void_count,
            ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS void_value
          FROM sales s
          LEFT JOIN employees e ON e.id = s.employee_id
          WHERE s.voided = true
          GROUP BY e.id, e.name
          HAVING COUNT(*) > 0
          ORDER BY void_count DESC, void_value DESC
          LIMIT 200
        `;
          const { rows } = await db.query(sql, []);
          return res.json({ type, rows });
        }

        if (type === "frequent_returns_by_product") {
          const sql = `
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.barcode,
            COUNT(ri.id) AS return_lines,
            ROUND(COALESCE(SUM(ri.quantity), 0), 2) AS returned_qty,
            ROUND(COALESCE(SUM(ri.quantity * ri.refund_price), 0), 2) AS returned_value
          FROM return_items ri
          JOIN products p ON p.id = ri.product_id
          GROUP BY p.id, p.name, p.barcode
          HAVING COUNT(ri.id) > 0
          ORDER BY returned_value DESC, returned_qty DESC
          LIMIT 300
        `;
          const { rows } = await db.query(sql, []);
          return res.json({ type, rows });
        }

        return res.status(400).json({
          error: "Unsupported exception type",
          supported_types: [
            "negative_margin_sales",
            "high_discount_orders",
            "frequent_voids_by_employee",
            "frequent_returns_by_product",
          ],
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Outlet comparison
  app.get("/api/reports/outlet-comparison", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { from, to, date_from, date_to } = req.query;
      const f = from || date_from;
      const t2 = to || date_to;
      const conditions = ["voided = false"];
      const params = [];
      if (f) {
        conditions.push("timestamp >= ?");
        params.push(toUtcStart(f, tz));
      }
      if (t2) {
        conditions.push("timestamp < ?");
        params.push(toUtcEnd(t2, tz));
      }

      let idx = 1;
      const saleWhere = conditions.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
      SELECT o.id, o.name,
             COALESCE(t.order_count, 0)       AS order_count,
             COALESCE(t.revenue, 0)            AS revenue,
             COALESCE(t.avg_basket, 0)         AS avg_basket,
             COALESCE(t.unique_customers, 0)   AS unique_customers
      FROM outlets o
      LEFT JOIN (
        SELECT outlet_id,
               COUNT(DISTINCT id)       AS order_count,
               SUM(total_amount)        AS revenue,
               AVG(total_amount)        AS avg_basket,
               COUNT(DISTINCT customer_id) AS unique_customers
        FROM sales
        WHERE ${saleWhere}
        GROUP BY outlet_id
      ) t ON t.outlet_id = o.id
      ORDER BY revenue DESC`;
      const { rows } = await db.query(sql, params);
      res.json({ comparison: rows }); // Frontend `ReportsOperations.jsx` expects `comparison` here.
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Supplier Wise
  app.get("/api/reports/supplier-wise", async (req, res) => {
    try {
      const sql = `
      SELECT s.id, s.name AS supplier_name, s.contact_person, s.phone,
             COUNT(DISTINCT po.id) AS total_pos,
             COALESCE(SUM(poi.quantity),0) AS total_items,
             COALESCE(SUM(poi.quantity * poi.cost_price),0) AS total_cost
      FROM suppliers s
      LEFT JOIN purchase_orders po ON s.id = po.supplier_id
      LEFT JOIN purchase_order_items poi ON po.id = poi.po_id
      GROUP BY s.id, s.name, s.contact_person, s.phone
      ORDER BY total_cost DESC`;
      const { rows } = await db.query(sql, []);
      res.json({ items: rows }); // ReportsPurchasing.jsx expects items
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2-G.7: Returns by reason — aggregates return_items by reason code +
  // product + supplier so ops can spot patterns (e.g. "defective blender
  // returns spiked this month — flag supplier X"). Splits restocked vs
  // scrapped so the shrinkage vector is visible alongside the refund
  // impact. UTC timestamp range matches the canonical returns filter.
  app.get("/api/reports/returns-by-reason", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id, supplier_id } = req.query;

      const utcStart = toUtcStart(date_from, tz);
      const utcEnd = toUtcEnd(date_to, tz);

      const where = ["r.timestamp >= $1", "r.timestamp < $2"];
      const params = [utcStart, utcEnd];

      if (outlet_id) {
        const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
        if (ids.length === 1) {
          where.push(`r.outlet_id = $${params.length + 1}`);
          params.push(ids[0]);
        } else if (ids.length > 1) {
          const placeholders = ids
            .map((_, i) => `$${params.length + 1 + i}`)
            .join(",");
          where.push(`r.outlet_id IN (${placeholders})`);
          params.push(...ids);
        }
      }
      if (supplier_id) {
        where.push(`p.supplier_id = $${params.length + 1}`);
        params.push(Number(supplier_id));
      }

      const sql = `
        SELECT
          COALESCE(rr.id, 0) AS reason_id,
          COALESCE(rr.code, 'unspecified') AS reason_code,
          COALESCE(rr.label, 'Unspecified') AS reason_label,
          p.id AS product_id,
          p.name AS product_name,
          p.sku,
          p.barcode,
          sup.id AS supplier_id,
          sup.name AS supplier_name,
          SUM(CASE WHEN ri.restock_flag IS NOT FALSE THEN ri.quantity ELSE 0 END) AS qty_restocked,
          SUM(CASE WHEN ri.restock_flag = FALSE THEN ri.quantity ELSE 0 END) AS qty_scrapped,
          SUM(ri.quantity) AS qty_total,
          SUM(ri.quantity * ri.refund_price) AS refund_total,
          COUNT(DISTINCT r.id) AS return_count
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        JOIN products p ON p.id = ri.product_id
        LEFT JOIN suppliers sup ON sup.id = p.supplier_id
        LEFT JOIN return_reasons rr ON rr.id = ri.reason_code_id
        WHERE ${where.join(" AND ")}
        GROUP BY rr.id, rr.code, rr.label, p.id, p.name, p.sku, p.barcode, sup.id, sup.name
        ORDER BY qty_scrapped DESC NULLS LAST, qty_total DESC
      `;

      const { rows } = await db.query(sql, params);
      res.json({ rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
