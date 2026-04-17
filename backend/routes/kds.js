module.exports = function registerKdsRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createKdsStationSchema, updateKdsStationSchema,
    createKdsRouteSchema, updateKdsRouteSchema,
  } = require("../schemas/restaurant");
  const kds = require("../services/restaurant-kds");

  const gate = [requireMode("restaurant"), requireFeature("phase4_restaurant_kds"), requirePerm("manage_kds")];

  app.get("/api/kds/stations", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const stations = await kds.getStations(deps.db, Number(outletId));
      res.json({ stations });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/kds/stations", ...gate, validate(createKdsStationSchema), async (req, res) => {
    try {
      const station = await kds.createStation(deps.db, req.body);
      res.status(201).json(station);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/kds/stations/:id", ...gate, validate(updateKdsStationSchema), async (req, res) => {
    try {
      const station = await kds.updateStation(deps.db, Number(req.params.id), req.body);
      if (!station) return res.status(404).json({ error: "Station not found" });
      res.json(station);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get("/api/kds/tickets", ...gate, async (req, res) => {
    try {
      const { station_id, status } = req.query;
      if (!station_id) return res.status(400).json({ error: "station_id required" });
      const tickets = await kds.getTickets(deps.db, Number(station_id), status || null);
      res.json({ tickets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/kds/tickets/:id/bump", ...gate, async (req, res) => {
    try {
      const ticket = await kds.bumpTicket(deps.db, Number(req.params.id), req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "kds_ticket_bumped", JSON.stringify({ ticket_id: Number(req.params.id) })]); } catch {}
      res.json(ticket);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/kds/tickets/:id/recall", ...gate, async (req, res) => {
    try {
      const ticket = await kds.recallTicket(deps.db, Number(req.params.id), req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "kds_ticket_recalled", JSON.stringify({ ticket_id: Number(req.params.id) })]); } catch {}
      res.json(ticket);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Phase 2.1 B1 — KDS station routing rules.
  // GET lists rules for an outlet (joined with station + matched entity names
  // so the UI can render without extra round-trips).
  app.get("/api/kds/routes", ...gate, async (req, res) => {
    try {
      const outletId = req.query.outlet_id || req.context?.outlet_id;
      if (!outletId) return res.status(400).json({ error: "outlet_id required" });
      const { rows } = await deps.db.query(
        `SELECT sr.*, ks.name AS station_name, ks.station_role,
                c.name AS category_name, p.name AS product_name, mg.name AS modifier_group_name
         FROM kds_station_routes sr
         JOIN kds_stations ks ON ks.id = sr.station_id
         LEFT JOIN categories c ON c.id = sr.category_id
         LEFT JOIN products p ON p.id = sr.product_id
         LEFT JOIN modifier_groups mg ON mg.id = sr.modifier_group_id
         WHERE sr.outlet_id = $1 OR (sr.outlet_id IS NULL AND ks.outlet_id = $1)
         ORDER BY sr.priority DESC, sr.id ASC`,
        [Number(outletId)]
      );
      res.json({ routes: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/kds/routes", ...gate, validate(createKdsRouteSchema), async (req, res) => {
    try {
      const b = req.body;
      // Verify the station belongs to this outlet — prevents cross-outlet wiring
      // when a client sends a mismatched station_id.
      const { rows: [station] } = await deps.db.query(
        "SELECT id FROM kds_stations WHERE id = $1 AND outlet_id = $2",
        [b.station_id, b.outlet_id]
      );
      if (!station) return res.status(400).json({ error: "Station not found for this outlet" });

      const { rows: [route] } = await deps.db.query(
        `INSERT INTO kds_station_routes
           (outlet_id, station_id, priority, product_id, modifier_group_id, category_id, match_all, station_role_filter)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          b.outlet_id,
          b.station_id,
          b.priority ?? 0,
          b.product_id ?? null,
          b.modifier_group_id ?? null,
          b.category_id ?? null,
          b.match_all === true,
          b.station_role_filter ?? null,
        ]
      );
      res.status(201).json(route);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/kds/routes/:id", ...gate, validate(updateKdsRouteSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body;
      const sets = [];
      const params = [];
      let idx = 0;
      for (const col of ["priority", "product_id", "modifier_group_id", "category_id", "match_all", "station_role_filter", "station_id"]) {
        if (b[col] !== undefined) {
          idx++;
          sets.push(`${col} = $${idx}`);
          params.push(b[col]);
        }
      }
      if (!sets.length) return res.status(400).json({ error: "No fields to update" });
      idx++;
      params.push(id);
      const { rows: [route] } = await deps.db.query(
        `UPDATE kds_station_routes SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        params
      );
      if (!route) return res.status(404).json({ error: "Route not found" });
      res.json(route);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete("/api/kds/routes/:id", ...gate, async (req, res) => {
    try {
      const { rowCount } = await deps.db.query(
        "DELETE FROM kds_station_routes WHERE id = $1",
        [Number(req.params.id)]
      );
      if (!rowCount) return res.status(404).json({ error: "Route not found" });
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read-only preview: shows which station each pending item on a draft order
  // would route to, without writing any kds_tickets rows. Used by the UI to
  // let a server verify rules before firing.
  app.get("/api/kds/routes/preview", ...gate, async (req, res) => {
    try {
      const draftId = Number(req.query.draft_order_id);
      if (!draftId) return res.status(400).json({ error: "draft_order_id required" });
      const rows = await kds.previewRouting(deps.db, draftId);
      res.json({ preview: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
