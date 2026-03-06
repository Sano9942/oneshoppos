const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requireFeature } = deps;
  const {
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
      where.push(`time(${saleAlias}.timestamp,'localtime') >= time(?)`);
      params.push(time_from);
    }
    if (time_to) {
      where.push(`time(${saleAlias}.timestamp,'localtime') <= time(?)`);
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
        `(${productAlias}.name LIKE ? OR COALESCE(${productAlias}.barcode, '') LIKE ? OR CAST(${productAlias}.id AS TEXT) LIKE ?)`,
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
  app.get("/api/reports/top-salespeople", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    const { date_from, date_to } = req.query;
    let where = ["s.voided = 0", "s.employee_id IS NOT NULL"];
    const params = [];
    if (date_from) {
      where.push("s.timestamp >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("s.timestamp < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    const sql = `
    SELECT e.name, SUM(s.total_amount) AS revenue, COUNT(s.id) AS order_count
    FROM sales s
    JOIN employees e ON s.employee_id = e.id
    WHERE ${where.join(" AND ")}
    GROUP BY e.id
    ORDER BY revenue DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ salespeople: rows });
    });
  });

  // Sales Summary: high-level totals by date/outlet
  app.get("/api/reports/sales-summary", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    const sql = `
    SELECT date(s.timestamp,'localtime') AS date,
           COUNT(s.id) AS orders,
           SUM(s.total_amount) AS revenue,
           COALESCE(o.name,'—') AS outlet_name,
           GROUP_CONCAT(DISTINCT COALESCE(sp.payment_method, s.payment_method)) AS payment_methods
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN employees e ON s.employee_id = e.id
    LEFT JOIN outlets o ON s.outlet_id = o.id
    LEFT JOIN sale_payments sp ON s.id = sp.sale_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id
    ORDER BY s.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      // Aggregate for SalesSummaryTab
      const daily_sales = [];
      const payment_map = {};
      let total_revenue = 0;
      let total_tax = 0;

      rows.forEach((r) => {
        // Daily trend
        const existingDay = daily_sales.find((d) => d.date === r.date);
        if (existingDay) {
          existingDay.total += r.revenue;
          existingDay.orders += 1;
        } else {
          daily_sales.push({ date: r.date, total: r.revenue, orders: 1 });
        }

        // Payment methods
        const methods = (r.payment_methods || "").split(",");
        methods.forEach((m) => {
          const method = m.trim();
          if (method) {
            payment_map[method] =
              (payment_map[method] || 0) + r.revenue / methods.length;
          }
        });

        total_revenue += r.revenue;
      });

      const payment_methods = Object.keys(payment_map)
        .map((method) => ({
          method,
          total: payment_map[method],
        }))
        .sort((a, b) => b.total - a.total);

      res.json({
        daily_sales: daily_sales.reverse(),
        payment_methods,
        total_revenue,
        total_tax, // Placeholder if tax calculation is needed per-row
        sales: rows, // Keep raw rows for table if needed
      });
    });
  });

  // Sales Detail: flat line-item list with parent sale info
  app.get("/api/reports/sales-detail", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    const { date_from, date_to, search } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    if (search) {
      where.push("(p.name LIKE ? OR CAST(s.id AS TEXT) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const sql = `
    SELECT s.id AS sale_id, s.timestamp, COALESCE(c.name,'Walk-in') AS customer_name,
           p.name AS product_name, p.barcode,
           si.quantity, si.price_at_sale, si.cost_price_at_sale,
           (si.quantity * si.price_at_sale) AS line_total
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE ${where.join(" AND ")}
    ORDER BY s.timestamp DESC, si.id ASC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sales: rows });
    });
  });

  // Order Wise report
  app.get("/api/reports/order-wise", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    const { search = "" } = req.query;
    let conditions = ["1=1"];
    const params = [];

    if (search) {
      conditions.push("(CAST(s.id AS TEXT) LIKE ? OR c.name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    applySaleTimeFilters(conditions, params, req.query, "s", tz);
    conditions.push("s.voided = 0");

    const where = conditions.join(" AND ");
    db.all(
      `SELECT s.id, s.timestamp, s.total_amount, s.payment_method,
            COALESCE(s.discount_amount, 0) as discount_amount,
            COALESCE(c.name, 'Walk-in Customer') as customer_name,
            o.name as outlet_name,
            COALESCE(SUM(si.price_at_sale * si.quantity), 0) as sale_excl_tax
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN sale_items si ON s.id = si.sale_id
     WHERE ${where}
     GROUP BY s.id
     ORDER BY s.timestamp DESC`,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ orders: rows });
      },
    );
  });

  // Monthly MOP Matrix: month-wise sales by payment method
  app.get("/api/reports/monthly-mop-matrix", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    const whereSql = where.join(" AND ");

    const matrixSql = `
      SELECT
        strftime('%Y-%m', s.timestamp, 'localtime') AS month_bucket,
        COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
        ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total_amount,
        COUNT(DISTINCT s.id) AS order_count
      FROM sales s
      LEFT JOIN sale_payments sp ON sp.sale_id = s.id
      WHERE ${whereSql}
      GROUP BY month_bucket, COALESCE(sp.payment_method, s.payment_method, 'Unknown')
      ORDER BY month_bucket DESC, total_amount DESC
    `;

    const totalsSql = `
      SELECT
        strftime('%Y-%m', s.timestamp, 'localtime') AS month_bucket,
        ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS total_amount,
        COUNT(DISTINCT s.id) AS total_orders
      FROM sales s
      WHERE ${whereSql}
      GROUP BY month_bucket
    `;

    db.all(matrixSql, params, (matrixErr, rows) => {
      if (matrixErr) return res.status(500).json({ error: matrixErr.message });
      db.all(totalsSql, params, (totalsErr, monthTotalsRows) => {
        if (totalsErr) return res.status(500).json({ error: totalsErr.message });

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
      });
    });
  });

  // Category Wise: sales grouped by product category
  app.get("/api/reports/category-wise", async (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    await applyProductDimensionFilters(where, params, req.query);
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
    WHERE ${where.join(" AND ")}
    GROUP BY p.category_id
    ORDER BY revenue DESC`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const total = rows.reduce((s, r) => s + r.revenue, 0);
      const categoryMeta = await buildCategoryMetaMap();
      const data = withCategoryPaths(rows, categoryMeta).map((r) => ({
        ...r,
        pct: total > 0 ? ((r.revenue / total) * 100).toFixed(1) : "0.0",
      }));
      res.json({ items: data });
    });
  });

  // Sub-Category Wise: sales grouped by leaf category with parent context
  app.get("/api/reports/subcategory-wise", async (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    await applyProductDimensionFilters(where, params, req.query);
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
    WHERE ${where.join(" AND ")}
    GROUP BY p.category_id
    ORDER BY revenue DESC`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
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
    });
  });

  // Item Wise: sales grouped by product
  app.get("/api/reports/item-wise", async (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    await applyProductDimensionFilters(where, params, req.query);
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
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY units_sold DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // Brand Wise: sales grouped by brand
  app.get("/api/reports/brand-wise", async (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    await applyProductDimensionFilters(where, params, req.query);
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
    WHERE ${where.join(" AND ")}
    GROUP BY COALESCE(p.brand_id, 0), COALESCE(b.name, 'Unbranded')
    ORDER BY revenue DESC, units_sold DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
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
    });
  });

  // Customer Wise report (summary)
  app.get("/api/reports/customer-wise", (req, res) => {
    db.all(
      `SELECT c.name as customer, COUNT(s.id) as order_count,
            COALESCE(SUM(s.total_amount), 0) as total_amount
     FROM customers c
     LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
     GROUP BY c.id
     ORDER BY total_amount DESC`,
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ items: rows });
      },
    );
  });

  // Product Performance: same as item-wise but sorted by margin %
  app.get("/api/reports/product-performance", async (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    await applyProductDimensionFilters(where, params, req.query);
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
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY margin_pct DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // Unified merchandising workspace: one payload for item/category/brand/supplier performance
  app.get("/api/reports/performance-workspace", async (req, res) => {
    const tz = req.company?.timezone || "UTC";
    let where = ["s.voided = 0"];
    const params = [];
    applySaleTimeFilters(where, params, req.query, "s", tz);
    await applyProductDimensionFilters(where, params, req.query);
    const whereSql = where.join(" AND ");

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
        GROUP BY p.id
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

    const runAll = (sql) =>
      new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });
    const runOne = (sql) =>
      new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
      });

    try {
      const [items, categories, brands, suppliers, summary] = await Promise.all([
        runAll(queries.items),
        runAll(queries.categories),
        runAll(queries.brands),
        runAll(queries.suppliers),
        runOne(queries.summary),
      ]);
      res.json({ summary, items, categories, brands, suppliers });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/performance-comparison", async (req, res) => {
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
      const where = ["s.voided = 0"];
      const params = [];
      if (req.query.time_from) {
        where.push("time(s.timestamp,'localtime') >= time(?)");
        params.push(req.query.time_from);
      }
      if (req.query.time_to) {
        where.push("time(s.timestamp,'localtime') <= time(?)");
        params.push(req.query.time_to);
      }
      applyOutletFilter(where, params, req.query.outlet_id);
      await applyProductDimensionFilters(where, params, req.query);
      return { where, params };
    };

    const { where, params } = await buildSharedFilters();
    const sharedWhere = where.join(" AND ");

    const runAll = (sql, sqlParams) =>
      new Promise((resolve, reject) => {
        db.all(sql, sqlParams, (err, rows) => (err ? reject(err) : resolve(rows)));
      });

    const comparisonSql = (dimension) => `
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
            WHEN s.timestamp >= ? AND s.timestamp < ? THEN 'current'
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
        WHERE (${sharedWhere})
          AND (
            (s.timestamp >= ? AND s.timestamp < ?)
            OR
            (s.timestamp >= ? AND s.timestamp < ?)
          )
        GROUP BY entity_id, entity_label, period_label
      )
      GROUP BY entity_id, entity_label
      ORDER BY current_revenue DESC, current_units DESC
      LIMIT 5
    `;

    const monthlySql = (dimension) => `
      WITH monthly_ranked AS (
        SELECT
          strftime('%Y-%m', s.timestamp, 'localtime') AS month_bucket,
          ${dimension.idExpr} AS entity_id,
          ${dimension.labelExpr} AS entity_label,
          ROUND(COALESCE(SUM(si.quantity), 0), 2) AS units_sold,
          ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS revenue,
          ROW_NUMBER() OVER (
            PARTITION BY strftime('%Y-%m', s.timestamp, 'localtime')
            ORDER BY SUM(si.quantity * si.price_at_sale) DESC, SUM(si.quantity) DESC
          ) AS bucket_rank
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN sales s ON si.sale_id = s.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN suppliers sup ON p.supplier_id = sup.id
        WHERE (${sharedWhere})
          AND s.timestamp >= ?
          AND s.timestamp < ?
        GROUP BY month_bucket, entity_id, entity_label
      )
      SELECT month_bucket, entity_id, entity_label, units_sold, revenue
      FROM monthly_ranked
      WHERE bucket_rank = 1
      ORDER BY month_bucket DESC
      LIMIT 6
    `;

    try {
      const [
        itemComparison,
        categoryComparisonRaw,
        brandComparison,
        supplierComparison,
        itemMonthly,
        categoryMonthlyRaw,
        brandMonthly,
        supplierMonthly,
      ] =
        await Promise.all([
          runAll(comparisonSql(dimensions.items), [
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            toUtcStart(ranges.previous.from, tz),
            toUtcEnd(ranges.previous.to, tz),
          ]),
          runAll(comparisonSql(dimensions.categories), [
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            toUtcStart(ranges.previous.from, tz),
            toUtcEnd(ranges.previous.to, tz),
          ]),
          runAll(comparisonSql(dimensions.brands), [
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            toUtcStart(ranges.previous.from, tz),
            toUtcEnd(ranges.previous.to, tz),
          ]),
          runAll(comparisonSql(dimensions.suppliers), [
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
            toUtcStart(ranges.previous.from, tz),
            toUtcEnd(ranges.previous.to, tz),
          ]),
          runAll(monthlySql(dimensions.items), [
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
          ]),
          runAll(monthlySql(dimensions.categories), [
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
          ]),
          runAll(monthlySql(dimensions.brands), [
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
          ]),
          runAll(monthlySql(dimensions.suppliers), [
            ...params,
            toUtcStart(ranges.current.from, tz),
            toUtcEnd(ranges.current.to, tz),
          ]),
        ]);

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
  app.get("/api/reports/refunds-voids", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    const saleWhere = ["s.voided = 1"];
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
      saleWhere.push("time(s.timestamp,'localtime') >= time(?)");
      refundWhere.push("time(r.timestamp,'localtime') >= time(?)");
      saleParams.push(time_from);
      refundParams.push(time_from);
    }
    if (time_to) {
      saleWhere.push("time(s.timestamp,'localtime') <= time(?)");
      refundWhere.push("time(r.timestamp,'localtime') <= time(?)");
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
      WHERE ${saleWhere.join(" AND ")}
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
      WHERE ${refundWhere.join(" AND ")}
      ORDER BY r.timestamp DESC
      LIMIT 300
    `;

    db.all(voidSql, saleParams, (voidErr, voidRows) => {
      if (voidErr) return res.status(500).json({ error: voidErr.message });
      db.all(refundSql, refundParams, (refundErr, refundRows) => {
        if (refundErr) return res.status(500).json({ error: refundErr.message });
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
      });
    });
  });

  // Cashier Wise: sales, voids, refunds, and discounts by employee
  app.get("/api/reports/cashier-wise", (req, res) => {
    const tz = req.company?.timezone || "UTC";
    const salesWhere = ["s.voided = 0", "s.employee_id IS NOT NULL"];
    const voidWhere = ["s.voided = 1", "s.employee_id IS NOT NULL"];
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
      salesWhere.push("time(s.timestamp,'localtime') >= time(?)");
      voidWhere.push("time(s.timestamp,'localtime') >= time(?)");
      refundWhere.push("time(r.timestamp,'localtime') >= time(?)");
      salesParams.push(time_from);
      voidParams.push(time_from);
      refundParams.push(time_from);
    }
    if (time_to) {
      salesWhere.push("time(s.timestamp,'localtime') <= time(?)");
      voidWhere.push("time(s.timestamp,'localtime') <= time(?)");
      refundWhere.push("time(r.timestamp,'localtime') <= time(?)");
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

    const sql = `
      WITH sales_agg AS (
        SELECT
          s.employee_id,
          COUNT(*) AS sale_count,
          ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS sales_value,
          ROUND(COALESCE(SUM(COALESCE(s.discount_amount, 0)), 0), 2) AS discount_value
        FROM sales s
        WHERE ${salesWhere.join(" AND ")}
        GROUP BY s.employee_id
      ),
      void_agg AS (
        SELECT
          s.employee_id,
          COUNT(*) AS void_count,
          ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS void_value
        FROM sales s
        WHERE ${voidWhere.join(" AND ")}
        GROUP BY s.employee_id
      ),
      refund_agg AS (
        SELECT
          r.employee_id,
          COUNT(*) AS refund_count,
          ROUND(COALESCE(SUM(r.total_refund), 0), 2) AS refund_value
        FROM returns r
        WHERE ${refundWhere.join(" AND ")}
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

    db.all(
      sql,
      [...salesParams, ...voidParams, ...refundParams],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ items: rows });
      },
    );
  });

  // Profit Summary
  app.get(
    "/api/reports/profit-summary",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
      const { where, params } = await buildReportFilterParts(req);
      const sql = `
      SELECT
        COUNT(DISTINCT s.id) AS orders,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS gross_sales,
        ROUND(COALESCE(SUM(si.quantity * si.cost_price_at_sale), 0), 2) AS cogs,
        ROUND(COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0), 2) AS gross_profit,
        ROUND(COALESCE(SUM(COALESCE(s.discount_amount, 0)), 0), 2) AS discount_amount,
        ROUND(0, 2) AS promo_discount,
        ROUND(
          COALESCE(SUM(si.quantity * si.price_at_sale - si.quantity * si.cost_price_at_sale), 0)
          - COALESCE(SUM(COALESCE(s.discount_amount, 0)), 0)
          - 0,
          2
        ) AS net_profit
      FROM sales s
      JOIN sale_items si ON s.id = si.sale_id
      JOIN products p ON si.product_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `;
      db.get(sql, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const grossSales = Number(row?.gross_sales || 0);
        const grossProfit = Number(row?.gross_profit || 0);
        const netProfit = Number(row?.net_profit || 0);
        res.json({
          summary: {
            ...row,
            margin_pct:
              grossSales > 0
                ? Number(((grossProfit / grossSales) * 100).toFixed(2))
                : 0,
            net_margin_pct:
              grossSales > 0
                ? Number(((netProfit / grossSales) * 100).toFixed(2))
                : 0,
          },
        });
      });
    },
  );

  // Profit by Product
  app.get(
    "/api/reports/profit-by-product",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
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
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY p.id
      ORDER BY ${sort} ${order}
      LIMIT ? OFFSET ?
    `;
      db.all(sql, [...params, limit, offset], async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        res.json({
          items: withCategoryPaths(rows, categoryMeta),
          paging: { limit, offset },
        });
      });
    },
  );

  // Profit by Outlet
  app.get(
    "/api/reports/profit-by-outlet",
    requireFeature("reports_profit_layer"),
    async (req, res) => {
      const { where, params } = await buildReportFilterParts(req, {
        sale: "s",
        product: "p",
        item: "si",
        outlet: "o",
        employee: "e",
      });
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
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY o.id
      ORDER BY gross_profit DESC
    `;
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ items: rows });
      });
    },
  );
};
