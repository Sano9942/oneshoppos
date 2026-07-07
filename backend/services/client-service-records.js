'use strict';

/**
 * services/client-service-records.js — V04 salon depth.
 *
 * Client service history / colorist formula notes. A skeleton record is
 * auto-created per service line when an appointment is checked out at POS
 * (F06 link), prefilled with customer / appointment / sale / service /
 * provider. The stylist enriches notes + formula ([{label,value}]) + photos
 * afterwards from the appointment drawer or the customer's Service History tab.
 *
 * Source of truth for the SKELETON is the appointment's services, not the
 * sale_items — the appointment already carries booking_service_id + the
 * performed-by employee per segment (multi-service appts) or on the row
 * itself (single-service appts), so attribution is exact without threading a
 * booking_service_id column through the cart. Walk-ins (no appointment) get no
 * skeleton — the stylist adds a record manually (createManualRecord).
 *
 * Every function takes a db/client so it can join a caller's transaction or
 * run standalone. Skeleton creation is idempotent per (appointment, service).
 */

// Resolve the (booking_service_id, employee_id, service_name) tuples for an
// appointment: prefer its segments (multi-service), else the single service on
// the appointment row itself.
async function resolveAppointmentServices(client, appointmentId) {
  const { rows: appt } = await client.query(
    `SELECT a.id, a.customer_id, a.service_id, a.employee_id,
            bs.name AS service_name
       FROM appointments a
       LEFT JOIN booking_services bs ON bs.id = a.service_id
      WHERE a.id = $1`,
    [appointmentId]
  );
  if (!appt.length) return { customerId: null, services: [] };
  const customerId = appt[0].customer_id;

  const { rows: segments } = await client.query(
    `SELECT seg.service_id, seg.employee_id, bs.name AS service_name
       FROM appointment_segments seg
       JOIN booking_services bs ON bs.id = seg.service_id
      WHERE seg.appointment_id = $1
      ORDER BY seg.start_at`,
    [appointmentId]
  );

  if (segments.length) {
    return {
      customerId,
      services: segments.map((s) => ({
        bookingServiceId: s.service_id,
        // A segment can leave employee null (unassigned) — fall back to the
        // appointment-level provider so the record still names a stylist.
        employeeId: s.employee_id != null ? s.employee_id : appt[0].employee_id,
        serviceName: s.service_name,
      })),
    };
  }

  // Single-service appointment.
  return {
    customerId,
    services: appt[0].service_id
      ? [{
          bookingServiceId: appt[0].service_id,
          employeeId: appt[0].employee_id,
          serviceName: appt[0].service_name,
        }]
      : [],
  };
}

/**
 * Create skeleton client_service_records for a checked-out appointment.
 * Idempotent: skips any (appointment_id, booking_service_id) that already has
 * a record, so a retried checkout or a double-fire never stacks duplicates.
 * Non-throwing on the empty case; DB errors bubble to the caller (which runs
 * this fire-and-forget after the sale commits).
 * @returns {Promise<object[]>} the rows created this call
 */
async function createSkeletonRecordsForAppointment(db, { saleId, appointmentId }) {
  if (!appointmentId) return [];
  return db.transaction(async (client) => {
    const { customerId, services } = await resolveAppointmentServices(client, appointmentId);
    if (customerId == null || !services.length) return [];

    const created = [];
    for (const svc of services) {
      const { rows } = await client.query(
        `INSERT INTO client_service_records
           (customer_id, appointment_id, sale_id, booking_service_id, employee_id, service_name)
         SELECT $1, $2, $3, $4, $5, $6
         WHERE NOT EXISTS (
           SELECT 1 FROM client_service_records
            WHERE appointment_id = $2 AND booking_service_id = $4
         )
         RETURNING *`,
        [customerId, appointmentId, saleId, svc.bookingServiceId, svc.employeeId, svc.serviceName]
      );
      if (rows.length) created.push(rows[0]);
    }
    return created;
  });
}

// Most recent record for a client — the booking-view "last visit" panel.
async function getLastVisit(db, customerId) {
  const { rows } = await db.query(
    `SELECT r.*, e.name AS employee_name
       FROM client_service_records r
       LEFT JOIN employees e ON e.id = r.employee_id
      WHERE r.customer_id = $1
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [customerId]
  );
  return rows[0] || null;
}

// Full timeline for the customer's Service History tab.
async function getHistoryForCustomer(db, customerId) {
  const { rows } = await db.query(
    `SELECT r.*, e.name AS employee_name, a.start_at AS appointment_start
       FROM client_service_records r
       LEFT JOIN employees e ON e.id = r.employee_id
       LEFT JOIN appointments a ON a.id = r.appointment_id
      WHERE r.customer_id = $1
      ORDER BY r.created_at DESC`,
    [customerId]
  );
  return rows;
}

async function getRecord(db, id) {
  const { rows } = await db.query(
    `SELECT r.*, e.name AS employee_name
       FROM client_service_records r
       LEFT JOIN employees e ON e.id = r.employee_id
      WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Stylist enriches a record: notes / formula / photos / performed-by. Only the
// provided fields change (COALESCE-style via explicit null checks).
async function updateRecord(db, id, { notes, formula, photos, employeeId }) {
  const { rows } = await db.query(
    `UPDATE client_service_records SET
       notes       = COALESCE($2, notes),
       formula     = COALESCE($3::jsonb, formula),
       photos      = COALESCE($4::jsonb, photos),
       employee_id = COALESCE($5, employee_id),
       updated_at  = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      notes !== undefined ? notes : null,
      formula !== undefined ? JSON.stringify(formula) : null,
      photos !== undefined ? JSON.stringify(photos) : null,
      employeeId !== undefined ? employeeId : null,
    ]
  );
  return rows[0] || null;
}

// Manual record — walk-ins (no appointment) or backfilling a past visit.
async function createManualRecord(db, { customerId, bookingServiceId, employeeId, serviceName, notes, formula, photos }) {
  const { rows } = await db.query(
    `INSERT INTO client_service_records
       (customer_id, booking_service_id, employee_id, service_name, notes, formula, photos)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING *`,
    [
      customerId,
      bookingServiceId || null,
      employeeId || null,
      serviceName || null,
      notes || null,
      JSON.stringify(formula || []),
      JSON.stringify(photos || []),
    ]
  );
  return rows[0];
}

module.exports = {
  createSkeletonRecordsForAppointment,
  getLastVisit,
  getHistoryForCustomer,
  getRecord,
  updateRecord,
  createManualRecord,
};
