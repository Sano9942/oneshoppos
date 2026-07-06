"use strict";

/**
 * V07 gym — PUBLIC member check-in kiosk (no login).
 *
 * Mounted BEFORE tenant middleware, alongside public-forms / public-bookings.
 * This is the safer realization of the "kiosk lesson" ([[cross_surface_traps_plan01]]
 * traps 3+4): resolving the tenant via resolvePublicTenantDb sidesteps BOTH the
 * PERMISSION_RULES blanket-GET guard AND the allowlist≠public trap, because the
 * route never enters the employee tenant chain at all.
 *
 * Discipline on this path:
 *  - member_checkin feature flag must be ON (merged with DEFAULT_FEATURE_FLAGS
 *    the same way the app does — trap 2 — via getFeatureFlagsMap).
 *  - identify by the unguessable member_code or phone ONLY (never a raw
 *    customer_id — that would let anyone check in an arbitrary member).
 *  - the response is the minimal public projection (toPublicStatus): first
 *    name + verdict + expiry + today's class. No phone / email / pack balance /
 *    dunning reason ever crosses this boundary.
 *  - unknown code → { found: false } (generic; combined with random 8-digit
 *    codes + the rate limiter this makes lobby enumeration impractical).
 */

const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const { memberKioskLimiter } = require("../middleware/rate-limit");
const { getFeatureFlagsMap } = require("../middleware/feature-flags");
const { validate } = require("../middleware/validate");
const { publicMemberLookupSchema, publicMemberCheckinSchema } = require("../schemas/members");
const members = require("../services/members");

module.exports = function registerMemberKioskRoutes(app, deps) {
  // Resolve tenant DB + verify the member_checkin flag is on. Returns
  // { db, tenant, profile } or sends the error response and returns null.
  async function resolveKiosk(req, res) {
    const resolved = await resolvePublicTenantDb(req, deps);
    if (resolved.error) {
      res.status(resolved.status).json({ error: resolved.error });
      return null;
    }
    const { db, tenant } = resolved;
    const flags = await getFeatureFlagsMap(tenant?.id);
    if (!flags.member_checkin) {
      res.status(404).json({ error: "Check-in is not enabled for this location" });
      return null;
    }
    const { rows: [profile] } = await db.query(
      "SELECT timezone, member_grace_checkins FROM company_profile WHERE id = 1"
    );
    return { db, tenant, profile: profile || {} };
  }

  // POST /api/member-kiosk/lookup — preview the door verdict before check-in.
  app.post(
    "/api/member-kiosk/lookup",
    memberKioskLimiter,
    validate(publicMemberLookupSchema),
    async (req, res) => {
      try {
        const ctx = await resolveKiosk(req, res);
        if (!ctx) return;
        const { db, profile } = ctx;

        // Never read customer_id on the public path.
        const customer = await members.lookupMember(db, {
          member_code: req.body.member_code,
          phone: req.body.phone,
        });
        if (!customer) return res.json({ found: false });

        const status = await members.deriveMemberStatus(db, customer, {
          tz: profile.timezone,
          graceCheckins: profile.member_grace_checkins,
        });
        res.json(members.toPublicStatus(status));
      } catch (err) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/member-kiosk/check-in — record the visit, mark class attendance.
  app.post(
    "/api/member-kiosk/check-in",
    memberKioskLimiter,
    validate(publicMemberCheckinSchema),
    async (req, res) => {
      try {
        const ctx = await resolveKiosk(req, res);
        if (!ctx) return;
        const { db, profile } = ctx;

        const customer = await members.lookupMember(db, {
          member_code: req.body.member_code,
          phone: req.body.phone,
        });
        if (!customer) return res.json({ found: false });

        const status = await members.deriveMemberStatus(db, customer, {
          tz: profile.timezone,
          graceCheckins: profile.member_grace_checkins,
        });

        // Only link (mark attended) when allowed in and not already checked in.
        // A denied member's attempt is still recorded (the snapshot captures the
        // 'expired'/'frozen' state for the front-desk feed) but doesn't consume
        // a class slot.
        let classSessionId = null;
        if (status.verdict !== "deny" && status.class_today && !status.class_today.already_checked_in) {
          // Honor an explicit class choice only if it matches the booked class.
          if (!req.body.class_session_id || Number(req.body.class_session_id) === status.class_today.class_session_id) {
            classSessionId = status.class_today.class_session_id;
          }
        }

        await members.recordCheckin(db, {
          customerId: customer.id,
          method: "kiosk",
          outletId: null,
          classSessionId,
          statusSnapshot: status.state,
        });

        const publicStatus = members.toPublicStatus(status);
        publicStatus.checked_in = true;
        publicStatus.class_marked = !!classSessionId;
        res.json(publicStatus);
      } catch (err) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );
};
