const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requireFeature } = deps;
  const { buildCategoryMetaMap, withCategoryPaths, buildReportFilterParts } =
    helpers;

  // Comparative Trends: Revenue comparison across periods
  app.get("/api/reports/comparative-trends", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { period1_from, period1_to, period2_from, period2_to, outlet_id } =
        req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      const filter = outlet_id ? "AND outlet_id = ?" : "";
      const outletParams = outlet_id ? [outlet_id] : [];

      const sql = () => `
            SELECT SUM(total_amount) as revenue, COUNT(id) as orders
            FROM sales
            WHERE voided = 0 AND timestamp >= ? AND timestamp < ? ${filter}
        `;

      const [p1, p2] = await Promise.all([
        getQuery(sql(), [
          toUtcStart(period1_from, tz),
          toUtcEnd(period1_to, tz),
          ...outletParams,
        ]),
        getQuery(sql(), [
          toUtcStart(period2_from, tz),
          toUtcEnd(period2_to, tz),
          ...outletParams,
        ]),
      ]);

      const data1 = p1[0] || { revenue: 0, orders: 0 };
      const data2 = p2[0] || { revenue: 0, orders: 0 };

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
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["voided = 0"];
      const params = [];

      if (date_from) {
        where.push("timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      }
      if (date_to) {
        where.push("timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      if (outlet_id) {
        where.push("outlet_id = ?");
        params.push(outlet_id);
      }

      const sql = `
            SELECT 
                strftime('%w', timestamp, 'localtime') as day_of_week,
                strftime('%H', timestamp, 'localtime') as hour_of_day,
                SUM(total_amount) as revenue,
                COUNT(id) as order_count
            FROM sales
            WHERE ${where.join(" AND ")}
            GROUP BY day_of_week, hour_of_day
            ORDER BY day_of_week, hour_of_day
        `;

      const heat = await getQuery(sql, params);
      res.json({ heatmap: heat });
    } catch (err) {
      res.status(500).json({ error: "Failed to load heatmap data" });
    }
  });

  // Revenue Leaks: Deep Dive on Discounts, Comps, and Voids
  app.get("/api/reports/revenue-leaks", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

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
      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      const filterStr = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

      const sql = `
        SELECT 
            SUM(total_amount) as total_gross_sales,
            SUM(CASE WHEN voided = 1 THEN total_amount ELSE 0 END) as total_voided_value,
            SUM(CASE WHEN voided = 0 AND COALESCE(discount_amount, 0) > 0 THEN discount_amount ELSE 0 END) as total_discounts,
            COUNT(id) as total_transactions,
            SUM(CASE WHEN voided = 1 THEN 1 ELSE 0 END) as voided_transactions,
            SUM(CASE WHEN voided = 0 AND COALESCE(discount_amount, 0) > 0 THEN 1 ELSE 0 END) as discounted_transactions
        FROM sales s
        ${filterStr}
      `;

      const rows = await getQuery(sql, params);
      const data = rows[0] || {};

      const summary = {
        gross_sales: data.total_gross_sales || 0,
        voids: data.total_voided_value || 0,
        discounts: data.total_discounts || 0,
        leakage_total:
          (data.total_voided_value || 0) + (data.total_discounts || 0),
      };

      let empWhere = [
        "COALESCE(s.discount_amount, 0) > 0 OR s.voided = 1",
        "s.employee_id IS NOT NULL",
      ];
      empWhere = empWhere.concat(where);

      const empSql = `
        SELECT 
            e.id as employee_id,
            e.name as employee_name,
            SUM(CASE WHEN s.voided = 1 THEN s.total_amount ELSE 0 END) as void_value,
            SUM(CASE WHEN s.voided = 0 THEN COALESCE(s.discount_amount, 0) ELSE 0 END) as discount_value,
            SUM(CASE WHEN s.voided = 1 THEN s.total_amount ELSE 0 END) + SUM(CASE WHEN s.voided = 0 THEN COALESCE(s.discount_amount, 0) ELSE 0 END) as total_leakage
        FROM sales s
        JOIN employees e ON s.employee_id = e.id
        WHERE ${empWhere.join(" AND ")}
        GROUP BY e.id
        ORDER BY total_leakage DESC
        LIMIT 10
      `;

      const top_leak_employees = await getQuery(
        empSql,
        params.concat(params).slice(0, params.length),
      );

      res.json({
        summary,
        transactions: {
          total: data.total_transactions || 0,
          voided: data.voided_transactions || 0,
          discounted: data.discounted_transactions || 0,
        },
        top_leak_employees,
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
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
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
      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      const sql = `
        WITH SharedTransactions AS (
          SELECT si1.sale_id, si1.product_id as pid1, p1.name as pname1, 
                 si2.product_id as pid2, p2.name as pname2
          FROM sale_items si1
          JOIN sale_items si2 ON si1.sale_id = si2.sale_id AND si1.product_id < si2.product_id
          JOIN sales s ON si1.sale_id = s.id
          JOIN products p1 ON si1.product_id = p1.id
          JOIN products p2 ON si2.product_id = p2.id
          WHERE ${where.join(" AND ")}
        )
        SELECT 
           pid1, pname1, pid2, pname2, COUNT(sale_id) as co_occurrences
        FROM SharedTransactions
        GROUP BY pid1, pid2
        ORDER BY co_occurrences DESC
        LIMIT ?
      `;

      const rows = await getQuery(sql, [...params, limit]);
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
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
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
      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      const averagesSql = `
        WITH ProductStats AS (
          SELECT 
            p.id,
            SUM(si.quantity) as volume,
            ROUND(SUM(si.quantity * (si.price_at_sale - si.cost_price_at_sale)) / SUM(si.quantity), 2) as avg_unit_margin
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE ${where.join(" AND ")}
          GROUP BY p.id
        )
        SELECT 
          AVG(volume) as threshold_volume,
          AVG(avg_unit_margin) as threshold_margin
        FROM ProductStats
      `;

      const averages = await getQuery(averagesSql, params);
      const thresholdVolume = averages[0]?.threshold_volume || 0;
      const thresholdMargin = averages[0]?.threshold_margin || 0;

      const matrixSql = `
        WITH ProductStats AS (
          SELECT 
            p.id as product_id,
            p.name as product_name,
            p.barcode,
            SUM(si.quantity) as volume,
            SUM(si.quantity * si.price_at_sale) as total_revenue,
            ROUND(SUM(si.quantity * (si.price_at_sale - si.cost_price_at_sale)) / SUM(si.quantity), 2) as avg_unit_margin
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE ${where.join(" AND ")}
          GROUP BY p.id
        )
        SELECT 
          *,
          CASE
            WHEN volume >= ? AND avg_unit_margin >= ? THEN 'Star'
            WHEN volume >= ? AND avg_unit_margin < ? THEN 'Plowhorse'
            WHEN volume < ? AND avg_unit_margin >= ? THEN 'Puzzle'
            ELSE 'Dog'
          END as matrix_category
        FROM ProductStats
        ORDER BY total_revenue DESC
      `;

      const rows = await getQuery(matrixSql, [
        ...params,
        thresholdVolume,
        thresholdMargin,
        thresholdVolume,
        thresholdMargin,
        thresholdVolume,
        thresholdMargin,
      ]);

      res.json({
        thresholds: { volume: thresholdVolume, margin: thresholdMargin },
        matrix: rows,
      });
    } catch (err) {
      console.error("Retail Matrix Error:", err);
      res.status(500).json({ error: "Failed to calculate retail matrix data" });
    }
  });

  // Customer RFM data
  app.get("/api/reports/customer-rfm", (req, res) => {
    const sql = `
    SELECT c.id, c.name, c.mobile, c.email,
           COUNT(DISTINCT s.id) AS order_count,
           COALESCE(SUM(s.total_amount), 0) AS total_spent,
           CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS recency_days,
           MAX(s.timestamp) AS last_order_at
    FROM customers c
    INNER JOIN sales s ON s.customer_id = c.id AND s.voided = 0
    GROUP BY c.id
    HAVING order_count > 0
    ORDER BY total_spent DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // Customer Details report
  app.get("/api/reports/customer-details", (req, res) => {
    const { search = "" } = req.query;
    let query = `
    SELECT c.id, c.name, c.mobile, c.email, c.created_at,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
  `;
    const params = [];
    if (search) {
      query += " WHERE c.name LIKE ? OR c.mobile LIKE ?";
      params.push(`%${search}%`, `%${search}%`);
    }
    query += " GROUP BY c.id ORDER BY total_spent DESC";
    db.all(query, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // Customer Retention
  app.get("/api/reports/customer-retention", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
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
      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      const sql = `
        WITH CustomerFirstPurchase AS (
          SELECT customer_id, MIN(date(timestamp, 'localtime')) as first_purchase_date
          FROM sales
          WHERE voided = 0 AND customer_id IS NOT NULL
          GROUP BY customer_id
        )
        SELECT 
          date(s.timestamp, 'localtime') as sale_date,
          CASE 
            WHEN s.customer_id IS NULL THEN 'walk_in'
            WHEN date(s.timestamp, 'localtime') = cfp.first_purchase_date THEN 'new_customer'
            ELSE 'returning_customer'
          END as customer_type,
          SUM(s.total_amount) as revenue,
          COUNT(s.id) as orders
        FROM sales s
        LEFT JOIN CustomerFirstPurchase cfp ON s.customer_id = cfp.customer_id
        WHERE ${where.join(" AND ")}
        GROUP BY sale_date, customer_type
        ORDER BY sale_date ASC
      `;

      const rows = await getQuery(sql, params);

      const summary = {
        walk_in: { revenue: 0, orders: 0 },
        new_customer: { revenue: 0, orders: 0 },
        returning_customer: { revenue: 0, orders: 0 },
      };

      rows.forEach((row) => {
        if (summary[row.customer_type]) {
          summary[row.customer_type].revenue += row.revenue;
          summary[row.customer_type].orders += row.orders;
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
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      let where = ["s.voided = 0"];
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
      if (outlet_id) {
        where.push("s.outlet_id = ?");
        params.push(outlet_id);
      }

      const sql = `
        SELECT 
            COALESCE(e.name, 'Unknown Staff') as employee_name,
            e.id as employee_id,
            COUNT(s.id) as total_transactions,
            SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) as profiled_transactions,
            SUM(CASE WHEN s.customer_id IS NULL THEN 1 ELSE 0 END) as walk_in_transactions,
            ROUND(CAST(SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(s.id) * 100, 1) as capture_rate_pct,
            SUM(s.total_amount) as total_revenue,
            SUM(CASE WHEN s.customer_id IS NOT NULL THEN s.total_amount ELSE 0 END) as profiled_revenue
        FROM sales s
        LEFT JOIN employees e ON s.employee_id = e.id
        WHERE ${where.join(" AND ")}
        GROUP BY e.id
        ORDER BY capture_rate_pct DESC
      `;

      const rows = await getQuery(sql, params);

      const totals = rows.reduce(
        (acc, row) => {
          acc.total_transactions += row.total_transactions;
          acc.profiled_transactions += row.profiled_transactions;
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
      const { where, params } = await buildReportFilterParts(req, {
        sale: "s",
        product: "p",
        item: "si",
      });
      const sql = `
      SELECT
        s.id AS sale_id,
        s.timestamp,
        COALESCE(o.name, '—') AS outlet_name,
        COALESCE(e.name, '—') AS employee_name,
        ROUND(COALESCE(s.total_amount, 0), 2) AS total_amount,
        ROUND(COALESCE(s.discount_amount, 0), 2) AS discount_amount,
        ROUND(0, 2) AS promo_discount,
        ROUND(COALESCE(s.discount_amount, 0), 2) AS total_discount
      FROM sales s
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN employees e ON s.employee_id = e.id
      JOIN sale_items si ON s.id = si.sale_id
      JOIN products p ON si.product_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY s.id
      HAVING total_discount > 0
      ORDER BY total_discount DESC, s.timestamp DESC
      LIMIT 200
    `;
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
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
      });
    },
  );

  // Exceptions
  app.get(
    "/api/reports/exceptions",
    requireFeature("reports_exceptions"),
    (req, res) => {
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
        JOIN sales s ON s.id = si.sale_id AND s.voided = 0
        JOIN products p ON p.id = si.product_id
        LEFT JOIN outlets o ON o.id = s.outlet_id
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE si.price_at_sale < si.cost_price_at_sale
        ORDER BY s.timestamp DESC
        LIMIT 300
      `;
        return db.all(sql, [], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, rows });
        });
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
        WHERE s.voided = 0
        GROUP BY s.id
        HAVING discount_pct >= ?
        ORDER BY discount_pct DESC, s.timestamp DESC
        LIMIT 300
      `;
        return db.all(sql, [thresholdPct], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, threshold_pct: thresholdPct, rows });
        });
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
        WHERE s.voided = 1
        GROUP BY e.id
        HAVING void_count > 0
        ORDER BY void_count DESC, void_value DESC
        LIMIT 200
      `;
        return db.all(sql, [], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, rows });
        });
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
        GROUP BY p.id
        HAVING return_lines > 0
        ORDER BY returned_value DESC, returned_qty DESC
        LIMIT 300
      `;
        return db.all(sql, [], (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          return res.json({ type, rows });
        });
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
    },
  );

  // Outlet comparison
  app.get("/api/reports/outlet-comparison", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    const { date_from, date_to } = req.query;
    const conditions = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      conditions.push("s.timestamp >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      conditions.push("s.timestamp < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    const saleWhere = conditions.join(" AND ");
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
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ comparison: rows }); // Frontend `ReportsOperations.jsx` expects `comparison` here.
    });
  });

  // Supplier Wise
  app.get("/api/reports/supplier-wise", (req, res) => {
    const sql = `
    SELECT s.id, s.name AS supplier_name, s.contact_person, s.phone,
           COUNT(DISTINCT po.id) AS total_pos,
           COALESCE(SUM(poi.quantity),0) AS total_items,
           COALESCE(SUM(poi.quantity * poi.cost_price),0) AS total_cost
    FROM suppliers s
    LEFT JOIN purchase_orders po ON s.id = po.supplier_id
    LEFT JOIN purchase_order_items poi ON po.id = poi.po_id
    GROUP BY s.id
    ORDER BY total_cost DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows }); // ReportsPurchasing.jsx expects items
    });
  });
};
