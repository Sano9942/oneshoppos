module.exports = function registerRestaurantRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");

  // W40 helper: send a 4xx/5xx JSON response, but also log to Sentry FIRST so
  // production observability isn't a black hole. Used in every restaurant
  // route catch block. We don't `next(err)` because the test-app factory
  // doesn't register a global error handler — that would fall through to
  // Express defaults and break res.body.error in integration tests.
  const sendErr = (req, res, err) => {
    try {
      if (process.env.SENTRY_DSN) {
        require("@sentry/node").captureException(err, {
          tags: { route: "restaurant", reqId: req.id, tenantSlug: req.tenantSlug },
          user: { id: req.employee?.id, username: req.employee?.name },
        });
      }
    } catch { /* sentry best-effort */ }
    if (req.log) req.log.error({ err, reqId: req.id }, "restaurant route error");
    res.status(err.statusCode || err.status || 500).json({ error: err.message });
  };

  const {
    createFloorPlanSchema, updateFloorPlanSchema,
    createTableSchema, updateTableSchema,
    createSessionSchema, createCheckSchema,
    splitCheckSchema, mergeChecksSchema, fireCourseSchema,
    holdCourseSchema, expediteCourseSchema,
    createTabSchema,
    updateCheckSchema,
  } = require("../schemas/restaurant");
  const floor = require("../services/restaurant-floor");
  const checks = require("../services/restaurant-checks");
  const kds = require("../services/restaurant-kds");

  const gate = [requireMode("restaurant"), requireFeature("phase4_restaurant"), requirePerm("manage_restaurant")];

  // ── Floor Plans ──────────────────────────────────────────────

  app.get("/api/restaurant/floor-plans", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outletId;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const plans = await floor.getFloorPlans(deps.db, Number(outletId));
      res.json({ floor_plans: plans });
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.get("/api/restaurant/floor-plans/:id", ...gate, async (req, res) => {
    try {
      const plan = await floor.getFloorPlanWithTables(deps.db, Number(req.params.id));
      if (!plan) return res.status(404).json({ error: "Floor plan not found" });
      res.json(plan);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/floor-plans", ...gate, validate(createFloorPlanSchema), async (req, res) => {
    try {
      const plan = await floor.createFloorPlan(deps.db, req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_floor_plan_created", JSON.stringify({ id: plan.id })]); } catch {}
      res.status(201).json(plan);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.put("/api/restaurant/floor-plans/:id", ...gate, validate(updateFloorPlanSchema), async (req, res) => {
    try {
      const plan = await floor.updateFloorPlan(deps.db, Number(req.params.id), req.body);
      if (!plan) return res.status(404).json({ error: "Floor plan not found" });
      res.json(plan);
    } catch (err) {
      sendErr(req, res, err);
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
      sendErr(req, res, err);
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
      sendErr(req, res, err);
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
      sendErr(req, res, err);
    }
  });

  // ── Table Sessions ───────────────────────────────────────────

  app.get("/api/restaurant/table-sessions", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outletId;
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
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/table-sessions", ...gate, validate(createSessionSchema), async (req, res) => {
    try {
      const session = await floor.openTableSession(deps.db, req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_session_opened", JSON.stringify({ session_id: session.id, table_id: req.body.table_id })]); } catch {}
      res.status(201).json(session);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.put("/api/restaurant/table-sessions/:id", ...gate, async (req, res) => {
    try {
      const session = await floor.updateTableSession(deps.db, Number(req.params.id), req.body);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  // ── Checks (restaurant draft orders) ─────────────────────────

  app.get("/api/restaurant/checks", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outletId;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const rows = await checks.getOpenChecks(deps.db, Number(outletId), req.query);
      res.json({ checks: rows });
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/checks", ...gate, validate(createCheckSchema), async (req, res) => {
    try {
      const order = await checks.createRestaurantCheck(deps.db, req.body, req.employee.id);
      res.status(201).json(order);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/checks/:id/send-to-kitchen", ...gate, async (req, res) => {
    try {
      const tickets = await kds.sendToKitchen(deps.db, Number(req.params.id));
      res.json({ tickets });
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/checks/:id/fire-course", ...gate, validate(fireCourseSchema), async (req, res) => {
    try {
      const fire = await checks.fireCourse(deps.db, Number(req.params.id), req.body.course_name, req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_course_fired", JSON.stringify({ draft_order_id: Number(req.params.id), course_name: req.body.course_name })]); } catch {}

      // 2-R.7 — route fire chit to each involved station's printer.
      // Flag-gated so tenants without the flag keep the prior no-print path.
      try {
        const flagsMap = await require("../middleware/feature-flags").getFeatureFlagsMap(req.tenantId);
        if (flagsMap.phase4_restaurant_fire_chits) {
          const printerService = require("../services/printer")(deps.db);
          // Collect involved stations via kds_tickets for this draft_order +
          // course. If none routed (flag newly enabled, no tickets yet), skip.
          const { rows: stations } = await deps.db.query(
            `SELECT DISTINCT kt.station_id
             FROM kds_tickets kt
             WHERE kt.draft_order_id = $1
               AND kt.course_name = $2
               AND kt.station_id IS NOT NULL`,
            [Number(req.params.id), req.body.course_name]
          );
          const { rows: [order] } = await deps.db.query(
            `SELECT id, outlet_id, subtotal FROM draft_orders WHERE id = $1`,
            [Number(req.params.id)]
          );
          const { rows: items } = await deps.db.query(
            `SELECT product_name, quantity, price, seat_number
             FROM draft_order_items
             WHERE draft_order_id = $1 AND course_name = $2
             ORDER BY seat_number NULLS LAST, id`,
            [Number(req.params.id), req.body.course_name]
          );
          // Fire one chit per station; items are the course's items grouped by seat.
          for (const { station_id } of stations) {
            const slip = {
              invoiceNumber: `FIRE-${req.params.id}-${req.body.course_name}`,
              timestamp: new Date().toISOString(),
              cart: items.map((it) => ({
                name: it.seat_number ? `Seat ${it.seat_number}: ${it.product_name}` : it.product_name,
                quantity: Number(it.quantity),
                price: Number(it.price),
              })),
              payments: [],
              total: 0,
              outlet: { id: order?.outlet_id },
            };
            // Fire-and-forget per station; alerting fires if a station printer
            // is offline via printReceipt's internal fallback path.
            printerService
              .printReceipt(slip, { header_text: `FIRE · Course ${req.body.course_name}`, footer_text: "— Kitchen —" }, "", {}, {
                purpose: "fire_chit",
                station_id,
                outlet_id: order?.outlet_id,
              })
              .catch(() => { /* swallow — alerting has already recorded */ });
          }
        }
      } catch { /* printer routing best-effort */ }

      res.json(fire);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  // 2-R.7 — Print guest bill. Routes to the outlet's guest_bill printer;
  // falls back to the default receipt printer if none configured.
  app.post(
    "/api/restaurant/checks/:id/print-bill",
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_fire_chits"),
    requirePerm("manage_restaurant"),
    async (req, res) => {
      try {
        const checkId = Number(req.params.id);
        const { rows: [order] } = await deps.db.query(
          `SELECT id, outlet_id, subtotal, tax_total, discount_total, total
           FROM draft_orders WHERE id = $1`,
          [checkId]
        );
        if (!order) return res.status(404).json({ error: "Check not found" });
        const { rows: items } = await deps.db.query(
          `SELECT product_name, quantity, price, seat_number
           FROM draft_order_items WHERE draft_order_id = $1 ORDER BY seat_number NULLS LAST, id`,
          [checkId]
        );
        const printerService = require("../services/printer")(deps.db);
        const slip = {
          invoiceNumber: `CHECK-${checkId}`,
          timestamp: new Date().toISOString(),
          cart: items.map((it) => ({
            name: it.seat_number ? `Seat ${it.seat_number}: ${it.product_name}` : it.product_name,
            quantity: Number(it.quantity),
            price: Number(it.price),
          })),
          payments: [],
          taxAmount: Number(order.tax_total || 0),
          discountAmount: Number(order.discount_total || 0),
          total: Number(order.total || 0),
          outlet: { id: order.outlet_id },
        };
        const result = await printerService.printReceipt(
          slip,
          { header_text: "GUEST CHECK", footer_text: "Not a receipt — for review only" },
          "",
          {},
          { purpose: "guest_bill", outlet_id: order.outlet_id }
        );
        if (result?.ok) res.json({ ok: true });
        else res.status(500).json({ error: result?.error || "Print failed" });
      } catch (err) {
        sendErr(req, res, err);
      }
    }
  );

  app.post("/api/restaurant/checks/:id/courses/hold", ...gate, validate(holdCourseSchema), async (req, res) => {
    try {
      const fire = await checks.holdCourse(
        deps.db, Number(req.params.id), req.body.course_name, req.body.hold_until, req.employee.id
      );
      res.json(fire);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/checks/:id/courses/expedite", ...gate, validate(expediteCourseSchema), async (req, res) => {
    try {
      const fire = await checks.expediteCourse(
        deps.db, Number(req.params.id), req.body.course_name, req.employee.id
      );
      res.json(fire);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/checks/:id/split", ...gate, validate(splitCheckSchema), async (req, res) => {
    try {
      let result;
      const sourceId = Number(req.params.id);
      const eid = req.employee.id;
      switch (req.body.split_type) {
        case "by_seat":
          result = await checks.splitCheckBySeat(deps.db, sourceId, eid);
          break;
        case "by_amount":
          result = await checks.splitCheckByAmount(deps.db, sourceId, req.body.parts, eid);
          break;
        case "evenly":
        case "equal":
          result = await checks.splitCheckEvenly(deps.db, sourceId, req.body.parts, eid);
          break;
        case "by_item":
        default:
          result = await checks.splitCheckByItem(deps.db, sourceId, req.body.item_assignments || [], eid);
      }
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_check_split", JSON.stringify({ source_id: sourceId, type: req.body.split_type })]); } catch {}
      res.json({ new_checks: result });
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  // W22 — non-payment close/cancel a check. The Checks list page uses this
  // to abandon zombie/empty checks at end-of-shift. Sale settlement (W17)
  // already flips the parent draft to 'completed' transactionally, so the
  // common flow doesn't go through here. Limited to 'cancelled' / 'completed'
  // statuses by updateCheckSchema; the other draft_orders.status values
  // (open / claimed / merged) are internal lifecycle and not exposed.
  app.put("/api/restaurant/checks/:id", ...gate, validate(updateCheckSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body;
      const { rows } = await deps.db.query(
        `UPDATE draft_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status, total::text AS total, table_session_id`,
        [status, id]
      );
      if (!rows[0]) return res.status(404).json({ error: "Check not found" });
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_check_status_changed", JSON.stringify({ id, status })]); } catch {}
      res.json(rows[0]);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/checks/merge", ...gate, validate(mergeChecksSchema), async (req, res) => {
    try {
      const merged = await checks.mergeChecks(deps.db, req.body.target_id, req.body.source_ids, req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "restaurant_checks_merged", JSON.stringify({ target_id: req.body.target_id, source_ids: req.body.source_ids })]); } catch {}
      res.json(merged);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  // ── Tabs ─────────────────────────────────────────────────────

  app.post("/api/restaurant/tabs", ...gate, validate(createTabSchema), async (req, res) => {
    try {
      const tab = await checks.openTab(deps.db, req.body, req.employee.id);
      res.status(201).json(tab);
    } catch (err) {
      sendErr(req, res, err);
    }
  });

  app.post("/api/restaurant/tabs/:id/close", ...gate, async (req, res) => {
    try {
      const tab = await checks.closeTab(deps.db, Number(req.params.id));
      res.json(tab);
    } catch (err) {
      sendErr(req, res, err);
    }
  });
};
