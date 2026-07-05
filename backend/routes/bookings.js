module.exports = function registerBookingRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createServiceSchema, updateServiceSchema, createAppointmentSchema, rescheduleSchema, cancelSchema,
    createResourceSchema, updateResourceSchema, setServiceResourcesSchema } = require("../schemas/bookings");
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
  // Resources are a sub-feature: same mode/perm, stricter flag.
  const resourceGate = [requireMode("appointments"), requireFeature("phase4_appointments_resources"), requirePerm("manage_bookings")];

  // Shared segments sub-select — multi-service visits render per segment.
  const SEGMENTS_AGG = `
    (SELECT json_agg(json_build_object(
        'id', s.id, 'service_id', s.service_id, 'service_name', sbs.name,
        'employee_id', s.employee_id, 'employee_name', se.name,
        'start_at', s.start_at, 'end_at', s.end_at) ORDER BY s.start_at)
     FROM appointment_segments s
     JOIN booking_services sbs ON sbs.id = s.service_id
     LEFT JOIN employees se ON se.id = s.employee_id
     WHERE s.appointment_id = a.id) AS segments`;

  // ── Booking Services ─────────────────────────────────────────

  app.get("/api/booking-services", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `SELECT bs.*,
           (SELECT json_agg(json_build_object('id', bsa.employee_id, 'name', e.name))
            FROM booking_staff_assignments bsa JOIN employees e ON e.id = bsa.employee_id
            WHERE bsa.service_id = bs.id) AS staff,
           (SELECT json_agg(json_build_object('id', r.id, 'name', r.name))
            FROM booking_resource_assignments ra JOIN booking_resources r ON r.id = ra.resource_id
            WHERE ra.service_id = bs.id) AS resources
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
      // Multi-segment parents have employee_id NULL — match via their segments.
      if (employee_id) {
        idx++;
        where += ` AND (a.employee_id = $${idx} OR EXISTS (
          SELECT 1 FROM appointment_segments fs WHERE fs.appointment_id = a.id AND fs.employee_id = $${idx}))`;
        params.push(Number(employee_id));
      }

      const { rows } = await deps.db.query(
        `SELECT a.*, bs.name AS service_name, e.name AS employee_name, c.name AS customer_display_name,${SEGMENTS_AGG}
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
           bs.name AS service_name, e.name AS employee_name,${SEGMENTS_AGG}
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
           e.name AS employee_name, c.name AS customer_display_name,
           (SELECT json_agg(json_build_object(
               'service_id', s.service_id, 'service_name', sbs.name, 'service_price', sbs.price,
               'product_id', sbs.product_id, 'product_name', sp.name, 'product_price', sp.price,
               'product_gst', sp.gst, 'product_tax_rate', st.rate, 'product_tax_name', st.name,
               'employee_id', s.employee_id, 'employee_name', se.name,
               'start_at', s.start_at, 'end_at', s.end_at) ORDER BY s.start_at)
            FROM appointment_segments s
            JOIN booking_services sbs ON sbs.id = s.service_id
            LEFT JOIN products sp ON sp.id = sbs.product_id AND sp.deleted_at IS NULL
            LEFT JOIN taxes st ON st.id = sp.tax_id
            LEFT JOIN employees se ON se.id = s.employee_id
            WHERE s.appointment_id = a.id) AS segments
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

  const APPOINTMENT_STATUSES = ["pending", "confirmed", "in_progress", "completed", "no_show", "cancelled"];

  app.put("/api/appointments/:id", ...gate, async (req, res) => {
    try {
      if (req.body.status !== undefined && !APPOINTMENT_STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${APPOINTMENT_STATUSES.join(", ")}` });
      }
      // Cancels must go through the ONE cancel path so the waitlist ripple,
      // cancelled_at, and cancellation bookkeeping all fire ([[F06 harden]]:
      // every cancel call site routes through cancelAppointment).
      if (req.body.status === "cancelled") {
        const appt = await cancelAppointment(deps.db, Number(req.params.id), req.body.notes || null, { notifyCtx: notifyCtxFrom(req) });
        return res.json(appt);
      }

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

      // A pre-start no-show frees the slot (overlap checks + EXCLUDE ignore
      // no_show) — same waitlist ripple duty as a cancel. Fire-and-forget.
      if (req.body.status === "no_show" && new Date(appt.start_at) > new Date()) {
        try {
          const { offerForFreedAppointmentSlot } = require("../services/waitlist");
          offerForFreedAppointmentSlot(deps.db, appt, notifyCtxFrom(req)).catch(() => {});
        } catch { /* waitlist module optional */ }
      }
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

  // ── Staff ICS calendar feeds (F06 — approved replacement for the dead
  //    Google-sync flag). Token IS the auth on the public feed URL. ────────

  app.post("/api/booking-staff/:employeeId/ics-feed", ...gate, async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      const { rows: [emp] } = await deps.db.query("SELECT id, name FROM employees WHERE id = $1", [employeeId]);
      if (!emp) return res.status(404).json({ error: "Employee not found" });

      const { rows: [existing] } = await deps.db.query(
        "SELECT id, feed_token FROM calendar_sync_accounts WHERE employee_id = $1 AND provider = 'ics'",
        [employeeId]
      );
      let feedToken = existing?.feed_token;
      const rotate = req.query.rotate === "1";
      if (!feedToken || rotate) {
        feedToken = require("crypto").randomBytes(24).toString("hex");
        if (existing) {
          await deps.db.query(
            "UPDATE calendar_sync_accounts SET feed_token = $1, sync_enabled = true, updated_at = NOW() WHERE id = $2",
            [feedToken, existing.id]
          );
        } else {
          await deps.db.query(
            `INSERT INTO calendar_sync_accounts (employee_id, provider, feed_token, sync_enabled)
             VALUES ($1, 'ics', $2, true)`,
            [employeeId, feedToken]
          );
        }
      }
      const feedPath = `/api/public/bookings/employee-feed.ics?tenant=${encodeURIComponent(req.tenantSlug || "")}&token=${feedToken}`;
      res.json({ employee_id: employeeId, employee_name: emp.name, feed_token: feedToken, feed_path: feedPath });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete("/api/booking-staff/:employeeId/ics-feed", ...gate, async (req, res) => {
    try {
      const { rowCount } = await deps.db.query(
        "UPDATE calendar_sync_accounts SET feed_token = NULL, sync_enabled = false, updated_at = NOW() WHERE employee_id = $1 AND provider = 'ics'",
        [Number(req.params.employeeId)]
      );
      if (!rowCount) return res.status(404).json({ error: "No feed for this employee" });
      res.json({ revoked: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Booking Resources (F06 — chairs, beds, bays) ─────────────

  app.get("/api/booking-resources", ...resourceGate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `SELECT r.*, o.name AS outlet_name,
           (SELECT json_agg(json_build_object('id', bs.id, 'name', bs.name))
            FROM booking_resource_assignments ra JOIN booking_services bs ON bs.id = ra.service_id
            WHERE ra.resource_id = r.id) AS services
         FROM booking_resources r
         LEFT JOIN outlets o ON o.id = r.outlet_id
         ORDER BY r.name`
      );
      res.json({ resources: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/booking-resources", ...resourceGate, validate(createResourceSchema), async (req, res) => {
    try {
      const d = req.body;
      const { rows: [resource] } = await deps.db.query(
        `INSERT INTO booking_resources (name, outlet_id, resource_type, capacity, is_active)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [d.name, d.outlet_id, d.resource_type, d.capacity, d.is_active]
      );
      res.status(201).json(resource);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/booking-resources/:id", ...resourceGate, validate(updateResourceSchema), async (req, res) => {
    try {
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(req.body)) {
        if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
      }
      if (!sets.length) return res.status(400).json({ error: "No fields to update" });
      idx++; params.push(Number(req.params.id));
      sets.push("updated_at = NOW()");
      const { rows: [resource] } = await deps.db.query(
        `UPDATE booking_resources SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
      );
      if (!resource) return res.status(404).json({ error: "Resource not found" });
      res.json(resource);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Full-replace of a service's resource mapping (same shape as staff_ids).
  app.put("/api/booking-services/:id/resources", ...resourceGate, validate(setServiceResourcesSchema), async (req, res) => {
    try {
      const serviceId = Number(req.params.id);
      const { rows: [svc] } = await deps.db.query("SELECT id FROM booking_services WHERE id = $1", [serviceId]);
      if (!svc) return res.status(404).json({ error: "Service not found" });
      await deps.db.transaction(async (client) => {
        await client.query("DELETE FROM booking_resource_assignments WHERE service_id = $1", [serviceId]);
        for (const rid of req.body.resource_ids) {
          await client.query(
            "INSERT INTO booking_resource_assignments (service_id, resource_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [serviceId, rid]
          );
        }
      });
      const { rows } = await deps.db.query(
        `SELECT r.id, r.name FROM booking_resource_assignments ra
         JOIN booking_resources r ON r.id = ra.resource_id WHERE ra.service_id = $1 ORDER BY r.name`,
        [serviceId]
      );
      res.json({ service_id: serviceId, resources: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
