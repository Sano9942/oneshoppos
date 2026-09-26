const { toUtcStart, toUtcEnd, isValidTz } = require("../../utils/tz");
const { getDescendantLeafIds } = require("../../category-tree");
const { returnsProfit } = require("../../services/returns-profit");

module.exports = function (app, deps, helpers) {
  const { db, requireFeature, requirePerm } = deps;
  // D4 split (PLAN-V2 Step 4, REPORT-PERMS.md §3.8) — explicit per-domain
  // guard on every route; the /api/reports blanket rule in
  // middleware/permissions.js is only a backstop.
  const salesView = requirePerm("view_sales_reports");
  const financeView = requirePerm("view_financial_reports"); // margin rule: profit layer
  const {
    pgWhere,
    buildCategoryMetaMap,
    withCategoryPaths,
    buildReportFilterParts,
    parsePaging,
  } = helpers;

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

  function applySaleTimeFilters(where, params, query, saleAlias = "s", tz = "UTC") {
    const { date_from, date_to, time_from, time_to, outlet_id } = query;
    if (date_from) {
      where.push(`${saleAlias}.timestamp >= ?`);
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push(`${saleAlias}.timestamp < ?`);
      params.push(toUtcEnd(date_to, tz));
    }
    if (time_from) {
      where.push(`${saleAlias}.timestamp::time >= ?::time`);
      params.push(time_from);
    }
    if (time_to) {
      where.push(`${saleAlias}.timestamp::time <= ?::time`);
      params.push(time_to);
    }
    if (outlet_id) {
      const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
      if (ids.length === 1) {
        where.push(`${saleAlias}.outlet_id = ?`);
        params.push(ids[0]);
      } else if (ids.length > 1) {
        where.push(`${saleAlias}.outlet_id IN (${ids.map(() => "?").join(",")})`);
        params.push(...ids);
      }
    }
  }

  async function applyProductDimensionFilters(
    where,
    params,
    query,
    aliases = {},
  ) {
    const { productAlias = "p", categoryColumn = `${productAlias}.category_id` } =
      aliases;
    const { category_id, brand_id, supplier_id, search } = query;

    if (category_id) {
      const leafIds = await helpers.getDescendantLeafIds(category_id);
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push(`${categoryColumn} = ?`);
        params.push(Number(leafIds[0]));
      } else {
        where.push(`${categoryColumn} IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    if (brand_id) {
      where.push(`${productAlias}.brand_id = ?`);
      params.push(brand_id);
    }
    if (supplier_id) {
      where.push(`${productAlias}.supplier_id = ?`);
      params.push(supplier_id);
    }
    if (search) {
      where.push(
        `(${productAlias}.name ILIKE ? OR COALESCE(${productAlias}.barcode, '') ILIKE ? OR ${productAlias}.id::text ILIKE ?)`,
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  function parseComparisonRanges(query) {
    const parseLocalDate = (value) => {
      if (!value) return null;
      const [year, month, day] = String(value).split("-").map(Number);
      return new Date(year, month - 1, day);
    };
    const formatLocalDate = (value) => {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const end = parseLocalDate(query.date_to) || new Date();
    const start =
      parseLocalDate(query.date_from) ||
      new Date(end.getFullYear(), end.getMonth(), end.getDate() - 29);
    const dayMs = 24 * 60 * 60 * 1000;
    const spanDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / dayMs) + 1,
    );
    const previousEnd = new Date(start.getTime() - dayMs);
    const previousStart = new Date(previousEnd.getTime() - (spanDays - 1) * dayMs);
    return {
      current: {
        from: formatLocalDate(start),
        to: formatLocalDate(end),
      },
      previous: {
        from: formatLocalDate(previousStart),
        to: formatLocalDate(previousEnd),
      },
    };
  }

  // Top Salespeople: revenue per employee
  app.get("/api/reports/top-salespeople", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { date_from, date_to } = req.query;
      const where = ["s.voided = false", "s.employee_id IS NOT NULL"];
      const params = [];
      if (date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(date_from, tz));
      }
      if (date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(date_to, tz));
      }
      const { text, values } = pgWhere(where, params);
      const sql = `
      SELECT e.name, SUM(s.total_amount) AS revenue, COUNT(s.id) AS order_count
      FROM sales s
      JOIN employees e ON s.employee_id = e.id
      WHERE ${text}
      GROUP BY e.id, e.name
      ORDER BY revenue DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ salespeople: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sales Summary: high-level totals by date/outlet
  app.get("/api/reports/sales-summary", salesView, async (req, res) => {
    try {
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      const { text, values } = pgWhere(where, params);
      // P22 fix: bucket by tenant-local date, not Postgres session TZ.
      // Emit as text (YYYY-MM-DD) to avoid pg-driver Date-object reinterpretation in JS.
      // tz is inline-literal'd because isValidTz already validated it (safe vs SQL injection)
      // and Postgres requires identical expression text to match GROUP BY across SELECT.
      const sql = `
      SELECT to_char((s.timestamp AT TIME ZONE '${tz}')::date, 'YYYY-MM-DD') AS date,
             s.id, s.timestamp, s.total_amount AS revenue,
             COALESCE(s.tax_total, 0) AS tax_total,
             COALESCE(o.name,'\u2014') AS outlet_name,
             string_agg(DISTINCT COALESCE(sp.payment_method, s.payment_method), ',') AS payment_methods,
             json_agg(json_build_object('method', sp.payment_method, 'amount', sp.amount))
               FILTER (WHERE sp.sale_id IS NOT NULL) AS payment_lines,
             s.payment_method AS header_method
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN employees e ON s.employee_id = e.id
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN sale_payments sp ON s.id = sp.sale_id
      WHERE ${text}
      GROUP BY s.id, o.name, s.timestamp, s.total_amount, s.tax_total, s.payment_method
      ORDER BY s.timestamp DESC`;
      const { rows } = await db.query(sql, values);

      // Aggregate for SalesSummaryTab
      const daily_sales = [];
      const payment_map = {};
      let total_revenue = 0;
      let total_tax = 0;

      rows.forEach((r) => {
        // r.date is already 'YYYY-MM-DD' text (post-P22 fix — emitted via to_char).
        const dateStr = String(r.date);
        // Daily trend
        const existingDay = daily_sales.find((d) => d.date === dateStr);
        if (existingDay) {
          existingDay.total += Number(r.revenue);
          existingDay.orders += 1;
        } else {
          daily_sales.push({ date: dateStr, total: Number(r.revenue), orders: 1 });
        }

        // Payment methods: split each bill by what was actually paid in each
        // method (was an equal split, so Rs 2,900 cash + 5,000 card showed as
        // 3,950 each). Scaled to the bill total so the methods always add up to
        // total_revenue, including older bills that stored cash change.
        const lines = (r.payment_lines || []).filter((l) => l && l.method);
        const paid = lines.reduce((a, l) => a + Number(l.amount || 0), 0);
        if (paid > 0) {
          for (const l of lines) {
            payment_map[l.method] =
              (payment_map[l.method] || 0) + (Number(r.revenue) * Number(l.amount || 0)) / paid;
          }
        } else {
          const method = String(r.header_method || (r.payment_methods || "").split(",")[0] || "").trim();
          if (method) payment_map[method] = (payment_map[method] || 0) + Number(r.revenue);
        }

        total_revenue += Number(r.revenue);
        total_tax += Number(r.tax_total || 0);
      });

      const payment_methods = Object.keys(payment_map)
        .map((method) => ({
          method,
          total: Math.round(payment_map[method] * 100) / 100,
        }))
        .sort((a, b) => b.total - a.total);

      // P8 (v83) \u2014 per-rate tax breakdown sub-table.
      let tax_by_rate = [];
      try {
        const ratesParams = [];
        const ratesWhere = ["s.voided = false", "si.tax_rate_at_sale > 0"];
        applySaleTimeFilters(ratesWhere, ratesParams, req.query, "s", tz);
        const { text: ratesText, values: ratesValues } = pgWhere(ratesWhere, ratesParams);
        const { rows: rateRows } = await db.query(
          `SELECT si.tax_rate_at_sale AS rate,
                  ROUND(SUM(si.tax_amount_at_sale)::numeric, 2) AS amount
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
            WHERE ${ratesText}
            GROUP BY si.tax_rate_at_sale
            ORDER BY si.tax_rate_at_sale DESC`,
          ratesValues
        );
        tax_by_rate = rateRows.map((r) => ({
          rate: Number(r.rate),
          amount: Number(r.amount),
        }));
      } catch { /* sale_items.tax_rate_at_sale missing on pre-v83 deploys */ }

      res.json({
        daily_sales: daily_sales.reverse(),
        payment_methods,
        total_revenue,
        total_tax,
        tax_by_rate,
        sales: rows, // Keep raw rows for table if needed
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sales Detail: flat line-item list with parent sale info
  app.get("/api/reports/sales-detail", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { search } = req.query;
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      if (search) {
        where.push("(p.name ILIKE ? OR s.id::text ILIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
      }
      const { text, values } = pgWhere(where, params);
      const sql = `
      SELECT s.id AS sale_id, s.timestamp, COALESCE(c.name,'Walk-in') AS customer_name,
             p.name AS product_name, p.barcode,
             si.quantity, si.price_at_sale, si.cost_price_at_sale,
             (si.quantity * si.price_at_sale) AS line_gross,
             ROUND(
               (si.quantity * si.price_at_sale)
               * (1.0 - COALESCE(s.discount_amount, 0)
                  / NULLIF((SELECT SUM(si2.quantity * si2.price_at_sale) FROM sale_items si2 WHERE si2.sale_id = s.id), 0)),
               2
             ) AS line_total
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN customers c ON s.customer_id = c.id
      WHERE ${text}
      ORDER BY s.timestamp DESC, si.id ASC`;
      const { rows } = await db.query(sql, values);
      res.json({ sales: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Order Wise report
  app.get("/api/reports/order-wise", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { search = "" } = req.query;
      const conditions = ["1=1"];
      const params = [];

      if (search) {
        conditions.push("(s.id::text ILIKE ? OR c.name ILIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
      }
      applySaleTimeFilters(conditions, params, req.query, "s", tz);
      conditions.push("s.voided = false");

      const { text, values } = pgWhere(conditions, params);
      const sql = `
      SELECT s.id, s.timestamp, s.total_amount, s.payment_method,
            COALESCE(s.discount_amount, 0) as discount_amount,
            COALESCE(c.name, 'Walk-in Customer') as customer_name,
            o.name as outlet_name,
            COALESCE(SUM(si.price_at_sale * si.quantity), 0) as sale_excl_tax
       FROM sales s
       LEFT JOIN customers c ON s.customer_id = c.id
       LEFT JOIN outlets o ON s.outlet_id = o.id
       LEFT JOIN sale_items si ON s.id = si.sale_id
       WHERE ${text}
       GROUP BY s.id, s.timestamp, s.total_amount, s.payment_method,
                s.discount_amount, c.name, o.name
       ORDER BY s.timestamp DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ orders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Monthly MOP Matrix: month-wise sales by payment method
  app.get("/api/reports/monthly-mop-matrix", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      const { text: whereSql, values } = pgWhere(where, params);

      const matrixSql = `
        SELECT
          TO_CHAR(s.timestamp, 'YYYY-MM') AS month_bucket,
          COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
          ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total_amount,
          COUNT(DISTINCT s.id) AS order_count
        FROM sales s
        LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE ${whereSql}
        GROUP BY TO_CHAR(s.timestamp, 'YYYY-MM'), COALESCE(sp.payment_method, s.payment_method, 'Unknown')
        ORDER BY TO_CHAR(s.timestamp, 'YYYY-MM') DESC, total_amount DESC
      `;

      const totalsSql = `
        SELECT
          TO_CHAR(s.timestamp, 'YYYY-MM') AS month_bucket,
          ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS total_amount,
          COUNT(DISTINCT s.id) AS total_orders
        FROM sales s
        WHERE ${whereSql}
        GROUP BY TO_CHAR(s.timestamp, 'YYYY-MM')
      `;

      const [matrixResult, totalsResult] = await Promise.all([
        db.query(matrixSql, values),
        db.query(totalsSql, values),
      ]);
      const rows = matrixResult.rows;
      const monthTotalsRows = totalsResult.rows;

      const methods = Array.from(
        new Set((rows || []).map((r) => r.payment_method)),
      ).sort();
      const totalsByMonth = new Map(
        (monthTotalsRows || []).map((row) => [row.month_bucket, row]),
      );
      const monthMap = new Map();

      (rows || []).forEach((row) => {
        if (!monthMap.has(row.month_bucket)) {
          monthMap.set(row.month_bucket, {
            month_bucket: row.month_bucket,
            payment_breakdown: {},
          });
        }
        const month = monthMap.get(row.month_bucket);
        month.payment_breakdown[row.payment_method] = Number(row.total_amount || 0);
      });

      const matrix = Array.from(monthMap.values())
        .map((month) => {
          const totals = totalsByMonth.get(month.month_bucket) || {};
          return {
            month_bucket: month.month_bucket,
            total_amount: Number(Number(totals.total_amount || 0).toFixed(2)),
            total_orders: Number(totals.total_orders || 0),
            ...methods.reduce((acc, method) => {
              acc[method] = Number(
                Number(month.payment_breakdown[method] || 0).toFixed(2),
              );
              return acc;
            }, {}),
          };
        })
        .sort((a, b) =>
          String(b.month_bucket).localeCompare(String(a.month_bucket)),
        );

      res.json({
        methods,
        rows: rows || [],
        matrix,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Category Wise: sales grouped by product category
  app.get("/api/reports/category-wise", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      await applyProductDimensionFilters(where, params, req.query);
      const { text, values } = pgWhere(where, params);
      const sql = `
      SELECT p.category_id,
             COALESCE(cat.name,'Uncategorized') AS category,
             SUM(si.quantity) AS units_sold,
             SUM(si.quantity * si.price_at_sale) AS revenue,
             SUM(si.quantity * si.cost_price_at_sale) AS cost,
             SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS profit
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      WHERE ${text}
      GROUP BY p.category_id, cat.name
      ORDER BY revenue DESC`;
      const { rows } = await db.query(sql, values);
      const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
      const categoryMeta = await buildCategoryMetaMap();
      const data = withCategoryPaths(rows, categoryMeta).map((r) => ({
        ...r,
        pct: total > 0 ? ((Number(r.revenue) / total) * 100).toFixed(1) : "0.0",
      }));
      res.json({ items: data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sub-Category Wise: sales grouped by leaf category with parent context
  app.get("/api/reports/subcategory-wise", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      await applyProductDimensionFilters(where, params, req.query);
      const { text, values } = pgWhere(where, params);
      const sql = `
      SELECT p.category_id,
             COALESCE(cat.name,'Uncategorized') AS subcategory,
             SUM(si.quantity) AS units_sold,
             SUM(si.quantity * si.price_at_sale) AS revenue,
             SUM(si.quantity * si.cost_price_at_sale) AS cost,
             SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS profit
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      WHERE ${text}
      GROUP BY p.category_id, cat.name
      ORDER BY revenue DESC`;
      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      const withPaths = withCategoryPaths(rows, categoryMeta).map((row) => {
        const meta =
          row.category_id != null ? categoryMeta.get(Number(row.category_id)) : null;
        const parent =
          meta?.parent_id != null ? categoryMeta.get(Number(meta.parent_id)) : null;
        return {
          ...row,
          category: parent?.path_label || "Top-Level",
          subcategory: meta?.name || row.subcategory || "Uncategorized",
        };
      });
      const total = withPaths.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
      res.json({
        items: withPaths.map((row) => ({
          ...row,
          pct:
            total > 0
              ? Number(((Number(row.revenue || 0) / total) * 100).toFixed(1))
              : 0,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/reports/item-wise:
   *   get:
   *     summary: Item-wise sales report
   *     description: Sales grouped by product within a date range. Shows quantity sold, revenue, cost, and profit per product.
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: from
   *         required: true
   *         schema: { type: string, format: date }
   *         description: Start date (YYYY-MM-DD)
   *       - in: query
   *         name: to
   *         required: true
   *         schema: { type: string, format: date }
   *         description: End date (YYYY-MM-DD)
   *       - in: query
   *         name: outlet_id
   *         schema: { type: integer }
   *       - in: query
   *         name: category_id
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Item-wise sales data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 rows:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       product_name: { type: string }
   *                       sku: { type: string }
   *                       qty_sold: { type: integer }
   *                       revenue: { type: number }
   *                       cost: { type: number }
   *                       profit: { type: number }
   *       401:
   *         description: Unauthorized
   */
  // Item Wise: sales grouped by product
  app.get("/api/reports/item-wise", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      await applyProductDimensionFilters(where, params, req.query);
      const { text, values } = pgWhere(where, params);
      const sql = `
      SELECT p.id, p.name AS product_name, p.barcode,
             COALESCE(cat.name,'Uncategorized') AS category,
             COALESCE(b.name,'Unbranded') AS brand,
             COALESCE(sup.name,'Unassigned') AS supplier,
             SUM(si.quantity) AS units_sold,
             SUM(si.quantity * si.price_at_sale) AS revenue,
             SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
             SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers sup ON p.supplier_id = sup.id
      WHERE ${text}
      GROUP BY p.id, p.name, p.barcode, cat.name, b.name, sup.name
      ORDER BY units_sold DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Brand Wise: sales grouped by brand
  app.get("/api/reports/brand-wise", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      await applyProductDimensionFilters(where, params, req.query);
      const { text, values } = pgWhere(where, params);
      const sql = `
      SELECT
        COALESCE(p.brand_id, 0) AS brand_id,
        COALESCE(b.name, 'Unbranded') AS brand,
        COUNT(DISTINCT s.id) AS order_count,
        SUM(si.quantity) AS units_sold,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
        ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS total_cost,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE ${text}
      GROUP BY COALESCE(p.brand_id, 0), COALESCE(b.name, 'Unbranded')
      ORDER BY revenue DESC, units_sold DESC`;
      const { rows } = await db.query(sql, values);
      const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
      res.json({
        items: rows.map((row) => ({
          ...row,
          contribution_pct:
            totalRevenue > 0
              ? Number(((Number(row.revenue || 0) / totalRevenue) * 100).toFixed(1))
              : 0,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Customer Wise report (summary)
  app.get("/api/reports/customer-wise", salesView, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT c.name as customer, COUNT(s.id) as order_count,
              COALESCE(SUM(s.total_amount), 0) as total_amount
         FROM customers c
         LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = false
         GROUP BY c.id, c.name
         ORDER BY total_amount DESC`,
      );
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Product Performance: same as item-wise but sorted by margin %
  app.get("/api/reports/product-performance", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      await applyProductDimensionFilters(where, params, req.query);
      const { text, values } = pgWhere(where, params);
      const sql = `
      SELECT p.id, p.name AS product_name, p.barcode,
             p.category_id,
             p.brand_id,
             p.supplier_id,
             COALESCE(cat.name,'Uncategorized') AS category,
             COALESCE(b.name,'Unbranded') AS brand,
             COALESCE(sup.name,'Unassigned') AS supplier,
             SUM(si.quantity) AS units_sold,
             SUM(si.quantity * si.price_at_sale) AS revenue,
             SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
             SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit,
             CASE WHEN SUM(si.quantity * si.price_at_sale) > 0
                  THEN ROUND(((SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale))
                       / SUM(si.quantity * si.price_at_sale)) * 100, 1)
                  ELSE 0 END AS margin_pct
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers sup ON p.supplier_id = sup.id
      WHERE ${text}
      GROUP BY p.id, p.name, p.barcode, p.category_id, p.brand_id, p.supplier_id,
               cat.name, b.name, sup.name
      ORDER BY margin_pct DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unified merchandising workspace: one payload for item/category/brand/supplier performance
  app.get("/api/reports/performance-workspace", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false"];
      const params = [];
      applySaleTimeFilters(where, params, req.query, "s", tz);
      await applyProductDimensionFilters(where, params, req.query);
      const { text: whereSql, values } = pgWhere(where, params);

      const queries = {
        items: `
          SELECT
            p.id,
            p.name AS product_name,
            p.barcode,
            COALESCE(cat.name,'Uncategorized') AS category,
            COALESCE(b.name,'Unbranded') AS brand,
            COALESCE(sup.name,'Unassigned') AS supplier,
            ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
            ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS total_cost,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit,
            ROUND(
              CASE WHEN COALESCE(SUM(si.quantity * si.price_at_sale), 0) > 0
                THEN ((SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale)) * 100.0)
                     / SUM(si.quantity * si.price_at_sale)
                ELSE 0
              END,
              1
            ) AS margin_pct
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN categories cat ON p.category_id = cat.id
          LEFT JOIN brands b ON p.brand_id = b.id
          LEFT JOIN suppliers sup ON p.supplier_id = sup.id
          WHERE ${whereSql}
          GROUP BY p.id, p.name, p.barcode, cat.name, b.name, sup.name
          ORDER BY revenue DESC
          LIMIT 12
        `,
        categories: `
          SELECT
            COALESCE(cat.id, 0) AS category_id,
            COALESCE(cat.name,'Uncategorized') AS category,
            ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN categories cat ON p.category_id = cat.id
          WHERE ${whereSql}
          GROUP BY COALESCE(cat.id, 0), COALESCE(cat.name,'Uncategorized')
          ORDER BY revenue DESC
          LIMIT 10
        `,
        brands: `
          SELECT
            COALESCE(b.id, 0) AS brand_id,
            COALESCE(b.name,'Unbranded') AS brand,
            ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN brands b ON p.brand_id = b.id
          WHERE ${whereSql}
          GROUP BY COALESCE(b.id, 0), COALESCE(b.name,'Unbranded')
          ORDER BY revenue DESC
          LIMIT 10
        `,
        suppliers: `
          SELECT
            COALESCE(sup.id, 0) AS supplier_id,
            COALESCE(sup.name,'Unassigned') AS supplier,
            ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN suppliers sup ON p.supplier_id = sup.id
          WHERE ${whereSql}
          GROUP BY COALESCE(sup.id, 0), COALESCE(sup.name,'Unassigned')
          ORDER BY revenue DESC
          LIMIT 10
        `,
        summary: `
          SELECT
            COUNT(DISTINCT s.id) AS order_count,
            COUNT(DISTINCT p.id) AS sku_count,
            COUNT(DISTINCT p.category_id) AS category_count,
            COUNT(DISTINCT p.brand_id) AS brand_count,
            COUNT(DISTINCT p.supplier_id) AS supplier_count,
            ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          WHERE ${whereSql}
        `,
      };

      const [itemsRes, categoriesRes, brandsRes, suppliersRes, summaryRes] = await Promise.all([
        db.query(queries.items, values),
        db.query(queries.categories, values),
        db.query(queries.brands, values),
        db.query(queries.suppliers, values),
        db.query(queries.summary, values),
      ]);
      res.json({
        summary: summaryRes.rows[0] || {},
        items: itemsRes.rows,
        categories: categoriesRes.rows,
        brands: brandsRes.rows,
        suppliers: suppliersRes.rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/performance-comparison", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const ranges = parseComparisonRanges(req.query);
      const dimensions = {
        items: {
          idExpr: "p.id",
          labelExpr: "p.name",
        },
        categories: {
          idExpr: "COALESCE(cat.id, 0)",
          labelExpr: "COALESCE(cat.name, 'Uncategorized')",
        },
        brands: {
          idExpr: "COALESCE(b.id, 0)",
          labelExpr: "COALESCE(b.name, 'Unbranded')",
        },
        suppliers: {
          idExpr: "COALESCE(sup.id, 0)",
          labelExpr: "COALESCE(sup.name, 'Unassigned')",
        },
      };

      const buildSharedFilters = async () => {
        const where = ["s.voided = false"];
        const params = [];
        if (req.query.time_from) {
          where.push("s.timestamp::time >= ?::time");
          params.push(req.query.time_from);
        }
        if (req.query.time_to) {
          where.push("s.timestamp::time <= ?::time");
          params.push(req.query.time_to);
        }
        applyOutletFilter(where, params, req.query.outlet_id);
        await applyProductDimensionFilters(where, params, req.query);
        return { where, params };
      };

      const { where, params } = await buildSharedFilters();
      const { text: sharedWhere, values: sharedValues } = pgWhere(where, params);

      // For comparison SQL, we prepend 2 params (current_from, current_to) before
      // the shared params, then append 4 more (current_from, current_to, previous_from, previous_to)
      const comparisonSql = (dimension) => {
        // Inner subquery: the CASE uses $1, $2 for current range detection
        // sharedWhere uses $3...$N for shared filters
        // Then the date range OR uses the next 4 params
        const sharedOffset = 2; // $1, $2 are current_from, current_to for CASE
        let idx = sharedOffset + 1;
        const innerSharedWhere = where
          .join(" AND ")
          .replace(/\?/g, () => `$${idx++}`);
        const rangeStart = idx;
        // 4 more params: current_from, current_to, previous_from, previous_to
        return `
        SELECT
          entity_id,
          entity_label,
          ROUND(COALESCE(SUM(CASE WHEN period_label = 'current' THEN units_sold ELSE 0 END), 0), 2) AS current_units,
          ROUND(COALESCE(SUM(CASE WHEN period_label = 'current' THEN revenue ELSE 0 END), 0), 2) AS current_revenue,
          ROUND(COALESCE(SUM(CASE WHEN period_label = 'previous' THEN units_sold ELSE 0 END), 0), 2) AS previous_units,
          ROUND(COALESCE(SUM(CASE WHEN period_label = 'previous' THEN revenue ELSE 0 END), 0), 2) AS previous_revenue
        FROM (
          SELECT
            ${dimension.idExpr} AS entity_id,
            ${dimension.labelExpr} AS entity_label,
            CASE
              WHEN s.timestamp >= $1 AND s.timestamp < $2 THEN 'current'
              ELSE 'previous'
            END AS period_label,
            SUM(si.quantity) AS units_sold,
            SUM(si.quantity * si.price_at_sale) AS revenue
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN categories cat ON p.category_id = cat.id
          LEFT JOIN brands b ON p.brand_id = b.id
          LEFT JOIN suppliers sup ON p.supplier_id = sup.id
          WHERE (${innerSharedWhere})
            AND (
              (s.timestamp >= $${rangeStart} AND s.timestamp < $${rangeStart + 1})
              OR
              (s.timestamp >= $${rangeStart + 2} AND s.timestamp < $${rangeStart + 3})
            )
          GROUP BY entity_id, entity_label, period_label
        ) sub
        GROUP BY entity_id, entity_label
        ORDER BY current_revenue DESC, current_units DESC
        LIMIT 5
      `;
      };

      const monthlySql = (dimension) => {
        // sharedWhere uses $1...$N, then 2 more for date range
        let idx = 1;
        const innerSharedWhere = where
          .join(" AND ")
          .replace(/\?/g, () => `$${idx++}`);
        const rangeStart = idx;
        return `
        WITH monthly_ranked AS (
          SELECT
            TO_CHAR(s.timestamp, 'YYYY-MM') AS month_bucket,
            ${dimension.idExpr} AS entity_id,
            ${dimension.labelExpr} AS entity_label,
            ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
            ROW_NUMBER() OVER (
              PARTITION BY TO_CHAR(s.timestamp, 'YYYY-MM')
              ORDER BY SUM(si.quantity * si.price_at_sale) DESC, SUM(si.quantity) DESC
            ) AS bucket_rank
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          JOIN sales s ON si.sale_id = s.id
          LEFT JOIN categories cat ON p.category_id = cat.id
          LEFT JOIN brands b ON p.brand_id = b.id
          LEFT JOIN suppliers sup ON p.supplier_id = sup.id
          WHERE (${innerSharedWhere})
            AND s.timestamp >= $${rangeStart}
            AND s.timestamp < $${rangeStart + 1}
          GROUP BY TO_CHAR(s.timestamp, 'YYYY-MM'), entity_id, entity_label
        )
        SELECT month_bucket, entity_id, entity_label, units_sold, revenue
        FROM monthly_ranked
        WHERE bucket_rank = 1
        ORDER BY month_bucket DESC
        LIMIT 6
      `;
      };

      const comparisonParams = (sharedVals) => [
        toUtcStart(ranges.current.from, tz),
        toUtcEnd(ranges.current.to, tz),
        ...sharedVals,
        toUtcStart(ranges.current.from, tz),
        toUtcEnd(ranges.current.to, tz),
        toUtcStart(ranges.previous.from, tz),
        toUtcEnd(ranges.previous.to, tz),
      ];

      const monthlyParams = (sharedVals) => [
        ...sharedVals,
        toUtcStart(ranges.current.from, tz),
        toUtcEnd(ranges.current.to, tz),
      ];

      const [
        itemComparisonRes,
        categoryComparisonRawRes,
        brandComparisonRes,
        supplierComparisonRes,
        itemMonthlyRes,
        categoryMonthlyRawRes,
        brandMonthlyRes,
        supplierMonthlyRes,
      ] =
        await Promise.all([
          db.query(comparisonSql(dimensions.items), comparisonParams(sharedValues)),
          db.query(comparisonSql(dimensions.categories), comparisonParams(sharedValues)),
          db.query(comparisonSql(dimensions.brands), comparisonParams(sharedValues)),
          db.query(comparisonSql(dimensions.suppliers), comparisonParams(sharedValues)),
          db.query(monthlySql(dimensions.items), monthlyParams(sharedValues)),
          db.query(monthlySql(dimensions.categories), monthlyParams(sharedValues)),
          db.query(monthlySql(dimensions.brands), monthlyParams(sharedValues)),
          db.query(monthlySql(dimensions.suppliers), monthlyParams(sharedValues)),
        ]);

      const itemComparison = itemComparisonRes.rows;
      const categoryComparisonRaw = categoryComparisonRawRes.rows;
      const brandComparison = brandComparisonRes.rows;
      const supplierComparison = supplierComparisonRes.rows;
      const itemMonthly = itemMonthlyRes.rows;
      const categoryMonthlyRaw = categoryMonthlyRawRes.rows;
      const brandMonthly = brandMonthlyRes.rows;
      const supplierMonthly = supplierMonthlyRes.rows;

      const categoryMeta = await buildCategoryMetaMap();

      const decorateComparison = (rows) =>
        rows.map((row) => {
          const currentRevenue = Number(row.current_revenue || 0);
          const previousRevenue = Number(row.previous_revenue || 0);
          const delta = currentRevenue - previousRevenue;
          return {
            ...row,
            revenue_delta: Number(delta.toFixed(2)),
            revenue_delta_pct:
              previousRevenue > 0
                ? Number(((delta / previousRevenue) * 100).toFixed(1))
                : currentRevenue > 0
                  ? 100
                  : 0,
          };
        });

      const aggregateComparison = (rows, resolver) => {
        const bucket = new Map();
        rows.forEach((row) => {
          const resolved = resolver(row);
          const key = String(resolved.id);
          const current = bucket.get(key) || {
            entity_id: resolved.id,
            entity_label: resolved.label,
            current_units: 0,
            current_revenue: 0,
            previous_units: 0,
            previous_revenue: 0,
          };
          current.current_units += Number(row.current_units || 0);
          current.current_revenue += Number(row.current_revenue || 0);
          current.previous_units += Number(row.previous_units || 0);
          current.previous_revenue += Number(row.previous_revenue || 0);
          bucket.set(key, current);
        });
        return Array.from(bucket.values()).sort(
          (a, b) => b.current_revenue - a.current_revenue,
        );
      };

      const aggregateMonthly = (rows, resolver) => {
        const bucket = new Map();
        rows.forEach((row) => {
          const resolved = resolver(row);
          const key = `${row.month_bucket}:${resolved.id}`;
          const current = bucket.get(key) || {
            month_bucket: row.month_bucket,
            entity_id: resolved.id,
            entity_label: resolved.label,
            units_sold: 0,
            revenue: 0,
          };
          current.units_sold += Number(row.units_sold || 0);
          current.revenue += Number(row.revenue || 0);
          bucket.set(key, current);
        });
        return Array.from(bucket.values()).sort((a, b) => {
          if (a.month_bucket === b.month_bucket) return b.revenue - a.revenue;
          return a.month_bucket < b.month_bucket ? 1 : -1;
        });
      };

      const resolveTopLevelCategory = (row) => {
        const category = categoryMeta.get(Number(row.entity_id));
        const topLevelId = category?.path_ids?.[0] ?? Number(row.entity_id);
        const topLevel = categoryMeta.get(Number(topLevelId));
        return {
          id: Number(topLevelId),
          label: topLevel?.name || row.entity_label,
        };
      };

      const resolveSubcategory = (row) => {
        const category = categoryMeta.get(Number(row.entity_id));
        return {
          id: Number(row.entity_id),
          label: category?.path_label || row.entity_label,
        };
      };

      const categoryComparison = decorateComparison(
        aggregateComparison(categoryComparisonRaw, resolveTopLevelCategory),
      );
      const subcategoryComparison = decorateComparison(
        aggregateComparison(categoryComparisonRaw, resolveSubcategory),
      );
      const categoryMonthly = aggregateMonthly(
        categoryMonthlyRaw,
        resolveTopLevelCategory,
      );
      const subcategoryMonthly = aggregateMonthly(
        categoryMonthlyRaw,
        resolveSubcategory,
      );

      res.json({
        ranges,
        item_comparison: decorateComparison(itemComparison),
        category_comparison: categoryComparison,
        subcategory_comparison: subcategoryComparison,
        brand_comparison: decorateComparison(brandComparison),
        supplier_comparison: decorateComparison(supplierComparison),
        item_monthly: itemMonthly,
        category_monthly: categoryMonthly,
        subcategory_monthly: subcategoryMonthly,
        brand_monthly: brandMonthly,
        supplier_monthly: supplierMonthly,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Refunds and Voids: operational exception summary plus detailed lists
  app.get("/api/reports/refunds-voids", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const saleWhere = ["s.voided = true"];
      const refundWhere = ["1=1"];
      const saleParams = [];
      const refundParams = [];
      const {
        date_from,
        date_to,
        time_from,
        time_to,
        outlet_id,
        employee_id,
      } = req.query;

      if (date_from) {
        saleWhere.push("s.timestamp >= ?");
        refundWhere.push("r.timestamp >= ?");
        saleParams.push(toUtcStart(date_from, tz));
        refundParams.push(toUtcStart(date_from, tz));
      }
      if (date_to) {
        saleWhere.push("s.timestamp < ?");
        refundWhere.push("r.timestamp < ?");
        saleParams.push(toUtcEnd(date_to, tz));
        refundParams.push(toUtcEnd(date_to, tz));
      }
      if (time_from) {
        saleWhere.push("s.timestamp::time >= ?::time");
        refundWhere.push("r.timestamp::time >= ?::time");
        saleParams.push(time_from);
        refundParams.push(time_from);
      }
      if (time_to) {
        saleWhere.push("s.timestamp::time <= ?::time");
        refundWhere.push("r.timestamp::time <= ?::time");
        saleParams.push(time_to);
        refundParams.push(time_to);
      }
      if (outlet_id) {
        const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
        if (ids.length === 1) {
          saleWhere.push("s.outlet_id = ?");
          refundWhere.push("r.outlet_id = ?");
          saleParams.push(ids[0]);
          refundParams.push(ids[0]);
        } else if (ids.length > 1) {
          const ph = ids.map(() => "?").join(",");
          saleWhere.push(`s.outlet_id IN (${ph})`);
          refundWhere.push(`r.outlet_id IN (${ph})`);
          saleParams.push(...ids);
          refundParams.push(...ids);
        }
      }
      if (employee_id) {
        saleWhere.push("s.employee_id = ?");
        refundWhere.push("r.employee_id = ?");
        saleParams.push(employee_id);
        refundParams.push(employee_id);
      }

      const { text: voidWhereText, values: voidValues } = pgWhere(saleWhere, saleParams);
      const { text: refundWhereText, values: refundValues } = pgWhere(refundWhere, refundParams);

      const voidSql = `
        SELECT
          s.id AS sale_id,
          s.timestamp,
          COALESCE(o.name, '-') AS outlet_name,
          COALESCE(e.name, '-') AS employee_name,
          COALESCE(c.name, 'Walk-in') AS customer_name,
          ROUND(COALESCE(s.total_amount, 0), 2) AS total_amount
        FROM sales s
        LEFT JOIN outlets o ON o.id = s.outlet_id
        LEFT JOIN employees e ON e.id = s.employee_id
        LEFT JOIN customers c ON c.id = s.customer_id
        WHERE ${voidWhereText}
        ORDER BY s.timestamp DESC
        LIMIT 300
      `;

      const refundSql = `
        SELECT
          r.id AS return_id,
          r.timestamp,
          COALESCE(o.name, '-') AS outlet_name,
          COALESCE(e.name, '-') AS employee_name,
          COALESCE(c.name, 'Walk-in') AS customer_name,
          COALESCE(r.refund_method, '-') AS refund_method,
          ROUND(COALESCE(r.total_refund, 0), 2) AS total_refund
        FROM returns r
        LEFT JOIN outlets o ON o.id = r.outlet_id
        LEFT JOIN employees e ON e.id = r.employee_id
        LEFT JOIN customers c ON c.id = r.customer_id
        WHERE ${refundWhereText}
        ORDER BY r.timestamp DESC
        LIMIT 300
      `;

      const [voidResult, refundResult] = await Promise.all([
        db.query(voidSql, voidValues),
        db.query(refundSql, refundValues),
      ]);
      const voidRows = voidResult.rows;
      const refundRows = refundResult.rows;

      const summary = {
        void_count: voidRows.length,
        void_value: Number(
          voidRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0).toFixed(2),
        ),
        refund_count: refundRows.length,
        refund_value: Number(
          refundRows.reduce((sum, row) => sum + Number(row.total_refund || 0), 0).toFixed(2),
        ),
      };
      res.json({
        summary: {
          ...summary,
          leakage_total: Number((summary.void_value + summary.refund_value).toFixed(2)),
        },
        voids: voidRows,
        refunds: refundRows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cashier Wise: sales, voids, refunds, and discounts by employee
  app.get("/api/reports/cashier-wise", salesView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const salesWhere = ["s.voided = false", "s.employee_id IS NOT NULL"];
      const voidWhere = ["s.voided = true", "s.employee_id IS NOT NULL"];
      const refundWhere = ["r.employee_id IS NOT NULL"];
      const salesParams = [];
      const voidParams = [];
      const refundParams = [];
      const {
        date_from,
        date_to,
        time_from,
        time_to,
        outlet_id,
        employee_id,
      } = req.query;

      if (date_from) {
        salesWhere.push("s.timestamp >= ?");
        voidWhere.push("s.timestamp >= ?");
        refundWhere.push("r.timestamp >= ?");
        salesParams.push(toUtcStart(date_from, tz));
        voidParams.push(toUtcStart(date_from, tz));
        refundParams.push(toUtcStart(date_from, tz));
      }
      if (date_to) {
        salesWhere.push("s.timestamp < ?");
        voidWhere.push("s.timestamp < ?");
        refundWhere.push("r.timestamp < ?");
        salesParams.push(toUtcEnd(date_to, tz));
        voidParams.push(toUtcEnd(date_to, tz));
        refundParams.push(toUtcEnd(date_to, tz));
      }
      if (time_from) {
        salesWhere.push("s.timestamp::time >= ?::time");
        voidWhere.push("s.timestamp::time >= ?::time");
        refundWhere.push("r.timestamp::time >= ?::time");
        salesParams.push(time_from);
        voidParams.push(time_from);
        refundParams.push(time_from);
      }
      if (time_to) {
        salesWhere.push("s.timestamp::time <= ?::time");
        voidWhere.push("s.timestamp::time <= ?::time");
        refundWhere.push("r.timestamp::time <= ?::time");
        salesParams.push(time_to);
        voidParams.push(time_to);
        refundParams.push(time_to);
      }
      if (outlet_id) {
        const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
        if (ids.length === 1) {
          salesWhere.push("s.outlet_id = ?");
          voidWhere.push("s.outlet_id = ?");
          refundWhere.push("r.outlet_id = ?");
          salesParams.push(ids[0]);
          voidParams.push(ids[0]);
          refundParams.push(ids[0]);
        } else if (ids.length > 1) {
          const ph = ids.map(() => "?").join(",");
          salesWhere.push(`s.outlet_id IN (${ph})`);
          voidWhere.push(`s.outlet_id IN (${ph})`);
          refundWhere.push(`r.outlet_id IN (${ph})`);
          salesParams.push(...ids);
          voidParams.push(...ids);
          refundParams.push(...ids);
        }
      }
      if (employee_id) {
        salesWhere.push("s.employee_id = ?");
        voidWhere.push("s.employee_id = ?");
        refundWhere.push("r.employee_id = ?");
        salesParams.push(employee_id);
        voidParams.push(employee_id);
        refundParams.push(employee_id);
      }

      // Convert each CTE's WHERE to $N params independently, then combine
      // We need to renumber across all three CTEs sequentially
      const { text: salesWhereText, values: salesValues, nextIdx: afterSales } = pgWhere(salesWhere, salesParams, 1);
      const { text: voidWhereText, values: voidValues, nextIdx: afterVoids } = pgWhere(voidWhere, voidParams, afterSales);
      const { text: refundWhereText } = pgWhere(refundWhere, refundParams, afterVoids);

      const allValues = [...salesValues, ...voidValues, ...refundParams];

      const sql = `
        WITH sales_agg AS (
          SELECT
            s.employee_id,
            COUNT(*) AS sale_count,
            ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS sales_value,
            ROUND(COALESCE(SUM(COALESCE(s.discount_amount, 0)), 0), 2) AS discount_value
          FROM sales s
          WHERE ${salesWhereText}
          GROUP BY s.employee_id
        ),
        void_agg AS (
          SELECT
            s.employee_id,
            COUNT(*) AS void_count,
            ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS void_value
          FROM sales s
          WHERE ${voidWhereText}
          GROUP BY s.employee_id
        ),
        refund_agg AS (
          SELECT
            r.employee_id,
            COUNT(*) AS refund_count,
            ROUND(COALESCE(SUM(r.total_refund), 0), 2) AS refund_value
          FROM returns r
          WHERE ${refundWhereText}
          GROUP BY r.employee_id
        ),
        cashiers AS (
          SELECT employee_id FROM sales_agg
          UNION
          SELECT employee_id FROM void_agg
          UNION
          SELECT employee_id FROM refund_agg
        )
        SELECT
          c.employee_id,
          COALESCE(e.name, 'Unknown') AS employee_name,
          COALESCE(sa.sale_count, 0) AS sale_count,
          COALESCE(sa.sales_value, 0) AS sales_value,
          COALESCE(sa.discount_value, 0) AS discount_value,
          COALESCE(va.void_count, 0) AS void_count,
          COALESCE(va.void_value, 0) AS void_value,
          COALESCE(ra.refund_count, 0) AS refund_count,
          COALESCE(ra.refund_value, 0) AS refund_value,
          ROUND(
            COALESCE(sa.sales_value, 0) - COALESCE(ra.refund_value, 0),
            2
          ) AS net_sales
        FROM cashiers c
        LEFT JOIN employees e ON e.id = c.employee_id
        LEFT JOIN sales_agg sa ON sa.employee_id = c.employee_id
        LEFT JOIN void_agg va ON va.employee_id = c.employee_id
        LEFT JOIN refund_agg ra ON ra.employee_id = c.employee_id
        ORDER BY sales_value DESC, sale_count DESC
      `;

      const { rows } = await db.query(sql, allValues);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Profit Summary
  app.get(
    "/api/reports/profit-summary",
    requireFeature("reports_profit_layer"),
    financeView,
    async (req, res) => {
      try {
        const { where, params } = await buildReportFilterParts(req);
        const { text, values } = pgWhere(where, params);
        // Lines are totalled per bill first: summing s.discount_amount across
        // the sale_items join counted each bill's discount once per line.
        const sql = `
        WITH per_sale AS (
          SELECT s.id,
                 COALESCE(s.discount_amount, 0) AS discount_amount,
                 SUM(si.quantity * si.price_at_sale) AS gross,
                 SUM(si.quantity * si.cost_price_at_sale) AS cogs
          FROM sales s
          JOIN sale_items si ON s.id = si.sale_id
          JOIN products p ON si.product_id = p.id
          ${text ? `WHERE ${text}` : ""}
          GROUP BY s.id, s.discount_amount
        )
        SELECT
          COUNT(*) AS orders,
          ROUND(COALESCE(SUM(gross), 0), 2) AS gross_sales,
          ROUND(COALESCE(SUM(cogs), 0), 2) AS cogs,
          ROUND(COALESCE(SUM(gross - cogs), 0), 2) AS gross_profit,
          ROUND(COALESCE(SUM(discount_amount), 0), 2) AS discount_amount,
          ROUND(0::numeric, 2) AS promo_discount,
          ROUND(COALESCE(SUM(gross - cogs - discount_amount), 0), 2) AS net_profit
        FROM per_sale
      `;
        const { rows } = await db.query(sql, values);
        const row = rows[0] || {};

        // D17: returns in the period give their profit back (refund minus the
        // cost of anything that went back on the shelf). Same filters as the
        // sales side, applied to the return.
        const { date_from, date_to, outlet_id, employee_id, category_id } = req.query;
        const tz = req.company?.timezone || "UTC";
        const ret = await returnsProfit(db, {
          from: date_from ? toUtcStart(date_from, tz) : "-infinity",
          to: date_to ? toUtcEnd(date_to, tz) : "infinity",
          outletIds: outlet_id ? String(outlet_id).split(",") : [],
          employeeId: employee_id || null,
          categoryIds: category_id ? await getDescendantLeafIds(db, Number(category_id)) : null,
        });

        const grossSales = Number(row.gross_sales || 0);
        const grossProfit = Number(row.gross_profit || 0);
        const discounts = Number(row.discount_amount || 0);
        const netSales = Number((grossSales - discounts - ret.refunds).toFixed(2));
        const netProfit = Number((Number(row.net_profit || 0) - ret.profit_back).toFixed(2));
        res.json({
          summary: {
            ...row,
            returns_count: ret.returns_count,
            returns_value: ret.refunds,
            returns_cost_back: ret.cost_back,
            returns_profit: ret.profit_back,
            net_sales: netSales,
            net_profit: netProfit,
            margin_pct:
              grossSales > 0
                ? Number(((grossProfit / grossSales) * 100).toFixed(2))
                : 0,
            net_margin_pct:
              netSales > 0
                ? Number(((netProfit / netSales) * 100).toFixed(2))
                : 0,
          },
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Profit by Product
  app.get(
    "/api/reports/profit-by-product",
    requireFeature("reports_profit_layer"),
    financeView,
    async (req, res) => {
      try {
        const sortable = new Set([
          "revenue",
          "gross_profit",
          "margin_pct",
          "units_sold",
          "product_name",
        ]);
        const sort = sortable.has(String(req.query.sort || ""))
          ? req.query.sort
          : "gross_profit";
        const order =
          String(req.query.order || "desc").toLowerCase() === "asc"
            ? "ASC"
            : "DESC";
        const { limit, offset } = parsePaging(req);
        const { where, params } = await buildReportFilterParts(req);
        const { text, values, nextIdx } = pgWhere(where, params);
        const sql = `
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.barcode,
          p.category_id,
          COALESCE(cat.name, 'Uncategorized') AS category,
          ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
          ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
          ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS cogs,
          ROUND(COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit,
          ROUND(
            CASE
              WHEN COALESCE(SUM(si.quantity * si.price_at_sale), 0) > 0
                THEN (COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0) * 100.0)
                   / COALESCE(SUM(si.quantity * si.price_at_sale), 1)
              ELSE 0
            END,
            2
          ) AS margin_pct
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        ${text ? `WHERE ${text}` : ""}
        GROUP BY p.id, p.name, p.barcode, p.category_id, cat.name
        ORDER BY ${sort} ${order}
        LIMIT $${nextIdx} OFFSET $${nextIdx + 1}
      `;
        const { rows } = await db.query(sql, [...values, limit, offset]);
        const categoryMeta = await buildCategoryMetaMap();
        res.json({
          items: withCategoryPaths(rows, categoryMeta),
          paging: { limit, offset },
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Profit by Outlet
  app.get(
    "/api/reports/profit-by-outlet",
    requireFeature("reports_profit_layer"),
    financeView,
    async (req, res) => {
      try {
        const { where, params } = await buildReportFilterParts(req, {
          sale: "s",
          product: "p",
          item: "si",
          outlet: "o",
          employee: "e",
        });
        const { text, values } = pgWhere(where, params);
        const sql = `
        SELECT
          o.id AS outlet_id,
          o.name AS outlet_name,
          COUNT(DISTINCT s.id) AS orders,
          ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
          ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS cogs,
          ROUND(COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit,
          ROUND(
            CASE
              WHEN COALESCE(SUM(si.quantity * si.price_at_sale), 0) > 0
                THEN (COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0) * 100.0)
                   / COALESCE(SUM(si.quantity * si.price_at_sale), 1)
              ELSE 0
            END,
            2
          ) AS margin_pct
        FROM sales s
        JOIN outlets o ON s.outlet_id = o.id
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        ${text ? `WHERE ${text}` : ""}
        GROUP BY o.id, o.name
        ORDER BY gross_profit DESC
      `;
        const { rows } = await db.query(sql, values);
        res.json({ items: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
