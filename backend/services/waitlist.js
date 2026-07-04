/**
 * Waitlist offer flow (F06): join → spot frees → oldest waiting entry gets an
 * offer (claim token + expiry window, F05 notification with a public claim
 * link) → claim books through the SAME locked paths (bookIntoSession /
 * createAppointment) → expired offers re-offer to the next in line.
 *
 * Two waitlist kinds share appointment_waitlist_entries:
 *   class_session_id set   → class waitlist (slot = the session itself)
 *   class_session_id null  → appointment waitlist (freed slot snapshot lives
 *                            in offered_start_at / offered_employee_id)
 *
 * Expiry is a lazy sweep (expireStaleOffers) invoked opportunistically from
 * the class/waitlist routes — no dedicated worker.
 */

const crypto = require("crypto");

const OFFER_WINDOW_MINUTES = Number(process.env.WAITLIST_OFFER_WINDOW_MINUTES || 120);

function httpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function newClaimToken() {
  return crypto.randomBytes(24).toString("hex");
}

function claimUrl(notifyCtx, token) {
  const base = (notifyCtx.frontendUrl || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/waitlist/claim?token=${token}&tenant=${encodeURIComponent(notifyCtx.tenantSlug)}`;
}

async function storeName(db, notifyCtx) {
  if (notifyCtx.tenant && notifyCtx.tenant.name) return notifyCtx.tenant.name;
  try {
    const { rows: [p] } = await db.query("SELECT company_name FROM company_profile LIMIT 1");
    return (p && p.company_name) || "";
  } catch { return ""; }
}

/** Join the waitlist for a full class. Dedupes active entries per customer. */
async function joinClassWaitlist(db, opts) {
  const { classSessionId } = opts;
  return db.transaction(async (client) => {
    const { rows: [session] } = await client.query(
      "SELECT * FROM class_sessions WHERE id = $1",
      [Number(classSessionId)]
    );
    if (!session) throw httpError("Class session not found", 404);
    if (session.status !== "scheduled" || new Date(session.start_at) <= new Date()) {
      throw httpError("This class is no longer open for a waitlist", 400);
    }

    const { resolveCustomer } = require("./class-bookings");
    const customerId = await resolveCustomer(client, opts);

    const { rows: [dupe] } = await client.query(
      `SELECT 1 FROM appointment_waitlist_entries
       WHERE class_session_id = $1 AND customer_id = $2 AND status IN ('waiting','offered')`,
      [session.id, customerId]
    );
    if (dupe) throw httpError("Customer is already on this waitlist", 409);

    const { rows: [entry] } = await client.query(
      `INSERT INTO appointment_waitlist_entries
         (service_id, customer_id, class_session_id, customer_name, customer_phone, customer_email)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [session.service_id, customerId, session.id,
       opts.customerName || null, opts.customerPhone || null, opts.customerEmail || null]
    );
    return entry;
  });
}

/** Join the waitlist for an unavailable appointment slot (service + prefs). */
async function joinAppointmentWaitlist(db, opts) {
  return db.transaction(async (client) => {
    const { rows: [service] } = await client.query(
      "SELECT id FROM booking_services WHERE id = $1",
      [Number(opts.serviceId)]
    );
    if (!service) throw httpError("Service not found", 404);

    const { resolveCustomer } = require("./class-bookings");
    const customerId = await resolveCustomer(client, opts);

    const { rows: [dupe] } = await client.query(
      `SELECT 1 FROM appointment_waitlist_entries
       WHERE class_session_id IS NULL AND service_id = $1 AND customer_id = $2
         AND status IN ('waiting','offered')
         AND (preferred_date IS NOT DISTINCT FROM $3)`,
      [service.id, customerId, opts.preferredDate || null]
    );
    if (dupe) throw httpError("Customer is already on this waitlist", 409);

    const { rows: [entry] } = await client.query(
      `INSERT INTO appointment_waitlist_entries
         (service_id, customer_id, employee_id, preferred_date, preferred_time_start,
          preferred_time_end, customer_name, customer_phone, customer_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [service.id, customerId, opts.employeeId || null, opts.preferredDate || null,
       opts.preferredTimeStart || null, opts.preferredTimeEnd || null,
       opts.customerName || null, opts.customerPhone || null, opts.customerEmail || null]
    );
    return entry;
  });
}

/** Dispatch the F05 'waitlist.offer' notification for an offered entry. */
async function notifyOffer(db, entry, slotInfo, notifyCtx) {
  try {
    const { notify } = require("./customer-notify");
    await notify(db, {
      event: "waitlist.offer",
      customerId: entry.customer_id,
      data: {
        storeName: await storeName(db, notifyCtx),
        customerName: entry.customer_name || undefined,
        className: slotInfo.name,
        classStart: slotInfo.startAt,
        offerExpiresAt: entry.offer_expires_at,
        claimUrl: claimUrl(notifyCtx, entry.claim_token),
        // email channel resolves recipient from the customer row; the raw
        // entry email is the fallback for walk-ins without one.
        email: entry.customer_email || undefined,
        mobile: entry.customer_phone || undefined,
      },
      tenantSlug: notifyCtx.tenantSlug,
      tenant: notifyCtx.tenant,
      entityType: "waitlist_entry",
      entityId: entry.id,
    });
  } catch { /* never surface */ }
}

/**
 * A spot freed in a class session → offer it to the oldest waiting entry.
 * Locks the session row so the capacity check can't race a concurrent booking.
 * No-op when the class has no free spot or no waiting entries.
 */
async function offerNextForClassSession(db, classSessionId, notifyCtx, { entryId } = {}) {
  const result = await db.transaction(async (client) => {
    const { rows: [session] } = await client.query(
      "SELECT * FROM class_sessions WHERE id = $1 FOR UPDATE",
      [Number(classSessionId)]
    );
    if (!session || session.status !== "scheduled" || new Date(session.start_at) <= new Date()) return null;

    const { rows: [{ n: taken }] } = await client.query(
      `SELECT (SELECT COUNT(*) FROM class_session_bookings
               WHERE class_session_id = $1 AND status = 'confirmed')::int
            + (SELECT COUNT(*) FROM appointment_waitlist_entries
               WHERE class_session_id = $1 AND status = 'offered'
                 AND offer_expires_at > NOW())::int AS n`,
      [session.id]
    );
    if (taken >= session.max_capacity) return null; // full (incl. live offers holding spots)

    const { rows: [entry] } = await client.query(
      `UPDATE appointment_waitlist_entries SET
         status = 'offered', offered_at = NOW(),
         offer_expires_at = NOW() + make_interval(mins => $2),
         claim_token = $3, updated_at = NOW()
       WHERE id = (
         SELECT id FROM appointment_waitlist_entries
         WHERE class_session_id = $1 AND status = 'waiting'
           AND ($4::int IS NULL OR id = $4::int)
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [session.id, OFFER_WINDOW_MINUTES, newClaimToken(), entryId || null]
    );
    if (!entry) return null;

    const { rows: [svc] } = await client.query(
      "SELECT name FROM booking_services WHERE id = $1", [session.service_id]
    );
    return { entry, slotInfo: { name: (svc && svc.name) || "class", startAt: session.start_at } };
  });

  if (result && notifyCtx && notifyCtx.tenantSlug) {
    await notifyOffer(db, result.entry, result.slotInfo, notifyCtx);
  }
  return result ? result.entry : null;
}

/**
 * A cancelled appointment freed a slot → offer it to the oldest matching
 * appointment-waitlist entry (same service; employee/date prefs must match or
 * be unset). The freed slot snapshot is stored on the entry for claim time.
 */
async function offerForFreedAppointmentSlot(db, appt, notifyCtx) {
  if (!appt || !appt.service_id) return null;
  const result = await db.transaction(async (client) => {
    const { rows: [entry] } = await client.query(
      `UPDATE appointment_waitlist_entries SET
         status = 'offered', offered_at = NOW(),
         offer_expires_at = NOW() + make_interval(mins => $4),
         claim_token = $5, offered_start_at = $2, offered_employee_id = $3, updated_at = NOW()
       WHERE id = (
         SELECT id FROM appointment_waitlist_entries
         WHERE class_session_id IS NULL AND status = 'waiting' AND service_id = $1
           AND (employee_id IS NULL OR employee_id IS NOT DISTINCT FROM $3)
           AND (preferred_date IS NULL OR preferred_date = ($2)::date)
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [appt.service_id, appt.start_at, appt.employee_id || null, OFFER_WINDOW_MINUTES, newClaimToken()]
    );
    if (!entry) return null;
    const { rows: [svc] } = await client.query(
      "SELECT name FROM booking_services WHERE id = $1", [appt.service_id]
    );
    return { entry, slotInfo: { name: (svc && svc.name) || "appointment", startAt: appt.start_at } };
  });

  if (result && notifyCtx && notifyCtx.tenantSlug) {
    await notifyOffer(db, result.entry, result.slotInfo, notifyCtx);
  }
  return result ? result.entry : null;
}

/**
 * Claim an offer by token (public, unauthenticated — the token IS the auth).
 * Books through the same locked paths every other surface uses.
 */
async function claimOffer(db, token, notifyCtx = {}) {
  if (!token || typeof token !== "string" || token.length < 16) {
    throw httpError("Invalid claim token", 400);
  }
  const { rows: [entry] } = await db.query(
    "SELECT * FROM appointment_waitlist_entries WHERE claim_token = $1",
    [token]
  );
  if (!entry) throw httpError("Offer not found", 404);
  if (entry.status === "booked") throw httpError("This offer was already claimed", 409);
  if (entry.status !== "offered") throw httpError("This offer is no longer active", 410);
  if (new Date(entry.offer_expires_at) <= new Date()) {
    // Lazily expire + hand the spot to the next in line.
    await expireEntry(db, entry, notifyCtx);
    throw httpError("This offer has expired", 410);
  }

  let booked;
  if (entry.class_session_id) {
    const { bookIntoSession } = require("./class-bookings");
    try {
      const res = await bookIntoSession(db, {
        classSessionId: entry.class_session_id,
        customerId: entry.customer_id,
        customerName: entry.customer_name,
        customerPhone: entry.customer_phone,
        customerEmail: entry.customer_email,
        bookedVia: "public",
      });
      booked = { kind: "class", booking: res.booking, session: res.session };
    } catch (err) {
      if (err.code === "CLASS_FULL") {
        // Race: the spot was refilled before the claim. Back to waiting.
        await db.query(
          `UPDATE appointment_waitlist_entries SET status = 'waiting', offered_at = NULL,
             offer_expires_at = NULL, claim_token = NULL, updated_at = NOW() WHERE id = $1`,
          [entry.id]
        );
      }
      throw err;
    }
  } else {
    const { createAppointment } = require("./booking-services");
    const appt = await createAppointment(db, {
      service_id: entry.service_id,
      employee_id: entry.offered_employee_id || entry.employee_id || null,
      start_at: entry.offered_start_at,
      customer_id: entry.customer_id,
      customer_name: entry.customer_name,
      customer_phone: entry.customer_phone,
      customer_email: entry.customer_email,
    }, "public", notifyCtx.tenant ? { tenant: notifyCtx.tenant, frontendUrl: notifyCtx.frontendUrl } : {});
    booked = { kind: "appointment", appointment: appt };
  }

  await db.query(
    "UPDATE appointment_waitlist_entries SET status = 'booked', updated_at = NOW() WHERE id = $1",
    [entry.id]
  );
  return { entry: { ...entry, status: "booked" }, ...booked };
}

/** Expire one offered entry and re-offer its spot to the next in line. */
async function expireEntry(db, entry, notifyCtx) {
  await db.query(
    `UPDATE appointment_waitlist_entries SET status = 'expired', updated_at = NOW()
     WHERE id = $1 AND status = 'offered'`,
    [entry.id]
  );
  if (entry.class_session_id) {
    await offerNextForClassSession(db, entry.class_session_id, notifyCtx || {});
  } else if (entry.offered_start_at) {
    await offerForFreedAppointmentSlot(db, {
      service_id: entry.service_id,
      start_at: entry.offered_start_at,
      employee_id: entry.offered_employee_id,
    }, notifyCtx || {});
  }
}

/**
 * Lazy expiry sweep — called opportunistically (fire-and-forget) from the
 * class/waitlist routes. Each expired offer re-offers to the next entry.
 */
async function expireStaleOffers(db, notifyCtx = {}) {
  const { rows: stale } = await db.query(
    `SELECT * FROM appointment_waitlist_entries
     WHERE status = 'offered' AND offer_expires_at <= NOW()
     ORDER BY offer_expires_at ASC LIMIT 20`
  );
  for (const entry of stale) {
    try { await expireEntry(db, entry, notifyCtx); } catch { /* keep sweeping */ }
  }
  return stale.length;
}

module.exports = {
  joinClassWaitlist,
  joinAppointmentWaitlist,
  offerNextForClassSession,
  offerForFreedAppointmentSlot,
  claimOffer,
  expireStaleOffers,
  OFFER_WINDOW_MINUTES,
};
