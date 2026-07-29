/**
 * F06 — class sessions (group scheduling) admin routes.
 *
 * Timetable CRUD, roster, admin booking/cancel/no-show, and the waitlist
 * admin surface. Every booking write goes through
 * services/class-bookings.js:bookIntoSession — no route-local capacity math.
 */

module.exports = function registerClassRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createClassSessionSchema, updateClassSessionSchema, cancelClassSessionSchema,
    adminClassBookSchema, adminWaitlistAddSchema,
  } = require("../schemas/classes");
  const classBookings = require("../services/class-bookings");
  const waitlist = require("../services/waitlist");

  const gate = [requireMode("appointments"), requireFeature("phase4_appointments_classes"), requirePerm("manage_bookings")];

  const notifyCtxFrom = (req) => ({
    tenantSlug: req.tenantSlug,
    tenant: { slug: req.tenantSlug, name: req.company?.company_name },
    frontendUrl: process.env.FRONTEND_URL,
  });

  // Opportunistic lazy expiry sweep — no worker; every timetable/roster read
  // gives stale offers a chance to move down the line.
  const sweep = (req) => {
    waitlist.expireStaleOffers(deps.db, notifyCtxFrom(req)).catch(() => {});
  };

  // ── Timetable ────────────────────────────────────────────────

  app.get("/api/classes/sessions", ...gate, async (req, res) => {
    try {
      sweep(req);
      const { from, to, employee_id, status, outlet_id } = req.query;
      const params = []; let idx = 0; let where = "1=1";
      if (from) { idx++; where += ` AND cs.start_at >= $${idx}`; params.push(from); }
      if (to) { idx++; where += ` AND cs.start_at <= $${idx}`; params.push(to); }
      if (status) { idx++; where += ` AND cs.status = $${idx}`; params.push(status); }
      if (employee_id) { idx++; where += ` AND cs.employee_id = $${idx}`; params.push(Number(employee_id)); }
      if (outlet_id) { idx++; where += ` AND cs.outlet_id = $${idx}`; params.push(Number(outlet_id)); }

      const { rows } = await deps.db.query(
        `SELECT cs.*, bs.name AS service_name, e.name AS employee_name,
           (SELECT COUNT(*)::int FROM class_session_bookings b
            WHERE b.class_session_id = cs.id AND b.status = 'confirmed') AS confirmed_count,
           (SELECT COUNT(*)::int FROM appointment_waitlist_entries w
            WHERE w.class_session_id = cs.id AND w.status IN ('waiting','offered')) AS waitlist_count
         FROM class_sessions cs
         JOIN booking_services bs ON bs.id = cs.service_id
         LEFT JOIN employees e ON e.id = cs.employee_id
         WHERE ${where}
         ORDER BY cs.start_at ASC`,
        params
      );
      res.json({ sessions: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/classes/sessions", ...gate, validate(createClassSessionSchema), async (req, res) => {
    try {
      const result = await classBookings.createClassSession(deps.db, req.body, {
        timezone: req.company?.timezone,
      });
      res.status(201).json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/classes/sessions/:id", ...gate, validate(updateClassSessionSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (req.body.max_capacity != null) {
        const { rows: [{ n }] } = await deps.db.query(
          "SELECT COUNT(*)::int AS n FROM class_session_bookings WHERE class_session_id = $1 AND status = 'confirmed'",
          [id]
        );
        if (req.body.max_capacity < n) {
          return res.status(400).json({ error: `Capacity cannot go below the ${n} confirmed bookings` });
        }
      }
      const sets = []; const params = []; let idx = 0;
      for (const [key, val] of Object.entries(req.body)) {
        if (val !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(val); }
      }
      if (!sets.length) return res.status(400).json({ error: "No fields to update" });
      idx++; params.push(id);
      sets.push("updated_at = NOW()");
      const { rows: [session] } = await deps.db.query(
        `UPDATE class_sessions SET ${sets.join(", ")} WHERE id = $${idx} AND status <> 'cancelled' RETURNING *`,
        params
      );
      if (!session) return res.status(404).json({ error: "Class session not found (or cancelled)" });
      res.json(session);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/classes/sessions/:id/cancel", ...gate, validate(cancelClassSessionSchema), async (req, res) => {
    try {
      const result = await classBookings.cancelClassSession(deps.db, Number(req.params.id), {
        reason: req.body.reason,
        cascadeSeries: req.body.cascade_series,
        notifyCtx: notifyCtxFrom(req),
      });
      try { await deps.db.query("INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)", [req.employee.id, "class_session_cancelled", JSON.stringify({ ids: result.sessionIds })]); } catch {}
      res.json({ cancelled_session_ids: result.sessionIds, notified_bookings: result.affected.length });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Roster ───────────────────────────────────────────────────

  app.get("/api/classes/sessions/:id/roster", ...gate, async (req, res) => {
    try {
      sweep(req);
      const id = Number(req.params.id);
      const { rows: [session] } = await deps.db.query(
        `SELECT cs.*, bs.name AS service_name, e.name AS employee_name
         FROM class_sessions cs
         JOIN booking_services bs ON bs.id = cs.service_id
         LEFT JOIN employees e ON e.id = cs.employee_id
         WHERE cs.id = $1`,
        [id]
      );
      if (!session) return res.status(404).json({ error: "Class session not found" });
      const { rows: bookings } = await deps.db.query(
        `SELECT b.*, c.name AS customer_display_name, c.mobile AS customer_mobile
         FROM class_session_bookings b
         LEFT JOIN customers c ON c.id = b.customer_id
         WHERE b.class_session_id = $1
         ORDER BY b.created_at ASC`,
        [id]
      );
      const { rows: waitlistEntries } = await deps.db.query(
        `SELECT w.*, c.name AS customer_display_name
         FROM appointment_waitlist_entries w
         LEFT JOIN customers c ON c.id = w.customer_id
         WHERE w.class_session_id = $1 AND w.status IN ('waiting','offered')
         ORDER BY w.created_at ASC`,
        [id]
      );
      res.json({ session, bookings, waitlist: waitlistEntries });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Bookings (admin entry path) ──────────────────────────────

  app.post("/api/classes/sessions/:id/book", ...gate, validate(adminClassBookSchema), async (req, res) => {
    try {
      const result = await classBookings.bookIntoSession(deps.db, {
        classSessionId: Number(req.params.id),
        customerId: req.body.customer_id,
        customerName: req.body.customer_name,
        customerPhone: req.body.customer_phone,
        customerEmail: req.body.customer_email,
        bookedVia: "admin",
      });
      res.status(201).json(result.booking);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
    }
  });

  app.post("/api/classes/bookings/:id/cancel", ...gate, async (req, res) => {
    try {
      const booking = await classBookings.cancelClassBooking(deps.db, Number(req.params.id), {
        notifyCtx: notifyCtxFrom(req),
      });
      res.json(booking);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/classes/bookings/:id/no-show", ...gate, async (req, res) => {
    try {
      const booking = await classBookings.setClassBookingStatus(deps.db, Number(req.params.id), "no_show");
      // A no-show frees a capacity spot — same waitlist ripple duty as a
      // cancel (offerNext refuses started sessions, so post-start no-shows
      // are a safe no-op). Fire-and-forget.
      try {
        const { offerNextForClassSession } = require("../services/waitlist");
        offerNextForClassSession(deps.db, booking.class_session_id, notifyCtxFrom(req)).catch(() => {});
      } catch { /* waitlist module optional */ }
      res.json(booking);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/classes/bookings/:id/confirm", ...gate, async (req, res) => {
    try {
      res.json(await classBookings.setClassBookingStatus(deps.db, Number(req.params.id), "confirmed"));
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Waitlist (admin surface) ─────────────────────────────────
  // Feature-gated on the waitlist sub-flag; classes flag alone doesn't open it.

  const waitlistGate = [requireMode("appointments"), requireFeature("phase4_appointments_waitlists"), requirePerm("manage_bookings")];

  app.get("/api/classes/waitlist", ...waitlistGate, async (req, res) => {
    try {
      sweep(req);
      const { class_session_id, status } = req.query;
      const params = []; let idx = 0; let where = "1=1";
      if (class_session_id) { idx++; where += ` AND w.class_session_id = $${idx}`; params.push(Number(class_session_id)); }
      if (status) { idx++; where += ` AND w.status = $${idx}`; params.push(status); }
      else { where += " AND w.status IN ('waiting','offered')"; }
      const { rows } = await deps.db.query(
        `SELECT w.*, c.name AS customer_display_name, bs.name AS service_name,
           cs.start_at AS class_start_at
         FROM appointment_waitlist_entries w
         LEFT JOIN customers c ON c.id = w.customer_id
         LEFT JOIN booking_services bs ON bs.id = w.service_id
         LEFT JOIN class_sessions cs ON cs.id = w.class_session_id
         WHERE ${where}
         ORDER BY w.created_at ASC`,
        params
      );
      res.json({ entries: rows });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/classes/sessions/:id/waitlist", ...waitlistGate, validate(adminWaitlistAddSchema), async (req, res) => {
    try {
      const entry = await waitlist.joinClassWaitlist(deps.db, {
        classSessionId: Number(req.params.id),
        customerId: req.body.customer_id,
        customerName: req.body.customer_name,
        customerPhone: req.body.customer_phone,
        customerEmail: req.body.customer_email,
      });
      res.status(201).json(entry);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/classes/waitlist/:id/offer", ...waitlistGate, async (req, res) => {
    try {
      const { rows: [entry] } = await deps.db.query(
        "SELECT * FROM appointment_waitlist_entries WHERE id = $1",
        [Number(req.params.id)]
      );
      if (!entry) return res.status(404).json({ error: "Waitlist entry not found" });
      if (entry.status !== "waiting") return res.status(400).json({ error: `Entry is ${entry.status}, not waiting` });
      if (!entry.class_session_id) return res.status(400).json({ error: "Manual offers are for class waitlist entries" });
      const offered = await waitlist.offerNextForClassSession(
        deps.db, entry.class_session_id, notifyCtxFrom(req), { entryId: entry.id }
      );
      if (!offered) return res.status(409).json({ error: "No free spot to offer (class full or offer already pending)" });
      res.json(offered);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/classes/waitlist/:id/remove", ...waitlistGate, async (req, res) => {
    try {
      const { rows: [entry] } = await deps.db.query(
        `UPDATE appointment_waitlist_entries SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND status IN ('waiting','offered') RETURNING *`,
        [Number(req.params.id)]
      );
      if (!entry) return res.status(404).json({ error: "Active waitlist entry not found" });
      res.json(entry);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
