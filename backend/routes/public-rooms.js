"use strict";

/**
 * Public direct booking engine + iCal export feeds (V10). Mounted BEFORE the
 * tenant middleware chain — tenant routing via resolvePublicTenantDb, gated
 * on the `room_online_booking` / `room_channel_sync` flags read directly
 * against the tenant DB (default OFF, same posture as public-rentals.js).
 *
 * The book endpoint goes through the SAME locked room-service.createBooking
 * choke point as the front desk — never a route-local availability check —
 * so an online booking of the last room races safely against a counter one.
 * It creates a 'reserved' booking with a TTL: unpaid holds expire (60 min
 * with a payment gateway, 24h manual) so the public engine can't be used to
 * reserve every room with no payment (denial-of-inventory guard).
 */

const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const { validate } = require("../middleware/validate");
const { publicBookingLimiter } = require("../middleware/rate-limit");
const { publicRoomBookSchema } = require("../schemas/rooms");
const { getPortalLabels, getPublicBookingLabels } = require("../config/industry-config");
const rooms = require("../services/room-service");
const roomDeposits = require("../services/room-deposits");
const channelSync = require("../services/room-channel-sync");

async function flagEnabled(db, key) {
  try {
    const { rows } = await db.query("SELECT enabled FROM feature_flags WHERE key = $1", [key]);
    return rows.length ? rows[0].enabled === true : false;
  } catch { return false; }
}

module.exports = function registerPublicRoomRoutes(app, deps) {

  // GET /api/public/rooms/config — booking page config + label skin
  app.get("/api/public/rooms/config", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await flagEnabled(db, "room_online_booking"))) {
        return res.status(403).json({ error: "Feature disabled: room_online_booking" });
      }
      const { rows: [profile] } = await db.query(
        "SELECT company_name, logo_url, currency_symbol, industry_type FROM company_profile LIMIT 1"
      );
      res.json({
        company_name: profile?.company_name || "",
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
        industry_type: profile?.industry_type || null,
        labels: getPortalLabels(profile?.industry_type || null),
        booking_labels: getPublicBookingLabels(profile?.industry_type || null),
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/public/rooms/availability?from=&to= — room types with live
  // availability + per-stay rate quote (public-safe fields only).
  app.get("/api/public/rooms/availability", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await flagEnabled(db, "room_online_booking"))) {
        return res.status(403).json({ error: "Feature disabled: room_online_booking" });
      }
      const { from, to } = req.query;
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to <= from) {
        return res.status(400).json({ error: "from and to (YYYY-MM-DD, to after from) required" });
      }
      const { rows: types } = await db.query(
        `SELECT id, name, description, capacity, base_rate, deposit_required, amenities, image_url
           FROM room_types WHERE is_active = TRUE ORDER BY base_rate ASC`
      );
      const out = [];
      for (const rt of types) {
        const avail = await rooms.checkRoomAvailability(db, { from, to, room_type_id: rt.id });
        const quote = await rooms.calculateStayTotal(db, { roomTypeId: rt.id, checkIn: from, checkOut: to });
        out.push({
          id: rt.id,
          name: rt.name,
          description: rt.description,
          capacity: rt.capacity,
          amenities: rt.amenities,
          image_url: rt.image_url || null,
          deposit_required: Number(rt.deposit_required || 0),
          rooms_available: avail.rooms_available,
          nights: quote.nights,
          stay_total: quote.subtotal,
          rate_breakdown: quote.rate_breakdown,
        });
      }
      res.json({ from, to, room_types: out });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/rooms/book — 'reserved' booking through the choke point
  // + deposit checkout link (gateway tenants) + F05 confirmation.
  app.post("/api/public/rooms/book", publicBookingLimiter, validate(publicRoomBookSchema), async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db, tenant } = resolved;
      if (!(await flagEnabled(db, "room_online_booking"))) {
        return res.status(403).json({ error: "Feature disabled: room_online_booking" });
      }

      const { room_type_id, check_in_date, check_out_date, guest_name, guest_phone, guest_email, notes } = req.body;

      // Find-or-create a lightweight customer (public-rentals pattern).
      let customerId = null;
      if (guest_phone || guest_email) {
        const { rows } = await db.query(
          `SELECT id FROM customers
            WHERE ($1::text IS NOT NULL AND mobile = $1) OR ($2::text IS NOT NULL AND email = $2)
            ORDER BY id ASC LIMIT 1`,
          [guest_phone || null, guest_email || null]
        );
        customerId = rows[0]?.id || null;
      }
      if (!customerId) {
        const { rows: [c] } = await db.query(
          "INSERT INTO customers (name, mobile, email) VALUES ($1, $2, $3) RETURNING id",
          [guest_name, guest_phone || null, guest_email || null]
        );
        customerId = c.id;
      }

      // System actor (created_by attribution — lowest employee id).
      const { rows: [actor] } = await db.query("SELECT id FROM employees ORDER BY id ASC LIMIT 1");
      if (!actor) return res.status(400).json({ error: "No staff account configured for online bookings" });

      // Unpaid-hold TTL: gateway tenants pay the deposit now (60 min);
      // manual tenants get a front-desk-confirm window (24h).
      const { getPaymentAdapter } = require("../services/payment-gateway");
      const gatewayOn = (() => { try { return getPaymentAdapter().isEnabled(); } catch { return false; } })();
      const { rows: [rt] } = await db.query(
        "SELECT deposit_required FROM room_types WHERE id = $1 AND is_active = TRUE",
        [Number(room_type_id)]
      );
      if (!rt) return res.status(404).json({ error: "Room type not found" });
      const depositRequired = Number(rt.deposit_required || 0);
      const wantsDeposit = gatewayOn && depositRequired > 0;
      const ttlMinutes = wantsDeposit
        ? rooms.ONLINE_RESERVATION_TTL_MINUTES.gateway
        : rooms.ONLINE_RESERVATION_TTL_MINUTES.manual;
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

      const booking = await rooms.createBooking(
        db,
        {
          customer_id: customerId,
          room_type_id: Number(room_type_id),
          check_in_date,
          check_out_date,
          notes: notes || "Online booking",
        },
        actor.id,
        { source: "online", expiresAt }
      );

      // Deposit pre-auth checkout (non-fatal — the hold TTL still governs).
      let depositCheckoutUrl = null;
      if (wantsDeposit) {
        try {
          const preauth = await roomDeposits.createDepositPreAuth(db, {
            bookingId: booking.id,
            amount: depositRequired,
          });
          depositCheckoutUrl = preauth?.checkout_url || preauth?.url || null;
        } catch (err) {
          console.warn("[public-rooms/book] deposit preauth failed:", err.message);
        }
      }

      // F05 confirmation (fire-and-forget; flag-gated inside notify()).
      try {
        const { notify } = require("../services/customer-notify");
        notify(db, {
          event: "room_booking.created",
          customerId,
          data: {
            storeName: tenant?.name || "",
            guestName: guest_name,
            bookingNumber: booking.booking_number,
            checkInDate: check_in_date,
            checkOutDate: check_out_date,
            nights: booking.nights,
            holdUntil: expiresAt,
            depositPaymentUrl: depositCheckoutUrl,
          },
          tenantSlug: tenant?.slug || req.query.tenant || "single",
          tenant: tenant ? { slug: tenant.slug, name: tenant.name } : undefined,
          entityType: "room_booking",
          entityId: booking.id,
        }).catch(() => {});
      } catch { /* notify module optional */ }

      res.status(201).json({
        booking_number: booking.booking_number,
        status: booking.status,
        nights: booking.nights,
        hold_expires_at: expiresAt,
        deposit_checkout_url: depositCheckoutUrl,
        message: depositCheckoutUrl
          ? "Reservation held — pay the deposit to confirm your stay"
          : "Your reservation is received and pending confirmation",
      });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
    }
  });

  // GET /api/public/rooms/ical/:secret — signed export feed (OTAs poll this).
  // The unguessable 48-hex secret IS the credential; ?tenant= routes the
  // schema. Live state — cancelled bookings drop on the OTA's next poll.
  app.get("/api/public/rooms/ical/:secret", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await flagEnabled(db, "room_channel_sync"))) {
        return res.status(403).json({ error: "Feature disabled: room_channel_sync" });
      }
      const secret = String(req.params.secret || "").replace(/\.ics$/i, "");
      if (!/^[a-f0-9]{32,64}$/.test(secret)) return res.status(404).json({ error: "Feed not found" });
      const feed = await channelSync.getFeedBySecret(db, secret);
      if (!feed) return res.status(404).json({ error: "Feed not found" });
      const ics = await channelSync.buildExportFeed(db, feed);
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Cache-Control", "no-cache");
      res.send(ics);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
