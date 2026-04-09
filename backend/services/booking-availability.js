/**
 * Availability engine — search-first booking.
 * Builds available slots from rules, blocks, and existing appointments.
 */

async function getAvailableSlots(db, { serviceId, employeeId, date, outletId }) {
  // 1. Get service details
  const { rows: [service] } = await db.query(
    "SELECT * FROM booking_services WHERE id = $1 AND is_active = true",
    [serviceId]
  );
  if (!service) throw Object.assign(new Error("Service not found"), { statusCode: 404 });

  const duration = service.duration_minutes;
  const padding = service.padding_minutes || 0;
  const slotLength = duration + padding;
  const dayOfWeek = new Date(date).getDay();

  // 2. Get eligible staff
  let staffIds = [];
  if (employeeId) {
    staffIds = [Number(employeeId)];
  } else {
    const { rows: assignments } = await db.query(
      "SELECT employee_id FROM booking_staff_assignments WHERE service_id = $1",
      [serviceId]
    );
    staffIds = assignments.map(a => a.employee_id);
  }
  if (!staffIds.length) return [];

  // 3. For each staff member, compute available slots
  const allSlots = [];

  for (const sid of staffIds) {
    // Get availability rules for this day
    const { rows: rules } = await db.query(
      `SELECT start_time, end_time FROM booking_availability_rules
       WHERE employee_id = $1 AND day_of_week = $2 AND is_active = true`,
      [sid, dayOfWeek]
    );
    if (!rules.length) continue;

    // Get blocks for this date
    const dateStart = `${date}T00:00:00`;
    const dateEnd = `${date}T23:59:59`;
    const { rows: blocks } = await db.query(
      `SELECT start_at, end_at FROM appointment_blocks
       WHERE employee_id = $1 AND start_at < $3 AND end_at > $2`,
      [sid, dateStart, dateEnd]
    );

    // Get existing appointments for this date
    const { rows: existing } = await db.query(
      `SELECT start_at, end_at FROM appointments
       WHERE employee_id = $1 AND start_at::date = $2 AND status NOT IN ('cancelled','no_show')`,
      [sid, date]
    );

    // Build slots from each rule window
    for (const rule of rules) {
      const windowStart = parseTimeToMinutes(rule.start_time);
      const windowEnd = parseTimeToMinutes(rule.end_time);

      for (let m = windowStart; m + slotLength <= windowEnd; m += 15) {
        const slotStart = minutesToIso(date, m);
        const slotEnd = minutesToIso(date, m + duration);
        const slotEndPadded = minutesToIso(date, m + slotLength);

        // Check conflicts
        const blocked = blocks.some(b =>
          new Date(slotStart) < new Date(b.end_at) && new Date(slotEndPadded) > new Date(b.start_at)
        );
        const occupied = existing.some(a =>
          new Date(slotStart) < new Date(a.end_at) && new Date(slotEndPadded) > new Date(a.start_at)
        );

        if (!blocked && !occupied) {
          allSlots.push({
            employee_id: sid,
            start_at: slotStart,
            end_at: slotEnd,
            duration_minutes: duration,
          });
        }
      }
    }
  }

  return allSlots;
}

async function checkOverlap(db, employeeId, startAt, endAt, excludeAppointmentId = null) {
  const params = [employeeId, startAt, endAt];
  let exclude = "";
  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    exclude = ` AND id != $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT id FROM appointments
     WHERE employee_id = $1 AND start_at < $3 AND end_at > $2
     AND status NOT IN ('cancelled','no_show')${exclude}`,
    params
  );
  return rows.length > 0;
}

// helpers
function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minutesToIso(date, minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${date}T${h}:${m}:00`;
}

module.exports = { getAvailableSlots, checkOverlap };
