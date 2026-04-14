/**
 * Booking service CRUD and appointment lifecycle.
 */

const MIN_NOTICE_MS = 15 * 60 * 1000;

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
  const endAt = new Date(startAt.getTime() + service.duration_minutes * 60 * 1000);

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

  // Check overlap if employee assigned
  if (data.employee_id) {
    const { checkOverlap } = require("./booking-availability");
    const overlaps = await checkOverlap(db, data.employee_id, startAt.toISOString(), endAt.toISOString());
    if (overlaps) throw Object.assign(new Error("Time slot is already booked"), { statusCode: 409 });
  }

  const status = (source === "public" && service.requires_confirmation) ? "pending" : "confirmed";

  const { rows: [appt] } = await db.query(
    `INSERT INTO appointments (service_id, variant_id, customer_id, employee_id, outlet_id,
       status, start_at, end_at, customer_name, customer_phone, customer_email, notes, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [data.service_id, data.variant_id || null, data.customer_id || null,
     data.employee_id || null, data.outlet_id || service.outlet_id || null,
     status, startAt.toISOString(), endAt.toISOString(),
     data.customer_name || null, data.customer_phone || null, data.customer_email || null,
     data.notes || null, source]
  );

  // Schedule reminder
  if (data.customer_email || data.customer_phone) {
    const reminderTime = new Date(startAt.getTime() - 60 * 60 * 1000); // 1 hour before
    if (reminderTime > new Date()) {
      await db.query(
        `INSERT INTO appointment_reminders (appointment_id, minutes_before, channel, scheduled_for)
         VALUES ($1, 60, $2, $3)`,
        [appt.id, data.customer_email ? "email" : "sms", reminderTime.toISOString()]
      );
    }
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
  const newStart = new Date(data.start_at);
  const newEnd = new Date(newStart.getTime() + service.duration_minutes * 60 * 1000);
  const employeeId = data.employee_id || appt.employee_id;

  if (employeeId) {
    const { checkOverlap } = require("./booking-availability");
    const overlaps = await checkOverlap(db, employeeId, newStart.toISOString(), newEnd.toISOString(), appointmentId);
    if (overlaps) throw Object.assign(new Error("New time slot is already booked"), { statusCode: 409 });
  }

  const { rows: [updated] } = await db.query(
    `UPDATE appointments SET start_at = $1, end_at = $2, employee_id = $3, updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [newStart.toISOString(), newEnd.toISOString(), employeeId, appointmentId]
  );
  return updated;
}

async function cancelAppointment(db, appointmentId, reason) {
  const { rows: [appt] } = await db.query(
    `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $2, updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('cancelled','completed') RETURNING *`,
    [appointmentId, reason || null]
  );
  if (!appt) throw Object.assign(new Error("Appointment not found or already cancelled"), { statusCode: 404 });
  return appt;
}

module.exports = { createAppointment, rescheduleAppointment, cancelAppointment };
