module.exports = function (app, deps, helpers) {
  const { db, requireFeature } = deps;
  const {
    buildCategoryMetaMap,
    withCategoryPaths,
    buildReportFilterParts,
    parsePaging,
  } = helpers;

  // Top Salespeople: revenue per employee
  app.get("/api/reports/top-salespeople", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["s.voided = 0", "s.employee_id IS NOT NULL"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
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
    const { date_from, date_to, outlet_id } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    if (outlet_id) {
      where.push("s.outlet_id = ?");
      params.push(outlet_id);
    }
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
    const { date_from, date_to, search } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
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
    const { date_from = "", date_to = "", search = "" } = req.query;
    let conditions = ["1=1"];
    const params = [];

    if (search) {
      conditions.push("(CAST(s.id AS TEXT) LIKE ? OR c.name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (date_from) {
      conditions.push("date(s.timestamp, 'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      conditions.push("date(s.timestamp, 'localtime') <= ?");
      params.push(date_to);
    }
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

  // Category Wise: sales grouped by product category
  app.get("/api/reports/category-wise", async (req, res) => {
    const { date_from, date_to, category_id } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    if (category_id) {
      const leafIds = await helpers.getDescendantLeafIds(category_id);
      if (!leafIds.length) return res.json({ data: [] });
      if (leafIds.length === 1) {
        where.push("p.category_id = ?");
        params.push(Number(leafIds[0]));
      } else {
        where.push(`p.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
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

  // Item Wise: sales grouped by product
  app.get("/api/reports/item-wise", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY units_sold DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
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
  app.get("/api/reports/product-performance", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["s.voided = 0"];
    const params = [];
    if (date_from) {
      where.push("date(s.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(s.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
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
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY margin_pct DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
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
