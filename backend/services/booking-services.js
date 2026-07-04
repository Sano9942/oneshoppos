/**
 * Booking service CRUD and appointment lifecycle.
 */

const MIN_NOTICE_MS = 15 * 60 * 1000;

/**
 * Serialize all bookings for one employee inside the current transaction.
 * Transaction-scoped advisory lock (pg_advisory_xact_lock) — safe under the
 * Supavisor transaction pooler precisely BECAUSE it is xact-scoped: the whole
 * db.transaction runs on one pooled connection and the lock releases at
 * COMMIT/ROLLBACK. Cross-statement session locks are what the pooler forbids.
 * Key is schema-qualified so tenants never contend on each other's employee ids.
 */
async function lockEmployeeCalendar(client, employeeId) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':appt-emp-' || $1::text))",
    [Number(employeeId)]
  );
}

/** Map the v100 EXCLUDE-constraint violation to the same friendly 409 the
 *  overlap pre-check throws — the constraint is the backstop for writes that
 *  race past (or never ran) checkOverlap. */
function mapOverlapConstraintError(err) {
  if (err && err.code === "23P01" && /excl_appointments_employee_overlap/.test(err.message || "")) {
    return Object.assign(new Error("Time slot is already booked"), { statusCode: 409 });
  }
  return err;
}

/**
 * Serialize resource picks the same way lockEmployeeCalendar serializes staff:
 * lock every candidate id in sorted order (stable order = no deadlocks against
 * a concurrent booking locking an overlapping candidate set), then the caller
 * runs findFreeResource knowing no other transaction is mid-pick.
 * Always lock AFTER employee locks — both paths keep employees→resources order.
 */
async function lockResourceCandidates(client, resourceIds) {
  for (const rid of [...resourceIds].sort((a, b) => a - b)) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':appt-res-' || $1::text))",
      [Number(rid)]
    );
  }
}

/**
 * Auto-assign a resource for [startAt, endAt) when the service maps to any
 * (flag-gated inside getCandidateResources; returns null = no resource needed).
 * Throws 409 when the service requires a resource and none is free.
 */
async function pickResource(client, serviceId, startAt, endAt, excludeAppointmentId = null) {
  const { getCandidateResources, findFreeResource } = require("./booking-availability");
  const candidates = await getCandidateResources(client, serviceId);
  if (!candidates.length) return null;
  await lockResourceCandidates(client, candidates);
  const resourceId = await findFreeResource(client, candidates, startAt, endAt, excludeAppointmentId);
  if (resourceId == null) {
    throw Object.assign(new Error("No resource available for this time"), { statusCode: 409 });
  }
  return resourceId;
}

/**
 * F06 segments — resolve data.segments (extra services AFTER the primary) into
 * sequential windows from startAt. Returns the full ordered window list
 * (primary first) and the overall end. Single-service bookings get one window.
 */
async function buildSegmentWindows(db, data, primaryService, startAt) {
  const extras = Array.isArray(data.segments) ? data.segments : [];
  const list = [
    { service_id: primaryService.id, employee_id: data.employee_id || null, duration: primaryService.duration_minutes },
  ];
  if (extras.length) {
    const ids = extras.map((s) => Number(s.service_id));
    const { rows } = await db.query(
      "SELECT id, duration_minutes FROM booking_services WHERE id = ANY($1::int[])",
      [ids]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const seg of extras) {
      const svc = byId.get(Number(seg.service_id));
      if (!svc) throw Object.assign(new Error(`Segment service ${seg.service_id} not found`), { statusCode: 404 });
      list.push({ service_id: svc.id, employee_id: seg.employee_id || null, duration: svc.duration_minutes });
    }
  }
  let cursor = startAt.getTime();
  const windows = list.map((seg) => {
    const s = cursor;
    cursor += seg.duration * 60 * 1000;
    return { ...seg, start: new Date(s), end: new Date(cursor) };
  });
  return { windows, endAt: new Date(cursor) };
}

async function createAppointment(db, data, source = "admin", options = {}) {
  const { rows: [service] } = await db.query(
    "SELECT * FROM booking_services WHERE id = $1",
    [data.service_id]
  );
  if (!service) throw Object.assign(new Error("Service not found"), { statusCode: 404 });

  const startAt = new Date(data.start_at);
  if (Number.isNaN(startAt.getTime())) {
    throw Object.assign(new Error("Invalid start_at"), { statusCode: 400 });
  }
  // F06 segments: multi-service visit (color+cut). Windows run back-to-back
  // from start_at; single-service bookings collapse to one window and keep
  // the exact pre-F06 shape.
  const { windows, endAt } = await buildSegmentWindows(db, data, service, startAt);
  const multiSegment = windows.length > 1;

  // Time guards (enforced for public bookings; admin bypasses).
  if (source !== "admin") {
    const now = Date.now();
    if (startAt.getTime() < now + MIN_NOTICE_MS) {
      throw Object.assign(
        new Error("Bookings must be made at least 15 minutes in advance"),
        { statusCode: 400 }
      );
    }
    const maxAdvanceDays = Number(service.max_advance_days) || 90;
    const maxAhead = now + maxAdvanceDays * 24 * 60 * 60 * 1000;
    if (startAt.getTime() > maxAhead) {
      throw Object.assign(
        new Error(`Bookings can be made up to ${maxAdvanceDays} days ahead`),
        { statusCode: 400 }
      );
    }
  }

  const status = (source === "public" && service.requires_confirmation) ? "pending" : "confirmed";

  // Concurrency contract (F06): lock → overlap check → insert, ONE transaction.
  // Two concurrent requests for the same employee serialize on the advisory
  // lock, so the loser's overlap check sees the winner's committed row and
  // throws a clean 409 instead of double-booking (completion-03 TOCTOU verdict).
  let appt;
  try {
    appt = await db.transaction(async (client) => {
      // Lock EVERY involved employee in sorted order (stable order across
      // concurrent bookings with overlapping staff sets = no deadlocks),
      // then overlap-check each segment against its own window.
      const employeeIds = [...new Set(windows.map((w) => Number(w.employee_id)).filter(Boolean))]
        .sort((a, b) => a - b);
      const { checkOverlap } = require("./booking-availability");
      for (const eid of employeeIds) await lockEmployeeCalendar(client, eid);
      for (const w of windows) {
        if (!w.employee_id) continue;
        const overlaps = await checkOverlap(client, w.employee_id, w.start.toISOString(), w.end.toISOString());
        if (overlaps) throw Object.assign(new Error("Time slot is already booked"), { statusCode: 409 });
      }

      // Resource auto-assign (flag-gated inside pickResource; null = service
      // needs no resource). Resource is held for the WHOLE visit span — a
      // salon chair doesn't free up between the cut and the color.
      const resourceId = await pickResource(client, service.id, startAt.toISOString(), endAt.toISOString());

      // Multi-segment parent rows carry employee_id = NULL: staff blocking
      // lives in appointment_segments (checkOverlap + getAvailableSlots count
      // them). A whole-span parent row would over-block the primary stylist
      // and trip the v100 EXCLUDE constraint on legitimate adjacent bookings.
      const { rows: [row] } = await client.query(
        `INSERT INTO appointments (service_id, variant_id, customer_id, employee_id, outlet_id,
           status, start_at, end_at, customer_name, customer_phone, customer_email, notes, source, resource_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [data.service_id, data.variant_id || null, data.customer_id || null,
         multiSegment ? null : (data.employee_id || null), data.outlet_id || service.outlet_id || null,
         status, startAt.toISOString(), endAt.toISOString(),
         data.customer_name || null, data.customer_phone || null, data.customer_email || null,
         data.notes || null, source, resourceId]
      );

      if (multiSegment) {
        for (const w of windows) {
          await client.query(
            `INSERT INTO appointment_segments (appointment_id, service_id, employee_id, start_at, end_at)
             VALUES ($1,$2,$3,$4,$5)`,
            [row.id, w.service_id, w.employee_id, w.start.toISOString(), w.end.toISOString()]
          );
        }
      }

      // Schedule reminder (same transaction — an appointment without its
      // reminder row is worse than a clean retry).
      if (data.customer_email || data.customer_phone) {
        const reminderTime = new Date(startAt.getTime() - 60 * 60 * 1000); // 1 hour before
        if (reminderTime > new Date()) {
          await client.query(
            `INSERT INTO appointment_reminders (appointment_id, minutes_before, channel, scheduled_for)
             VALUES ($1, 60, $2, $3)`,
            [row.id, data.customer_email ? "email" : "sms", reminderTime.toISOString()]
          );
        }
      }
      return row;
    });
  } catch (err) {
    throw mapOverlapConstraintError(err);
  }

  // Public / portal booking: send confirmation email (non-fatal).
  // Portal sends its own branded template from the route, so skip duplicate.
  if (source === "public" && data.customer_email && options.tenant) {
    try {
      const { enqueueEmail } = require("./email");
      const tenant = options.tenant;
      let staffName = null;
      if (data.employee_id) {
        try {
          const { rows: [emp] } = await db.query(
            "SELECT name FROM employees WHERE id = $1",
            [data.employee_id]
          );
          if (emp) staffName = emp.name;
        } catch { /* staff name is optional */ }
      }
      let profile = options.companyProfile || null;
      if (!profile) {
        try {
          const { rows: [p] } = await db.query(
            "SELECT company_name, address, phone FROM company_profile LIMIT 1"
          );
          profile = p || null;
        } catch { /* profile optional */ }
      }

      const icsUrl = options.frontendUrl && tenant.slug
        ? `${String(options.frontendUrl).replace(/\/$/, "")}/api/public/bookings/${appt.id}/ics?tenant=${encodeURIComponent(tenant.slug)}`
        : null;

      await enqueueEmail(db, {
        tenantId: tenant.id || null,
        type: "booking_confirmation",
        to: data.customer_email,
        tenant: { slug: tenant.slug, name: profile?.company_name || tenant.name || tenant.slug },
        data: {
          storeName: profile?.company_name || tenant.name || tenant.slug,
          customerName: data.customer_name,
          serviceName: service.name,
          staffName,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          duration: service.duration_minutes,
          notes: data.notes || null,
          bookingId: appt.id,
          storeAddress: profile?.address || null,
          storePhone: profile?.phone || null,
          status,
          icsUrl,
        },
      });
    } catch (err) {
      // Non-fatal: log via console since services don't uniformly have a logger
      try {
        // eslint-disable-next-line no-console
        console.warn("[booking] failed to enqueue confirmation email:", err.message);
      } catch { /* ignore */ }
    }
  }

  return appt;
}

async function rescheduleAppointment(db, appointmentId, data) {
  const { rows: [appt] } = await db.query(
    "SELECT * FROM appointments WHERE id = $1",
    [appointmentId]
  );
  if (!appt) throw Object.assign(new Error("Appointment not found"), { statusCode: 404 });
  if (appt.status === "cancelled") throw Object.assign(new Error("Cannot reschedule cancelled appointment"), { statusCode: 400 });

  const { rows: [service] } = await db.query("SELECT duration_minutes FROM booking_services WHERE id = $1", [appt.service_id]);
  const { rows: segments } = await db.query(
    "SELECT * FROM appointment_segments WHERE appointment_id = $1 ORDER BY start_at",
    [appointmentId]
  );

  const newStart = new Date(data.start_at);
  if (Number.isNaN(newStart.getTime())) {
    throw Object.assign(new Error("Invalid start_at"), { statusCode: 400 });
  }

  // Multi-segment reschedule: rigid shift — every segment moves by the same
  // delta, staff per segment stays fixed (per-segment reassignment is a
  // cancel+rebook, not a reschedule).
  if (segments.length && data.employee_id) {
    throw Object.assign(
      new Error("Cannot reassign staff on a multi-service appointment — cancel and rebook instead"),
      { statusCode: 400 }
    );
  }
  const delta = newStart.getTime() - new Date(appt.start_at).getTime();
  const newEnd = segments.length
    ? new Date(new Date(appt.end_at).getTime() + delta)
    : new Date(newStart.getTime() + service.duration_minutes * 60 * 1000);
  const employeeId = data.employee_id || appt.employee_id;

  // Same locked contract as createAppointment — reschedule races are the same
  // TOCTOU (two reschedules into one slot, or reschedule vs new booking).
  try {
    return await db.transaction(async (client) => {
      const { checkOverlap } = require("./booking-availability");
      const shifted = segments.map((s) => ({
        ...s,
        newStart: new Date(new Date(s.start_at).getTime() + delta),
        newEnd: new Date(new Date(s.end_at).getTime() + delta),
      }));
      const involvedIds = segments.length
        ? [...new Set(shifted.map((s) => Number(s.employee_id)).filter(Boolean))].sort((a, b) => a - b)
        : (employeeId ? [Number(employeeId)] : []);
      for (const eid of involvedIds) await lockEmployeeCalendar(client, eid);

      if (segments.length) {
        for (const s of shifted) {
          if (!s.employee_id) continue;
          const overlaps = await checkOverlap(client, s.employee_id, s.newStart.toISOString(), s.newEnd.toISOString(), appointmentId);
          if (overlaps) throw Object.assign(new Error("New time slot is already booked"), { statusCode: 409 });
        }
      } else if (employeeId) {
        const overlaps = await checkOverlap(client, employeeId, newStart.toISOString(), newEnd.toISOString(), appointmentId);
        if (overlaps) throw Object.assign(new Error("New time slot is already booked"), { statusCode: 409 });
      }

      // Re-pick the resource for the new window (the old pick may be taken).
      const resourceId = await pickResource(client, appt.service_id, newStart.toISOString(), newEnd.toISOString(), appointmentId);

      const { rows: [updated] } = await client.query(
        `UPDATE appointments SET start_at = $1, end_at = $2, employee_id = $3, resource_id = $4, updated_at = NOW()
         WHERE id = $5 RETURNING *`,
        [newStart.toISOString(), newEnd.toISOString(), segments.length ? null : employeeId, resourceId, appointmentId]
      );
      for (const s of shifted) {
        await client.query(
          "UPDATE appointment_segments SET start_at = $1, end_at = $2 WHERE id = $3",
          [s.newStart.toISOString(), s.newEnd.toISOString(), s.id]
        );
      }
      return updated;
    });
  } catch (err) {
    throw mapOverlapConstraintError(err);
  }
}

async function cancelAppointment(db, appointmentId, reason, options = {}) {
  const { rows: [appt] } = await db.query(
    `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $2, updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('cancelled','completed') RETURNING *`,
    [appointmentId, reason || null]
  );
  if (!appt) throw Object.assign(new Error("Appointment not found or already cancelled"), { statusCode: 404 });

  // Waitlist ripple (F06): every cancel path funnels through here, so this is
  // the ONE place a freed slot triggers the offer flow. Fire-and-forget — the
  // cancel must never fail because an offer couldn't be made.
  if (options.notifyCtx && options.notifyCtx.tenantSlug) {
    try {
      const { offerForFreedAppointmentSlot } = require("./waitlist");
      offerForFreedAppointmentSlot(db, appt, options.notifyCtx).catch(() => {});
    } catch { /* waitlist module optional at boot */ }
  }
  return appt;
}

module.exports = {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  lockEmployeeCalendar,
  mapOverlapConstraintError,
};
