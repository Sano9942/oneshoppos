// Phase 2-R.4 — Public reservation booking.
//
// No-auth endpoints used by the /reserve/:tenantSlug guest page. Tenant
// resolved via slug param so rate-limiting keys against (tenant, IP).

const crypto = require("crypto");

module.exports = function registerPublicReservationsRoutes(app, deps) {
  const { resolvePublicTenantDb } = require("../services/public-tenant-context");
  const { webhookLimiter } = require("../middleware/rate-limit");
  const { publicReservationCreateSchema } = require("../schemas/reservations");

  // Tenant slug resolver wrapper — allow it as either a route param or query
  // so the frontend can use whichever is cleanest.
  //
  // Express 5 changed `req.query` to a getter that re-parses `req.url` on every
  // access — mutations to `req.query.X = Y` write to a temporary object that's
  // discarded on the next access. We pass the slug via the `x-tenant-slug`
  // request header instead (mutable in Express 5), which `resolvePublicTenantDb`
  // already reads as a fallback.
  async function resolveForSlug(req, deps) {
    const tenantSlug = req.params.tenantSlug || req.query.tenant;
    if (tenantSlug) req.headers["x-tenant-slug"] = String(tenantSlug);
    return resolvePublicTenantDb(req, deps);
  }

  // Availability: 30-min slots between 09:00 and 22:00 local. If a slot
  // already has an overlapping reservation for the same (floating) table,
  // subtract it. Keeping the rules simple for MVP — the admin page lets
  // staff double-book manually if needed.
  app.get(
    "/api/public/restaurant/reservations/:tenantSlug/availability",
    webhookLimiter,
    async (req, res) => {
      try {
        const resolved = await resolveForSlug(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const db = resolved.db;

        const dateStr = String(req.query.date || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          return res.status(400).json({ error: "Invalid date — expected YYYY-MM-DD" });
        }

        // Generate 30-min slots 09:00–22:00. NOTE: slots are anchored to UTC
        // wall-clock (…Z) and stored reservations are matched in the same UTC
        // frame below — the whole endpoint is internally consistent in UTC.
        const slots = [];
        for (let h = 9; h < 22; h++) {
          for (const m of [0, 30]) {
            const hh = String(h).padStart(2, "0");
            const mm = String(m).padStart(2, "0");
            const startIso = `${dateStr}T${hh}:${mm}:00.000Z`;
            slots.push({ time: `${hh}:${mm}`, start: startIso });
          }
        }

        // Filter booked reservations by an explicit UTC day range, NOT
        // `reservation_start::date = $1` — that cast uses the DB session
        // TimeZone, so under a non-UTC session a reservation would fall on a
        // different calendar date than the (UTC-anchored) slots and read as
        // available → double-book. A [dayStartUtc, nextDayUtc) range keeps the
        // filter in the same UTC frame as slot generation + the match below.
        const dayStartUtc = `${dateStr}T00:00:00.000Z`;
        const dayEndUtc = new Date(Date.parse(dayStartUtc) + 86400000).toISOString();
        const { rows: booked } = await db.query(
          `SELECT reservation_start FROM reservations
           WHERE reservation_start >= $1 AND reservation_start < $2
             AND status IN ('pending','confirmed','seated')`,
          [dayStartUtc, dayEndUtc]
        );
        const bookedSet = new Set(
          booked.map((r) => new Date(r.reservation_start).toISOString().slice(0, 16))
        );

        const available = slots.map((s) => ({
          ...s,
          available: !bookedSet.has(s.start.slice(0, 16)),
        }));

        res.json({ date: dateStr, slots: available });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // Create reservation — public page flow.
  app.post(
    "/api/public/restaurant/reservations/:tenantSlug",
    webhookLimiter,
    async (req, res) => {
      try {
        const resolved = await resolveForSlug(req, deps);
        if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
        const db = resolved.db;

        const parsed = publicReservationCreateSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid payload",
            issues: parsed.error.issues.map((i) => i.message),
          });
        }
        const body = parsed.data;
        const token = crypto.randomUUID();

        const { rows: [row] } = await db.query(
          `INSERT INTO reservations
            (customer_name, phone, email, party_size, reservation_start,
             status, notes, source, token)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'web', $7)
           RETURNING id, token, reservation_start, party_size, status`,
          [
            body.customer_name,
            body.phone || null,
            body.email || null,
            body.party_size,
            body.reservation_start,
            body.notes || null,
            token,
          ]
        );
        res.status(201).json(row);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
