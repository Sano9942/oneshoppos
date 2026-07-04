module.exports = function registerBookingRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createServiceSchema, updateServiceSchema, createAppointmentSchema, rescheduleSchema, cancelSchema } = require("../schemas/bookings");
  const { getAvailableSlots } = require("../services/booking-availability");
  const { createAppointment, rescheduleAppointment, cancelAppointment, mapOverlapConstraintError } = require("../services/booking-services");

  // notifyCtx for the waitlist offer flow + F05 notifications (fire-and-forget
  // downstream; safe when slug is missing — notify() rejects and is caught).
  const notifyCtxFrom = (req) => ({
    tenantSlug: req.tenantSlug,
    tenant: { slug: req.tenantSlug, name: req.company?.company_name },
    frontendUrl: process.env.FRONTEND_URL,
  });

  const gate = [requireMode("appointments"), requireFeature("phase4_appointments"), requirePerm("manage_bookings")];

  // ── Booking Services ─────────────────────────────────────────

  app.get("/api/booking-services", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `SELECT bs.*,
           (SELECT json_agg(json_build_object('id', bsa.employee_id, 'name', e.name))
            FROM booking_staff_assignments bsa JOIN employees e ON e.id = bsa.employee_id
            WHERE bsa.service_id = bs.id) AS staff
         FROM booking_services bs ORDER BY bs.name`
      );
      res.json({ services: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/booking-services", ...gate, validate(createServiceSchema), async (req, res) => {
    try {
      const { staff_ids, ...data } = req.body;
      const { rows: [service] } = await deps.db.query(
        `INSERT INTO booking_services (name, description, duration_minutes, padding_minutes, price, outlet_id, requires_confirmation, max_advance_days, product_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [data.name, data.description || null, data.duration_minutes, data.padding_minutes, data.price, data.outlet_id || null, data.requires_confirmation, data.max_advance_days, data.product_id || null]
      );

      if (staff_ids?.length) {
        for (const eid of staff_ids) {
          await deps.db.query(
            "INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [service.id, eid]
          );
        }
      }
      res.status(201).json(service);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/booking-services/:id", ...gate, validate(updateServiceSchema), async (req, res) => {
    try {
      const { staff_ids, ...data } = req.body;
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
      }
      if (sets.length) {
        idx++; params.push(Number(req.params.id));
        sets.push("updated_at = NOW()");
        await deps.db.query(`UPDATE booking_services SET ${sets.join(", ")} WHERE id = $${idx}`, params);
      }
      if (staff_ids) {
        await deps.db.query("DELETE FROM booking_staff_assignments WHERE service_id = $1", [Number(req.params.id)]);
        for (const eid of staff_ids) {
          await deps.db.query("INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, $2)", [Number(req.params.id), eid]);
        }
      }
      const { rows: [service] } = await deps.db.query("SELECT * FROM booking_services WHERE id = $1", [Number(req.params.id)]);
      res.json(service);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Availability ─────────────────────────────────────────────

  app.get("/api/appointments/availability", ...gate, async (req, res) => {
    try {
      const { service_id, employee_id, date, outlet_id } = req.query;
      if (!service_id || !date) return res.status(400).json({ error: "service_id and date required" });
      const slots = await getAvailableSlots(deps.db, { serviceId: Number(service_id), employeeId: employee_id ? Number(employee_id) : null, date, outletId: outlet_id ? Number(outlet_id) : null });
      res.json({ slots });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Appointments ─────────────────────────────────────────────

  app.get("/api/appointments", ...gate, async (req, res) => {
    try {
      const { from, to, status, employee_id } = req.query;
      const params = []; let idx = 0;
      let where = "1=1";
      if (from) { idx++; where += ` AND a.start_at >= $${idx}`; params.push(from); }
      if (to) { idx++; where += ` AND a.start_at <= $${idx}`; params.push(to); }
      if (status) { idx++; where += ` AND a.status = $${idx}`; params.push(status); }
      if (employee_id) { idx++; where += ` AND a.employee_id = $${idx}`; params.push(Number(employee_id)); }

      const { rows } = await deps.db.query(
        `SELECT a.*, bs.name AS service_name, e.name AS employee_name, c.name AS customer_display_name
         FROM appointments a
         JOIN booking_services bs ON bs.id = a.service_id
         LEFT JOIN employees e ON e.id = a.employee_id
         LEFT JOIN customers c ON c.id = a.customer_id
         WHERE ${where}
         ORDER BY a.start_at ASC`,
        params
      );
      res.json({ appointments: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/appointments/calendar", ...gate, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to required" });
      const { rows } = await deps.db.query(
        `SELECT a.id, a.start_at, a.end_at, a.status, a.employee_id, a.customer_name,
           bs.name AS service_name, e.name AS employee_name
         FROM appointments a
         JOIN booking_services bs ON bs.id = a.service_id
         LEFT JOIN employees e ON e.id = a.employee_id
         WHERE a.start_at >= $1 AND a.start_at <= $2 AND a.status NOT IN ('cancelled')
         ORDER BY a.start_at`,
        [from, to]
      );
      res.json({ events: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // F06 — POS "today's appointments" checkout entry point. Deliberately NOT
  // behind manage_bookings: cashiers ring up appointments they can't manage.
  // Mode+flag gated; auth comes from the standard tenant chain.
  app.get("/api/appointments/pos-today", requireMode("appointments"), requireFeature("phase4_appointments"), async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const { toUtcStart, toUtcEnd, toLocalDateStr } = require("../utils/tz");
      const today = toLocalDateStr(new Date().toISOString(), tz);
      const params = [toUtcStart(today, tz), toUtcEnd(today, tz)];
      let outletFilter = "";
      if (req.query.outlet_id) {
        params.push(Number(req.query.outlet_id));
        outletFilter = ` AND (a.outlet_id = $${params.length} OR a.outlet_id IS NULL)`;
      }
      const { rows } = await deps.db.query(
        `SELECT a.id, a.start_at, a.end_at, a.status, a.customer_id, a.customer_name,
           a.customer_phone, a.employee_id, a.sale_id,
           bs.id AS service_id, bs.name AS service_name, bs.price AS service_price,
           bs.product_id AS service_product_id,
           p.name AS product_name, p.price AS product_price, p.gst AS product_gst,
           t.rate AS product_tax_rate, t.name AS product_tax_name,
           e.name AS employee_name, c.name AS customer_display_name
         FROM appointments a
         JOIN booking_services bs ON bs.id = a.service_id
         LEFT JOIN products p ON p.id = bs.product_id AND p.deleted_at IS NULL
         LEFT JOIN taxes t ON t.id = p.tax_id
         LEFT JOIN employees e ON e.id = a.employee_id
         LEFT JOIN customers c ON c.id = a.customer_id
         WHERE a.start_at >= $1 AND a.start_at < $2
           AND a.status IN ('confirmed','in_progress')
           AND a.sale_id IS NULL${outletFilter}
         ORDER BY a.start_at ASC`,
        params
      );
      // Same effective-tax normalization the POS product endpoints use.
      res.json({
        appointments: rows.map((r) => ({
          ...r,
          effective_tax_rate: r.product_tax_rate != null ? Number(r.product_tax_rate)
            : r.product_gst != null ? Number(r.product_gst) : 0,
          effective_tax_name: r.product_tax_name || (r.product_gst != null ? "GST" : "No Tax"),
        })),
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/appointments", ...gate, validate(createAppointmentSchema), async (req, res) => {
    try {
      const appt = await createAppointment(deps.db, req.body, "admin");
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "appointment_created", JSON.stringify({ id: appt.id })]); } catch {}
      res.status(201).json(appt);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/appointments/:id", ...gate, async (req, res) => {
    try {
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(req.body)) {
        if (val !== undefined && ["status", "notes", "employee_id"].includes(key)) {
          idx++; sets.push(`${key} = $${idx}`); params.push(val);
        }
      }
      if (!sets.length) return res.status(400).json({ error: "No fields to update" });
      idx++; params.push(Number(req.params.id));
      sets.push("updated_at = NOW()");
      const { rows: [appt] } = await deps.db.query(
        `UPDATE appointments SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
      );
      if (!appt) return res.status(404).json({ error: "Appointment not found" });
      res.json(appt);
    } catch (err) {
      // employee_id reassignment never ran checkOverlap — the v100 EXCLUDE
      // constraint is what catches a conflicting move here.
      const mapped = mapOverlapConstraintError(err);
      res.status(mapped.statusCode || 500).json({ error: mapped.message });
    }
  });

  app.post("/api/appointments/:id/reschedule", ...gate, validate(rescheduleSchema), async (req, res) => {
    try {
      const appt = await rescheduleAppointment(deps.db, Number(req.params.id), req.body);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "appointment_rescheduled", JSON.stringify({ id: appt.id })]); } catch {}
      res.json(appt);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/appointments/:id/cancel", ...gate, validate(cancelSchema), async (req, res) => {
    try {
      const appt = await cancelAppointment(deps.db, Number(req.params.id), req.body.reason, { notifyCtx: notifyCtxFrom(req) });
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "appointment_cancelled", JSON.stringify({ id: appt.id })]); } catch {}
      res.json(appt);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
