"use strict";

/**
 * Public online rental booking (V09). Mounted BEFORE the tenant middleware
 * chain — tenant routing via resolvePublicTenantDb, gated on the
 * `rental_online_booking` flag checked directly against the tenant DB
 * (default OFF, same posture as requireFeature).
 *
 * The reserve endpoint goes through the SAME locked rental-service.createContract
 * as the staff path — never a route-local availability check — so an online
 * reservation of the last unit races safely against a counter reservation
 * ([[feedback_parallel_paths]]). It creates a 'reserved' contract pending staff
 * confirmation (the lifecycle's first state).
 */

const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const { validate } = require("../middleware/validate");
const { publicBookingLimiter } = require("../middleware/rate-limit");
const { publicReserveSchema } = require("../schemas/rentals");
const { getPortalLabels } = require("../config/industry-config");
const rentals = require("../services/rental-service");

async function onlineBookingEnabled(db) {
  try {
    const { rows } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'rental_online_booking'"
    );
    return rows.length ? rows[0].enabled === true : false;
  } catch { return false; }
}

module.exports = function registerPublicRentalRoutes(app, deps) {

  // GET /api/public/rentals/config — public rental page config + label skin
  app.get("/api/public/rentals/config", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await onlineBookingEnabled(db))) {
        return res.status(403).json({ error: "Feature disabled: rental_online_booking" });
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
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/public/rentals/items — bookable rental items (public-safe fields)
  app.get("/api/public/rentals/items", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await onlineBookingEnabled(db))) {
        return res.status(403).json({ error: "Feature disabled: rental_online_booking" });
      }
      const { rows } = await db.query(
        `SELECT id, name, description, daily_rate, hourly_rate, weekly_rate, deposit_amount, total_quantity
           FROM rental_items WHERE is_active = TRUE ORDER BY name ASC`
      );
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/public/rentals/items/:id/availability?from=&to=
  app.get("/api/public/rentals/items/:id/availability", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await onlineBookingEnabled(db))) {
        return res.status(403).json({ error: "Feature disabled: rental_online_booking" });
      }
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to query params required" });
      const availability = await rentals.getItemAvailability(db, Number(req.params.id), from, to);
      if (!availability) return res.status(404).json({ error: "Rental item not found" });
      res.json(availability);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/rentals/reserve — create a 'reserved' contract (pending
  // staff confirm) through the shared locked service fn.
  app.post("/api/public/rentals/reserve", publicBookingLimiter, validate(publicReserveSchema), async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;
      if (!(await onlineBookingEnabled(db))) {
        return res.status(403).json({ error: "Feature disabled: rental_online_booking" });
      }

      const { customer_name, customer_phone, customer_email, rental_start, expected_return, notes, lines } = req.body;

      // Find or create a lightweight customer for the reservation.
      let customerId = null;
      if (customer_phone || customer_email) {
        const { rows } = await db.query(
          `SELECT id FROM customers
            WHERE ($1::text IS NOT NULL AND mobile = $1) OR ($2::text IS NOT NULL AND email = $2)
            ORDER BY id ASC LIMIT 1`,
          [customer_phone || null, customer_email || null]
        );
        customerId = rows[0]?.id || null;
      }
      if (!customerId) {
        const { rows: [c] } = await db.query(
          "INSERT INTO customers (name, mobile, email) VALUES ($1, $2, $3) RETURNING id",
          [customer_name, customer_phone || null, customer_email || null]
        );
        customerId = c.id;
      }

      // System actor for online bookings (created_by is NOT NULL). Lowest
      // employee id acts as the online-booking attributor.
      const { rows: [actor] } = await db.query("SELECT id FROM employees ORDER BY id ASC LIMIT 1");
      if (!actor) return res.status(400).json({ error: "No staff account configured for online bookings" });

      const contract = await rentals.createContract(
        db,
        { customer_id: customerId, rental_start, expected_return, notes: notes || "Online reservation", lines },
        actor.id
      );
      await rentals.logActivity(db, contract.id, actor.id, "note", "Reserved online (pending staff confirmation)");

      res.status(201).json({
        contract_number: contract.contract_number,
        status: contract.status,
        message: "Your reservation is received and pending confirmation",
      });
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
    }
  });
};
