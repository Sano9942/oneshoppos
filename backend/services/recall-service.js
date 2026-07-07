"use strict";

/**
 * Recall / continuing-care engine (V05 clinical depth).
 *
 * One OPEN recall per (customer, subject, recall_type) — enforced by the
 * partial unique index `uq_patient_recalls_open`. Re-arming completes the
 * open row and inserts a fresh one, so each cycle is one auditable row.
 *
 * Vaccinations are a recall SPECIALIZATION, not a parallel system: each
 * vaccine gets its own type key (`vaccination:<slug>`) so a pet can carry
 * one open recall per vaccine, and the worker routes any `vaccination:*`
 * type to the `recall.vaccination_due` notification event.
 *
 * Suppression rule (hardening, plan V05): a recall is auto-set to 'booked'
 * while a future appointment exists for that patient — the patient already
 * has a visit coming; texting them "time for your checkup" looks broken.
 * Subject-scoped recalls only match appointments linked (via treatment plan)
 * to the same subject, so one pet's visit never silences another pet's recall.
 */

function vaccinationTypeKey(vaccineName) {
  return (
    "vaccination:" +
    String(vaccineName || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60)
  );
}

function isVaccinationType(recallType) {
  return String(recallType || "").startsWith("vaccination");
}

/** Human copy for outreach: 'vaccination:rabies' → 'Rabies vaccine',
 *  'checkup' + 6 months → '6-month checkup'. */
function humanizeRecall(recall) {
  const t = String(recall.recall_type || "checkup");
  if (isVaccinationType(t)) {
    const name = t.includes(":") ? t.split(":")[1].replace(/_/g, " ").trim() : "";
    if (!name) return "a vaccination";
    return `${name.replace(/\b\w/g, (c) => c.toUpperCase())} vaccine`;
  }
  const label = t.replace(/_/g, " ");
  return recall.interval_months ? `${recall.interval_months}-month ${label}` : label;
}

/**
 * Find a future appointment that should suppress outreach for this patient.
 * Subject-scoped recalls require the appointment's plan to be for the same
 * subject; subjectless recalls match any future appointment of the customer.
 */
async function findFutureAppointment(db, customerId, subjectId) {
  const { rows } = await db.query(
    `SELECT a.id
       FROM appointments a
       LEFT JOIN treatment_plans tp ON tp.id = a.treatment_plan_id
      WHERE a.customer_id = $1
        AND a.start_at > NOW()
        AND (a.status IS NULL OR a.status NOT IN ('cancelled', 'no_show'))
        AND ($2::int IS NULL OR tp.subject_id = $2)
      ORDER BY a.start_at ASC
      LIMIT 1`,
    [customerId, subjectId || null]
  );
  return rows[0] || null;
}

/**
 * Arm (or re-arm) a recall. Completes any open recall of the same key first,
 * then inserts the fresh row. Applies the suppression rule at arm time.
 *
 * @returns the new patient_recalls row (or null when nothing to arm).
 */
async function armRecall(db, {
  customerId,
  subjectId = null,
  recallType = "checkup",
  intervalMonths = null,
  dueDate = null, // 'YYYY-MM-DD'; defaults to today + intervalMonths
  sourcePlanId = null,
  vaccinationRecordId = null,
  notes = null,
}) {
  if (!customerId) return null;
  if (!dueDate && !intervalMonths) return null;

  // Close out any open recall of the same key — re-arming advances the cycle.
  await db.query(
    `UPDATE patient_recalls
        SET status = 'completed', updated_at = NOW()
      WHERE customer_id = $1
        AND COALESCE(patient_subject_id, 0) = COALESCE($2::int, 0)
        AND recall_type = $3
        AND status IN ('due', 'contacted', 'booked')`,
    [customerId, subjectId || null, recallType]
  );

  const future = await findFutureAppointment(db, customerId, subjectId);

  const { rows: [row] } = await db.query(
    `INSERT INTO patient_recalls
       (customer_id, patient_subject_id, recall_type, interval_months, due_date,
        status, source_plan_id, appointment_id, vaccination_record_id, notes)
     VALUES ($1, $2, $3, $4,
             COALESCE($5::date, (CURRENT_DATE + make_interval(months => $4))::date),
             $6, $7, $8, $9, $10)
     RETURNING *, due_date::text AS due_date`,
    [
      customerId, subjectId || null, recallType, intervalMonths || null,
      dueDate || null,
      future ? "booked" : "due",
      sourcePlanId || null,
      future ? future.id : null,
      vaccinationRecordId || null,
      notes || null,
    ]
  );
  return row;
}

/**
 * Visit-completion hook — called (non-fatally) from completeSession and
 * transitionPlanStatus. Two jobs:
 *  1. A completed visit that was BOOKED from a recall closes that recall and
 *     re-arms it at its own interval (the recall loop).
 *  2. A plan carrying recall config advances its recall: due = today + interval.
 */
async function onVisitCompleted(db, { plan, sessionAppointmentId = null }) {
  if (!plan) return;

  // 1. Recall booked against this very appointment → complete + re-arm.
  if (sessionAppointmentId) {
    const { rows: booked } = await db.query(
      `SELECT * FROM patient_recalls
        WHERE appointment_id = $1 AND status = 'booked'`,
      [sessionAppointmentId]
    );
    for (const r of booked) {
      await db.query(
        `UPDATE patient_recalls SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [r.id]
      );
      if (r.interval_months) {
        await armRecall(db, {
          customerId: r.customer_id,
          subjectId: r.patient_subject_id,
          recallType: r.recall_type,
          intervalMonths: r.interval_months,
          sourcePlanId: r.source_plan_id,
          notes: r.notes,
        });
      }
    }
  }

  // 2. Plan-level recall config → advance the plan's recall type.
  if (plan.recall_interval_months) {
    await armRecall(db, {
      customerId: plan.customer_id,
      subjectId: plan.subject_id,
      recallType: plan.recall_type || "checkup",
      intervalMonths: plan.recall_interval_months,
      sourcePlanId: plan.id,
    });
  }
}

// ── Overdue screen / CRUD ────────────────────────────────────────────

async function listRecalls(db, filters = {}) {
  const where = [];
  const params = [];
  let i = 0;
  if (filters.status) {
    i++; where.push(`r.status = $${i}`); params.push(filters.status);
  } else if (filters.open === true) {
    where.push(`r.status IN ('due','contacted','booked')`);
  }
  if (filters.recall_type) {
    i++; where.push(`r.recall_type = $${i}`); params.push(filters.recall_type);
  }
  if (filters.overdue === true) {
    where.push(`r.due_date <= CURRENT_DATE AND r.status IN ('due','contacted')`);
  }
  if (filters.q) {
    i++; where.push(`(c.name ILIKE $${i} OR ps.name ILIKE $${i} OR c.mobile ILIKE $${i})`);
    params.push(`%${filters.q}%`);
  }
  const { rows } = await db.query(
    `SELECT r.*,
            r.due_date::text AS due_date,
            c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email,
            ps.name AS subject_name, ps.subject_type,
            (CURRENT_DATE - r.due_date) AS days_overdue,
            a.start_at AS appointment_start_at
       FROM patient_recalls r
       JOIN customers c ON c.id = r.customer_id
       LEFT JOIN patient_subjects ps ON ps.id = r.patient_subject_id
       LEFT JOIN appointments a ON a.id = r.appointment_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY r.due_date ASC, r.id ASC
      LIMIT ${Number(filters.limit) > 0 ? Number(filters.limit) : 500}`,
    params
  );
  return rows;
}

async function getRecall(db, id) {
  const { rows: [row] } = await db.query(
    `SELECT r.*, r.due_date::text AS due_date,
            c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email,
            ps.name AS subject_name
       FROM patient_recalls r
       JOIN customers c ON c.id = r.customer_id
       LEFT JOIN patient_subjects ps ON ps.id = r.patient_subject_id
      WHERE r.id = $1`,
    [id]
  );
  return row || null;
}

async function markContacted(db, id) {
  const { rows: [row] } = await db.query(
    `UPDATE patient_recalls
        SET status = CASE WHEN status = 'due' THEN 'contacted' ELSE status END,
            last_contacted_at = NOW(), contact_attempts = contact_attempts + 1,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('due','contacted')
      RETURNING *, due_date::text AS due_date`,
    [id]
  );
  return row || null;
}

async function dismissRecall(db, id, notes) {
  const { rows: [row] } = await db.query(
    `UPDATE patient_recalls
        SET status = 'dismissed', notes = COALESCE($2, notes), updated_at = NOW()
      WHERE id = $1 AND status IN ('due','contacted','booked')
      RETURNING *, due_date::text AS due_date`,
    [id, notes || null]
  );
  return row || null;
}

/**
 * Book an appointment from a recall. Either links an existing appointment
 * (appointmentId) or creates a minimal one (scheduledAt) — same fallback
 * shape as treatment-plan-service.createSession for NOT NULL service_id
 * schemas.
 */
async function bookRecall(db, id, { appointmentId = null, scheduledAt = null, employeeId = null } = {}) {
  return db.transaction(async (client) => {
    const { rows: [recall] } = await client.query(
      `SELECT r.*, c.id AS cid FROM patient_recalls r
         JOIN customers c ON c.id = r.customer_id
        WHERE r.id = $1 FOR UPDATE`,
      [id]
    );
    if (!recall) {
      const err = new Error("Recall not found");
      err.statusCode = 404;
      throw err;
    }
    if (!["due", "contacted"].includes(recall.status)) {
      const err = new Error(`Recall is ${recall.status}`);
      err.statusCode = 400;
      throw err;
    }

    let apptId = appointmentId ? Number(appointmentId) : null;
    if (!apptId) {
      if (!scheduledAt) {
        const err = new Error("appointment_id or scheduled_at required");
        err.statusCode = 400;
        throw err;
      }
      const { rows: [appt] } = await client.query(
        `INSERT INTO appointments
           (customer_id, employee_id, start_at, end_at, status, notes, source)
         VALUES ($1, $2, $3::timestamptz, $3::timestamptz + INTERVAL '60 minutes', 'confirmed', $4, 'admin')
         RETURNING id`,
        [recall.customer_id, employeeId || null, scheduledAt, `Recall follow-up (${recall.recall_type})`]
      ).catch((err) => {
        if (err.code === "23502" || err.code === "42703") return { rows: [] };
        throw err;
      });
      apptId = appt?.id || null;
      if (!apptId) {
        const err = new Error("Could not create appointment for recall");
        err.statusCode = 400;
        throw err;
      }
    }

    const { rows: [row] } = await client.query(
      `UPDATE patient_recalls
          SET status = 'booked', appointment_id = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *, due_date::text AS due_date`,
      [id, apptId]
    );
    return row;
  });
}

/** Manually complete a recall; re-arms at its interval when it has one. */
async function completeRecall(db, id) {
  const { rows: [row] } = await db.query(
    `UPDATE patient_recalls SET status = 'completed', updated_at = NOW()
      WHERE id = $1 AND status IN ('due','contacted','booked')
      RETURNING *, due_date::text AS due_date`,
    [id]
  );
  if (!row) return null;
  let next = null;
  if (row.interval_months) {
    next = await armRecall(db, {
      customerId: row.customer_id,
      subjectId: row.patient_subject_id,
      recallType: row.recall_type,
      intervalMonths: row.interval_months,
      sourcePlanId: row.source_plan_id,
      notes: row.notes,
    });
  }
  return { completed: row, next };
}

// ── Worker query ─────────────────────────────────────────────────────

const MAX_CONTACT_ATTEMPTS = 3;

/**
 * Recalls the outreach worker should act on today. Returns each row with
 * `future_appointment_id` — when set, the worker auto-books instead of
 * contacting (the suppression rule, re-checked at fire time since the
 * patient may have booked after arming).
 */
async function getDueRecallsForOutreach(db, { cadenceDays = 30 } = {}) {
  const cadence = Number(cadenceDays) > 0 ? Number(cadenceDays) : 30;
  const { rows } = await db.query(
    `SELECT r.*,
            r.due_date::text AS due_date,
            c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email,
            ps.name AS subject_name,
            (SELECT a.id FROM appointments a
               LEFT JOIN treatment_plans tp ON tp.id = a.treatment_plan_id
              WHERE a.customer_id = r.customer_id
                AND a.start_at > NOW()
                AND (a.status IS NULL OR a.status NOT IN ('cancelled','no_show'))
                AND (r.patient_subject_id IS NULL OR tp.subject_id = r.patient_subject_id)
              ORDER BY a.start_at ASC LIMIT 1) AS future_appointment_id
       FROM patient_recalls r
       JOIN customers c ON c.id = r.customer_id
       LEFT JOIN patient_subjects ps ON ps.id = r.patient_subject_id
      WHERE r.status IN ('due','contacted')
        AND r.due_date <= CURRENT_DATE
        AND r.contact_attempts < $1
        AND (r.last_contacted_at IS NULL OR r.last_contacted_at < NOW() - make_interval(days => $2))
      ORDER BY r.due_date ASC
      LIMIT 200`,
    [MAX_CONTACT_ATTEMPTS, cadence]
  );
  return rows;
}

// ── Vaccinations (vet) ───────────────────────────────────────────────

/**
 * Record an administered vaccine (in-session or standalone) and arm the
 * next-due recall. Administering also satisfies any open recall for the
 * same vaccine (armRecall completes it before inserting the next cycle).
 */
async function administerVaccination(db, {
  subjectId,
  vaccineName,
  administeredAt = null, // 'YYYY-MM-DD', default today
  sessionId = null,
  administeredBy = null,
  nextDue = null, // 'YYYY-MM-DD'
  batchNumber = null,
  notes = null,
}) {
  if (!subjectId || !vaccineName || !String(vaccineName).trim()) {
    const err = new Error("subjectId and vaccineName required");
    err.statusCode = 400;
    throw err;
  }
  const { rows: [subject] } = await db.query(
    "SELECT id, customer_id, name FROM patient_subjects WHERE id = $1",
    [subjectId]
  );
  if (!subject) {
    const err = new Error("Patient subject not found");
    err.statusCode = 404;
    throw err;
  }

  const { rows: [record] } = await db.query(
    `INSERT INTO vaccination_records
       (patient_subject_id, vaccine_name, administered_at, treatment_session_id,
        administered_by, next_due, batch_number, notes)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8)
     RETURNING *, administered_at::text AS administered_at, next_due::text AS next_due`,
    [
      subjectId, String(vaccineName).trim(), administeredAt || null,
      sessionId || null, administeredBy || null, nextDue || null,
      batchNumber || null, notes || null,
    ]
  );

  const typeKey = vaccinationTypeKey(vaccineName);
  let recall = null;
  if (nextDue) {
    recall = await armRecall(db, {
      customerId: subject.customer_id,
      subjectId,
      recallType: typeKey,
      dueDate: nextDue,
      vaccinationRecordId: record.id,
      notes: `${String(vaccineName).trim()} due`,
    });
  } else {
    // No next dose — just satisfy any open recall for this vaccine.
    await db.query(
      `UPDATE patient_recalls
          SET status = 'completed', updated_at = NOW()
        WHERE customer_id = $1 AND COALESCE(patient_subject_id, 0) = $2
          AND recall_type = $3 AND status IN ('due','contacted','booked')`,
      [subject.customer_id, subjectId, typeKey]
    );
  }
  return { record, recall };
}

/** Vaccination card for one subject — records newest-first + open recalls. */
async function getVaccinationCard(db, subjectId) {
  const { rows: [subject] } = await db.query(
    `SELECT ps.*, c.name AS owner_name, c.mobile AS owner_mobile
       FROM patient_subjects ps JOIN customers c ON c.id = ps.customer_id
      WHERE ps.id = $1`,
    [subjectId]
  );
  if (!subject) return null;
  const { rows: records } = await db.query(
    `SELECT vr.*,
            vr.administered_at::text AS administered_at,
            vr.next_due::text AS next_due,
            e.name AS administered_by_name, ts.session_number
       FROM vaccination_records vr
       LEFT JOIN employees e ON e.id = vr.administered_by
       LEFT JOIN treatment_sessions ts ON ts.id = vr.treatment_session_id
      WHERE vr.patient_subject_id = $1
      ORDER BY vr.administered_at DESC, vr.id DESC`,
    [subjectId]
  );
  const { rows: upcoming } = await db.query(
    `SELECT id, recall_type, due_date::text AS due_date, status, notes
       FROM patient_recalls
      WHERE patient_subject_id = $1
        AND recall_type LIKE 'vaccination%'
        AND status IN ('due','contacted','booked')
      ORDER BY due_date ASC`,
    [subjectId]
  );
  return { subject, records, upcoming };
}

module.exports = {
  vaccinationTypeKey,
  isVaccinationType,
  humanizeRecall,
  findFutureAppointment,
  armRecall,
  onVisitCompleted,
  listRecalls,
  getRecall,
  markContacted,
  dismissRecall,
  bookRecall,
  completeRecall,
  getDueRecallsForOutreach,
  administerVaccination,
  getVaccinationCard,
  MAX_CONTACT_ATTEMPTS,
};
