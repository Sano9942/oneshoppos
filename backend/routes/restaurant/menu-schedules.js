// Phase 2-R Wave B — 2-R.6 menu schedules CRUD.
//
// Schedules act as *restrictions* on product visibility: a product with
// zero active schedules is always available. Writing a schedule + pinning
// products to it constrains those products to the named windows.

module.exports = function registerRestaurantMenuSchedulesRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");
  const { validate } = require("../../middleware/validate");
  const { scheduleCreateSchema, scheduleUpdateSchema } = require("../../schemas/menu-schedules");
  const { invalidateMenuScheduleCache } = require("../../services/menu-schedule-resolver");

  const gate = [
    // companyLevel: day-parting schedules are tenant menu catalog config
    // (Step 9 allowlist).
    requireMode("restaurant", { companyLevel: true }),
    requireFeature("phase4_restaurant_day_parting", { companyLevel: true }),
    requirePerm("manage_restaurant"),
  ];

  app.get("/api/restaurant/menu-schedules", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;
      const { rows } = await deps.db.query(
        `SELECT s.*,
                COALESCE(
                  (SELECT json_agg(sp.product_id)
                   FROM menu_schedule_products sp WHERE sp.schedule_id = s.id),
                  '[]'::json
                ) AS product_ids
         FROM menu_schedules s
         WHERE ($1::int IS NULL OR s.outlet_id = $1 OR s.outlet_id IS NULL)
         ORDER BY s.outlet_id NULLS FIRST, s.day_of_week NULLS FIRST, s.start_time`,
        [outletId]
      );
      res.json(rows);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post(
    "/api/restaurant/menu-schedules",
    ...gate,
    validate(scheduleCreateSchema),
    async (req, res) => {
      try {
        const { name, outlet_id, day_of_week, start_time, end_time, timezone, product_ids, is_active } =
          req.body;
        const row = await deps.db.transaction(async (client) => {
          const { rows: [schedule] } = await client.query(
            `INSERT INTO menu_schedules (name, outlet_id, day_of_week, start_time, end_time, timezone, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true))
             RETURNING *`,
            [name, outlet_id || null, day_of_week ?? null, start_time, end_time, timezone || null, is_active]
          );
          for (const pid of product_ids || []) {
            await client.query(
              `INSERT INTO menu_schedule_products (schedule_id, product_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [schedule.id, pid]
            );
          }
          return { ...schedule, product_ids: product_ids || [] };
        });
        invalidateMenuScheduleCache(outlet_id);
        invalidateMenuScheduleCache(null);
        res.status(201).json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  app.put(
    "/api/restaurant/menu-schedules/:id",
    ...gate,
    validate(scheduleUpdateSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid schedule id" });
        }
        const patch = req.body;
        const row = await deps.db.transaction(async (client) => {
          const sets = [];
          const params = [];
          let idx = 1;
          for (const col of ["name", "outlet_id", "day_of_week", "start_time", "end_time", "timezone", "is_active"]) {
            if (patch[col] !== undefined) {
              sets.push(`${col} = $${idx++}`);
              params.push(patch[col]);
            }
          }
          sets.push(`updated_at = NOW()`);
          params.push(id);
          const { rows: [schedule] } = sets.length > 0
            ? await client.query(
                `UPDATE menu_schedules SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
                params
              )
            : await client.query(`SELECT * FROM menu_schedules WHERE id = $1`, [id]);
          if (!schedule) {
            const e = new Error("Schedule not found");
            e.statusCode = 404;
            throw e;
          }
          if (Array.isArray(patch.product_ids)) {
            await client.query(`DELETE FROM menu_schedule_products WHERE schedule_id = $1`, [id]);
            for (const pid of patch.product_ids) {
              await client.query(
                `INSERT INTO menu_schedule_products (schedule_id, product_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [id, pid]
              );
            }
          }
          const { rows: productRows } = await client.query(
            `SELECT product_id FROM menu_schedule_products WHERE schedule_id = $1`,
            [id]
          );
          return { ...schedule, product_ids: productRows.map((r) => r.product_id) };
        });
        invalidateMenuScheduleCache(row.outlet_id);
        invalidateMenuScheduleCache(null);
        res.json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  app.delete("/api/restaurant/menu-schedules/:id", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid schedule id" });
      }
      const { rows: [row] } = await deps.db.query(
        `DELETE FROM menu_schedules WHERE id = $1 RETURNING outlet_id`,
        [id]
      );
      if (!row) return res.status(404).json({ error: "Schedule not found" });
      invalidateMenuScheduleCache(row.outlet_id);
      invalidateMenuScheduleCache(null);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
