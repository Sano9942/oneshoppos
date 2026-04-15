module.exports = function registerRestaurantRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createFloorPlanSchema, updateFloorPlanSchema,
    createTableSchema, updateTableSchema,
    createSessionSchema, createCheckSchema,
    splitCheckSchema, fireCourseSchema,
    createTabSchema,
  } = require("../schemas/restaurant");
  const floor = require("../services/restaurant-floor");
  const checks = require("../services/restaurant-checks");
  const kds = require("../services/restaurant-kds");

  const gate = [requireMode("restaurant"), requireFeature("phase4_restaurant"), requirePerm("manage_restaurant")];

  // ── Floor Plans ──────────────────────────────────────────────

  app.get("/api/restaurant/floor-plans", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const plans = await floor.getFloorPlans(deps.db, Number(outletId));
      res.json({ floor_plans: plans });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/restaurant/floor-plans/:id", ...gate, async (req, res) => {
    try {
      const plan = await floor.getFloorPlanWithTables(deps.db, Number(req.params.id));
      if (!plan) return res.status(404).json({ error: "Floor plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/floor-plans", ...gate, validate(createFloorPlanSchema), async (req, res) => {
    try {
      const plan = await floor.createFloorPlan(deps.db, req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_floor_plan_created", JSON.stringify({ id: plan.id })]); } catch {}
      res.status(201).json(plan);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/restaurant/floor-plans/:id", ...gate, validate(updateFloorPlanSchema), async (req, res) => {
    try {
      const plan = await floor.updateFloorPlan(deps.db, Number(req.params.id), req.body);
      if (!plan) return res.status(404).json({ error: "Floor plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Tables ───────────────────────────────────────────────────

  app.get("/api/restaurant/tables", ...gate, async (req, res) => {
    try {
      const { floor_plan_id } = req.query;
      if (!floor_plan_id) return res.status(400).json({ error: "floor_plan_id required" });
      const { rows } = await deps.db.query(
        "SELECT * FROM restaurant_tables WHERE floor_plan_id = $1 ORDER BY label",
        [Number(floor_plan_id)]
      );
      res.json({ tables: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/tables", ...gate, validate(createTableSchema), async (req, res) => {
    try {
      const { rows: [table] } = await deps.db.query(
        `INSERT INTO restaurant_tables (floor_plan_id, section_id, label, capacity, shape, pos_x, pos_y)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.body.floor_plan_id, req.body.section_id || null, req.body.label, req.body.capacity, req.body.shape, req.body.pos_x, req.body.pos_y]
      );
      res.status(201).json(table);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/restaurant/tables/:id", ...gate, validate(updateTableSchema), async (req, res) => {
    try {
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(req.body)) {
        if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
      }
      if (!sets.length) return res.status(400).json({ error: "No fields to update" });
      idx++; params.push(Number(req.params.id));
      sets.push("updated_at = NOW()");
      const { rows: [table] } = await deps.db.query(
        `UPDATE restaurant_tables SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
      );
      if (!table) return res.status(404).json({ error: "Table not found" });
      res.json(table);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Table Sessions ───────────────────────────────────────────

  app.get("/api/restaurant/table-sessions", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      const status = req.query.status;
      const params = [];
      let where = "1=1";
      let idx = 0;
      if (outletId) { idx++; where += ` AND ts.outlet_id = $${idx}`; params.push(Number(outletId)); }
      if (status) { idx++; where += ` AND ts.status = $${idx}`; params.push(status); }
      else { where += " AND ts.status != 'closed'"; }

      const { rows } = await deps.db.query(
        `SELECT ts.*, rt.label AS table_label, e.name AS server_name
         FROM restaurant_table_sessions ts
         JOIN restaurant_tables rt ON rt.id = ts.table_id
         LEFT JOIN employees e ON e.id = ts.server_id
         WHERE ${where}
         ORDER BY ts.seated_at DESC`,
        params
      );
      res.json({ sessions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/table-sessions", ...gate, validate(createSessionSchema), async (req, res) => {
    try {
      const session = await floor.openTableSession(deps.db, req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_session_opened", JSON.stringify({ session_id: session.id, table_id: req.body.table_id })]); } catch {}
      res.status(201).json(session);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/restaurant/table-sessions/:id", ...gate, async (req, res) => {
    try {
      const session = await floor.updateTableSession(deps.db, Number(req.params.id), req.body);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Checks (restaurant draft orders) ─────────────────────────

  app.get("/api/restaurant/checks", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const rows = await checks.getOpenChecks(deps.db, Number(outletId), req.query);
      res.json({ checks: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks", ...gate, validate(createCheckSchema), async (req, res) => {
    try {
      const order = await checks.createRestaurantCheck(deps.db, req.body, req.employee.id);
      res.status(201).json(order);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks/:id/send-to-kitchen", ...gate, async (req, res) => {
    try {
      const tickets = await kds.sendToKitchen(deps.db, Number(req.params.id));
      res.json({ tickets });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks/:id/fire-course", ...gate, validate(fireCourseSchema), async (req, res) => {
    try {
      const fire = await checks.fireCourse(deps.db, Number(req.params.id), req.body.course_name, req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_course_fired", JSON.stringify({ draft_order_id: Number(req.params.id), course_name: req.body.course_name })]); } catch {}
      res.json(fire);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/checks/:id/split", ...gate, validate(splitCheckSchema), async (req, res) => {
    try {
      let result;
      if (req.body.split_type === "by_seat") {
        result = await checks.splitCheckBySeat(deps.db, Number(req.params.id), req.employee.id);
      } else {
        result = await checks.splitCheckByItem(deps.db, Number(req.params.id), req.body.item_assignments || [], req.employee.id);
      }
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_check_split", JSON.stringify({ source_id: Number(req.params.id), type: req.body.split_type })]); } catch {}
      res.json({ new_checks: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Tabs ─────────────────────────────────────────────────────

  app.post("/api/restaurant/tabs", ...gate, validate(createTabSchema), async (req, res) => {
    try {
      const tab = await checks.openTab(deps.db, req.body, req.employee.id);
      res.status(201).json(tab);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/restaurant/tabs/:id/close", ...gate, async (req, res) => {
    try {
      const tab = await checks.closeTab(deps.db, Number(req.params.id));
      res.json(tab);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
