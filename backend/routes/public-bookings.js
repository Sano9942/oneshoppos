const { resolvePublicTenantDb } = require("../services/public-tenant-context");

module.exports = function registerPublicBookingRoutes(app, deps) {

  // GET /api/public/bookings/config — public booking page config
  app.get("/api/public/bookings/config", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows: [profile] } = await db.query(
        "SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1"
      );

      const { rows: services } = await db.query(
        `SELECT bs.id, bs.name, bs.description, bs.duration_minutes, bs.price,
           (SELECT json_agg(json_build_object('id', e.id, 'name', e.name))
            FROM booking_staff_assignments bsa JOIN employees e ON e.id = bsa.employee_id
            WHERE bsa.service_id = bs.id) AS staff
         FROM booking_services bs
         WHERE bs.is_active = true
         ORDER BY bs.name`
      );

      res.json({
        company_name: profile?.company_name || "",
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
        services,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/public/bookings/availability — public slot search
  app.get("/api/public/bookings/availability", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { service_id, employee_id, date } = req.query;
      if (!service_id || !date) return res.status(400).json({ error: "service_id and date required" });

      const { getAvailableSlots } = require("../services/booking-availability");
      const slots = await getAvailableSlots(db, {
        serviceId: Number(service_id),
        employeeId: employee_id ? Number(employee_id) : null,
        date,
      });
      res.json({ slots });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/bookings — create public booking
  app.post("/api/public/bookings", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { service_id, employee_id, start_at, customer_name, customer_phone, customer_email, notes } = req.body || {};
      if (!service_id || !start_at || !customer_name || !customer_phone) {
        return res.status(400).json({ error: "service_id, start_at, customer_name, customer_phone required" });
      }

      const { createAppointment } = require("../services/booking-services");
      const appt = await createAppointment(db, {
        service_id, employee_id, start_at, customer_name, customer_phone, customer_email, notes,
      }, "public");

      res.status(201).json({
        id: appt.id,
        status: appt.status,
        start_at: appt.start_at,
        end_at: appt.end_at,
        message: appt.status === "pending" ? "Your booking is pending confirmation" : "Your booking is confirmed",
      });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
    }
  });
};
