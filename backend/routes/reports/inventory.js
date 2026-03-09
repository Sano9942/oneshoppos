const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requireFeature } = deps;
  const { buildCategoryMetaMap, withCategoryPaths, getDescendantLeafIds } =
    helpers;

  function applyOutletFilter(where, params, rawId, col = "os.outlet_id") {
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

  async function applyInventoryProductFilters(where, params, query, alias = "p") {
    const { category_id, brand_id, supplier_id, search } = query || {};
    if (category_id) {
      const leafIds = await getDescendantLeafIds(category_id);
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push(`${alias}.category_id = ?`);
        params.push(Number(leafIds[0]));
      } else {
        where.push(`${alias}.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    if (brand_id) {
      where.push(`${alias}.brand_id = ?`);
      params.push(brand_id);
    }
    if (supplier_id) {
      where.push(`${alias}.supplier_id = ?`);
      params.push(supplier_id);
    }
    if (search) {
      where.push(
        `(${alias}.name LIKE ? OR COALESCE(${alias}.barcode, '') LIKE ? OR CAST(${alias}.id AS TEXT) LIKE ?)`,
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

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
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // Inventory Dump: stock per product per outlet with full product info
  app.get("/api/reports/inventory-dump", async (req, res) => {
    const { outlet_id, aggregate = "0", anomaly = "" } = req.query;
    const aggregateMode = String(aggregate) === "1";
    const marginThreshold = Math.max(
      0,
      Math.min(100, Number(req.query.margin_threshold || 15)),
    );
    let where = [];
    const params = [];
    await applyInventoryProductFilters(where, params, req.query);
    applyOutletFilter(where, params, outlet_id);

    if (aggregateMode) {
      const having = [];
      if (anomaly === "zero_stock") having.push("SUM(os.quantity) = 0");
      if (anomaly === "negative_stock") having.push("SUM(os.quantity) < 0");
      if (anomaly === "low_stock") having.push("SUM(os.quantity) <= 5");
      if (anomaly === "zero_sale_price") having.push("p.price <= 0");
      if (anomaly === "zero_cost") having.push("p.cost_price <= 0");
      if (anomaly === "cost_over_sale") having.push("p.cost_price >= p.price");
      if (anomaly === "margin_risk") {
        having.push(
          "(p.cost_price >= p.price OR CASE WHEN COALESCE(p.price, 0) > 0 THEN ((p.price - p.cost_price) * 100.0) / p.price ELSE 0 END < ?)",
        );
        params.push(marginThreshold);
      }
      const sql = `
      SELECT
        'All Outlets' AS outlet_name,
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        COALESCE(cat.name,'—') AS category,
        p.category_id,
        COALESCE(b.name,'—') AS brand,
        COALESCE(sup.name,'—') AS supplier,
        p.price,
        p.cost_price,
        SUM(os.quantity) AS quantity,
        (SUM(os.quantity) * p.price) AS retail_value,
        (SUM(os.quantity) * p.cost_price) AS cost_value,
        COUNT(DISTINCT os.outlet_id) AS outlet_count,
        ROUND(
          CASE WHEN COALESCE(p.price, 0) > 0
            THEN ((p.price - p.cost_price) * 100.0) / p.price
            ELSE 0
          END,
          2
        ) AS margin_pct
      FROM outlet_stock os
      JOIN products p ON os.product_id = p.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers sup ON p.supplier_id = sup.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY p.id
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ORDER BY quantity ASC, p.name`;
      return db.all(sql, params, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        res.json({ items: withCategoryPaths(rows, categoryMeta) });
      });
    }

    if (anomaly === "zero_stock") where.push("os.quantity = 0");
    if (anomaly === "negative_stock") where.push("os.quantity < 0");
    if (anomaly === "low_stock") where.push("os.quantity <= 5");
    if (anomaly === "zero_sale_price") where.push("p.price <= 0");
    if (anomaly === "zero_cost") where.push("p.cost_price <= 0");
    if (anomaly === "cost_over_sale") where.push("p.cost_price >= p.price");
    if (anomaly === "margin_risk") {
      where.push(
        "(p.cost_price >= p.price OR CASE WHEN COALESCE(p.price, 0) > 0 THEN ((p.price - p.cost_price) * 100.0) / p.price ELSE 0 END < ?)",
      );
      params.push(marginThreshold);
    }
    const sql = `
    SELECT o.name AS outlet_name, p.id AS product_id, p.name AS product_name, p.barcode,
           COALESCE(cat.name,'—') AS category, p.category_id, COALESCE(b.name,'—') AS brand,
           COALESCE(sup.name,'—') AS supplier,
           p.price, p.cost_price, os.quantity,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value,
           ROUND(
             CASE WHEN COALESCE(p.price, 0) > 0
               THEN ((p.price - p.cost_price) * 100.0) / p.price
               ELSE 0
             END,
             2
           ) AS margin_pct
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY o.name, os.quantity ASC, p.name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // Product Specification: full product table with all FK names and inventory master context
  app.get("/api/reports/product-spec", async (req, res) => {
    let where = [];
    const params = [];
    await applyInventoryProductFilters(where, params, req.query);
    const sql = `
    SELECT p.id, p.barcode, p.name, p.price, p.cost_price,
           p.sku, p.status, p.product_type, p.min_qty, p.max_qty, p.unit,
           COALESCE(cat.name,'—') AS category, p.category_id, COALESCE(b.name,'—') AS brand,
           COALESCE(sup.name,'—') AS supplier,
           COALESCE(t.name,'—') AS tax_name, COALESCE(t.rate, p.gst, 0) AS tax_rate,
           COALESCE(SUM(os.quantity), 0) AS total_stock,
           COUNT(DISTINCT os.outlet_id) AS outlet_count
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    LEFT JOIN taxes t ON p.tax_id = t.id
    LEFT JOIN outlet_stock os ON os.product_id = p.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY p.id
    ORDER BY p.name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // On Hand Inventory: current stock per product per outlet or aggregated across all outlets
  app.get("/api/reports/on-hand", async (req, res) => {
    const { outlet_id, aggregate = "0", anomaly = "" } = req.query;
    const aggregateMode = String(aggregate) === "1";
    const marginThreshold = Math.max(
      0,
      Math.min(100, Number(req.query.margin_threshold || 15)),
    );
    let where = [];
    const params = [];
    await applyInventoryProductFilters(where, params, req.query);
    applyOutletFilter(where, params, outlet_id);

    if (aggregateMode) {
      const having = [];
      if (anomaly === "zero_stock") having.push("SUM(os.quantity) = 0");
      if (anomaly === "negative_stock") having.push("SUM(os.quantity) < 0");
      if (anomaly === "low_stock") having.push("SUM(os.quantity) <= 5");
      if (anomaly === "zero_sale_price") having.push("p.price <= 0");
      if (anomaly === "zero_cost") having.push("p.cost_price <= 0");
      if (anomaly === "cost_over_sale") having.push("p.cost_price >= p.price");
      if (anomaly === "margin_risk") {
        having.push(
          "(p.cost_price >= p.price OR CASE WHEN COALESCE(p.price, 0) > 0 THEN ((p.price - p.cost_price) * 100.0) / p.price ELSE 0 END < ?)",
        );
        params.push(marginThreshold);
      }
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        'All Outlets' AS outlet_name,
        COALESCE(cat.name,'—') AS category,
        COALESCE(b.name,'—') AS brand,
        COALESCE(sup.name,'—') AS supplier,
        SUM(os.quantity) AS quantity,
        p.price,
        p.cost_price,
        (SUM(os.quantity) * p.price) AS retail_value,
        (SUM(os.quantity) * p.cost_price) AS cost_value,
        COUNT(DISTINCT os.outlet_id) AS outlet_count,
        ROUND(
          CASE WHEN COALESCE(p.price, 0) > 0
            THEN ((p.price - p.cost_price) * 100.0) / p.price
            ELSE 0
          END,
          2
        ) AS margin_pct
      FROM outlet_stock os
      JOIN products p ON os.product_id = p.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers sup ON p.supplier_id = sup.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY p.id
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ORDER BY quantity ASC, p.name`;
      return db.all(sql, params, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        res.json({ items: withCategoryPaths(rows, categoryMeta) });
      });
    }

    if (anomaly === "zero_stock") where.push("os.quantity = 0");
    if (anomaly === "negative_stock") where.push("os.quantity < 0");
    if (anomaly === "low_stock") where.push("os.quantity <= 5");
    if (anomaly === "zero_sale_price") where.push("p.price <= 0");
    if (anomaly === "zero_cost") where.push("p.cost_price <= 0");
    if (anomaly === "cost_over_sale") where.push("p.cost_price >= p.price");
    if (anomaly === "margin_risk") {
      where.push(
        "(p.cost_price >= p.price OR CASE WHEN COALESCE(p.price, 0) > 0 THEN ((p.price - p.cost_price) * 100.0) / p.price ELSE 0 END < ?)",
      );
      params.push(marginThreshold);
    }
    const sql = `
    SELECT p.id AS product_id, p.name AS product_name, p.barcode, o.name AS outlet_name,
           COALESCE(cat.name,'—') AS category, COALESCE(b.name,'—') AS brand,
           COALESCE(sup.name,'—') AS supplier,
           os.quantity, p.price, p.cost_price,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value,
           ROUND(
             CASE WHEN COALESCE(p.price, 0) > 0
               THEN ((p.price - p.cost_price) * 100.0) / p.price
               ELSE 0
             END,
             2
           ) AS margin_pct
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY os.quantity ASC, p.name, o.name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    });
  });

  // Inventory Loss: stock adjustments with negative quantity
  app.get("/api/reports/inventory-loss", (req, res) => {
    const { date_from, date_to } = req.query;
    const tz = req.company?.timezone || "UTC";
    let where = ["sa.quantity_change < 0"];
    const params = [];
    if (date_from) {
      where.push("sa.timestamp >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("sa.timestamp < ?");
      params.push(toUtcEnd(date_to, tz));
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
      res.json({ items: rows });
    });
  });

  // Wastage: stock adjustments for Damaged or Expired reasons
  app.get("/api/reports/wastage", (req, res) => {
    const { date_from, date_to } = req.query;
    const tz = req.company?.timezone || "UTC";
    let where = ["sa.reason IN ('Damaged','Expired')"];
    const params = [];
    if (date_from) {
      where.push("sa.timestamp >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("sa.timestamp < ?");
      params.push(toUtcEnd(date_to, tz));
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
      res.json({ items: rows });
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
      res.json({ items: rows, threshold });
    });
  });

  // Pricing Exceptions: price, cost, and margin-risk views by product/outlet or aggregated across all outlets
  app.get("/api/reports/pricing-exceptions", async (req, res) => {
    const marginThreshold = Math.max(
      0,
      Math.min(100, Number(req.query.margin_threshold || 15)),
    );
    const aggregateMode = String(req.query.aggregate || "0") === "1";
    const anomaly = String(req.query.anomaly || "margin_risk");
    let where = [];
    const params = [];
    await applyInventoryProductFilters(where, params, req.query);
    applyOutletFilter(where, params, req.query.outlet_id);

    const buildConditions = () => {
      const conditions = [];
      if (anomaly === "zero_sale_price") conditions.push("p.price <= 0");
      if (anomaly === "zero_cost") conditions.push("p.cost_price <= 0");
      if (anomaly === "cost_over_sale") conditions.push("p.cost_price >= p.price");
      if (anomaly === "margin_risk") {
        conditions.push(
          "(p.cost_price >= p.price OR CASE WHEN COALESCE(p.price, 0) > 0 THEN ((p.price - p.cost_price) * 100.0) / p.price ELSE 0 END < ?)",
        );
      }
      return conditions;
    };

    if (aggregateMode) {
      const having = buildConditions();
      const aggregateParams = [...params];
      if (anomaly === "margin_risk") aggregateParams.push(marginThreshold);
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        COALESCE(cat.name,'—') AS category,
        COALESCE(b.name,'—') AS brand,
        COALESCE(sup.name,'—') AS supplier,
        'All Outlets' AS outlet_name,
        SUM(COALESCE(os.quantity, 0)) AS quantity,
        p.price,
        p.cost_price,
        COUNT(DISTINCT os.outlet_id) AS outlet_count,
        ROUND(
          CASE WHEN COALESCE(p.price, 0) > 0
            THEN ((p.price - p.cost_price) * 100.0) / p.price
            ELSE 0
          END,
          2
        ) AS margin_pct
      FROM products p
      LEFT JOIN outlet_stock os ON os.product_id = p.id
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN suppliers sup ON p.supplier_id = sup.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY p.id
      ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
      ORDER BY margin_pct ASC, p.name`;
      return db.all(sql, aggregateParams, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        res.json({
          items: withCategoryPaths(rows, categoryMeta),
          margin_threshold: marginThreshold,
        });
      });
    }

    const detailedWhere = [...where, ...buildConditions()];
    if (anomaly === "margin_risk") params.push(marginThreshold);
    const sql = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.barcode,
      COALESCE(cat.name,'—') AS category,
      COALESCE(b.name,'—') AS brand,
      COALESCE(sup.name,'—') AS supplier,
      COALESCE(o.name, 'No Outlet') AS outlet_name,
      COALESCE(os.quantity, 0) AS quantity,
      p.price,
      p.cost_price,
      ROUND(
        CASE WHEN COALESCE(p.price, 0) > 0
          THEN ((p.price - p.cost_price) * 100.0) / p.price
          ELSE 0
        END,
        2
      ) AS margin_pct
    FROM products p
    LEFT JOIN outlet_stock os ON os.product_id = p.id
    LEFT JOIN outlets o ON o.id = os.outlet_id
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    ${detailedWhere.length ? "WHERE " + detailedWhere.join(" AND ") : ""}
    ORDER BY margin_pct ASC, p.name, outlet_name`;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      res.json({
        items: withCategoryPaths(rows, categoryMeta),
        margin_threshold: marginThreshold,
      });
    });
  });

  // Pricing Margin: all products with cost vs sell price and margin analysis
  app.get("/api/reports/pricing-margin", async (req, res) => {
    const { outlet_id, category_id } = req.query;
    const where = [];
    const params = [];
    if (category_id) {
      const leafIds = await getDescendantLeafIds(category_id);
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
    if (outlet_id) {
      const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
      if (ids.length === 1) {
        where.push("EXISTS (SELECT 1 FROM outlet_stock os2 WHERE os2.product_id = p.id AND os2.outlet_id = ?)");
        params.push(ids[0]);
      } else if (ids.length > 1) {
        where.push(`EXISTS (SELECT 1 FROM outlet_stock os2 WHERE os2.product_id = p.id AND os2.outlet_id IN (${ids.map(() => "?").join(",")}))`);
        params.push(...ids);
      }
    }
    const sql = `
      SELECT
        p.id AS product_id,
        p.name,
        p.sku,
        COALESCE(p.cost_price, 0) AS cost_price,
        COALESCE(p.price, 0) AS selling_price,
        ROUND(COALESCE(p.price, 0) - COALESCE(p.cost_price, 0), 2) AS margin_amount,
        ROUND(
          CASE WHEN COALESCE(p.price, 0) > 0
            THEN ((COALESCE(p.price, 0) - COALESCE(p.cost_price, 0)) * 100.0) / COALESCE(p.price, 0)
            ELSE 0
          END, 2
        ) AS margin_pct,
        COALESCE(cat.name, '—') AS category_name,
        p.category_id
      FROM products p
      LEFT JOIN categories cat ON cat.id = p.category_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY margin_pct ASC, p.name ASC
    `;
    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows || [], categoryMeta);
      res.json({ items });
    });
  });

  // Dead Stock (ungated): products with zero sales in last N days (default 90)
  app.get("/api/reports/dead-stock", async (req, res) => {
    const inactiveDays = Math.max(
      1,
      Math.min(3650, parseInt(req.query.inactive_days || 90, 10)),
    );
    const where = ["os.quantity > 0"];
    const params = [];
    applyOutletFilter(where, params, req.query.outlet_id);
    await applyInventoryProductFilters(where, params, req.query);
    const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        p.barcode,
        p.category_id,
        COALESCE(cat.name, '-') AS category,
        COALESCE(SUM(os.quantity), 0) AS current_stock,
        MAX(s.timestamp) AS last_sold_date,
        CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS days_since_sold,
        ROUND(COALESCE(SUM(os.quantity), 0) * COALESCE(p.cost_price, 0), 2) AS cost_value
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE ${where.join(" AND ")}
      GROUP BY p.id
      HAVING COALESCE(days_since_sold, 99999) >= ?
      ORDER BY cost_value DESC
      LIMIT 500
    `;
    db.all(sql, [...params, inactiveDays], async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows || [], categoryMeta);
      res.json({ items, inactive_days: inactiveDays });
    });
  });

  // Forecast Demand (ungated): avg daily sales over lookback window per product
  app.get("/api/reports/forecast-demand", (req, res) => {
    buildForecastRows(req.query || {}, req.company?.timezone || "UTC", async (err, rows, lookbackDays) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows, categoryMeta);
      res.json({
        items,
        rows: items,
        lookback_days: lookbackDays,
        formula: "moving_average_daily_velocity",
        data_as_of: new Date().toISOString(),
      });
    });
  });

  // Replenishment Smart (ungated): days_of_cover < 14, sorted by urgency ASC
  app.get("/api/reports/replenishment-smart", (req, res) => {
    const forecastDays = Math.max(
      7,
      Math.min(90, parseInt(req.query.forecast_days || 14, 10)),
    );
    buildForecastRows(req.query || {}, req.company?.timezone || "UTC", async (err, rows, lookbackDays) => {
      if (err) return res.status(500).json({ error: err.message });
      const smart = (rows || [])
        .map((r) => {
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
        })
        .filter((r) => r.days_of_cover === null || Number(r.days_of_cover) < 14)
        .sort((a, b) => {
          const aDoc = a.days_of_cover === null ? -1 : Number(a.days_of_cover);
          const bDoc = b.days_of_cover === null ? -1 : Number(b.days_of_cover);
          return aDoc - bDoc;
        });
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(smart, categoryMeta);
      res.json({
        items,
        rows: items,
        lookback_days: lookbackDays,
        forecast_days: forecastDays,
        formula: "moving_average_cover_gap",
        data_as_of: new Date().toISOString(),
      });
    });
  });

  // Dead Stock (feature-gated variant — kept for backward compat with flag-enabled tenants)
  app.get(
    "/api/reports/dead-stock",
    requireFeature("reports_inventory_health_plus"),
    async (req, res) => {
      const inactiveDays = Math.max(
        1,
        Math.min(3650, parseInt(req.query.inactive_days || 60, 10)),
      );
      const where = ["os.quantity > 0"];
      const params = [];
      applyOutletFilter(where, params, req.query.outlet_id);
      await applyInventoryProductFilters(where, params, req.query);
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        p.category_id,
        COALESCE(cat.name,'-') AS category,
        COALESCE(b.name,'-') AS brand,
        COALESCE(sup.name,'-') AS supplier,
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
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, o.id
      HAVING COALESCE(days_since_sale, 99999) >= ?
      ORDER BY stock_cost_value DESC
      LIMIT 500
    `;
      db.all(sql, [...params, inactiveDays], async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        const items = withCategoryPaths(rows, categoryMeta);
        res.json({ items, rows: items, inactive_days: inactiveDays });
      });
    },
  );

  // Stock Aging
  app.get(
    "/api/reports/stock-aging",
    requireFeature("reports_inventory_health_plus"),
    async (req, res) => {
      const where = ["os.quantity > 0"];
      const params = [];
      applyOutletFilter(where, params, req.query.outlet_id);
      await applyInventoryProductFilters(where, params, req.query);
      const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        p.category_id,
        COALESCE(cat.name,'-') AS category,
        COALESCE(b.name,'-') AS brand,
        COALESCE(sup.name,'-') AS supplier,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(os.quantity * COALESCE(p.cost_price, 0), 2) AS stock_cost_value,
        MAX(s.timestamp) AS last_sold_at,
        CAST(julianday('now') - julianday(MAX(s.timestamp)) AS INTEGER) AS days_since_sale
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.voided = 0
      WHERE ${where.join(" AND ")}
      GROUP BY p.id, o.id
      ORDER BY COALESCE(days_since_sale, 99999) DESC, stock_cost_value DESC
      LIMIT 500
    `;
      db.all(sql, params, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        const items = withCategoryPaths(rows, categoryMeta);
        res.json({ items, rows: items });
      });
    },
  );

  async function buildForecastRows(filters, tz, cb) {
    const lookbackDays = Math.max(
      7,
      Math.min(
        365,
        parseInt(filters.lookback_days || filters.lookbackDays || 28, 10),
      ),
    );
    const lookbackDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - lookbackDays * 24 * 3600 * 1000));
    const where = [
      "s.voided = 0",
      "s.timestamp >= ?",
    ];
    const whereParams = [toUtcStart(lookbackDateStr, tz)];
    applyOutletFilter(where, whereParams, filters.outlet_id, "s.outlet_id");
    if (filters.brand_id) {
      where.push("p.brand_id = ?");
      whereParams.push(filters.brand_id);
    }
    if (filters.supplier_id) {
      where.push("p.supplier_id = ?");
      whereParams.push(filters.supplier_id);
    }
    if (filters.category_id) {
      const leafIds = await getDescendantLeafIds(filters.category_id);
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push("p.category_id = ?");
        whereParams.push(Number(leafIds[0]));
      } else {
        where.push(`p.category_id IN (${leafIds.map(() => "?").join(",")})`);
        whereParams.push(...leafIds.map(Number));
      }
    }
    if (filters.search) {
      where.push(
        "(p.name LIKE ? OR COALESCE(p.barcode,'') LIKE ? OR CAST(p.id AS TEXT) LIKE ?)",
      );
      whereParams.push(
        `%${filters.search}%`,
        `%${filters.search}%`,
        `%${filters.search}%`,
      );
    }
    const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        COALESCE(SUM(si.quantity), 0) AS units_lookback,
        ROUND(COALESCE(SUM(si.quantity), 0) * 1.0 / ?, 4) AS avg_daily_units,
        COALESCE(os.quantity, 0) AS on_hand_qty,
        ROUND((COALESCE(SUM(si.quantity), 0) * 1.0 / ?) * 7, 2) AS forecast_7d_units,
        ROUND((COALESCE(SUM(si.quantity), 0) * 1.0 / ?) * 14, 2) AS forecast_14d_units,
        ROUND(
          CASE WHEN COALESCE(SUM(si.quantity), 0) > 0
            THEN COALESCE(os.quantity, 0) / (COALESCE(SUM(si.quantity), 0) * 1.0 / ?)
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
      [lookbackDays, lookbackDays, lookbackDays, lookbackDays, ...whereParams],
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
    async (req, res) => {
      const tz = req.company?.timezone || "UTC";
      const lookbackDays = Math.max(
        7,
        Math.min(365, parseInt(req.query.lookback_days || 30, 10)),
      );
      const lookbackDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - lookbackDays * 24 * 3600 * 1000));
      const lookbackStart = toUtcStart(lookbackDateStr, tz);
      const where = ["os.quantity > 0"];
      const params = [lookbackStart, lookbackDays, lookbackDays, lookbackDays, lookbackDays];
      applyOutletFilter(where, params, req.query.outlet_id);
      await applyInventoryProductFilters(where, params, req.query);
      const sql = `
      WITH sales_velocity AS (
        SELECT
          si.product_id,
          s.outlet_id,
          SUM(si.quantity) AS units_sold
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.voided = 0
          AND s.timestamp >= ?
        GROUP BY si.product_id, s.outlet_id
      )
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        p.category_id,
        COALESCE(cat.name,'-') AS category,
        COALESCE(b.name,'-') AS brand,
        COALESCE(sup.name,'-') AS supplier,
        o.id AS outlet_id,
        o.name AS outlet_name,
        os.quantity AS stock_qty,
        ROUND(COALESCE(v.units_sold, 0) * 1.0 / ?, 4) AS avg_daily_units,
        ROUND(
          CASE WHEN COALESCE(v.units_sold, 0) > 0
            THEN os.quantity / (COALESCE(v.units_sold, 0) * 1.0 / ?)
            ELSE NULL
          END, 2
        ) AS days_of_cover,
        CASE
          WHEN COALESCE(v.units_sold, 0) = 0 THEN 'stable'
          WHEN (os.quantity / (COALESCE(v.units_sold, 0) * 1.0 / ?)) < 7 THEN 'high'
          WHEN (os.quantity / (COALESCE(v.units_sold, 0) * 1.0 / ?)) < 14 THEN 'medium'
          ELSE 'stable'
        END AS risk_level
      FROM outlet_stock os
      JOIN products p ON p.id = os.product_id
      JOIN outlets o ON o.id = os.outlet_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN sales_velocity v ON v.product_id = os.product_id AND v.outlet_id = os.outlet_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        days_of_cover ASC
      LIMIT 500
    `;
      db.all(sql, params, async (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        const items = withCategoryPaths(rows, categoryMeta);
        res.json({ items, rows: items, lookback_days: lookbackDays });
      });
    },
  );

  // Forecast Demand
  app.get(
    "/api/reports/forecast-demand",
    requireFeature("reports_inventory_health_plus"),
    (req, res) => {
      buildForecastRows(req.query || {}, req.company?.timezone || "UTC", async (err, rows, lookbackDays) => {
        if (err) return res.status(500).json({ error: err.message });
        const categoryMeta = await buildCategoryMetaMap();
        const items = withCategoryPaths(rows, categoryMeta);
        res.json({
          items,
          rows: items,
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
      buildForecastRows(req.query || {}, req.company?.timezone || "UTC", async (err, rows, lookbackDays) => {
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
        const categoryMeta = await buildCategoryMetaMap();
        const items = withCategoryPaths(smart, categoryMeta);
        res.json({
          items,
          rows: items,
          lookback_days: lookbackDays,
          forecast_days: forecastDays,
          formula: "moving_average_cover_gap",
          data_as_of: new Date().toISOString(),
        });
      });
    },
  );

  // Product Movement (Inter-Outlet Transfers)
  app.get("/api/reports/product-movement", (req, res) => {
    const { date_from, date_to, outlet_id } = req.query;
    const tz = req.company?.timezone || "UTC";
    let where = [];
    const params = [];
    if (date_from) {
      where.push("it.timestamp >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("it.timestamp < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    if (outlet_id) {
      where.push("(it.from_outlet_id = ? OR it.to_outlet_id = ?)");
      params.push(outlet_id, outlet_id);
    }
    const sql = `
    SELECT it.timestamp, p.name AS product_name, p.barcode,
           fo.name AS from_outlet_name, to_o.name AS to_outlet_name,
           it.quantity, COALESCE(e.name, 'System') AS employee_name
    FROM inventory_transfers it
    JOIN products p ON it.product_id = p.id
    JOIN outlets fo ON it.from_outlet_id = fo.id
    JOIN outlets to_o ON it.to_outlet_id = to_o.id
    LEFT JOIN employees e ON it.employee_id = e.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY it.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // STR Report (Stock Transfer Register - functionally similar to product movement but used as a formal register)
  app.get("/api/reports/str-report", (req, res) => {
    const { date_from, date_to, outlet_id } = req.query;
    const tz = req.company?.timezone || "UTC";
    let where = [];
    const params = [];
    if (date_from) {
      where.push("it.timestamp >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("it.timestamp < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    if (outlet_id) {
      where.push("(it.from_outlet_id = ? OR it.to_outlet_id = ?)");
      params.push(outlet_id, outlet_id);
    }
    const sql = `
    SELECT it.timestamp, it.id as reference_id,
           fo.name AS from_outlet_name, to_o.name AS to_outlet_name,
           SUM(it.quantity) as quantity
    FROM inventory_transfers it
    JOIN outlets fo ON it.from_outlet_id = fo.id
    JOIN outlets to_o ON it.to_outlet_id = to_o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY it.timestamp, fo.id, to_o.id
    ORDER BY it.timestamp DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // GRN Report: Historical log of stock receipts from suppliers
  app.get("/api/reports/grn-report", (req, res) => {
    const { date_from, date_to, outlet_id } = req.query;
    let where = [];
    const params = [];

    if (date_from) {
      where.push("date(grn.received_at) >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(grn.received_at) <= ?");
      params.push(date_to);
    }
    applyOutletFilter(where, params, outlet_id, "grn.outlet_id");

    const sql = `
      SELECT date(grn.received_at) as date, p.name as product_name,
             s.name as supplier_name, gi.qty_received AS quantity, gi.cost_price
      FROM goods_received_notes grn
      JOIN purchase_orders po ON grn.po_id = po.id
      JOIN grn_items gi ON gi.grn_id = grn.id
      JOIN products p ON gi.product_id = p.id
      JOIN suppliers s ON po.supplier_id = s.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY grn.received_at DESC`;

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ items: rows });
    });
  });

  // History Cost: GRN-level purchase cost history by product
  app.get("/api/reports/history-cost", async (req, res) => {
    let where = [];
    const params = [];
    await applyInventoryProductFilters(where, params, req.query);

    if (req.query.date_from) {
      where.push("date(grn.received_at) >= ?");
      params.push(req.query.date_from);
    }
    if (req.query.date_to) {
      where.push("date(grn.received_at) <= ?");
      params.push(req.query.date_to);
    }
    if (req.query.time_from) {
      where.push("strftime('%H:%M', grn.received_at) >= ?");
      params.push(req.query.time_from);
    }
    if (req.query.time_to) {
      where.push("strftime('%H:%M', grn.received_at) <= ?");
      params.push(req.query.time_to);
    }
    applyOutletFilter(where, params, req.query.outlet_id, "grn.outlet_id");

    const sql = `
      SELECT
        grn.id AS grn_id,
        grn.grn_number,
        grn.received_at,
        COALESCE(o.name, '—') AS outlet_name,
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        p.sku,
        p.category_id,
        COALESCE(cat.name, '—') AS category,
        COALESCE(b.name, '—') AS brand,
        COALESCE(sup.name, '—') AS supplier,
        gi.qty_received,
        ROUND(COALESCE(gi.cost_price, 0), 2) AS received_cost_price,
        ROUND(COALESCE(p.cost_price, 0), 2) AS current_master_cost,
        ROUND(COALESCE(gi.qty_received, 0) * COALESCE(gi.cost_price, 0), 2) AS received_cost_value,
        ROUND(COALESCE(gi.cost_price, 0) - COALESCE(p.cost_price, 0), 2) AS vs_current_cost
      FROM goods_received_notes grn
      JOIN grn_items gi ON gi.grn_id = grn.id
      JOIN products p ON p.id = gi.product_id
      LEFT JOIN purchase_orders po ON po.id = grn.po_id
      LEFT JOIN suppliers sup ON sup.id = COALESCE(po.supplier_id, p.supplier_id)
      LEFT JOIN outlets o ON o.id = grn.outlet_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY grn.received_at DESC, p.name ASC
      LIMIT 500
    `;

    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows, categoryMeta);
      res.json({ items });
    });
  });

  // History Sale: sale-line history by product with realized sell/cost
  app.get("/api/reports/history-sale", async (req, res) => {
    let where = ["s.voided = 0", "si.quantity > 0"];
    const params = [];
    await applyInventoryProductFilters(where, params, req.query);

    const tz = req.company?.timezone || "UTC";
    if (req.query.date_from) {
      where.push("s.timestamp >= ?");
      params.push(toUtcStart(req.query.date_from, tz));
    }
    if (req.query.date_to) {
      where.push("s.timestamp < ?");
      params.push(toUtcEnd(req.query.date_to, tz));
    }
    if (req.query.time_from) {
      where.push("strftime('%H:%M', s.timestamp, 'localtime') >= ?");
      params.push(req.query.time_from);
    }
    if (req.query.time_to) {
      where.push("strftime('%H:%M', s.timestamp, 'localtime') <= ?");
      params.push(req.query.time_to);
    }
    applyOutletFilter(where, params, req.query.outlet_id, "s.outlet_id");
    if (req.query.employee_id) {
      where.push("s.employee_id = ?");
      params.push(req.query.employee_id);
    }

    const sql = `
      SELECT
        s.id AS sale_id,
        s.timestamp,
        COALESCE(o.name, '—') AS outlet_name,
        COALESCE(e.name, '—') AS employee_name,
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        p.sku,
        p.category_id,
        COALESCE(cat.name, '—') AS category,
        COALESCE(b.name, '—') AS brand,
        COALESCE(sup.name, '—') AS supplier,
        si.quantity,
        ROUND(COALESCE(si.price_at_sale, 0), 2) AS price_at_sale,
        ROUND(COALESCE(si.cost_price_at_sale, 0), 2) AS cost_price_at_sale,
        ROUND(COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0), 2) AS line_revenue,
        ROUND(COALESCE(si.quantity, 0) * COALESCE(si.cost_price_at_sale, 0), 2) AS line_cost,
        ROUND(
          (COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0))
          - (COALESCE(si.quantity, 0) * COALESCE(si.cost_price_at_sale, 0)),
          2
        ) AS line_gross_profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      LEFT JOIN outlets o ON o.id = s.outlet_id
      LEFT JOIN employees e ON e.id = s.employee_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.timestamp DESC, p.name ASC
      LIMIT 500
    `;

    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows, categoryMeta);
      res.json({ items });
    });
  });

  // Product Audit: master-data and reference utility checks from the live schema
  app.get("/api/reports/product-audit", async (req, res) => {
    let where = [];
    const params = [];
    const issue = String(req.query.issue || "all");
    const inactivityDays = Math.max(
      1,
      Math.min(3650, Number(req.query.inactivity_days || 60)),
    );
    await applyInventoryProductFilters(where, params, req.query);

    const stockWhere = [];
    const stockParams = [];
    const saleWhere = ["s.voided = 0"];
    const saleParams = [];

    applyOutletFilter(stockWhere, stockParams, req.query.outlet_id);
    applyOutletFilter(saleWhere, saleParams, req.query.outlet_id, "s.outlet_id");

    const sql = `
      WITH stock_by_product AS (
        SELECT
          os.product_id,
          COALESCE(SUM(os.quantity), 0) AS total_stock,
          COUNT(DISTINCT os.outlet_id) AS outlet_count
        FROM outlet_stock os
        ${stockWhere.length ? `WHERE ${stockWhere.join(" AND ")}` : ""}
        GROUP BY os.product_id
      ),
      sale_by_product AS (
        SELECT
          si.product_id,
          MAX(s.timestamp) AS last_sold_at,
          COALESCE(SUM(si.quantity), 0) AS lifetime_units_sold
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE ${saleWhere.join(" AND ")}
        GROUP BY si.product_id
      )
      SELECT
        p.id,
        p.name,
        p.barcode,
        p.sku,
        p.status,
        p.product_type,
        p.price,
        p.cost_price,
        p.min_qty,
        p.max_qty,
        p.unit,
        p.category_id,
        COALESCE(cat.name, '—') AS category,
        COALESCE(b.name, '—') AS brand,
        COALESCE(sup.name, '—') AS supplier,
        COALESCE(stock.total_stock, 0) AS total_stock,
        COALESCE(stock.outlet_count, 0) AS outlet_count,
        sales.last_sold_at,
        COALESCE(sales.lifetime_units_sold, 0) AS lifetime_units_sold
      FROM products p
      LEFT JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN stock_by_product stock ON stock.product_id = p.id
      LEFT JOIN sale_by_product sales ON sales.product_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.name ASC
    `;

    db.all(sql, [...stockParams, ...saleParams, ...params], async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const categoryMeta = await buildCategoryMetaMap();
      const scoped = withCategoryPaths(rows, categoryMeta).map((row) => {
        const issueTags = [];
        const barcode = String(row.barcode || "").trim();
        const sku = String(row.sku || "").trim();
        const supplier = String(row.supplier || "").trim();
        const category = String(row.category || "").trim();
        const status = String(row.status || "").toLowerCase();
        const totalStock = Number(row.total_stock || 0);
        const minQty = Number(row.min_qty || 0);
        const maxQty = Number(row.max_qty || 0);
        const lastSoldAt = row.last_sold_at ? new Date(row.last_sold_at + "Z") : null;
        const now = new Date();
        const daysSinceSale = lastSoldAt
          ? Math.floor((now.getTime() - lastSoldAt.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        if (!barcode) issueTags.push("missing_barcode");
        if (!sku) issueTags.push("missing_sku");
        if (!supplier || supplier === "—") issueTags.push("missing_supplier");
        if (!category || category === "—" || category === "Uncategorized") {
          issueTags.push("missing_category");
        }
        if (minQty <= 0 && maxQty <= 0) issueTags.push("minmax_unset");
        if (status !== "active" && totalStock > 0) issueTags.push("inactive_with_stock");
        if (totalStock > 0 && (!lastSoldAt || Number(daysSinceSale || 0) >= inactivityDays)) {
          issueTags.push("no_recent_sales");
        }

        return {
          ...row,
          days_since_sale: daysSinceSale,
          issue_tags: issueTags,
          issue_summary: issueTags.join(" | "),
        };
      });

      const summary = scoped.reduce(
        (acc, row) => {
          row.issue_tags.forEach((tag) => {
            acc[tag] = (acc[tag] || 0) + 1;
          });
          return acc;
        },
        {
          missing_barcode: 0,
          missing_sku: 0,
          missing_supplier: 0,
          missing_category: 0,
          minmax_unset: 0,
          inactive_with_stock: 0,
          no_recent_sales: 0,
        },
      );

      const filtered = scoped.filter((row) => {
        if (!row.issue_tags.length) return false;
        if (issue === "all") return true;
        return row.issue_tags.includes(issue);
      });

      res.json({
        rows: filtered,
        summary,
        issue,
        inactivity_days: inactivityDays,
      });
    });
  });

  return { buildForecastRows };
};
