"use strict";

/**
 * V07 gym — authed staff / front-desk member endpoints.
 *
 * In the tenant chain (db proxy, req.company, req.employee). Full-detail
 * responses (the front desk needs the pack balance, payment-failed flag, and
 * unsigned-waiver flag to actually act on them) — contrast the public kiosk in
 * routes/member-kiosk.js which only ever emits the minimal projection.
 *
 * Gated by requireFeature("member_checkin") + manage_bookings/all_access.
 * deriveMemberStatus is the SAME truth function the kiosk and portal use.
 */

const members = require("../services/members");

module.exports = function registerMembersRoutes(app, deps) {
  // Middleware comes from deps (the app/harness-wired, init'd versions) — not
  // raw module requires, which aren't init'd in the test harness. Mirrors the
  // house convention (routes/packages.js).
  const { db, requireFeature, requireAnyPerm } = deps;
  const { validate } = require("../middleware/validate");
  const { staffMemberLookupSchema, staffMemberCheckinSchema } = require("../schemas/members");

  const gate = [requireFeature("member_checkin"), requireAnyPerm(["manage_bookings", "all_access"])];

  async function loadCustomer(db, body) {
    if (body.customer_id) {
      const { rows: [c] } = await db.query(
        "SELECT id, name, member_code, mobile, email FROM customers WHERE id = $1 AND deleted_at IS NULL",
        [Number(body.customer_id)]
      );
      return c || null;
    }
    return members.lookupMember(db, { member_code: body.member_code, phone: body.phone });
  }

  // POST /api/members/lookup — full detail for the front desk.
  app.post("/api/members/lookup", ...gate, validate(staffMemberLookupSchema), async (req, res) => {
    try {
      const customer = await loadCustomer(db, req.body);
      if (!customer) return res.json({ found: false });
      const status = await members.deriveMemberStatus(db, customer, {
        tz: req.company?.timezone,
        graceCheckins: req.company?.member_grace_checkins,
      });
      res.json({ found: true, ...status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/members/check-in — staff-recorded check-in (full detail response).
  app.post("/api/members/check-in", ...gate, validate(staffMemberCheckinSchema), async (req, res) => {
    try {
      const customer = await loadCustomer(db, req.body);
      if (!customer) return res.status(404).json({ error: "Member not found" });

      const status = await members.deriveMemberStatus(db, customer, {
        tz: req.company?.timezone,
        graceCheckins: req.company?.member_grace_checkins,
      });

      let classSessionId = null;
      if (status.verdict !== "deny" && status.class_today && !status.class_today.already_checked_in) {
        if (!req.body.class_session_id || Number(req.body.class_session_id) === status.class_today.class_session_id) {
          classSessionId = status.class_today.class_session_id;
        }
      }
      const outletId = req.body.outlet_id || req.context?.outletId || null;

      const row = await members.recordCheckin(db, {
        customerId: customer.id,
        method: "staff",
        outletId,
        classSessionId,
        statusSnapshot: status.state,
      });

      res.status(201).json({ checkin: row, class_marked: !!classSessionId, ...status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/members/checkins/today — front-desk live feed + count.
  app.get("/api/members/checkins/today", ...gate, async (req, res) => {
    try {
      const { start, end } = members.todayRangeUtc(req.company?.timezone);
      const { rows } = await db.query(
        `SELECT mc.id, mc.created_at, mc.method, mc.class_session_id,
                mc.membership_status_at_checkin AS status,
                c.id AS customer_id, c.name AS member_name, c.member_code,
                svc.name AS class_title
           FROM member_checkins mc
           JOIN customers c ON c.id = mc.customer_id
           LEFT JOIN class_sessions cs ON cs.id = mc.class_session_id
           LEFT JOIN booking_services svc ON svc.id = cs.service_id
          WHERE mc.created_at >= $1 AND mc.created_at < $2
          ORDER BY mc.created_at DESC
          LIMIT 200`,
        [start, end]
      );
      res.json({ checkins: rows, count: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/members/:id/assign-code — issue/return a member card code.
  app.post("/api/members/:id/assign-code", ...gate, async (req, res) => {
    try {
      const code = await members.ensureMemberCode(db, Number(req.params.id));
      res.json({ member_code: code });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
