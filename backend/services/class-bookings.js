/**
 * Class sessions + bookings (F06 scheduling engine).
 *
 * ALL booking writes — admin calendar, customer portal, public page, and the
 * V07 kiosk later — go through bookIntoSession()/cancelClassBooking() here.
 * No route does its own capacity math ([[feedback_parallel_paths]]).
 *
 * Concurrency contract: `SELECT … FOR UPDATE` on the class_sessions row
 * serializes every booking/cancel for that session inside one transaction, so
 * the capacity count the loser sees includes the winner's committed row.
 * The partial unique index uq_class_booking_active kills same-member
 * double-booking as the DB-level backstop (23505 → friendly 409).
 */

const OCCURRENCE_MAX_WEEKS = 12;

function httpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

/**
 * Find-or-create a customer row from public/portal contact input so capacity,
 * waitlists, and F05 notifications all key on a real customer id. Match order:
 * mobile, then email. Runs inside the caller's transaction.
 */
async function resolveCustomer(client, { customerId, customerName, customerPhone, customerEmail }) {
  if (customerId) {
    const { rows: [c] } = await client.query("SELECT id FROM customers WHERE id = $1", [customerId]);
    if (!c) throw httpError("Customer not found", 404);
    return c.id;
  }
  if (customerPhone) {
    const { rows: [c] } = await client.query(
      "SELECT id FROM customers WHERE mobile = $1 ORDER BY id LIMIT 1",
      [customerPhone]
    );
    if (c) return c.id;
  }
  if (customerEmail) {
    const { rows: [c] } = await client.query(
      "SELECT id FROM customers WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1",
      [customerEmail]
    );
    if (c) return c.id;
  }
  if (!customerPhone && !customerEmail) {
    throw httpError("customer_id or customer_phone/customer_email is required", 400);
  }
  const { rows: [created] } = await client.query(
    "INSERT INTO customers (name, mobile, email) VALUES ($1, $2, $3) RETURNING id",
    [customerName || customerPhone || customerEmail, customerPhone || null, customerEmail || null]
  );
  return created.id;
}

/**
 * THE class booking entry point (all surfaces).
 *
 * @param {object} db - tenant-scoped DB (must expose .transaction)
 * @param {object} opts
 * @param {number} opts.classSessionId
 * @param {number} [opts.customerId]     - or contact fields below (find-or-create)
 * @param {string} [opts.customerName]
 * @param {string} [opts.customerPhone]
 * @param {string} [opts.customerEmail]
 * @param {string} [opts.bookedVia]      - 'admin' | 'portal' | 'public' | 'kiosk'
 * @returns {Promise<{booking: object, session: object}>}
 * @throws 404 session/customer missing · 400 not bookable · 409 CLASS_FULL / already booked
 */
async function bookIntoSession(db, opts) {
  const { classSessionId, bookedVia = "admin" } = opts;

  return db.transaction(async (client) => {
    const { rows: [session] } = await client.query(
      "SELECT * FROM class_sessions WHERE id = $1 FOR UPDATE",
      [Number(classSessionId)]
    );
    if (!session) throw httpError("Class session not found", 404);
    if (session.status !== "scheduled") {
      throw httpError(`Class session is ${session.status} and cannot be booked`, 400);
    }
    if (bookedVia !== "admin" && new Date(session.start_at) <= new Date()) {
      throw httpError("This class has already started", 400);
    }

    const resolvedCustomerId = await resolveCustomer(client, opts);

    const { rows: [{ n: confirmedCount }] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM class_session_bookings
       WHERE class_session_id = $1 AND status = 'confirmed'`,
      [session.id]
    );
    if (confirmedCount >= session.max_capacity) {
      throw httpError("Class is full", 409, { code: "CLASS_FULL", capacity: session.max_capacity });
    }

    let booking;
    try {
      const { rows: [row] } = await client.query(
        `INSERT INTO class_session_bookings
           (class_session_id, customer_id, booked_via, customer_name, customer_phone, customer_email)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [session.id, resolvedCustomerId, bookedVia,
         opts.customerName || null, opts.customerPhone || null, opts.customerEmail || null]
      );
      booking = row;
    } catch (err) {
      if (err.code === "23505" && /uq_class_booking_active/.test(err.message || "")) {
        throw httpError("Customer is already booked into this class", 409, { code: "ALREADY_BOOKED" });
      }
      throw err;
    }
    return { booking, session };
  });
}

/**
 * Cancel one class booking. Frees a spot → fires the waitlist offer flow
 * (fire-and-forget; the cancel never fails because an offer couldn't be made).
 */
async function cancelClassBooking(db, bookingId, options = {}) {
  const booking = await db.transaction(async (client) => {
    const { rows: [b] } = await client.query(
      `SELECT b.*, s.id AS session_id FROM class_session_bookings b
       JOIN class_sessions s ON s.id = b.class_session_id
       WHERE b.id = $1 FOR UPDATE OF b`,
      [Number(bookingId)]
    );
    if (!b) throw httpError("Class booking not found", 404);
    if (b.status === "cancelled") throw httpError("Booking is already cancelled", 400);

    const { rows: [updated] } = await client.query(
      `UPDATE class_session_bookings SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1 RETURNING *`,
      [b.id]
    );
    return updated;
  });

  // Offer fires even without a tenantSlug (single-tenant mode) — only the
  // notification sub-step needs the slug, and it gates itself.
  if (options.notifyCtx) {
    try {
      const { offerNextForClassSession } = require("./waitlist");
      offerNextForClassSession(db, booking.class_session_id, options.notifyCtx).catch(() => {});
    } catch { /* waitlist module optional */ }
  }
  return booking;
}

/**
 * Roster status flip: confirmed ↔ no_show.
 * Re-confirming a no-show RE-TAKES a capacity spot (a waitlist claim may
 * have refilled it in the meantime), so the confirmed direction runs the
 * same locked capacity check as bookIntoSession. no_show frees a spot —
 * the caller (routes/classes.js) fires the waitlist ripple.
 */
async function setClassBookingStatus(db, bookingId, status) {
  if (!["confirmed", "no_show"].includes(status)) {
    throw httpError("status must be 'confirmed' or 'no_show'", 400);
  }
  return db.transaction(async (client) => {
    const { rows: [b] } = await client.query(
      "SELECT * FROM class_session_bookings WHERE id = $1 FOR UPDATE",
      [Number(bookingId)]
    );
    if (!b || b.status === "cancelled") throw httpError("Class booking not found (or cancelled)", 404);
    if (b.status === status) return b;

    if (status === "confirmed" && b.status !== "confirmed") {
      const { rows: [session] } = await client.query(
        "SELECT * FROM class_sessions WHERE id = $1 FOR UPDATE",
        [b.class_session_id]
      );
      const { rows: [{ n: confirmedCount }] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM class_session_bookings
         WHERE class_session_id = $1 AND status = 'confirmed'`,
        [b.class_session_id]
      );
      if (session && confirmedCount >= session.max_capacity) {
        throw httpError("Class is full", 409, { code: "CLASS_FULL", capacity: session.max_capacity });
      }
    }

    const { rows: [updated] } = await client.query(
      "UPDATE class_session_bookings SET status = $2 WHERE id = $1 RETURNING *",
      [b.id, status]
    );
    return updated;
  });
}

/** Local day-of-week (0=Sun..6=Sat) of a UTC instant in an IANA timezone. */
function localDayOfWeek(date, tz) {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short" }).format(date);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
  } catch {
    return date.getUTCDay();
  }
}

/** Parse 'weekly:0,2,4' → [0,2,4]. Returns null for anything else. */
function parseRecurrenceRule(rule) {
  if (!rule || typeof rule !== "string") return null;
  const m = rule.match(/^weekly:([0-6](,[0-6])*)$/);
  if (!m) return null;
  return Array.from(new Set(m[1].split(",").map(Number))).sort();
}

/**
 * Create a class session; when recurrence_rule is set, materialize occurrences
 * for the selected weekdays over the next `recurrence_weeks` weeks (cap 12) at
 * save time — no worker. Occurrences copy the parent's fields and point back
 * via recurrence_parent_id. Wall-clock time is preserved by fixed 24h steps
 * (correct in no-DST zones like Asia/Karachi; DST zones drift one hour across
 * a transition — documented limitation).
 */
async function createClassSession(db, data, { timezone } = {}) {
  const startAt = new Date(data.start_at);
  const endAt = new Date(data.end_at);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    throw httpError("Invalid start_at/end_at", 400);
  }
  const days = parseRecurrenceRule(data.recurrence_rule);
  if (data.recurrence_rule && !days) {
    throw httpError("recurrence_rule must look like 'weekly:1,3,5' (0=Sun..6=Sat)", 400);
  }
  const weeks = Math.min(Math.max(Number(data.recurrence_weeks) || 4, 1), OCCURRENCE_MAX_WEEKS);

  return db.transaction(async (client) => {
    const { rows: [parent] } = await client.query(
      `INSERT INTO class_sessions
         (service_id, employee_id, outlet_id, start_at, end_at, max_capacity,
          recurrence_rule, price, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [data.service_id, data.employee_id || null, data.outlet_id || null,
       startAt.toISOString(), endAt.toISOString(), Number(data.max_capacity) || 10,
       days ? data.recurrence_rule : null, data.price != null ? Number(data.price) : null,
       data.notes || null]
    );

    const occurrences = [];
    if (days) {
      const durationMs = endAt - startAt;
      const DAY = 24 * 60 * 60 * 1000;
      for (let d = 1; d <= weeks * 7; d++) {
        const occStart = new Date(startAt.getTime() + d * DAY);
        if (!days.includes(localDayOfWeek(occStart, timezone))) continue;
        const { rows: [occ] } = await client.query(
          `INSERT INTO class_sessions
             (service_id, employee_id, outlet_id, start_at, end_at, max_capacity,
              recurrence_parent_id, price, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [parent.service_id, parent.employee_id, parent.outlet_id,
           occStart.toISOString(), new Date(occStart.getTime() + durationMs).toISOString(),
           parent.max_capacity, parent.id, parent.price, parent.notes]
        );
        occurrences.push(occ);
      }
    }
    return { session: parent, occurrences };
  });
}

/**
 * Cancel a session (optionally its whole recurrence series): bookings flip to
 * cancelled, waitlist entries flip to cancelled, every booked member gets an
 * F05 'class_session.cancelled' notification (fire-and-forget).
 */
async function cancelClassSession(db, sessionId, { reason, cascadeSeries = false, notifyCtx } = {}) {
  const cancelled = await db.transaction(async (client) => {
    const { rows: [session] } = await client.query(
      "SELECT * FROM class_sessions WHERE id = $1 FOR UPDATE",
      [Number(sessionId)]
    );
    if (!session) throw httpError("Class session not found", 404);
    if (session.status === "cancelled") throw httpError("Class session is already cancelled", 400);

    const ids = [session.id];
    if (cascadeSeries) {
      const parentId = session.recurrence_parent_id || session.id;
      const { rows: siblings } = await client.query(
        `SELECT id FROM class_sessions
         WHERE (id = $1 OR recurrence_parent_id = $1)
           AND id <> $2 AND status = 'scheduled' AND start_at > NOW()`,
        [parentId, session.id]
      );
      ids.push(...siblings.map((s) => s.id));
    }

    const { rows: affected } = await client.query(
      `SELECT b.*, s.start_at AS session_start, s.service_id
       FROM class_session_bookings b JOIN class_sessions s ON s.id = b.class_session_id
       WHERE b.class_session_id = ANY($1::int[]) AND b.status = 'confirmed'`,
      [ids]
    );

    await client.query(
      `UPDATE class_sessions SET status = 'cancelled', cancellation_reason = $2, updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids, reason || null]
    );
    await client.query(
      `UPDATE class_session_bookings SET status = 'cancelled', cancelled_at = NOW()
       WHERE class_session_id = ANY($1::int[]) AND status = 'confirmed'`,
      [ids]
    );
    await client.query(
      `UPDATE appointment_waitlist_entries SET status = 'cancelled', updated_at = NOW()
       WHERE class_session_id = ANY($1::int[]) AND status IN ('waiting','offered')`,
      [ids]
    );
    return { sessionIds: ids, session, affected };
  });

  if (notifyCtx && notifyCtx.tenantSlug && cancelled.affected.length) {
    (async () => {
      try {
        const { notify } = require("./customer-notify");
        const { rows: [svc] } = await db.query(
          "SELECT name FROM booking_services WHERE id = $1", [cancelled.session.service_id]
        );
        let storeName = notifyCtx.tenant && notifyCtx.tenant.name;
        if (!storeName) {
          try {
            const { rows: [p] } = await db.query("SELECT company_name FROM company_profile LIMIT 1");
            storeName = p && p.company_name;
          } catch { /* optional */ }
        }
        for (const b of cancelled.affected) {
          await notify(db, {
            event: "class_session.cancelled",
            customerId: b.customer_id,
            data: {
              storeName: storeName || "",
              className: (svc && svc.name) || "your class",
              classStart: b.session_start,
              reason: reason || null,
            },
            tenantSlug: notifyCtx.tenantSlug,
            tenant: notifyCtx.tenant,
            entityType: "class_session",
            entityId: b.class_session_id,
          });
        }
      } catch { /* notification failures never surface */ }
    })().catch(() => {});
  }
  return cancelled;
}

module.exports = {
  bookIntoSession,
  cancelClassBooking,
  setClassBookingStatus,
  createClassSession,
  cancelClassSession,
  resolveCustomer,
  parseRecurrenceRule,
  localDayOfWeek,
};
