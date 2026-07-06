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

  // F06 resources: when the flag is on and the service maps to resources, a
  // slot additionally needs at least one free resource instance (salon chair,
  // physio bed, studio bay). Occupancy is loaded once for the day.
  const candidateResources = await getCandidateResources(db, serviceId);
  let resourceBusy = [];
  if (candidateResources.length) {
    const { rows } = await db.query(
      `SELECT resource_id, start_at, end_at FROM appointments
       WHERE resource_id = ANY($1::int[]) AND start_at::date = $2
       AND status NOT IN ('cancelled','no_show')`,
      [candidateResources, date]
    );
    resourceBusy = rows;
  }
  const hasFreeResource = (slotStart, slotEnd) => {
    if (!candidateResources.length) return true;
    const busySet = new Set(
      resourceBusy
        .filter((b) => new Date(slotStart) < new Date(b.end_at) && new Date(slotEnd) > new Date(b.start_at))
        .map((b) => b.resource_id)
    );
    return candidateResources.some((id) => !busySet.has(id));
  };

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

    // Get existing appointments for this date (F06: segments occupy staff too)
    const { rows: existing } = await db.query(
      `SELECT start_at, end_at FROM appointments
       WHERE employee_id = $1 AND start_at::date = $2 AND status NOT IN ('cancelled','no_show')
       UNION ALL
       SELECT s.start_at, s.end_at FROM appointment_segments s
       JOIN appointments pa ON pa.id = s.appointment_id
       WHERE s.employee_id = $1 AND s.start_at::date = $2 AND pa.status NOT IN ('cancelled','no_show')`,
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

        if (!blocked && !occupied && hasFreeResource(slotStart, slotEndPadded)) {
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
  // F06: appointment_segments block staff too — a color+cut's second stylist
  // must be invisible to direct bookings for that stylist. Segment rows count
  // only while their parent appointment is live.
  const segExclude = excludeAppointmentId ? ` AND s.appointment_id != $${params.length}` : "";
  const { rows } = await db.query(
    `SELECT id FROM appointments
     WHERE employee_id = $1 AND start_at < $3 AND end_at > $2
     AND status NOT IN ('cancelled','no_show')${exclude}
     UNION ALL
     SELECT s.appointment_id FROM appointment_segments s
     JOIN appointments pa ON pa.id = s.appointment_id
     WHERE s.employee_id = $1 AND s.start_at < $3 AND s.end_at > $2
     AND pa.status NOT IN ('cancelled','no_show')${segExclude}`,
    params
  );
  return rows.length > 0;
}

/**
 * F06 resources — is the feature on, and which resources can serve a service?
 * Returns [] when the flag is off or the service needs no resource (staff-only
 * availability, pre-F06 behavior).
 */
async function getCandidateResources(db, serviceId) {
  try {
    const { rows: [flag] } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'phase4_appointments_resources'"
    );
    if (!flag || flag.enabled !== true) return [];
    const { rows } = await db.query(
      `SELECT r.id FROM booking_resource_assignments a
       JOIN booking_resources r ON r.id = a.resource_id AND r.is_active = true
       WHERE a.service_id = $1 ORDER BY r.id`,
      [serviceId]
    );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Pick a free resource among candidates for [startAt, endAt). Returns the id
 * or null when all are occupied. Run inside the booking transaction (after
 * the resource advisory locks) so concurrent picks serialize.
 */
async function findFreeResource(db, candidateIds, startAt, endAt, excludeAppointmentId = null) {
  if (!candidateIds.length) return null;
  const params = [candidateIds, startAt, endAt];
  let exclude = "";
  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    exclude = ` AND id != $${params.length}`;
  }
  const { rows: busy } = await db.query(
    `SELECT DISTINCT resource_id FROM appointments
     WHERE resource_id = ANY($1::int[]) AND start_at < $3 AND end_at > $2
     AND status NOT IN ('cancelled','no_show')${exclude}`,
    params
  );
  const busySet = new Set(busy.map((b) => b.resource_id));
  return candidateIds.find((id) => !busySet.has(id)) ?? null;
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

module.exports = { getAvailableSlots, checkOverlap, getCandidateResources, findFreeResource };
