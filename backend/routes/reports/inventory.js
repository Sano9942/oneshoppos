const { toUtcStart, toUtcEnd, isValidTz } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requireFeature, requirePerm } = deps;
  // D4 split (PLAN-V2 Step 4, REPORT-PERMS.md §3.8) — explicit per-domain
  // guard on every route; the /api/reports blanket rule in
  // middleware/permissions.js is only a backstop.
  const invView = requirePerm("view_inventory_reports");
  const financeView = requirePerm("view_financial_reports"); // margin rule: pricing-margin/exceptions
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
        `(${alias}.name ILIKE ? OR COALESCE(${alias}.barcode, '') ILIKE ? OR ${alias}.id::text ILIKE ?)`,
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  // Sales & Stock: product with all-time sales + current stock
  app.get("/api/reports/sales-stock", invView, async (req, res) => {
    try {
      // Stock and sales are totalled in separate CTEs, then joined per product.
      // Joining outlet_stock and sale_items together multiplied every sale by
      // the number of outlet rows, and SUM(DISTINCT os.quantity) collapsed two
      // outlets holding the same quantity into one. Voided bills don't count.
      // Honours the page's outlet, date and time filters (times are in the
      // shop's time zone).
      const { date_from, date_to, time_from, time_to, outlet_id } = req.query;
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
      const stockWhere = [];
      const stockParams = [];
      applyOutletFilter(stockWhere, stockParams, outlet_id, "os.outlet_id");
      const saleWhere = ["s.voided = false"];
      const saleParams = [];
      applyOutletFilter(saleWhere, saleParams, outlet_id, "s.outlet_id");
      if (date_from) { saleWhere.push("s.timestamp >= ?"); saleParams.push(toUtcStart(String(date_from), tz)); }
      if (date_to) { saleWhere.push("s.timestamp < ?"); saleParams.push(toUtcEnd(String(date_to), tz)); }
      if (time_from) { saleWhere.push(`(s.timestamp AT TIME ZONE '${tz}')::time >= ?::time`); saleParams.push(time_from); }
      if (time_to) { saleWhere.push(`(s.timestamp AT TIME ZONE '${tz}')::time <= ?::time`); saleParams.push(time_to); }
      const productWhere = ["p.deleted_at IS NULL"];
      const productParams = [];
      await applyInventoryProductFilters(productWhere, productParams, req.query);

      const stock = helpers.pgWhere(stockWhere, stockParams);
      const sold = helpers.pgWhere(saleWhere, saleParams, stock.nextIdx);
      const prod = helpers.pgWhere(productWhere, productParams, sold.nextIdx);
      const sql = `
      WITH stock AS (
        SELECT os.product_id, SUM(os.quantity) AS total_stock
        FROM outlet_stock os
        ${stock.text ? `WHERE ${stock.text}` : ""}
        GROUP BY os.product_id
      ),
      sold AS (
        SELECT si.product_id,
               SUM(si.quantity) AS units_sold,
               SUM(si.quantity * si.price_at_sale) AS revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE ${sold.text}
        GROUP BY si.product_id
      )
      SELECT p.id, p.name, p.barcode, COALESCE(cat.name,'—') AS category,
             p.category_id,
             COALESCE(stock.total_stock, 0) AS total_stock,
             COALESCE(sold.units_sold, 0) AS units_sold,
             ROUND(COALESCE(sold.revenue, 0), 2) AS revenue
      FROM products p
      LEFT JOIN categories cat ON p.category_id = cat.id
      LEFT JOIN stock ON stock.product_id = p.id
      LEFT JOIN sold ON sold.product_id = p.id
      WHERE ${prod.text}
      ORDER BY units_sold DESC, p.name`;
      const { rows } = await db.query(sql, [...stock.values, ...sold.values, ...prod.values]);
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/reports/inventory-dump:
   *   get:
   *     summary: Inventory dump report
   *     description: Full inventory snapshot — stock per product per outlet. Supports outlet filtering and anomaly detection (negative/zero stock).
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: outlet_id
   *         schema: { type: integer }
   *         description: Filter by outlet
   *       - in: query
   *         name: aggregate
   *         schema: { type: string, enum: ["0", "1"] }
   *         description: Aggregate stock across outlets
   *       - in: query
   *         name: anomaly
   *         schema: { type: string, enum: [negative, zero] }
   *         description: Filter for stock anomalies
   *     responses:
   *       200:
   *         description: Inventory data
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
   *                       outlet_name: { type: string }
   *                       stock: { type: integer }
   *                       cost_price: { type: number }
   *                       stock_value: { type: number }
   *       401:
   *         description: Unauthorized
   */
  // Inventory Dump: stock per product per outlet with full product info
  app.get("/api/reports/inventory-dump", invView, async (req, res) => {
    try {
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
        const { text: whereText, values, nextIdx } = helpers.pgWhere(where, params);
        // Convert HAVING placeholders starting from nextIdx
        let hIdx = nextIdx;
        const havingText = having.join(" AND ").replace(/\?/g, () => `$${hIdx++}`);
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
        ${where.length ? "WHERE " + whereText : ""}
        GROUP BY p.id, p.name, p.barcode, cat.name, p.category_id, b.name, sup.name, p.price, p.cost_price
        ${having.length ? `HAVING ${havingText}` : ""}
        ORDER BY quantity ASC, p.name`;
        const { rows } = await db.query(sql, values);
        const categoryMeta = await buildCategoryMetaMap();
        return res.json({ items: withCategoryPaths(rows, categoryMeta) });
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
      const { text: whereText, values } = helpers.pgWhere(where, params);
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
      ${where.length ? "WHERE " + whereText : ""}
      ORDER BY o.name, os.quantity ASC, p.name`;
      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Product Specification: full product table with all FK names and inventory master context
  app.get("/api/reports/product-spec", invView, async (req, res) => {
    try {
      let where = [];
      const params = [];
      await applyInventoryProductFilters(where, params, req.query);
      const { text: whereText, values } = helpers.pgWhere(where, params);
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
      ${where.length ? "WHERE " + whereText : ""}
      GROUP BY p.id, p.barcode, p.name, p.price, p.cost_price, p.sku, p.status, p.product_type,
               p.min_qty, p.max_qty, p.unit, cat.name, p.category_id, b.name, sup.name, t.name, t.rate, p.gst
      ORDER BY p.name`;
      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // On Hand Inventory: current stock per product per outlet or aggregated across all outlets
  app.get("/api/reports/on-hand", invView, async (req, res) => {
    try {
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
        const { text: whereText, values, nextIdx } = helpers.pgWhere(where, params);
        let hIdx = nextIdx;
        const havingText = having.join(" AND ").replace(/\?/g, () => `$${hIdx++}`);
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
        ${where.length ? "WHERE " + whereText : ""}
        GROUP BY p.id, p.name, p.barcode, cat.name, b.name, sup.name, p.price, p.cost_price
        ${having.length ? `HAVING ${havingText}` : ""}
        ORDER BY quantity ASC, p.name`;
        const { rows } = await db.query(sql, values);
        const categoryMeta = await buildCategoryMetaMap();
        return res.json({ items: withCategoryPaths(rows, categoryMeta) });
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
      const { text: whereText, values } = helpers.pgWhere(where, params);
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
      ${where.length ? "WHERE " + whereText : ""}
      ORDER BY os.quantity ASC, p.name, o.name`;
      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      res.json({ items: withCategoryPaths(rows, categoryMeta) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // One Toy Store G1: stock value grouped by supplier / category (top level) /
  // sub-category (the toy's own category) / brand, like iPOS's PSP summaries.
  // A toy counts when its units in the chosen branches are not zero.
  const STOCK_VALUE_GROUPS = {
    supplier: { name: "COALESCE(sup.name, 'No supplier')", parent: "NULL" },
    brand: { name: "COALESCE(b.name, 'No brand')", parent: "NULL" },
    category: { name: "COALESCE(root.name, 'No category')", parent: "NULL" },
    subcategory: { name: "COALESCE(c.name, 'No category')", parent: "par.name" },
  };
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const pct = (part, whole) => (Number(whole) ? round2((Number(part) * 100) / Number(whole)) : 0);

  app.get("/api/reports/stock-value-summary", invView, async (req, res) => {
    try {
      const group = STOCK_VALUE_GROUPS[String(req.query.group_by || "")];
      if (!group) return res.status(400).json({ error: "group_by must be supplier, category, subcategory or brand" });
      const where = [];
      const params = [];
      applyOutletFilter(where, params, req.query.outlet_id);
      const { text: whereText, values } = helpers.pgWhere(where, params);
      const { rows } = await db.query(
        `WITH RECURSIVE tree AS (
           SELECT id, id AS root_id FROM categories WHERE parent_id IS NULL
           UNION ALL
           SELECT ch.id, t.root_id FROM categories ch JOIN tree t ON ch.parent_id = t.id
         ),
         stock AS (
           SELECT os.product_id, SUM(os.quantity) AS q
             FROM outlet_stock os
             ${where.length ? "WHERE " + whereText : ""}
            GROUP BY os.product_id
           HAVING SUM(os.quantity) <> 0
         )
         SELECT ${group.name} AS name, ${group.parent} AS parent,
                COUNT(*)::int AS toys, SUM(s.q) AS units,
                SUM(s.q * COALESCE(p.cost_price, 0)) AS cost_value,
                SUM(s.q * COALESCE(p.price, 0)) AS retail_value
           FROM stock s
           JOIN products p ON p.id = s.product_id
           LEFT JOIN suppliers sup ON sup.id = p.supplier_id
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN categories par ON par.id = c.parent_id
           LEFT JOIN tree t ON t.id = p.category_id
           LEFT JOIN categories root ON root.id = t.root_id
          GROUP BY 1, 2
          ORDER BY cost_value DESC, name`,
        values
      );
      const totals = rows.reduce(
        (t, r) => ({
          toys: t.toys + Number(r.toys),
          units: round2(t.units + Number(r.units)),
          cost_value: round2(t.cost_value + Number(r.cost_value)),
          retail_value: round2(t.retail_value + Number(r.retail_value)),
        }),
        { toys: 0, units: 0, cost_value: 0, retail_value: 0 }
      );
      totals.margin_pct = pct(totals.retail_value - totals.cost_value, totals.retail_value);
      res.json({
        group_by: req.query.group_by,
        rows: rows.map((r) => ({
          name: r.name,
          parent: r.parent,
          toys: Number(r.toys),
          units: round2(r.units),
          cost_value: round2(r.cost_value),
          retail_value: round2(r.retail_value),
          margin_pct: pct(Number(r.retail_value) - Number(r.cost_value), r.retail_value),
          share_pct: pct(r.cost_value, totals.cost_value),
        })),
        totals,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Inventory Loss: stock adjustments with negative quantity
  app.get("/api/reports/inventory-loss", invView, async (req, res) => {
    try {
      const { date_from, date_to } = req.query;
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
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
      const { text: whereText, values } = helpers.pgWhere(where, params);
      const sql = `
      SELECT sa.timestamp, p.name AS product_name, p.barcode,
             o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
             sa.quantity_change, sa.reason
      FROM stock_adjustments sa
      JOIN products p ON sa.product_id = p.id
      JOIN outlets o ON sa.outlet_id = o.id
      LEFT JOIN employees e ON sa.employee_id = e.id
      WHERE ${whereText}
      ORDER BY sa.timestamp DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Wastage: stock adjustments for Damaged or Expired reasons
  app.get("/api/reports/wastage", invView, async (req, res) => {
    try {
      const { date_from, date_to } = req.query;
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
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
      const { text: whereText, values } = helpers.pgWhere(where, params);
      const sql = `
      SELECT sa.timestamp, p.name AS product_name, p.barcode,
             o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
             sa.quantity_change, sa.reason
      FROM stock_adjustments sa
      JOIN products p ON sa.product_id = p.id
      JOIN outlets o ON sa.outlet_id = o.id
      LEFT JOIN employees e ON sa.employee_id = e.id
      WHERE ${whereText}
      ORDER BY sa.timestamp DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Replenishment: products at or below threshold per outlet
  app.get("/api/reports/replenishment", invView, async (req, res) => {
    try {
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
      WHERE os.quantity <= $1
      ORDER BY supplier_name ASC, os.quantity ASC, p.name ASC`;
      const { rows } = await db.query(sql, [threshold]);
      res.json({ items: rows, threshold });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pricing Exceptions: price, cost, and margin-risk views by product/outlet or aggregated across all outlets
  app.get("/api/reports/pricing-exceptions", financeView, async (req, res) => {
    try {
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
        const { text: whereText, values, nextIdx } = helpers.pgWhere(where, aggregateParams);
        let hIdx = nextIdx;
        const havingText = having.join(" AND ").replace(/\?/g, () => `$${hIdx++}`);
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
        ${where.length ? "WHERE " + whereText : ""}
        GROUP BY p.id, p.name, p.barcode, cat.name, b.name, sup.name, p.price, p.cost_price
        ${having.length ? `HAVING ${havingText}` : ""}
        ORDER BY margin_pct ASC, p.name`;
        const { rows } = await db.query(sql, values);
        const categoryMeta = await buildCategoryMetaMap();
        return res.json({
          items: withCategoryPaths(rows, categoryMeta),
          margin_threshold: marginThreshold,
        });
      }

      const detailedWhere = [...where, ...buildConditions()];
      if (anomaly === "margin_risk") params.push(marginThreshold);
      const { text: whereText, values } = helpers.pgWhere(detailedWhere, params);
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
      ${detailedWhere.length ? "WHERE " + whereText : ""}
      ORDER BY margin_pct ASC, p.name, o.name`;
      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      res.json({
        items: withCategoryPaths(rows, categoryMeta),
        margin_threshold: marginThreshold,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pricing Margin: all products with cost vs sell price and margin analysis
  app.get("/api/reports/pricing-margin", financeView, async (req, res) => {
    try {
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
      const { text: whereText, values } = helpers.pgWhere(where, params);
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
        ${where.length ? "WHERE " + whereText : ""}
        ORDER BY margin_pct ASC, p.name ASC
      `;
      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows || [], categoryMeta);
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dead Stock (ungated): products with zero sales in last N days (default 90)
  app.get("/api/reports/dead-stock", invView, async (req, res) => {
    try {
      const inactiveDays = Math.max(
        1,
        Math.min(3650, parseInt(req.query.inactive_days || 90, 10)),
      );
      const where = ["os.quantity > 0", "p.deleted_at IS NULL"];
      const params = [];
      applyOutletFilter(where, params, req.query.outlet_id);
      await applyInventoryProductFilters(where, params, req.query);
      const { text: whereText, values, nextIdx } = helpers.pgWhere(where, params);
      // One row per product per outlet. The last sale is looked up per outlet
      // in its own CTE: joining sale_items straight onto outlet_stock repeated
      // each stock row once per past sale line, multiplying stock and value.
      // An item that never sold is aged from when the product was created, so
      // yesterday's new arrival isn't "dead". Old field names (current_stock,
      // cost_value, last_sold_date, days_since_sold) are kept alongside the
      // ones the Dead Stock page reads.
      const sql = `
        WITH last_sale AS (
          SELECT si.product_id, s.outlet_id, MAX(s.timestamp) AS last_sold
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id AND s.voided = false
           GROUP BY si.product_id, s.outlet_id
        )
        SELECT * FROM (
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.sku,
            p.barcode,
            p.category_id,
            COALESCE(cat.name, '-') AS category,
            COALESCE(b.name, '-') AS brand,
            COALESCE(sup.name, '-') AS supplier,
            o.id AS outlet_id,
            o.name AS outlet_name,
            os.quantity AS stock_qty,
            os.quantity AS current_stock,
            ls.last_sold AS last_sold_at,
            ls.last_sold AS last_sold_date,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ls.last_sold, p.created_at))) / 86400.0)::int AS days_since_sale,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - ls.last_sold)) / 86400.0)::int AS days_since_sold,
            ROUND(os.quantity * COALESCE(p.cost_price, 0), 2) AS stock_cost_value,
            ROUND(os.quantity * COALESCE(p.cost_price, 0), 2) AS cost_value,
            ROUND(os.quantity * COALESCE(p.price, 0), 2) AS stock_retail_value
          FROM outlet_stock os
          JOIN products p ON p.id = os.product_id
          JOIN outlets o ON o.id = os.outlet_id
          LEFT JOIN categories cat ON cat.id = p.category_id
          LEFT JOIN brands b ON b.id = p.brand_id
          LEFT JOIN suppliers sup ON sup.id = p.supplier_id
          LEFT JOIN last_sale ls ON ls.product_id = os.product_id AND ls.outlet_id = os.outlet_id
          WHERE ${whereText}
        ) dead
        WHERE COALESCE(days_since_sale, 99999) >= $${nextIdx}
        ORDER BY stock_cost_value DESC
        LIMIT 500
      `;
      const { rows } = await db.query(sql, [...values, inactiveDays]);
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows || [], categoryMeta);
      res.json({ items, inactive_days: inactiveDays });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Forecast Demand (ungated): avg daily sales over lookback window per product
  app.get("/api/reports/forecast-demand", invView, async (req, res) => {
    try {
      const { rows, lookbackDays } = await buildForecastRows(req.query || {}, req.company?.timezone || "UTC");
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows, categoryMeta);
      res.json({
        items,
        rows: items,
        lookback_days: lookbackDays,
        formula: "moving_average_daily_velocity",
        data_as_of: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Replenishment Smart (ungated): days_of_cover < 14, sorted by urgency ASC
  app.get("/api/reports/replenishment-smart", invView, async (req, res) => {
    try {
      const forecastDays = Math.max(
        7,
        Math.min(90, parseInt(req.query.forecast_days || 14, 10)),
      );
      const { rows, lookbackDays } = await buildForecastRows(req.query || {}, req.company?.timezone || "UTC");
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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // NOTE: The /api/reports/stock-aging route lives in reports/stock-aging.js
  // (Wave 3, ungated — requireAnyPerm(["view_inventory_reports","manage_inventory"])).
  // A shadowing gated duplicate previously lived here and, being registered
  // first in reports/index.js, prevented the real implementation from serving.
  // Removed in completion-00 so the ungated report reaches every tenant.

  async function buildForecastRows(filters, tz) {
    const lookbackDays = Math.max(
      7,
      Math.min(
        365,
        parseInt(filters.lookback_days || filters.lookbackDays || 28, 10),
      ),
    );
    const lookbackDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - lookbackDays * 24 * 3600 * 1000));
    const where = [
      "s.voided = false",
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
        "(p.name ILIKE ? OR COALESCE(p.barcode,'') ILIKE ? OR p.id::text ILIKE ?)",
      );
      whereParams.push(
        `%${filters.search}%`,
        `%${filters.search}%`,
        `%${filters.search}%`,
      );
    }
    // Prepend the 4 lookbackDays params, then dynamic where params
    const prependParams = [lookbackDays, lookbackDays, lookbackDays, lookbackDays];
    const allParams = [...prependParams, ...whereParams];
    const { text: whereText, values } = helpers.pgWhere(where, allParams, prependParams.length + 1);
    const sql = `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.barcode,
        o.id AS outlet_id,
        o.name AS outlet_name,
        COALESCE(SUM(si.quantity), 0) AS units_lookback,
        ROUND(COALESCE(SUM(si.quantity), 0) * 1.0 / $1, 4) AS avg_daily_units,
        COALESCE(os.quantity, 0) AS on_hand_qty,
        ROUND((COALESCE(SUM(si.quantity), 0) * 1.0 / $2) * 7, 2) AS forecast_7d_units,
        ROUND((COALESCE(SUM(si.quantity), 0) * 1.0 / $3) * 14, 2) AS forecast_14d_units,
        ROUND(
          CASE WHEN COALESCE(SUM(si.quantity), 0) > 0
            THEN COALESCE(os.quantity, 0) / (COALESCE(SUM(si.quantity), 0) * 1.0 / $4)
            ELSE NULL
          END, 2
        ) AS days_of_cover
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      JOIN outlets o ON o.id = s.outlet_id
      LEFT JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = o.id
      WHERE ${whereText}
      GROUP BY p.id, p.name, p.barcode, o.id, o.name, os.quantity
      ORDER BY avg_daily_units DESC
      LIMIT 1000
    `;
    const { rows } = await db.query(sql, values);
    return { rows: rows || [], lookbackDays };
  }

  // Stockout Risk
  app.get(
    "/api/reports/stockout-risk",
    requireFeature("reports_inventory_health_plus"),
    invView,
    async (req, res) => {
      try {
        const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
        const lookbackDays = Math.max(
          7,
          Math.min(365, parseInt(req.query.lookback_days || 30, 10)),
        );
        const lookbackDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - lookbackDays * 24 * 3600 * 1000));
        const lookbackStart = toUtcStart(lookbackDateStr, tz);
        const where = ["os.quantity > 0"];
        // Prepend: lookbackStart for CTE, then 4x lookbackDays for calculations
        const prependParams = [lookbackStart, lookbackDays, lookbackDays, lookbackDays, lookbackDays];
        const dynamicParams = [];
        applyOutletFilter(where, dynamicParams, req.query.outlet_id);
        await applyInventoryProductFilters(where, dynamicParams, req.query);
        const allParams = [...prependParams, ...dynamicParams];
        const { text: whereText, values } = helpers.pgWhere(where, allParams, prependParams.length + 1);
        // Wrapped so ORDER BY can use risk_level: Postgres only resolves an
        // output alias in ORDER BY when it stands alone, not inside a CASE.
        const sql = `
        SELECT * FROM (
        WITH sales_velocity AS (
          SELECT
            si.product_id,
            s.outlet_id,
            SUM(si.quantity) AS units_sold
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE s.voided = false
            AND s.timestamp >= $1
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
          ROUND(COALESCE(v.units_sold, 0) * 1.0 / $2, 4) AS avg_daily_units,
          ROUND(
            CASE WHEN COALESCE(v.units_sold, 0) > 0
              THEN os.quantity / (COALESCE(v.units_sold, 0) * 1.0 / $3)
              ELSE NULL
            END, 2
          ) AS days_of_cover,
          CASE
            WHEN COALESCE(v.units_sold, 0) = 0 THEN 'stable'
            WHEN (os.quantity / (COALESCE(v.units_sold, 0) * 1.0 / $4)) < 7 THEN 'high'
            WHEN (os.quantity / (COALESCE(v.units_sold, 0) * 1.0 / $5)) < 14 THEN 'medium'
            ELSE 'stable'
          END AS risk_level
        FROM outlet_stock os
        JOIN products p ON p.id = os.product_id
        JOIN outlets o ON o.id = os.outlet_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN suppliers sup ON sup.id = p.supplier_id
        LEFT JOIN sales_velocity v ON v.product_id = os.product_id AND v.outlet_id = os.outlet_id
        WHERE ${whereText}
        ) risk
        ORDER BY
          CASE risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
          days_of_cover ASC
        LIMIT 500
      `;
        const { rows } = await db.query(sql, values);
        const categoryMeta = await buildCategoryMetaMap();
        const items = withCategoryPaths(rows, categoryMeta);
        res.json({ items, rows: items, lookback_days: lookbackDays });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Product Movement (Inter-Outlet Transfers)
  app.get("/api/reports/product-movement", invView, async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
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
      const { text: whereText, values } = helpers.pgWhere(where, params);
      const sql = `
      SELECT it.timestamp, p.name AS product_name, p.barcode,
             fo.name AS from_outlet_name, to_o.name AS to_outlet_name,
             it.quantity, COALESCE(e.name, 'System') AS employee_name
      FROM inventory_transfers it
      JOIN products p ON it.product_id = p.id
      JOIN outlets fo ON it.from_outlet_id = fo.id
      JOIN outlets to_o ON it.to_outlet_id = to_o.id
      LEFT JOIN employees e ON it.employee_id = e.id
      ${where.length ? "WHERE " + whereText : ""}
      ORDER BY it.timestamp DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // STR Report (Stock Transfer Register - functionally similar to product movement but used as a formal register)
  app.get("/api/reports/str-report", invView, async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
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
      const { text: whereText, values } = helpers.pgWhere(where, params);
      const sql = `
      SELECT it.timestamp, it.id as reference_id,
             fo.name AS from_outlet_name, to_o.name AS to_outlet_name,
             SUM(it.quantity) as quantity
      FROM inventory_transfers it
      JOIN outlets fo ON it.from_outlet_id = fo.id
      JOIN outlets to_o ON it.to_outlet_id = to_o.id
      ${where.length ? "WHERE " + whereText : ""}
      GROUP BY it.timestamp, it.id, fo.name, to_o.name
      ORDER BY it.timestamp DESC`;
      const { rows } = await db.query(sql, values);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GRN Report: Historical log of stock receipts from suppliers
  app.get("/api/reports/grn-report", invView, async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      let where = [];
      const params = [];

      // received_at is TIMESTAMPTZ — tenant-tz UTC bounds and tz-aware day
      // bucketing, not bare ::date casts (which use the DB session timezone).
      // tz inline-literal'd after isValidTz validation (same pattern as the
      // dashboard trend queries).
      const { isValidTz } = require("../../utils/tz");
      const grnTz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
      if (date_from) {
        where.push("grn.received_at >= ?");
        params.push(toUtcStart(String(date_from), grnTz));
      }
      if (date_to) {
        where.push("grn.received_at < ?");
        params.push(toUtcEnd(String(date_to), grnTz));
      }
      applyOutletFilter(where, params, outlet_id, "grn.outlet_id");
      const { text: whereText, values } = helpers.pgWhere(where, params);

      const sql = `
        SELECT (grn.received_at AT TIME ZONE '${grnTz}')::date as date, p.name as product_name,
               s.name as supplier_name, gi.qty_received AS quantity, gi.cost_price
        FROM goods_received_notes grn
        JOIN purchase_orders po ON grn.po_id = po.id
        JOIN grn_items gi ON gi.grn_id = grn.id
        JOIN products p ON gi.product_id = p.id
        JOIN suppliers s ON po.supplier_id = s.id
        ${where.length ? "WHERE " + whereText : ""}
        ORDER BY grn.received_at DESC`;

      const { rows } = await db.query(sql, values);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // History Cost: GRN-level purchase cost history by product
  app.get("/api/reports/history-cost", invView, async (req, res) => {
    try {
      let where = [];
      const params = [];
      await applyInventoryProductFilters(where, params, req.query);

      // received_at is TIMESTAMPTZ — tenant-tz UTC bounds, not bare ::date.
      const hcTz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
      if (req.query.date_from) {
        where.push("grn.received_at >= ?");
        params.push(toUtcStart(String(req.query.date_from), hcTz));
      }
      if (req.query.date_to) {
        where.push("grn.received_at < ?");
        params.push(toUtcEnd(String(req.query.date_to), hcTz));
      }
      if (req.query.time_from) {
        where.push(`(grn.received_at AT TIME ZONE '${hcTz}')::time >= ?::time`);
        params.push(req.query.time_from);
      }
      if (req.query.time_to) {
        where.push(`(grn.received_at AT TIME ZONE '${hcTz}')::time <= ?::time`);
        params.push(req.query.time_to);
      }
      applyOutletFilter(where, params, req.query.outlet_id, "grn.outlet_id");
      const { text: whereText, values } = helpers.pgWhere(where, params);

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
        ${where.length ? `WHERE ${whereText}` : ""}
        ORDER BY grn.received_at DESC, p.name ASC
        LIMIT 500
      `;

      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows, categoryMeta);
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // History Sale: sale-line history by product with realized sell/cost
  app.get("/api/reports/history-sale", invView, async (req, res) => {
    try {
      let where = ["s.voided = false", "si.quantity > 0"];
      const params = [];
      await applyInventoryProductFilters(where, params, req.query);

      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
      if (req.query.date_from) {
        where.push("s.timestamp >= ?");
        params.push(toUtcStart(req.query.date_from, tz));
      }
      if (req.query.date_to) {
        where.push("s.timestamp < ?");
        params.push(toUtcEnd(req.query.date_to, tz));
      }
      if (req.query.time_from) {
        where.push(`(s.timestamp AT TIME ZONE '${tz}')::time >= ?::time`);
        params.push(req.query.time_from);
      }
      if (req.query.time_to) {
        where.push(`(s.timestamp AT TIME ZONE '${tz}')::time <= ?::time`);
        params.push(req.query.time_to);
      }
      applyOutletFilter(where, params, req.query.outlet_id, "s.outlet_id");
      if (req.query.employee_id) {
        where.push("s.employee_id = ?");
        params.push(req.query.employee_id);
      }
      const { text: whereText, values } = helpers.pgWhere(where, params);

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
        WHERE ${whereText}
        ORDER BY s.timestamp DESC, p.name ASC
        LIMIT 500
      `;

      const { rows } = await db.query(sql, values);
      const categoryMeta = await buildCategoryMetaMap();
      const items = withCategoryPaths(rows, categoryMeta);
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Product Audit: master-data and reference utility checks from the live schema
  app.get("/api/reports/product-audit", invView, async (req, res) => {
    try {
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
      const saleWhere = ["s.voided = false"];
      const saleParams = [];

      applyOutletFilter(stockWhere, stockParams, req.query.outlet_id);
      applyOutletFilter(saleWhere, saleParams, req.query.outlet_id, "s.outlet_id");

      // Build numbered params for the 3 separate param groups (stock CTE, sale CTE, main WHERE)
      // Stock CTE params come first
      let idx = 1;
      const stockWhereText = stockWhere.join(" AND ").replace(/\?/g, () => `$${idx++}`);
      // Sale CTE params next
      const saleWhereText = saleWhere.join(" AND ").replace(/\?/g, () => `$${idx++}`);
      // Main WHERE params last
      const mainWhereText = where.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
        WITH stock_by_product AS (
          SELECT
            os.product_id,
            COALESCE(SUM(os.quantity), 0) AS total_stock,
            COUNT(DISTINCT os.outlet_id) AS outlet_count
          FROM outlet_stock os
          ${stockWhere.length ? `WHERE ${stockWhereText}` : ""}
          GROUP BY os.product_id
        ),
        sale_by_product AS (
          SELECT
            si.product_id,
            MAX(s.timestamp) AS last_sold_at,
            COALESCE(SUM(si.quantity), 0) AS lifetime_units_sold
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE ${saleWhereText}
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
        ${where.length ? `WHERE ${mainWhereText}` : ""}
        ORDER BY p.name ASC
      `;

      const allValues = [...stockParams, ...saleParams, ...params];
      const { rows } = await db.query(sql, allValues);

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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Shrinkage / Stock Discrepancy Report -----------------------------------
  app.get("/api/reports/shrinkage", invView, async (req, res) => {
    try {
      const tz = isValidTz(req.company?.timezone) ? req.company.timezone : "UTC";
      const { outlet_id, category_id, search } = req.query;
      // Default to last 30 days if not provided
      const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      const thirtyDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 24 * 3600 * 1000));
      const date_from = req.query.date_from || thirtyDaysAgoStr;
      const date_to = req.query.date_to || todayStr;

      const utcStart = toUtcStart(date_from, tz);
      const utcEnd = toUtcEnd(date_to, tz);

      const where = ["p.deleted_at IS NULL"];
      const filterParams = [];

      applyOutletFilter(where, filterParams, outlet_id, "os.outlet_id");
      await applyInventoryProductFilters(where, filterParams, { category_id, search }, "p");

      // 6 date-range param sets come first as $1-$12, then dynamic WHERE params follow
      const dateParams = [
        utcStart, utcEnd,   // sales
        utcStart, utcEnd,   // returns
        utcStart, utcEnd,   // grn (received_at is TIMESTAMPTZ like the rest)
        utcStart, utcEnd,   // adjustments
        utcStart, utcEnd,   // transfers in
        utcStart, utcEnd,   // transfers out
      ];

      const allParams = [...dateParams, ...filterParams];
      // WHERE params start at $13
      const { text: whereText, values } = helpers.pgWhere(where, allParams, dateParams.length + 1);

      const sql = `
        SELECT
          p.id, p.name, p.barcode, p.sku, COALESCE(p.cost_price, 0) AS cost_price,
          os.outlet_id, o.name AS outlet_name,
          os.quantity AS actual_qty,
          COALESCE(sales_sub.qty, 0) AS sales_qty,
          COALESCE(returns_sub.qty, 0) AS returns_qty,
          COALESCE(scrapped_sub.qty, 0) AS scrapped_qty,
          COALESCE(grn_sub.qty, 0) AS purchases_qty,
          COALESCE(adj_sub.qty, 0) AS adjustments_qty,
          COALESCE(tin_sub.qty, 0) AS transfers_in,
          COALESCE(tout_sub.qty, 0) AS transfers_out
        FROM outlet_stock os
        JOIN products p ON p.id = os.product_id
        JOIN outlets o ON o.id = os.outlet_id
        LEFT JOIN (
          SELECT si.product_id, s.outlet_id, SUM(si.quantity) AS qty
          FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.timestamp >= $1 AND s.timestamp < $2
          GROUP BY si.product_id, s.outlet_id
        ) sales_sub ON sales_sub.product_id = p.id AND sales_sub.outlet_id = os.outlet_id
        LEFT JOIN (
          -- 2-G.7: restocked returns only. IS NOT FALSE catches legacy NULL
          -- rows (pre-v68), treating them as restocked by default.
          SELECT ri.product_id, r.outlet_id, SUM(ri.quantity) AS qty
          FROM return_items ri JOIN returns r ON r.id = ri.return_id
          WHERE r.timestamp >= $3 AND r.timestamp < $4
            AND ri.restock_flag IS NOT FALSE
          GROUP BY ri.product_id, r.outlet_id
        ) returns_sub ON returns_sub.product_id = p.id AND returns_sub.outlet_id = os.outlet_id
        LEFT JOIN (
          -- 2-G.7: scrapped units logged on return_items but never pushed
          -- back into outlet_stock. Separate shrink vector in variance summary.
          SELECT ri.product_id, r.outlet_id, SUM(ri.quantity) AS qty
          FROM return_items ri JOIN returns r ON r.id = ri.return_id
          WHERE r.timestamp >= $3 AND r.timestamp < $4
            AND ri.restock_flag = FALSE
          GROUP BY ri.product_id, r.outlet_id
        ) scrapped_sub ON scrapped_sub.product_id = p.id AND scrapped_sub.outlet_id = os.outlet_id
        LEFT JOIN (
          SELECT gi.product_id, g.outlet_id, SUM(gi.qty_received) AS qty
          FROM grn_items gi JOIN goods_received_notes g ON g.id = gi.grn_id
          WHERE g.received_at >= $5 AND g.received_at < $6
          GROUP BY gi.product_id, g.outlet_id
        ) grn_sub ON grn_sub.product_id = p.id AND grn_sub.outlet_id = os.outlet_id
        LEFT JOIN (
          SELECT product_id, outlet_id, SUM(quantity_change) AS qty
          FROM stock_adjustments
          WHERE timestamp >= $7 AND timestamp < $8
          GROUP BY product_id, outlet_id
        ) adj_sub ON adj_sub.product_id = p.id AND adj_sub.outlet_id = os.outlet_id
        LEFT JOIN (
          SELECT product_id, to_outlet_id AS outlet_id, SUM(quantity) AS qty
          FROM inventory_transfers
          WHERE timestamp >= $9 AND timestamp < $10
          GROUP BY product_id, to_outlet_id
        ) tin_sub ON tin_sub.product_id = p.id AND tin_sub.outlet_id = os.outlet_id
        LEFT JOIN (
          SELECT product_id, from_outlet_id AS outlet_id, SUM(quantity) AS qty
          FROM inventory_transfers
          WHERE timestamp >= $11 AND timestamp < $12
          GROUP BY product_id, from_outlet_id
        ) tout_sub ON tout_sub.product_id = p.id AND tout_sub.outlet_id = os.outlet_id
        WHERE ${whereText}
        ORDER BY p.name, o.name
      `;

      const { rows } = await db.query(sql, values);

      // Calculate opening, expected, variance for each row
      const enriched = rows.map((r) => {
        const actual = Number(r.actual_qty || 0);
        const sales = Number(r.sales_qty || 0);
        // 2-G.7: `returns` now means restocked returns only. Scrapped units
        // are a separate shrink vector — they were returned by the customer
        // but the tenant chose NOT to re-shelf, so they never touched
        // outlet_stock and must not participate in the balance equation.
        const returns = Number(r.returns_qty || 0);
        const scrapped = Number(r.scrapped_qty || 0);
        const purchases = Number(r.purchases_qty || 0);
        const adjustments = Number(r.adjustments_qty || 0);
        const tIn = Number(r.transfers_in || 0);
        const tOut = Number(r.transfers_out || 0);

        // opening = actual - (all additions) + (all deductions)
        const opening = actual - purchases - returns - tIn + sales + tOut - adjustments;
        // expected = opening + additions - deductions
        const expected = opening + purchases + returns + tIn - sales - tOut + adjustments;
        // variance = actual - expected (will be 0 unless rounding or untracked movements)
        const variance = actual - expected;
        const cost = Number(r.cost_price || 0);
        const variance_value = variance * cost;
        // scrapped units are an independent shrink signal. Valued at cost for
        // the dashboard rollup.
        const scrapped_value = scrapped * cost;

        return {
          product_id: r.id,
          product_name: r.name,
          barcode: r.barcode,
          sku: r.sku,
          cost_price: cost,
          outlet_id: r.outlet_id,
          outlet_name: r.outlet_name,
          opening,
          purchases,
          sales,
          returns,
          scrapped,
          transfers_in: tIn,
          transfers_out: tOut,
          adjustments,
          expected,
          actual,
          variance,
          variance_value,
          scrapped_value,
        };
      });

      const summary = {
        total_products: enriched.length,
        total_variance_value: enriched.reduce((sum, r) => sum + r.variance_value, 0),
        total_shrinkage_units: enriched.reduce((sum, r) => sum + (r.variance < 0 ? Math.abs(r.variance) : 0), 0),
        total_scrapped_units: enriched.reduce((sum, r) => sum + r.scrapped, 0),
        total_scrapped_value: enriched.reduce((sum, r) => sum + r.scrapped_value, 0),
        rows_with_variance: enriched.filter((r) => r.variance !== 0).length,
      };

      res.json({ rows: enriched, summary });
    } catch (err) {
      console.error("shrinkage report error:", err);
      res.status(500).json({ error: "Failed to generate shrinkage report" });
    }
  });

  return { buildForecastRows };
};
