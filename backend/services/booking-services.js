/**
 * Booking service CRUD and appointment lifecycle.
 */

async function createAppointment(db, data, source = "admin") {
  const { rows: [service] } = await db.query(
    "SELECT * FROM booking_services WHERE id = $1",
    [data.service_id]
  );
  if (!service) throw Object.assign(new Error("Service not found"), { statusCode: 404 });

  const startAt = new Date(data.start_at);
  const endAt = new Date(startAt.getTime() + service.duration_minutes * 60 * 1000);

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
