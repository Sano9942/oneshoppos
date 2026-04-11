module.exports = function registerKdsRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createKdsStationSchema, updateKdsStationSchema } = require("../schemas/restaurant");
  const kds = require("../services/restaurant-kds");

  const gate = [requireFeature("phase4_restaurant_kds"), requirePerm("manage_kds")];

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
};
