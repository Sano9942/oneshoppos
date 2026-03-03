module.exports = function (app, deps, helpers) {
  const { db, requireFeature } = deps;
  const { buildCategoryMetaMap, withCategoryPaths, getDescendantLeafIds } =
    helpers;

  // Sales & Stock: product with all-time sales + current stock
  app.get("/api/reports/sales-stock", (req, res) => {
    const sql = `
    SELECT p.id, p.name, p.barcode, COALESCE(cat.name,'—') AS category,
           p.category_id,
           COALESCE(SUM(DISTINCT os.quantity),0) AS total_stock,
           COALESCE(SUM(si.quantity),0) AS units_sold,
           COALESCE(SUM(si.quantity * si.price_at_sale),0) AS revenue
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN outlet_stock os ON p.id = os.product_id
    LEFT JOIN sale_items si ON p.id = si.product_id
    GROUP BY p.id
    ORDER BY units_sold DESC`;
    db.all(sql, [], async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ rows: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // Inventory Dump: stock per product per outlet with full product info
  app.get("/api/reports/inventory-dump", (req, res) => {
    const { outlet_id } = req.query;
    let where = [];
    const params = [];
    if (outlet_id) {
      where.push("os.outlet_id = ?");
      params.push(outlet_id);
    }
    const sql = `
    SELECT o.name AS outlet_name, p.name AS product_name, p.barcode,
           COALESCE(cat.name,'—') AS category, p.category_id, COALESCE(b.name,'—') AS brand,
           p.price, p.cost_price, os.quantity,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY o.name, p.name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ rows: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // Product Specification: full product table with all FK names
  app.get("/api/reports/product-spec", (req, res) => {
    const { search } = req.query;
    let where = [];
    const params = [];
    if (search) {
      where.push("(p.name LIKE ? OR p.barcode LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const sql = `
    SELECT p.id, p.barcode, p.name, p.price, p.cost_price,
           COALESCE(cat.name,'—') AS category, p.category_id, COALESCE(b.name,'—') AS brand,
           COALESCE(sup.name,'—') AS supplier,
           COALESCE(t.name,'—') AS tax_name, COALESCE(t.rate, p.gst, 0) AS tax_rate
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    LEFT JOIN taxes t ON p.tax_id = t.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ rows: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // On Hand Inventory: current stock per product per outlet
  app.get("/api/reports/on-hand", (req, res) => {
    const { outlet_id } = req.query;
    let where = [];
    const params = [];
    if (outlet_id) {
      where.push("os.outlet_id = ?");
      params.push(outlet_id);
    }
    const sql = `
    SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
           os.quantity, p.price, p.cost_price,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name, o.name`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Inventory Loss: stock adjustments with negative quantity
  app.get("/api/reports/inventory-loss", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["sa.quantity_change < 0"];
    const params = [];
    if (date_from) {
      where.push("date(sa.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(sa.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Wastage: stock adjustments for Damaged or Expired reasons
  app.get("/api/reports/wastage", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = ["sa.reason IN ('Damaged','Expired')"];
    const params = [];
    if (date_from) {
      where.push("date(sa.timestamp,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(sa.timestamp,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows });
    });
  });

  // Replenishment: products at or below threshold per outlet
  app.get("/api/reports/replenishment", (req, res) => {
    const threshold = parseInt(req.query.threshold) || 10;
    const sql = `
    SELECT p.id AS product_id, p.name AS product_name, p.barcode,
           p.cost_price, p.min_qty, p.supplier_id,
           COALESCE(s.name, 'No Supplier') AS supplier_name,
           o.id AS outlet_id, o.name AS outlet_name, os.quantity
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE os.quantity <= ?
    ORDER BY supplier_name ASC, os.quantity ASC, p.name ASC`;
    db.all(sql, [threshold], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows, threshold });
    });
  });

  // Dead Stock
  app.get(
    "/api/reports/dead-stock",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const inactiveDays = Math.max(
        1,
        Math.min(3650, parseInt(req.query.inactive_days || 60, 10)),
      );
      const outletFilter = req.query.outlet_id ? "AND os.outlet_id = ?" : "";
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(os.quantity * COALESCE(p.cost_price, 0), 2) AS stock_cost_value,
        ROUND(os.quantity * COALESCE(p.price, 0), 2) AS stock_retail_value,
        MAX(s.timestamp) AS last_sold_at,
        CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS days_since_sale
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE os.quantity > 0 ${outletFilter}
      GROUP BY p.id, o.id
      HAVING COALESCE(days_since_sale, 99999) >= ?
      ORDER BY stock_cost_value DESC
      LIMIT 500
    `;
      const reorderedParams = req.query.outlet_id
        ? [req.query.outlet_id, inactiveDays]
        : [inactiveDays];
      db.all(sql, reorderedParams, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rows, inactive_days: inactiveDays });
      });
    },
  );

  // Stock Aging
  app.get(
    "/api/reports/stock-aging",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(os.quantity * COALESCE(p.cost_price, 0), 2) AS stock_cost_value,
        MAX(s.timestamp) AS last_sold_at,
        CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS days_since_sale
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE os.quantity > 0
      ${req.query.outlet_id ? "AND os.outlet_id = ?" : ""}
      GROUP BY p.id, o.id
      ORDER BY COALESCE(days_since_sale, 99999) DESC, stock_cost_value DESC
      LIMIT 500
    `;
      const params = req.query.outlet_id ? [req.query.outlet_id] : [];
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rows });
      });
    },
  );

  async function buildForecastRows(filters, cb) {
    const lookbackDays = Math.max(
      7,
      Math.min(
        365,
        parseInt(filters.lookback_days || filters.lookbackDays || 28, 10),
      ),
    );
    const where = [
      "s.voided = 0",
      "date(s.timestamp,'localtime') >= date('now', '-' || ? || ' days', 'localtime')",
    ];
    const params = [lookbackDays];
    if (filters.outlet_id) {
      where.push("s.outlet_id = ?");
      params.push(filters.outlet_id);
    }
    if (filters.category_id) {
      const leafIds = await getDescendantLeafIds(filters.category_id);
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push("p.category_id = ?");
        params.push(Number(leafIds[0]));
      } else {
        where.push(`p.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        COALESCE(SUM(si.quantity), 0) AS units_lookback,
        ROUND(COALESCE(SUM(si.quantity), 0) / ?, 4) AS avg_daily_units,
        COALESCE(os.quantity, 0) AS on_hand_qty,
        ROUND((COALESCE(SUM(si.quantity), 0) / ?) * 7, 2) AS forecast_7d_units,
        ROUND((COALESCE(SUM(si.quantity), 0) / ?) * 14, 2) AS forecast_14d_units,
        ROUND(
          CASE WHEN COALESCE(SUM(si.quantity), 0) > 0
            THEN COALESCE(os.quantity, 0) / (COALESCE(SUM(si.quantity), 0) / ?)
            ELSE NULL
          END, 2
        ) AS days_of_cover
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      JOIN outlets o ON o.id = s.outlet_id
      LEFT JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = o.id
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, o.id
      ORDER BY avg_daily_units DESC
      LIMIT 1000
    `;
    db.all(
      sql,
      [...params, lookbackDays, lookbackDays, lookbackDays, lookbackDays],
      (err, rows) => {
        if (err) return cb(err);
        return cb(null, rows || [], lookbackDays);
      },
    );
  }

  // Stockout Risk
  app.get(
    "/api/reports/stockout-risk",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const lookbackDays = Math.max(
        7,
        Math.min(365, parseInt(req.query.lookback_days || 30, 10)),
      );
      const sql = `
      WITH sales_velocity AS (
        SELECT
          si.product_id,
          s.outlet_id,
          SUM(si.quantity) AS units_sold
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.voided = 0
          AND date(s.timestamp, 'localtime') >= date('now', '-' || ? || ' days', 'localtime')
        GROUP BY si.product_id, s.outlet_id
      )
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(COALESCE(v.units_sold, 0) / ?, 4) AS avg_daily_units,
        ROUND(
          CASE WHEN COALESCE(v.units_sold, 0) > 0
            THEN os.quantity / (COALESCE(v.units_sold, 0) / ?)
            ELSE NULL
          END, 2
        ) AS days_of_cover,
        CASE
          WHEN COALESCE(v.units_sold, 0) = 0 THEN 'stable'
          WHEN (os.quantity / (COALESCE(v.units_sold, 0) / ?)) < 7 THEN 'high'
          WHEN (os.quantity / (COALESCE(v.units_sold, 0) / ?)) < 14 THEN 'medium'
          ELSE 'stable'
        END AS risk_level
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN sales_velocity v ON v.product_id = os.product_id AND v.outlet_id = os.outlet_id
      WHERE os.quantity > 0
      ${req.query.outlet_id ? "AND os.outlet_id = ?" : ""}
      ORDER BY
        CASE risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        days_of_cover ASC
      LIMIT 500
    `;
      const params = req.query.outlet_id
        ? [
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
            req.query.outlet_id,
          ]
        : [
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
            lookbackDays,
          ];
      db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ rows, lookback_days: lookbackDays });
      });
    },
  );

  // Forecast Demand
  app.get(
    "/api/reports/forecast-demand",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      buildForecastRows(req.query || {}, (err, rows, lookbackDays) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          rows,
          lookback_days: lookbackDays,
          formula: "moving_average_daily_velocity",
          data_as_of: new Date().toISOString(),
        });
      });
    },
  );

  // Replenishment Smart
  app.get(
    "/api/reports/replenishment-smart",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      const forecastDays = Math.max(
        7,
        Math.min(90, parseInt(req.query.forecast_days || 14, 10)),
      );
      buildForecastRows(req.query || {}, (err, rows, lookbackDays) => {
        if (err) return res.status(500).json({ error: err.message });
        const smart = (rows || []).map((r) => {
          const avgDaily = Number(r.avg_daily_units || 0);
          const onHand = Number(r.on_hand_qty || 0);
          const target = avgDaily * forecastDays;
          const suggested = Math.max(0, Math.ceil(target - onHand));
          return {
            ...r,
            forecast_days: forecastDays,
            target_cover_units: Number(target.toFixed(2)),
            suggested_reorder_qty: suggested,
          };
        });
        res.json({
          rows: smart,
          lookback_days: lookbackDays,
          forecast_days: forecastDays,
          formula: "moving_average_cover_gap",
          data_as_of: new Date().toISOString(),
        });
      });
    },
  );

  return { buildForecastRows };
};
