"use strict";

/**
 * field.js — Tier 1.1 wholesale field-rep endpoints.
 *
 * GET  /api/field/route/today      — rep view: today's planned customers
 * POST /api/field/check-in          — rep posts GPS + selfie + outcome
 * GET  /api/field/visits            — owner view: visit history with filters
 * GET  /api/field/summary           — owner dashboard cards data (per-rep stats)
 * POST /api/admin/field-routes      — owner seeds/updates a rep's weekly beat
 *
 * Gated by feature flag `wholesale_field_sales`.
 * Permissions:
 *   - manage_field_sales   — owner-side endpoints (visits report, summary, route admin)
 *   - field reps can POST their own check-ins + GET their own route via implicit
 *     ownership check (employee_id = req.employee.id) — no extra permission needed,
 *     but the Field Rep role carries manage_field_sales so requirePerm passes.
 */

const { validate } = require("../middleware/validate");
const { CheckInSchema, SetRouteDaySchema } = require("../schemas/field");
const { distanceMeters } = require("../services/geo");
const { uploadToR2 } = require("../utils/r2");
const crypto = require("crypto");

module.exports = function registerFieldRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  // ─────────────────────────────────────────────────────────────────────
  // Helper: tenant-local day-of-week (0=Sun..6=Sat) using req.company.timezone
  // ─────────────────────────────────────────────────────────────────────
  function tenantDayOfWeek(tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz || "UTC",
        weekday: "short",
      }).formatToParts(new Date());
      const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const wd = parts.find((p) => p.type === "weekday")?.value;
      return map[wd] ?? new Date().getUTCDay();
    } catch {
      return new Date().getUTCDay();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/field/price-quote — per-customer prices for the rep's cart
  //
  // The rep app showed base prices only — a wholesale buyer's negotiated
  // price list never applied on field orders (plan-01 trap 6, field half).
  // Resolves each line through the shared cascade in services/pricing.js
  // (same precedence as POS + storefront). Gated by the Field Rep role's
  // own flag+perm pair — the rep cannot read /api/price-lists directly
  // (manage_inventory) and phase2_outlet_pricing may be off, so the
  // /api/price-resolve route is not usable from this surface.
  //
  // Body: { customer_id, items: [{ product_id, variant_id?, quantity }] }
  // Returns: { prices: [{ product_id, variant_id, unit_price, source }] }
  // ─────────────────────────────────────────────────────────────────────
  app.post(
    "/api/field/price-quote",
    requireFeature("wholesale_field_sales"),
    requirePerm("manage_field_sales"),
    async (req, res) => {
      const { customer_id, items } = req.body || {};
      if (!customer_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "customer_id and items are required" });
      }
      if (items.length > 200) {
        return res.status(400).json({ error: "Too many items (max 200)" });
      }
      try {
        const { resolvePriceForContext } = require("../services/pricing");
        const prices = [];
        for (const it of items) {
          const productId = Number(it.product_id);
          if (!Number.isInteger(productId) || productId <= 0) continue;
          const resolved = await resolvePriceForContext(db, {
            productId,
            variantId: it.variant_id ? Number(it.variant_id) : null,
            qty: Number(it.quantity) || 1,
            customerId: Number(customer_id),
          });
          prices.push({
            product_id: productId,
            variant_id: it.variant_id ? Number(it.variant_id) : null,
            unit_price: resolved.price,
            source: resolved.source,
          });
        }
        res.json({ prices });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/field/route/today — rep view
  // ─────────────────────────────────────────────────────────────────────
  app.get(
    "/api/field/route/today",
    requireFeature("wholesale_field_sales"),
    requirePerm("manage_field_sales"),
    async (req, res) => {
      try {
        const employeeId = req.employee?.id;
        if (!employeeId) return res.status(401).json({ error: "Not authenticated" });

        const dow = tenantDayOfWeek(req.company?.timezone);

        // Today's planned route + each customer's check-in status today
        // (joined via field_visits within current tenant-local day).
        const { rows } = await db.query(
          `
          WITH today_visits AS (
            SELECT customer_id, status, gps_flagged, checked_in_at
            FROM field_visits
            WHERE employee_id = $1
              AND checked_in_at::date = CURRENT_DATE
          )
          SELECT
            r.id            AS route_id,
            r.visit_order,
            c.id            AS customer_id,
            c.name,
            c.mobile,
            c.address,
            c.lat,
            c.lng,
            c.credit_limit,
            tv.status       AS visit_status,
            tv.gps_flagged  AS visit_flagged,
            tv.checked_in_at
          FROM field_rep_routes r
          JOIN customers c ON c.id = r.customer_id AND c.deleted_at IS NULL
          LEFT JOIN today_visits tv ON tv.customer_id = c.id
          WHERE r.employee_id = $1 AND r.day_of_week = $2
          ORDER BY r.visit_order ASC
          `,
          [employeeId, dow]
        );

        res.json({
          day_of_week: dow,
          geofence_meters: Number(req.company?.field_geofence_meters || 500),
          customers: rows,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/field/check-in — rep posts GPS + selfie + outcome
  // ─────────────────────────────────────────────────────────────────────
  app.post(
    "/api/field/check-in",
    requireFeature("wholesale_field_sales"),
    requirePerm("manage_field_sales"),
    validate(CheckInSchema),
    async (req, res) => {
      const {
        customer_id,
        outcome,
        lat,
        lng,
        gps_accuracy_m,
        selfie_base64,
        client_uuid,
        tag_shop_location,
      } = req.body;

      const employeeId = req.employee?.id;
      if (!employeeId) return res.status(401).json({ error: "Not authenticated" });

      try {
        // Idempotency: if a row already exists for this client_uuid, return it.
        // Offline queue retries land here on reconnect — must be a no-op the
        // second time, not a duplicate row or 500.
        const { rows: existing } = await db.query(
          "SELECT id, status, gps_flagged, gps_distance_m FROM field_visits WHERE client_uuid = $1",
          [client_uuid]
        );
        if (existing.length) {
          return res.json({ visit: existing[0], duplicate: true });
        }

        // Resolve customer's stored coordinates for geofence comparison
        const { rows: custRows } = await db.query(
          "SELECT id, lat, lng FROM customers WHERE id = $1 AND deleted_at IS NULL",
          [customer_id]
        );
        if (!custRows.length) {
          return res.status(404).json({ error: "Customer not found" });
        }
        const cust = custRows[0];

        // If the rep is geo-tagging the shop (no saved coords yet), upsert
        // customers.lat/lng using the check-in coordinates as the canonical
        // shop location. Future check-ins compare against this.
        if (tag_shop_location && lat != null && lng != null && cust.lat == null) {
          await db.query(
            "UPDATE customers SET lat = $1, lng = $2 WHERE id = $3",
            [lat, lng, customer_id]
          );
          cust.lat = lat;
          cust.lng = lng;
        }

        // Compute distance + flag
        const geofenceM = Number(req.company?.field_geofence_meters || 500);
        const distance =
          cust.lat != null && cust.lng != null
            ? distanceMeters(Number(cust.lat), Number(cust.lng), Number(lat), Number(lng))
            : null;
        const flagged = distance != null && distance > geofenceM;

        // Upload selfie to R2 if provided (skip silently when missing — failure
        // to upload would block check-in, which is worse than no photo).
        let selfieUrl = null;
        if (selfie_base64) {
          try {
            const matches = String(selfie_base64).match(/^data:(image\/[a-z]+);base64,(.+)$/i);
            const mime = matches ? matches[1] : "image/jpeg";
            const raw = matches ? matches[2] : selfie_base64;
            const buffer = Buffer.from(raw, "base64");
            const ext = mime.split("/")[1] || "jpg";
            const key = `field-selfies/${req.tenantSlug || "default"}/${employeeId}/${client_uuid}.${ext}`;
            selfieUrl = await uploadToR2(buffer, key, mime);
          } catch (e) {
            req.log?.warn?.({ err: e.message }, "Selfie upload failed; continuing without");
          }
        }

        const { rows: inserted } = await db.query(
          `
          INSERT INTO field_visits (
            employee_id, customer_id, outlet_id, checked_in_at,
            gps_lat, gps_lng, gps_accuracy_m, gps_distance_m, gps_flagged,
            selfie_url, status, client_uuid
          ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
          `,
          [
            employeeId,
            customer_id,
            req.context?.outletId || null,
            lat,
            lng,
            gps_accuracy_m,
            distance,
            flagged,
            selfieUrl,
            outcome,
            client_uuid,
          ]
        );

        res.json({ visit: inserted[0], duplicate: false });
      } catch (err) {
        // Race: a concurrent retry inserted between our SELECT and INSERT.
        // The UNIQUE(client_uuid) catches it; we re-read and return idempotent.
        if (String(err.message || "").match(/unique|duplicate/i)) {
          const { rows: again } = await db.query(
            "SELECT id, status, gps_flagged, gps_distance_m FROM field_visits WHERE client_uuid = $1",
            [client_uuid]
          );
          if (again.length) return res.json({ visit: again[0], duplicate: true });
        }
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/field/visits — owner view: visit history
  // Filters: from, to (YYYY-MM-DD), employee_id, flagged_only=1
  // ─────────────────────────────────────────────────────────────────────
  app.get(
    "/api/field/visits",
    requireFeature("wholesale_field_sales"),
    requirePerm("manage_field_sales"),
    async (req, res) => {
      try {
        const { from, to, employee_id, flagged_only } = req.query;
        const where = [];
        const params = [];
        if (from) {
          params.push(from);
          where.push(`v.checked_in_at::date >= $${params.length}`);
        }
        if (to) {
          params.push(to);
          where.push(`v.checked_in_at::date <= $${params.length}`);
        }
        if (employee_id) {
          params.push(Number(employee_id));
          where.push(`v.employee_id = $${params.length}`);
        }
        if (String(flagged_only || "") === "1") {
          where.push(`v.gps_flagged = true`);
        }

        // Tier 1.2: surface the linked sale (if any) so the owner-side visit
        // log can show "this visit took an order of Rs X". LEFT JOIN is safe —
        // visits without an order get NULL for sale_* columns.
        const sql = `
          SELECT
            v.id, v.employee_id, v.customer_id, v.checked_in_at,
            v.gps_lat, v.gps_lng, v.gps_accuracy_m, v.gps_distance_m, v.gps_flagged,
            v.selfie_url, v.status, v.client_uuid,
            e.name AS employee_name,
            c.name AS customer_name, c.mobile AS customer_mobile,
            s.id AS sale_id,
            s.total_amount AS sale_total,
            s.invoice_number AS sale_invoice_number
          FROM field_visits v
          JOIN employees e ON e.id = v.employee_id
          JOIN customers c ON c.id = v.customer_id
          LEFT JOIN sales s ON s.field_visit_id = v.id AND s.voided = false
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY v.checked_in_at DESC NULLS LAST, v.id DESC
          LIMIT 500
        `;
        const { rows } = await db.query(sql, params);
        res.json({ visits: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/field/summary — owner dashboard: per-rep stats for today
  // ─────────────────────────────────────────────────────────────────────
  app.get(
    "/api/field/summary",
    requireFeature("wholesale_field_sales"),
    requirePerm("manage_field_sales"),
    async (req, res) => {
      try {
        const dow = tenantDayOfWeek(req.company?.timezone);

        // Per-rep stats: planned today, checked in, outcomes breakdown, flags,
        // last seen. Only counts employees with employee_type='field_rep'.
        const { rows } = await db.query(
          `
          WITH reps AS (
            SELECT id, name FROM employees
            WHERE employee_type = 'field_rep' AND deleted_at IS NULL
          ),
          planned AS (
            SELECT employee_id, COUNT(*)::int AS planned_count
            FROM field_rep_routes
            WHERE day_of_week = $1
            GROUP BY employee_id
          ),
          today AS (
            SELECT
              employee_id,
              COUNT(*)::int                                            AS checked_in_count,
              COUNT(*) FILTER (WHERE status = 'ordered')::int          AS ordered_count,
              COUNT(*) FILTER (WHERE status = 'no_stock_needed')::int  AS no_stock_count,
              COUNT(*) FILTER (WHERE status = 'shop_closed')::int      AS closed_count,
              COUNT(*) FILTER (WHERE status = 'owner_away')::int       AS away_count,
              COUNT(*) FILTER (WHERE gps_flagged = true)::int          AS flagged_count,
              MAX(checked_in_at)                                       AS last_seen_at
            FROM field_visits
            WHERE checked_in_at::date = CURRENT_DATE
            GROUP BY employee_id
          )
          SELECT
            r.id   AS employee_id,
            r.name AS employee_name,
            COALESCE(p.planned_count, 0)     AS planned_count,
            COALESCE(t.checked_in_count, 0)  AS checked_in_count,
            COALESCE(t.ordered_count, 0)     AS ordered_count,
            COALESCE(t.no_stock_count, 0)    AS no_stock_count,
            COALESCE(t.closed_count, 0)      AS closed_count,
            COALESCE(t.away_count, 0)        AS away_count,
            COALESCE(t.flagged_count, 0)     AS flagged_count,
            t.last_seen_at
          FROM reps r
          LEFT JOIN planned p ON p.employee_id = r.id
          LEFT JOIN today t   ON t.employee_id = r.id
          ORDER BY r.name ASC
          `,
          [dow]
        );

        res.json({ day_of_week: dow, reps: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/admin/field-routes?employee_id=N — owner view: rep's full
  // weekly beat across all 7 days, grouped by day_of_week. Powers the
  // route-assignment admin UI.
  // ─────────────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/field-routes",
    requireFeature("wholesale_field_sales"),
    requirePerm("manage_field_sales"),
    async (req, res) => {
      try {
        const employeeId = Number(req.query.employee_id);
        if (!Number.isInteger(employeeId) || employeeId <= 0) {
          return res.status(400).json({ error: "employee_id is required" });
        }
        const { rows } = await db.query(
          `
          SELECT
            r.day_of_week,
            r.visit_order,
            r.customer_id,
            c.name,
            c.mobile,
            c.address
          FROM field_rep_routes r
          JOIN customers c ON c.id = r.customer_id AND c.deleted_at IS NULL
          WHERE r.employee_id = $1
          ORDER BY r.day_of_week ASC, r.visit_order ASC
          `,
          [employeeId]
        );
        const days = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
        for (const row of rows) {
          days[row.day_of_week].push({
            customer_id: row.customer_id,
            name: row.name,
            mobile: row.mobile,
            address: row.address,
            visit_order: row.visit_order,
          });
        }
        res.json({ employee_id: employeeId, days });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/admin/field-routes — owner seeds/updates a rep's weekly beat.
  // Replace-all semantics for (employee_id, day_of_week).
  // ─────────────────────────────────────────────────────────────────────
  app.post(
    "/api/admin/field-routes",
    requireFeature("wholesale_field_sales"),
    requirePerm("manage_field_sales"),
    validate(SetRouteDaySchema),
    async (req, res) => {
      const { employee_id, day_of_week, customer_ids } = req.body;
      try {
        await db.transaction(async (client) => {
          await client.query(
            "DELETE FROM field_rep_routes WHERE employee_id = $1 AND day_of_week = $2",
            [employee_id, day_of_week]
          );
          for (let i = 0; i < customer_ids.length; i++) {
            await client.query(
              `INSERT INTO field_rep_routes (employee_id, day_of_week, customer_id, visit_order)
               VALUES ($1, $2, $3, $4)`,
              [employee_id, day_of_week, customer_ids[i], i + 1]
            );
          }
        });
        res.json({ ok: true, count: customer_ids.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
