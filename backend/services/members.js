/**
 * backend/services/members.js — Gym member check-in + active-membership truth (V07).
 *
 * The status verdict at the door MUST derive from the same billing state the
 * renewal/dunning engine writes — otherwise the door lies (a member whose card
 * failed three weeks ago but whose subscription row is still `active` because
 * dunning hasn't paused it yet would be waved in forever). `deriveMemberStatus`
 * is that single source of truth, reused by the public kiosk, the authed
 * front-desk widget, and the portal.
 *
 * PII discipline: `deriveMemberStatus` returns the full picture (phone, plan,
 * pack balance, payment-failed reason, unsigned waiver) for the AUTHED staff
 * surface. `toPublicStatus` projects it down to what a lobby kiosk may show —
 * first name + verdict + expiry + today's class only. No phone, no balance, no
 * failure reason on the public path (see the enumeration hardening in the V07
 * plan).
 */

const crypto = require("crypto");

// Derived membership states, strongest entitlement first. The door verdict is
// computed from the strongest subscription a member holds, then overlaid with
// the payment-failed flag.
const STATE_RANK = {
  active: 6,
  trial: 5,
  grace: 4,
  frozen: 2,
  payment_failed: 2,
  expired: 1,
  cancelled: 1,
  none: 0,
};

const STATE_LABEL = {
  active: "Active",
  trial: "Trial",
  grace: "Grace period",
  frozen: "Frozen",
  payment_failed: "Payment failed",
  expired: "Expired",
  cancelled: "Cancelled",
  pack: "Class pass",
  none: "No active membership",
};

/** Local `YYYY-MM-DD` for the tenant timezone (falls back to UTC). */
function localDateStr(tz) {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: tz || "UTC" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** [startUtc, endUtc) covering "today" in the tenant timezone. */
function todayRangeUtc(tz) {
  const { toUtcStart, toUtcEnd } = require("../utils/tz");
  const day = localDateStr(tz);
  return { start: toUtcStart(day, tz || "UTC"), end: toUtcEnd(day, tz || "UTC") };
}

/**
 * Generate a random, non-sequential 8-digit member code, retrying on the rare
 * unique-index collision. Random (not sequential) so a lobby kiosk can't be
 * used to enumerate the member list by counting up.
 */
async function generateMemberCode(db, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const code = String(crypto.randomInt(10_000_000, 100_000_000)); // 8 digits
    const { rows } = await db.query(
      "SELECT 1 FROM customers WHERE member_code = $1",
      [code]
    );
    if (!rows.length) return code;
  }
  throw new Error("could not generate a unique member_code");
}

/**
 * Ensure a customer has a member_code, assigning one if absent. Returns the
 * code. Idempotent — safe to call on every enrollment. The UPDATE guards on
 * `member_code IS NULL` so a concurrent assigner can't clobber an existing one.
 */
async function ensureMemberCode(db, customerId) {
  const { rows: [existing] } = await db.query(
    "SELECT member_code FROM customers WHERE id = $1",
    [customerId]
  );
  if (existing && existing.member_code) return existing.member_code;
  // Retry loop: a collision on the partial-unique index is possible under a
  // race; regenerate and try again.
  for (let i = 0; i < 6; i++) {
    const code = await generateMemberCode(db);
    try {
      const { rows } = await db.query(
        "UPDATE customers SET member_code = $2 WHERE id = $1 AND member_code IS NULL RETURNING member_code",
        [customerId, code]
      );
      if (rows.length) return rows[0].member_code;
      // Lost the race — someone else assigned. Return whatever's there now.
      const { rows: [now] } = await db.query(
        "SELECT member_code FROM customers WHERE id = $1",
        [customerId]
      );
      if (now && now.member_code) return now.member_code;
    } catch (err) {
      if (!String(err.message).includes("uq_customers_member_code")) throw err;
      // unique collision — loop and regenerate
    }
  }
  throw new Error("could not assign member_code");
}

/**
 * Resolve a member from a scannable code or a phone number. Exact match on
 * member_code first (the scanned/typed card), else phone (mobile). Returns the
 * customer row or null.
 */
async function lookupMember(db, { member_code, phone } = {}) {
  if (member_code) {
    const code = String(member_code).trim();
    const { rows } = await db.query(
      "SELECT id, name, member_code, mobile, email FROM customers WHERE member_code = $1 AND deleted_at IS NULL",
      [code]
    );
    if (rows.length) return rows[0];
  }
  if (phone) {
    const p = String(phone).trim();
    const { rows } = await db.query(
      "SELECT id, name, member_code, mobile, email FROM customers WHERE mobile = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1",
      [p]
    );
    if (rows.length) return rows[0];
  }
  return null;
}

/** Derive one subscription's standing (before the payment-failed overlay). */
function subState(sub, now) {
  if (sub.status === "cancelled") {
    return { state: "cancelled", expiry: sub.cancelled_at || sub.current_period_end };
  }
  if (sub.status === "draft") return { state: "none", expiry: null };
  if (sub.status === "paused") {
    // frozen vs dunning-paused resolved by the caller's payment_failed overlay
    return { state: "frozen", expiry: sub.current_period_end, frozenAt: sub.paused_at };
  }
  // active
  if (sub.trial_end && new Date(sub.trial_end) > now) {
    return { state: "trial", expiry: sub.trial_end };
  }
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
  if (!periodEnd || periodEnd > now) return { state: "active", expiry: periodEnd };
  const graceEnd = sub.grace_period_end ? new Date(sub.grace_period_end) : null;
  if (graceEnd && graceEnd > now) return { state: "grace", expiry: periodEnd };
  return { state: "expired", expiry: periodEnd };
}

/**
 * The single source of truth for a member's standing at the door.
 *
 * @param db tenant db
 * @param customer resolved customer row ({ id, name, member_code, mobile, email })
 * @param opts { tz, graceCheckins }
 * @returns full status object (project via toPublicStatus for the public path)
 */
async function deriveMemberStatus(db, customer, opts = {}) {
  const tz = opts.tz || "UTC";
  const graceCheckins = Number(opts.graceCheckins) || 0;
  const now = new Date();
  const first_name = String(customer.name || "").trim().split(/\s+/)[0] || "Member";

  // 1. Subscriptions → pick the strongest standing.
  const { rows: subs } = await db.query(
    `SELECT cs.id, cs.status, cs.current_period_end, cs.grace_period_end,
            cs.trial_end, cs.paused_at, cs.cancelled_at, sp.name AS plan_name
       FROM customer_subscriptions cs
       JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.customer_id = $1`,
    [customer.id]
  );
  let best = null;
  for (const s of subs) {
    const st = subState(s, now);
    st.plan_name = s.plan_name;
    if (
      !best ||
      STATE_RANK[st.state] > STATE_RANK[best.state] ||
      (STATE_RANK[st.state] === STATE_RANK[best.state] &&
        st.expiry && best.expiry && new Date(st.expiry) > new Date(best.expiry))
    ) {
      best = st;
    }
  }

  // 2. Open failed charge (dunning in progress) — surfaces even when the
  //    subscription row is still `active`. This is the "card failed weeks ago,
  //    door says welcome forever" fix.
  const { rows: [failed] } = await db.query(
    `SELECT sr.dunning_attempts, sr.first_failed_at, sr.next_dunning_at
       FROM subscription_runs sr
       JOIN customer_subscriptions cs ON cs.id = sr.subscription_id
      WHERE cs.customer_id = $1 AND sr.charge_status = 'failed' AND sr.dunning_done_at IS NULL
      ORDER BY sr.first_failed_at ASC LIMIT 1`,
    [customer.id]
  );
  const payment_failed = !!failed;

  // 3. Active packages (class/PT passes) — a member can be entitled by a pack
  //    even with no live subscription.
  const { rows: [pk] } = await db.query(
    `SELECT COUNT(*)::int AS active_count,
            COALESCE(SUM(credits_total - credits_used), 0)::int AS credits_remaining
       FROM customer_packages
      WHERE customer_id = $1 AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [customer.id]
  );
  const packages = { active_count: pk.active_count, credits_remaining: pk.credits_remaining };

  // 4. Unsigned waiver (any pending signature-required form attached to member).
  const { rows: [wv] } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM form_responses fr
       JOIN form_templates ft ON ft.id = fr.form_template_id
      WHERE fr.customer_id = $1 AND fr.status = 'pending' AND ft.require_signature = TRUE`,
    [customer.id]
  );
  const unsigned_waiver = wv.n > 0;

  // 5. Today's booked class (+ whether already checked in today).
  const { start, end } = todayRangeUtc(tz);
  const { rows: [cls] } = await db.query(
    `SELECT b.id AS booking_id, b.class_session_id, cs.start_at, cs.end_at,
            svc.name AS title,
            EXISTS (
              SELECT 1 FROM member_checkins mc
               WHERE mc.customer_id = $1 AND mc.class_session_id = b.class_session_id
                 AND mc.created_at >= $2 AND mc.created_at < $3
            ) AS already_checked_in
       FROM class_session_bookings b
       JOIN class_sessions cs ON cs.id = b.class_session_id
       JOIN booking_services svc ON svc.id = cs.service_id
      WHERE b.customer_id = $1 AND b.status = 'confirmed'
        AND cs.start_at >= $2 AND cs.start_at < $3
        AND cs.status IN ('scheduled','in_progress')
      ORDER BY cs.start_at ASC LIMIT 1`,
    [customer.id, start, end]
  );
  const class_today = cls
    ? {
        booking_id: cls.booking_id,
        class_session_id: cls.class_session_id,
        title: cls.title,
        start_at: cls.start_at,
        end_at: cls.end_at,
        already_checked_in: cls.already_checked_in,
      }
    : null;

  // 6. Resolve final state + verdict.
  let state = best ? best.state : "none";
  let expiry_date = best ? best.expiry : null;
  let plan_name = best ? best.plan_name : null;
  let frozen_until = null;
  let message = "";

  // Frozen: distinguish manual freeze from dunning-auto-pause.
  if (state === "frozen") {
    if (payment_failed) {
      state = "payment_failed";
    } else {
      frozen_until = best.frozenAt || null;
    }
  }

  // Pack-only entitlement: no live subscription but credits remain → allow.
  let pack_entitled = false;
  if (STATE_RANK[state] <= 1 && packages.credits_remaining > 0) {
    pack_entitled = true;
  }

  // Grace-checkin policy: a lapsed (not cancelled) member may get N courtesy
  // check-ins before the door goes red, if the tenant enabled it.
  let grace_used = 0;
  if (state === "expired" && graceCheckins > 0 && expiry_date) {
    const { rows: [gc] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM member_checkins
        WHERE customer_id = $1 AND created_at > $2
          AND membership_status_at_checkin IN ('grace','expired')`,
      [customer.id, expiry_date]
    );
    grace_used = gc.n;
    if (grace_used < graceCheckins) state = "grace";
  }

  // Verdict from final state.
  let verdict;
  if (state === "active" || state === "trial") verdict = "allow";
  else if (state === "grace") verdict = "warn";
  else if (pack_entitled) { verdict = "allow"; }
  else verdict = "deny";

  // Payment-failed overlay: an otherwise-allowed member is downgraded to a
  // warning so the desk can collect while the member is physically present.
  if (payment_failed && verdict === "allow" && state !== "payment_failed") {
    verdict = "warn";
  }

  // Human line for the door.
  const effectiveLabel = pack_entitled && STATE_RANK[state] <= 1 ? STATE_LABEL.pack : STATE_LABEL[state];
  const dateStr = expiry_date ? new Date(expiry_date).toISOString().slice(0, 10) : null;
  if (verdict === "allow" && !payment_failed) {
    message = pack_entitled && STATE_RANK[state] <= 1
      ? `Welcome — ${packages.credits_remaining} class pass credit${packages.credits_remaining === 1 ? "" : "s"} left`
      : `Welcome${dateStr ? ` — membership active to ${dateStr}` : ""}`;
  } else if (verdict === "warn" && payment_failed) {
    message = "Payment issue on file — please see the front desk";
  } else if (state === "grace") {
    message = `Renewal due${dateStr ? ` (expired ${dateStr})` : ""} — please see the front desk`;
  } else if (state === "payment_failed") {
    message = "Membership paused — payment failed. Please see the front desk";
  } else if (state === "frozen") {
    message = "Membership frozen — please see the front desk to resume";
  } else if (state === "cancelled") {
    message = "Membership cancelled — please see the front desk";
  } else if (state === "expired") {
    message = `Membership expired${dateStr ? ` ${dateStr}` : ""} — please see the front desk`;
  } else {
    message = "No active membership — please see the front desk";
  }

  const needs_front_desk =
    verdict !== "allow" || payment_failed || unsigned_waiver;

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      first_name,
      member_code: customer.member_code,
      phone: customer.mobile,
      email: customer.email,
    },
    verdict,
    state,
    status_label: effectiveLabel,
    expiry_date: expiry_date ? new Date(expiry_date).toISOString() : null,
    plan_name,
    payment_failed,
    dunning: failed
      ? { attempts: failed.dunning_attempts, first_failed_at: failed.first_failed_at, next_retry_at: failed.next_dunning_at }
      : null,
    frozen_until,
    packages,
    unsigned_waiver,
    grace: graceCheckins > 0 ? { allowed: graceCheckins, used: grace_used } : null,
    class_today,
    message,
    needs_front_desk,
  };
}

/**
 * Project a full status object to the minimal public (kiosk) shape. First name,
 * verdict, a short status label, expiry, and today's class — nothing else. No
 * phone, no email, no pack balance, no dunning detail on the enumerable path.
 */
function toPublicStatus(status) {
  return {
    found: true,
    first_name: status.customer.first_name,
    verdict: status.verdict,
    status_label: status.status_label,
    expiry_date: status.expiry_date,
    needs_front_desk: status.needs_front_desk,
    class_today: status.class_today
      ? {
          class_session_id: status.class_today.class_session_id,
          title: status.class_today.title,
          start_at: status.class_today.start_at,
          already_checked_in: status.class_today.already_checked_in,
        }
      : null,
    message: status.message,
  };
}

/**
 * Record a check-in. If the member has a booked class today, the row links to
 * it (member_checkins.class_session_id IS the attendance mark — no separate
 * write to class_session_bookings). Returns the inserted row.
 */
async function recordCheckin(db, { customerId, method = "kiosk", outletId = null, classSessionId = null, statusSnapshot = null }) {
  const { rows: [row] } = await db.query(
    `INSERT INTO member_checkins (customer_id, outlet_id, class_session_id, method, membership_status_at_checkin)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [customerId, outletId, classSessionId, method, statusSnapshot]
  );
  return row;
}

module.exports = {
  STATE_RANK,
  STATE_LABEL,
  generateMemberCode,
  ensureMemberCode,
  lookupMember,
  deriveMemberStatus,
  toPublicStatus,
  recordCheckin,
  todayRangeUtc,
};
