// Available datasets — curated, not arbitrary SQL
const DATASETS = {
  sales_summary: {
    label: "Sales Summary",
    dimensions: ["date", "outlet", "employee", "payment_method", "customer"],
    measures: ["total_amount", "discount_amount", "sale_count", "item_count", "avg_bill"],
    base_table: "sales",
  },
  product_performance: {
    label: "Product Performance",
    dimensions: ["product", "category", "brand", "outlet", "date"],
    measures: ["quantity_sold", "revenue", "cost", "margin", "margin_percent"],
    base_table: "sale_items",
  },
  inventory_snapshot: {
    label: "Inventory Snapshot",
    dimensions: ["product", "category", "brand", "outlet"],
    measures: ["stock_on_hand", "stock_value", "reorder_point", "days_of_supply"],
    base_table: "products",
  },
  customer_analysis: {
    label: "Customer Analysis",
    dimensions: ["customer", "customer_group", "date", "outlet"],
    measures: ["total_spent", "visit_count", "avg_order_value", "points_balance"],
    base_table: "customers",
  },
  employee_performance: {
    label: "Employee Performance",
    dimensions: ["employee", "outlet", "date", "role"],
    measures: ["sale_count", "total_revenue", "avg_bill", "items_sold", "discount_given", "commission_earned"],
    base_table: "sales",
  },
};

// Build SQL from dataset + dimensions + measures + filters
function buildQuery(dataset, dimensions, measures, filters, sortBy, sortOrder) {
  const ds = DATASETS[dataset];
  if (!ds) throw new Error("Unknown dataset");

  for (const d of dimensions) {
    if (!ds.dimensions.includes(d)) throw new Error(`Invalid dimension: ${d}`);
  }
  for (const m of measures) {
    if (!ds.measures.includes(m)) throw new Error(`Invalid measure: ${m}`);
  }

  let selectCols = [];
  let groupCols = [];
  let whereConditions = ["1=1"];
  const params = [];
  let idx = 1;

  const dimMap = {
    date: { col: "s.timestamp::date", alias: "date", group: "s.timestamp::date" },
    outlet: { col: "o.name", alias: "outlet", join: "JOIN outlets o ON o.id = s.outlet_id", group: "o.name" },
    employee: { col: "e.name", alias: "employee", join: "JOIN employees e ON e.id = s.employee_id", group: "e.name" },
    payment_method: { col: "s.payment_method", alias: "payment_method", group: "s.payment_method" },
    customer: { col: "c.name", alias: "customer", join: "LEFT JOIN customers c ON c.id = s.customer_id", group: "c.name" },
    product: { col: "p.name", alias: "product", join: "JOIN products p ON p.id = si.product_id", group: "p.name" },
    category: { col: "cat.name", alias: "category", join: "LEFT JOIN categories cat ON cat.id = p.category_id", group: "cat.name" },
    brand: { col: "b.name", alias: "brand", join: "LEFT JOIN brands b ON b.id = p.brand_id", group: "b.name" },
    customer_group: { col: "cg.name", alias: "customer_group", join: "LEFT JOIN customer_groups cg ON cg.id = c.group_id", group: "cg.name" },
    role: { col: "e.role", alias: "role", group: "e.role" },
  };

  const measureMap = {
    total_amount: "SUM(s.total_amount)",
    discount_amount: "SUM(s.discount_amount)",
    sale_count: "COUNT(DISTINCT s.id)",
    item_count: "SUM(si.quantity)",
    avg_bill: "ROUND(AVG(s.total_amount)::numeric, 2)",
    quantity_sold: "SUM(si.quantity)",
    revenue: "SUM(si.price_at_sale * si.quantity)",
    cost: "SUM(si.cost_price_at_sale * si.quantity)",
    margin: "SUM((si.price_at_sale - si.cost_price_at_sale) * si.quantity)",
    margin_percent: "ROUND(CASE WHEN SUM(si.price_at_sale * si.quantity) = 0 THEN 0 ELSE SUM((si.price_at_sale - si.cost_price_at_sale) * si.quantity) * 100.0 / SUM(si.price_at_sale * si.quantity) END::numeric, 2)",
    total_spent: "SUM(s.total_amount)",
    visit_count: "COUNT(DISTINCT s.id)",
    avg_order_value: "ROUND(AVG(s.total_amount)::numeric, 2)",
    points_balance: "SUM(c.loyalty_points)",
    stock_on_hand: "SUM(p.stock)",
    stock_value: "SUM(p.stock * p.cost_price)",
    reorder_point: "SUM(p.min_qty)",
    days_of_supply: "0",
    items_sold: "SUM(si.quantity)",
    discount_given: "SUM(s.discount_amount)",
    commission_earned: "COALESCE(SUM(ce.commission_amount), 0)",
    total_revenue: "SUM(s.total_amount)",
  };

  const joinSet = new Set();
  for (const d of dimensions) {
    const dm = dimMap[d];
    if (!dm) continue;
    selectCols.push(`${dm.col} AS ${dm.alias}`);
    groupCols.push(dm.group);
    if (dm.join) joinSet.add(dm.join);
  }

  for (const m of measures) {
    const expr = measureMap[m];
    if (!expr) continue;
    selectCols.push(`${expr} AS ${m}`);
  }

  if (measures.some(m => ["quantity_sold", "revenue", "cost", "margin", "margin_percent", "item_count", "items_sold"].includes(m))) {
    if (ds.base_table === "sales") joinSet.add("JOIN sale_items si ON si.sale_id = s.id");
  }
  if (measures.includes("commission_earned")) {
    joinSet.add("LEFT JOIN commission_earnings ce ON ce.sale_id = s.id AND ce.status != 'reversed'");
  }

  let fromClause;
  if (ds.base_table === "sales") {
    fromClause = "sales s";
    whereConditions.push("s.voided = FALSE");
  } else if (ds.base_table === "sale_items") {
    fromClause = "sale_items si JOIN sales s ON s.id = si.sale_id";
    whereConditions.push("s.voided = FALSE");
  } else if (ds.base_table === "products") {
    fromClause = "products p";
    whereConditions.push("p.deleted_at IS NULL");
  } else if (ds.base_table === "customers") {
    fromClause = "customers c JOIN sales s ON s.customer_id = c.id";
    whereConditions.push("s.voided = FALSE");
  }

  if (filters) {
    const parsed = typeof filters === "string" ? JSON.parse(filters) : filters;
    if (parsed.from) { whereConditions.push(`s.timestamp >= $${idx}`); params.push(parsed.from); idx++; }
    if (parsed.to) { whereConditions.push(`s.timestamp < $${idx}`); params.push(parsed.to); idx++; }
    if (parsed.outlet_id) { whereConditions.push(`s.outlet_id = $${idx}`); params.push(parsed.outlet_id); idx++; }
    if (parsed.employee_id) { whereConditions.push(`s.employee_id = $${idx}`); params.push(parsed.employee_id); idx++; }
  }

  const orderCol = sortBy && [...dimensions, ...measures].includes(sortBy) ? sortBy : measures[0] || dimensions[0];
  const orderDir = sortOrder === "asc" ? "ASC" : "DESC";

  const sql = `
    SELECT ${selectCols.join(", ")}
    FROM ${fromClause}
    ${[...joinSet].join("\n")}
    WHERE ${whereConditions.join(" AND ")}
    ${groupCols.length ? "GROUP BY " + groupCols.join(", ") : ""}
    ORDER BY ${orderCol} ${orderDir}
    LIMIT 1000
  `;

  return { sql, params };
}

module.exports = function registerReportBuilderRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;
  const feat = requireFeature("phase2_report_builder");

  // GET /api/reports/builder/datasets
  app.get("/api/reports/builder/datasets", feat, requireAnyPerm(["all_access", "view_reports"]), (req, res) => {
    const datasets = Object.entries(DATASETS).map(([key, val]) => ({
      key, label: val.label, dimensions: val.dimensions, measures: val.measures,
    }));
    res.json({ datasets });
  });

  // POST /api/reports/builder/run
  app.post("/api/reports/builder/run", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { dataset, dimensions, measures, filters, sort_by, sort_order } = req.body;
    if (!dataset || !dimensions?.length || !measures?.length) {
      return res.status(400).json({ error: "dataset, dimensions, and measures are required" });
    }
    try {
      const { sql, params } = buildQuery(dataset, dimensions, measures, filters, sort_by, sort_order);
      const { rows } = await db.query(sql, params);
      res.json({ rows, count: rows.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/reports/builder/definitions
  app.get("/api/reports/builder/definitions", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT crd.*, e.name AS created_by_name
         FROM custom_report_definitions crd
         LEFT JOIN employees e ON e.id = crd.created_by
         WHERE crd.is_shared = TRUE OR crd.created_by = $1
         ORDER BY crd.updated_at DESC`,
        [req.employee?.id]
      );
      res.json({ definitions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reports/builder/definitions
  app.post("/api/reports/builder/definitions", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { name, description, dataset, dimensions, measures, filters_json, sort_by, sort_order, is_shared } = req.body;
    if (!name || !dataset || !dimensions?.length || !measures?.length) {
      return res.status(400).json({ error: "name, dataset, dimensions, and measures are required" });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO custom_report_definitions
         (name, description, dataset, dimensions, measures, filters_json, sort_by, sort_order, created_by, is_shared)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [name, description || null, dataset, dimensions, measures,
         filters_json ? JSON.stringify(filters_json) : "{}", sort_by || null,
         sort_order || "desc", req.employee?.id, is_shared === true]
      );
      res.status(201).json({ definition: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/reports/builder/definitions/:id
  app.put("/api/reports/builder/definitions/:id", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { name, description, dimensions, measures, filters_json, sort_by, sort_order, is_shared } = req.body;
    try {
      const { rows: existing } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      if (!existing.length) return res.status(404).json({ error: "Definition not found" });
      if (existing[0].created_by !== req.employee?.id && !req.employeePerms?.includes("all_access")) {
        return res.status(403).json({ error: "Not authorized to edit this definition" });
      }

      const sets = [];
      const vals = [];
      let idx = 1;
      if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
      if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
      if (dimensions !== undefined) { sets.push(`dimensions = $${idx}`); vals.push(dimensions); idx++; }
      if (measures !== undefined) { sets.push(`measures = $${idx}`); vals.push(measures); idx++; }
      if (filters_json !== undefined) { sets.push(`filters_json = $${idx}`); vals.push(JSON.stringify(filters_json)); idx++; }
      if (sort_by !== undefined) { sets.push(`sort_by = $${idx}`); vals.push(sort_by); idx++; }
      if (sort_order !== undefined) { sets.push(`sort_order = $${idx}`); vals.push(sort_order); idx++; }
      if (is_shared !== undefined) { sets.push(`is_shared = $${idx}`); vals.push(is_shared); idx++; }
      sets.push(`updated_at = NOW()`);

      vals.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE custom_report_definitions SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
      );
      res.json({ definition: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/reports/builder/definitions/:id
  app.delete("/api/reports/builder/definitions/:id", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Definition not found" });
      if (rows[0].created_by !== req.employee?.id && !req.employeePerms?.includes("all_access")) {
        return res.status(403).json({ error: "Not authorized to delete this definition" });
      }
      await db.query("DELETE FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/reports/builder/definitions/:id/schedule
  app.post("/api/reports/builder/definitions/:id/schedule", feat, requirePerm("all_access"), async (req, res) => {
    const { frequency, run_hour, run_minute, timezone, recipient, export_format } = req.body;
    if (!frequency || !recipient) return res.status(400).json({ error: "frequency and recipient required" });
    try {
      const { rows: defRows } = await db.query("SELECT * FROM custom_report_definitions WHERE id = $1", [req.params.id]);
      if (!defRows.length) return res.status(404).json({ error: "Definition not found" });
      const def = defRows[0];

      const { rows } = await db.query(
        `INSERT INTO report_schedules
         (name, report_key, frequency, run_hour, run_minute, timezone, recipient, export_format, filters_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          `Custom: ${def.name}`, `builder:${def.id}`, frequency,
          run_hour || 8, run_minute || 0, timezone || "UTC",
          recipient, export_format || "csv", def.filters_json,
          req.employee?.id
        ]
      );
      res.status(201).json({ schedule: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

module.exports.buildQuery = buildQuery;
module.exports.DATASETS = DATASETS;
