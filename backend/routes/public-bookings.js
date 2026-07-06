const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const { validate } = require("../middleware/validate");
const { publicBookingLimiter } = require("../middleware/rate-limit");
const { publicBookingSchema } = require("../schemas/bookings");
const { publicClassBookSchema, publicClassWaitlistSchema, claimOfferSchema } = require("../schemas/classes");
const { getPublicBookingLabels } = require("../config/industry-config");
const { buildIcsEvent } = require("../utils/ics");

module.exports = function registerPublicBookingRoutes(app, deps) {

  // GET /api/public/bookings/config — public booking page config
  app.get("/api/public/bookings/config", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows: [profile] } = await db.query(
        "SELECT company_name, logo_url, currency_symbol, industry_type FROM company_profile LIMIT 1"
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

      const labels = getPublicBookingLabels(profile?.industry_type || null);

      res.json({
        company_name: profile?.company_name || "",
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
        industry_type: profile?.industry_type || null,
        labels,
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
  app.post(
    "/api/public/bookings",
    publicBookingLimiter,
    validate(publicBookingSchema),
    async (req, res) => {
      try {
        const resolved = await resolvePublicTenantDb(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const { db, tenant } = resolved;

        const {
          service_id, employee_id, start_at,
          customer_name, customer_phone, customer_email, notes, card_token,
        } = req.body;

        let companyProfile = null;
        try {
          const { rows: [p] } = await db.query(
            "SELECT company_name, address, phone FROM company_profile LIMIT 1"
          );
          companyProfile = p || null;
        } catch { /* optional */ }

        const tenantCtx = tenant
          ? { id: tenant.id, slug: tenant.slug, name: companyProfile?.company_name || tenant.slug }
          : null;

        const { createAppointment } = require("../services/booking-services");
        const appt = await createAppointment(
          db,
          { service_id, employee_id, start_at, customer_name, customer_phone, customer_email, notes, card_token },
          "public",
          {
            tenant: tenantCtx,
            companyProfile,
            frontendUrl: process.env.FRONTEND_URL || "",
          }
        );

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
    }
  );

  // POST /api/public/bookings/deposit-intent — creates a payment intent via the
  // active payment adapter (sandbox in dev/staging, xPay in prod) and returns
  // the hosted checkout URL. The frontend redirects the customer there, then
  // the payment webhook (routes/webhooks.js) finalises the appointment and
  // marks deposit_status = captured. See docs/plans/tenant-preset-engine-v1
  // /strategy.md for the full flow.
  app.post("/api/public/bookings/deposit-intent", publicBookingLimiter, async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db, tenant } = resolved;
      const { service_id, amount, returnUrl, cancelUrl, booking_draft_id } = req.body || {};
      if (!service_id || !amount) {
        return res.status(400).json({ error: "service_id and amount required" });
      }
      // Verify service exists and deposit is expected.
      const { rows: [svc] } = await db.query(
        "SELECT id, name, require_deposit, deposit_amount FROM booking_services WHERE id = $1",
        [Number(service_id)]
      );
      if (!svc) return res.status(404).json({ error: "Service not found" });

      const gateway = require("../services/payment-gateway");
      const reference = `booking-deposit-${tenant?.slug || "local"}-${service_id}-${Date.now()}`;
      const { checkout_url, gateway_ref } = await gateway.createCheckout({
        amount: Number(amount),
        currency: "PKR",
        reference,
        description: `Booking deposit — ${svc.name}`,
        returnUrl: returnUrl || `${process.env.FRONTEND_URL || ""}/book/${tenant?.slug || ""}?deposit=success`,
        cancelUrl: cancelUrl || `${process.env.FRONTEND_URL || ""}/book/${tenant?.slug || ""}?deposit=cancelled`,
      });

      res.json({
        checkout_url,
        gateway_ref,
        service: { id: svc.id, name: svc.name },
        amount: Number(amount),
        booking_draft_id: booking_draft_id || null,
      });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ── F06 classes (public entry path) ────────────────────────────────
  // These mount before the tenant middleware, so the feature flag is checked
  // directly against the tenant DB (default OFF — same posture as requireFeature).

  async function classFlagEnabled(db) {
    try {
      const { rows } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = 'phase4_appointments_classes'"
      );
      return rows.length ? rows[0].enabled === true : false;
    } catch { return false; }
  }

  async function waitlistFlagEnabled(db) {
    try {
      const { rows } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = 'phase4_appointments_waitlists'"
      );
      return rows.length ? rows[0].enabled === true : false;
    } catch { return false; }
  }

  function publicNotifyCtx(tenant) {
    return {
      tenantSlug: tenant?.slug,
      tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name || tenant.slug } : null,
      frontendUrl: process.env.FRONTEND_URL,
    };
  }

  // GET /api/public/bookings/classes — upcoming bookable sessions
  app.get("/api/public/bookings/classes", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await classFlagEnabled(db))) return res.status(403).json({ error: "Feature disabled: phase4_appointments_classes" });

      const { rows } = await db.query(
        `SELECT cs.id, cs.start_at, cs.end_at, cs.max_capacity, cs.price, cs.notes,
           bs.name AS service_name, bs.description, e.name AS employee_name,
           (SELECT COUNT(*)::int FROM class_session_bookings b
            WHERE b.class_session_id = cs.id AND b.status = 'confirmed') AS confirmed_count
         FROM class_sessions cs
         JOIN booking_services bs ON bs.id = cs.service_id
         LEFT JOIN employees e ON e.id = cs.employee_id
         WHERE cs.status = 'scheduled' AND cs.start_at > NOW()
         ORDER BY cs.start_at ASC
         LIMIT 100`
      );
      res.json({
        sessions: rows.map((r) => ({
          ...r,
          spots_left: Math.max(0, r.max_capacity - r.confirmed_count),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/bookings/classes/book — public class booking
  app.post(
    "/api/public/bookings/classes/book",
    publicBookingLimiter,
    validate(publicClassBookSchema),
    async (req, res) => {
      try {
        const resolved = await resolvePublicTenantDb(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const { db } = resolved;
        if (!(await classFlagEnabled(db))) return res.status(403).json({ error: "Feature disabled: phase4_appointments_classes" });

        const { bookIntoSession } = require("../services/class-bookings");
        const result = await bookIntoSession(db, {
          classSessionId: req.body.class_session_id,
          customerName: req.body.customer_name,
          customerPhone: req.body.customer_phone,
          customerEmail: req.body.customer_email,
          bookedVia: "public",
        });
        res.status(201).json({
          id: result.booking.id,
          status: result.booking.status,
          start_at: result.session.start_at,
          end_at: result.session.end_at,
          message: "Your spot is booked",
        });
      } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({
          error: status === 500 ? "Internal server error" : err.message,
          code: err.code,
          ...(err.code === "CLASS_FULL" ? { hint: "Join the waitlist to be offered the next free spot" } : {}),
        });
      }
    }
  );

  // POST /api/public/bookings/classes/waitlist — join a full class's waitlist
  app.post(
    "/api/public/bookings/classes/waitlist",
    publicBookingLimiter,
    validate(publicClassWaitlistSchema),
    async (req, res) => {
      try {
        const resolved = await resolvePublicTenantDb(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const { db } = resolved;
        if (!(await waitlistFlagEnabled(db))) return res.status(403).json({ error: "Feature disabled: phase4_appointments_waitlists" });

        const { joinClassWaitlist } = require("../services/waitlist");
        const entry = await joinClassWaitlist(db, {
          classSessionId: req.body.class_session_id,
          customerName: req.body.customer_name,
          customerPhone: req.body.customer_phone,
          customerEmail: req.body.customer_email,
        });
        res.status(201).json({ id: entry.id, status: entry.status, message: "You're on the waitlist" });
      } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
      }
    }
  );

  // GET /api/public/bookings/waitlist/claim — claim-page preview (what am I claiming?)
  app.get("/api/public/bookings/waitlist/claim", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      const token = String(req.query.token || "");
      if (token.length < 16) return res.status(400).json({ error: "Invalid claim token" });

      const { rows: [entry] } = await db.query(
        `SELECT w.id, w.status, w.offer_expires_at, w.offered_start_at, w.customer_name,
           w.class_session_id, bs.name AS service_name, cs.start_at AS class_start_at,
           cs.end_at AS class_end_at
         FROM appointment_waitlist_entries w
         LEFT JOIN booking_services bs ON bs.id = w.service_id
         LEFT JOIN class_sessions cs ON cs.id = w.class_session_id
         WHERE w.claim_token = $1`,
        [token]
      );
      if (!entry) return res.status(404).json({ error: "Offer not found" });
      res.json({
        status: entry.status,
        expires_at: entry.offer_expires_at,
        service_name: entry.service_name,
        start_at: entry.class_start_at || entry.offered_start_at,
        end_at: entry.class_end_at || null,
        kind: entry.class_session_id ? "class" : "appointment",
        customer_name: entry.customer_name,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/bookings/waitlist/claim — claim the offered spot
  app.post(
    "/api/public/bookings/waitlist/claim",
    publicBookingLimiter,
    validate(claimOfferSchema),
    async (req, res) => {
      try {
        const resolved = await resolvePublicTenantDb(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const { db, tenant } = resolved;

        const { claimOffer } = require("../services/waitlist");
        const result = await claimOffer(db, req.body.token, publicNotifyCtx(tenant));
        res.status(201).json({
          kind: result.kind,
          booking_id: result.kind === "class" ? result.booking.id : result.appointment.id,
          start_at: result.kind === "class" ? result.session.start_at : result.appointment.start_at,
          message: "Your spot is booked",
        });
      } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: status === 500 ? "Internal server error" : err.message, code: err.code });
      }
    }
  );

  // GET /api/public/bookings/:id/ics — calendar download
  app.get("/api/public/bookings/:id/ics", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid booking id" });
      }

      const { rows: [appt] } = await db.query(
        `SELECT a.id, a.start_at, a.end_at, a.customer_name, a.notes, a.source,
                bs.name AS service_name
         FROM appointments a
         JOIN booking_services bs ON bs.id = a.service_id
         WHERE a.id = $1 AND a.source = 'public'`,
        [id]
      );
      if (!appt) return res.status(404).json({ error: "Booking not found" });

      let companyName = "";
      let address = "";
      try {
        const { rows: [p] } = await db.query(
          "SELECT company_name, address FROM company_profile LIMIT 1"
        );
        companyName = p?.company_name || "";
        address = p?.address || "";
      } catch { /* optional */ }

      const host = (process.env.FRONTEND_URL || "sanopos.com").replace(/^https?:\/\//, "");
      const uid = `booking-${appt.id}@${host}`;

      const summary = companyName
        ? `${appt.service_name} at ${companyName}`
        : appt.service_name;

      const description = [
        companyName ? `Booking at ${companyName}` : null,
        `Booking #${appt.id}`,
        appt.notes ? `Notes: ${appt.notes}` : null,
      ].filter(Boolean).join("\n");

      const ics = buildIcsEvent({
        uid,
        start: appt.start_at,
        end: appt.end_at,
        summary,
        description,
        location: address || undefined,
      });

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="booking-${appt.id}.ics"`
      );
      res.status(200).send(ics);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/public/bookings/employee-feed.ics?tenant=slug&token=... —
  // F06 per-employee subscription feed (the approved replacement for the
  // deleted phase4_google_calendar_sync flag). The token IS the auth: minted
  // per employee via POST /api/booking-staff/:id/ics-feed, revocable, unique.
  app.get("/api/public/bookings/employee-feed.ics", publicBookingLimiter, async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const token = String(req.query.token || "");
      if (token.length < 24) return res.status(401).json({ error: "Invalid feed token" });

      const { rows: [account] } = await db.query(
        `SELECT csa.employee_id, e.name AS employee_name
         FROM calendar_sync_accounts csa
         JOIN employees e ON e.id = csa.employee_id
         WHERE csa.provider = 'ics' AND csa.sync_enabled = true AND csa.feed_token = $1`,
        [token]
      );
      if (!account) return res.status(401).json({ error: "Invalid feed token" });

      // Upcoming 60 days (plus yesterday, so in-flight events don't vanish
      // mid-day). Direct bookings UNION segment assignments — a color+cut's
      // second stylist sees their segment window, not the whole visit.
      const { rows: events } = await db.query(
        `SELECT 'appt-' || a.id AS uid_key, a.start_at, a.end_at, a.status,
                bs.name AS service_name, COALESCE(c.name, a.customer_name) AS customer_name, a.notes
         FROM appointments a
         JOIN booking_services bs ON bs.id = a.service_id
         LEFT JOIN customers c ON c.id = a.customer_id
         WHERE a.employee_id = $1 AND a.status NOT IN ('cancelled','no_show')
           AND a.start_at >= NOW() - INTERVAL '1 day' AND a.start_at < NOW() + INTERVAL '60 days'
         UNION ALL
         SELECT 'seg-' || s.id AS uid_key, s.start_at, s.end_at, pa.status,
                sbs.name AS service_name, COALESCE(c.name, pa.customer_name) AS customer_name, pa.notes
         FROM appointment_segments s
         JOIN appointments pa ON pa.id = s.appointment_id
         JOIN booking_services sbs ON sbs.id = s.service_id
         LEFT JOIN customers c ON c.id = pa.customer_id
         WHERE s.employee_id = $1 AND pa.status NOT IN ('cancelled','no_show')
           AND s.start_at >= NOW() - INTERVAL '1 day' AND s.start_at < NOW() + INTERVAL '60 days'
         ORDER BY start_at ASC
         LIMIT 500`,
        [account.employee_id]
      );

      let companyName = "";
      let address = "";
      try {
        const { rows: [p] } = await db.query("SELECT company_name, address FROM company_profile LIMIT 1");
        companyName = p?.company_name || "";
        address = p?.address || "";
      } catch { /* optional */ }

      const host = (process.env.FRONTEND_URL || "sanopos.com").replace(/^https?:\/\//, "");
      const { buildIcsFeed } = require("../utils/ics");
      const ics = buildIcsFeed({
        calName: companyName ? `${companyName} — ${account.employee_name}` : account.employee_name,
        events: events.map((ev) => ({
          uid: `${ev.uid_key}@${host}`,
          start: ev.start_at,
          end: ev.end_at,
          summary: ev.customer_name ? `${ev.service_name} — ${ev.customer_name}` : ev.service_name,
          description: ev.notes || undefined,
          location: address || undefined,
        })),
      });

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="appointments.ics"');
      res.status(200).send(ics);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
