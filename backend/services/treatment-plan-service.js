"use strict";

/**
 * Treatment plan lifecycle — plans, sessions, charting, consent, lab orders,
 * clinical documents, and plan folios.
 *
 * Mirrors patterns from services/rental-service.js (status machine + activity log
 * + invoice generation) and services/room-service.js (folio model).
 */

const { generateInvoiceNumber } = require("./customer-invoicing");

// ── Status transition table ──────────────────────────────────────────

const VALID_PLAN_TRANSITIONS = {
  draft: ["active", "discontinued"],
  active: ["on_hold", "completed", "discontinued"],
  on_hold: ["active", "discontinued"],
  completed: ["invoiced"],
  discontinued: [],
  invoiced: [],
};

function validateStatusTransition(from, to) {
  if (!VALID_PLAN_TRANSITIONS[from]) {
    return { ok: false, error: `Unknown plan status: ${from}` };
  }
  if (!VALID_PLAN_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `Cannot transition plan from '${from}' to '${to}'` };
  }
  return { ok: true };
}

function calculateSessionCompletionPct(plan, sessions) {
  const total = Number(plan?.total_sessions_planned || 0);
  if (total <= 0) return 0;
  const completed = Array.isArray(sessions)
    ? sessions.filter((s) => s.status === "completed").length
    : Number(plan?.sessions_completed || 0);
  return Math.min(100, Math.round((completed / total) * 100));
}

// ── Plan numbering ───────────────────────────────────────────────────

async function generatePlanNumber(db /* , outletId */) {
  const year = new Date().getFullYear();
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*) AS cnt FROM treatment_plans
     WHERE plan_number LIKE $1`,
    [`TP-${year}-%`]
  );
  const next = Number(row?.cnt || 0) + 1;
  return `TP-${year}-${String(next).padStart(4, "0")}`;
}

async function generateLabOrderNumber(db) {
  const year = new Date().getFullYear();
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*) AS cnt FROM lab_orders
     WHERE order_number LIKE $1`,
    [`LAB-${year}-%`]
  );
  const next = Number(row?.cnt || 0) + 1;
  return `LAB-${year}-${String(next).padStart(4, "0")}`;
}

async function resolveNextSessionNumber(db, planId) {
  const { rows: [row] } = await db.query(
    "SELECT COALESCE(MAX(session_number), 0) + 1 AS next FROM treatment_sessions WHERE plan_id = $1",
    [planId]
  );
  return Number(row?.next || 1);
}

// ── Activity log ─────────────────────────────────────────────────────

async function logActivity(db, planId, actorId, activityType, description, metadata = {}) {
  await db.query(
    `INSERT INTO treatment_plan_activities (plan_id, actor_id, activity_type, description, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [planId, actorId || null, activityType, description || null, JSON.stringify(metadata || {})]
  );
}

// ── Patient subjects ─────────────────────────────────────────────────

async function listPatientSubjects(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";
  if (filters.customer_id) {
    idx++;
    where += ` AND customer_id = $${idx}`;
    params.push(Number(filters.customer_id));
  }
  if (filters.is_active !== undefined) {
    idx++;
    where += ` AND is_active = $${idx}`;
    params.push(filters.is_active === "false" || filters.is_active === false ? false : true);
  }
  const { rows } = await db.query(
    `SELECT * FROM patient_subjects WHERE ${where} ORDER BY name ASC`,
    params
  );
  return rows;
}

async function createPatientSubject(db, data) {
  const { rows: [row] } = await db.query(
    `INSERT INTO patient_subjects
       (customer_id, subject_type, name, species, breed, dob, sex, weight_kg,
        identifier, photo_url, notes, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, TRUE))
     RETURNING *`,
    [
      data.customer_id, data.subject_type || "self", data.name,
      data.species || null, data.breed || null, data.dob || null,
      data.sex || null, data.weight_kg ?? null, data.identifier || null,
      data.photo_url || null, data.notes || null, data.is_active,
    ]
  );
  return row;
}

async function updatePatientSubject(db, id, data) {
  const allowed = [
    "subject_type", "name", "species", "breed", "dob", "sex", "weight_kg",
    "identifier", "photo_url", "notes", "is_active",
  ];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) {
    const { rows: [cur] } = await db.query("SELECT * FROM patient_subjects WHERE id = $1", [id]);
    return cur || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE patient_subjects SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row || null;
}

async function deletePatientSubject(db, id) {
  const { rows: [row] } = await db.query(
    "UPDATE patient_subjects SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  return row || null;
}

// ── Plans ────────────────────────────────────────────────────────────

async function listPlans(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      const placeholders = filters.status.map(() => {
        idx++;
        params.push(filters.status[idx - 1 - (params.length - filters.status.length)]);
        return `$${idx}`;
      });
      // simpler: rewrite
    }
    if (typeof filters.status === "string") {
      idx++;
      where += ` AND p.status = $${idx}`;
      params.push(filters.status);
    }
  }
  if (filters.customer_id) {
    idx++;
    where += ` AND p.customer_id = $${idx}`;
    params.push(Number(filters.customer_id));
  }
  if (filters.subject_id) {
    idx++;
    where += ` AND p.subject_id = $${idx}`;
    params.push(Number(filters.subject_id));
  }
  if (filters.provider_id) {
    idx++;
    where += ` AND p.provider_id = $${idx}`;
    params.push(Number(filters.provider_id));
  }
  if (filters.search) {
    idx++;
    where += ` AND (p.plan_number ILIKE $${idx} OR p.title ILIKE $${idx})`;
    params.push(`%${filters.search}%`);
  }
  const { rows } = await db.query(
    `SELECT p.*,
       c.name AS customer_name,
       ps.name AS subject_name, ps.subject_type,
       e.name AS provider_name,
       (SELECT tf.id FROM treatment_folios tf WHERE tf.plan_id = p.id AND tf.status = 'open' ORDER BY tf.created_at DESC LIMIT 1) AS folio_id
     FROM treatment_plans p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN patient_subjects ps ON ps.id = p.subject_id
     LEFT JOIN employees e ON e.id = p.provider_id
     WHERE ${where}
     ORDER BY p.created_at DESC
     LIMIT 500`,
    params
  );
  return rows;
}

async function getPlan(db, id) {
  const { rows: [plan] } = await db.query(
    `SELECT p.*,
       c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email,
       ps.name AS subject_name, ps.subject_type, ps.species, ps.breed,
       e.name AS provider_name
     FROM treatment_plans p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN patient_subjects ps ON ps.id = p.subject_id
     LEFT JOIN employees e ON e.id = p.provider_id
     WHERE p.id = $1`,
    [id]
  );
  if (!plan) return null;
  const { rows: sessions } = await db.query(
    "SELECT * FROM treatment_sessions WHERE plan_id = $1 ORDER BY session_number ASC",
    [id]
  );
  const { rows: labOrders } = await db.query(
    "SELECT * FROM lab_orders WHERE plan_id = $1 ORDER BY ordered_at DESC",
    [id]
  );
  const { rows: consents } = await db.query(
    "SELECT * FROM consent_forms WHERE plan_id = $1 ORDER BY signed_at DESC",
    [id]
  );
  const { rows: documents } = await db.query(
    "SELECT * FROM clinical_documents WHERE plan_id = $1 ORDER BY uploaded_at DESC",
    [id]
  );
  const { rows: [folio] } = await db.query(
    "SELECT * FROM treatment_folios WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 1",
    [id]
  );
  const { rows: activities } = await db.query(
    "SELECT * FROM treatment_plan_activities WHERE plan_id = $1 ORDER BY created_at DESC",
    [id]
  );
  return {
    ...plan,
    sessions,
    lab_orders: labOrders,
    consents,
    documents,
    folio,
    activities,
    progress_pct: calculateSessionCompletionPct(plan, sessions),
  };
}

async function createPlan(db, payload, createdBy) {
  return db.transaction(async (client) => {
    const planNumber = await generatePlanNumber(client);
    const { rows: [plan] } = await client.query(
      `INSERT INTO treatment_plans
         (plan_number, customer_id, subject_id, outlet_id, created_by, provider_id,
          title, diagnosis_code, diagnosis_notes, status,
          start_date, expected_end_date, total_sessions_planned, estimated_total,
          deposit_collected, deposit_method, deposit_paid_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8, $9, 'draft',
               $10, $11, $12, $13,
               $14, $15, $16, $17)
       RETURNING *`,
      [
        planNumber, payload.customer_id, payload.subject_id || null,
        payload.outlet_id || null, createdBy, payload.provider_id || null,
        payload.title, payload.diagnosis_code || null, payload.diagnosis_notes || null,
        payload.start_date || null, payload.expected_end_date || null,
        payload.total_sessions_planned || 1, payload.estimated_total || 0,
        payload.deposit_collected || 0, payload.deposit_method || null,
        payload.deposit_collected > 0 ? new Date().toISOString() : null,
        payload.notes || null,
      ]
    );

    // Seed a folio immediately
    await client.query(
      `INSERT INTO treatment_folios (plan_id, status) VALUES ($1, 'open')`,
      [plan.id]
    );

    await client.query(
      `INSERT INTO treatment_plan_activities (plan_id, actor_id, activity_type, description, metadata)
       VALUES ($1, $2, 'status_change', $3, $4)`,
      [plan.id, createdBy || null, `Plan created as draft`,
        JSON.stringify({ plan_number: planNumber })]
    );

    if (Number(payload.deposit_collected || 0) > 0) {
      await client.query(
        `INSERT INTO treatment_plan_activities (plan_id, actor_id, activity_type, description, metadata)
         VALUES ($1, $2, 'deposit_recorded', $3, $4)`,
        [plan.id, createdBy || null,
          `Deposit of ${payload.deposit_collected} recorded`,
          JSON.stringify({ amount: payload.deposit_collected, method: payload.deposit_method || null })]
      );
    }

    return plan;
  });
}

async function updatePlan(db, id, data) {
  const allowed = [
    "subject_id", "provider_id", "title", "diagnosis_code", "diagnosis_notes",
    "expected_end_date", "total_sessions_planned", "estimated_total", "notes",
  ];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) {
    const { rows: [cur] } = await db.query("SELECT * FROM treatment_plans WHERE id = $1", [id]);
    return cur || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE treatment_plans SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row || null;
}

async function transitionPlanStatus(db, planId, toStatus, actorId, reason) {
  const { rows: [current] } = await db.query(
    "SELECT * FROM treatment_plans WHERE id = $1",
    [planId]
  );
  if (!current) return null;
  const check = validateStatusTransition(current.status, toStatus);
  if (!check.ok) {
    const err = new Error(check.error);
    err.statusCode = 400;
    throw err;
  }
  const actualEndDate = toStatus === "completed" || toStatus === "discontinued"
    ? new Date().toISOString().slice(0, 10)
    : current.actual_end_date;
  const { rows: [updated] } = await db.query(
    `UPDATE treatment_plans
     SET status = $1, actual_end_date = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [toStatus, actualEndDate, planId]
  );
  await logActivity(db, planId, actorId, "status_change",
    `Status: ${current.status} → ${toStatus}${reason ? ` (${reason})` : ""}`,
    { from: current.status, to: toStatus, reason: reason || null });
  return updated;
}

async function addPlanNote(db, planId, actorId, description) {
  await logActivity(db, planId, actorId, "note", description, {});
  return { ok: true };
}

// ── Sessions ─────────────────────────────────────────────────────────

async function createSession(db, planId, payload, actorId) {
  // Retry once on 23505 (unique violation on (plan_id, session_number)) —
  // handles concurrent session creation for the same plan by re-reading MAX+1.
  const attempt = async () => db.transaction(async (client) => {
    const { rows: [plan] } = await client.query(
      "SELECT * FROM treatment_plans WHERE id = $1",
      [planId]
    );
    if (!plan) {
      const err = new Error("Plan not found");
      err.statusCode = 404;
      throw err;
    }
    const sessionNumber = await resolveNextSessionNumber(client, planId);

    let appointmentId = null;
    if (payload.create_appointment && payload.scheduled_at) {
      // Create a minimal appointment linked to this session
      const { rows: [appt] } = await client.query(
        `INSERT INTO appointments
           (customer_id, employee_id, start_at, end_at, status,
            treatment_plan_id, notes, source)
         VALUES ($1, $2, $3, $3 + INTERVAL '60 minutes', 'confirmed', $4, $5, 'admin')
         RETURNING id`,
        [
          plan.customer_id, payload.provider_id || plan.provider_id || null,
          payload.scheduled_at, planId,
          `Plan ${plan.plan_number} session #${sessionNumber}`,
        ]
      ).catch((err) => {
        // If appointments table requires service_id (NOT NULL), fall back silently
        if (err.code === "23502" || err.code === "42703") return { rows: [] };
        throw err;
      });
      appointmentId = appt?.id || null;
    }

    const { rows: [session] } = await client.query(
      `INSERT INTO treatment_sessions
         (plan_id, session_number, appointment_id, provider_id, scheduled_at,
          status, chief_complaint)
       VALUES ($1, $2, $3, $4, $5, 'scheduled', $6)
       RETURNING *`,
      [
        planId, sessionNumber, appointmentId,
        payload.provider_id || plan.provider_id || null,
        payload.scheduled_at || null, payload.chief_complaint || null,
      ]
    );

    // Back-link appointment to session
    if (appointmentId) {
      await client.query(
        `UPDATE appointments SET treatment_session_id = $1 WHERE id = $2`,
        [session.id, appointmentId]
      );
    }

    await client.query(
      `INSERT INTO treatment_plan_activities (plan_id, actor_id, activity_type, description, metadata)
       VALUES ($1, $2, 'note', $3, $4)`,
      [planId, actorId || null, `Session #${sessionNumber} scheduled`,
        JSON.stringify({ session_id: session.id, scheduled_at: payload.scheduled_at || null })]
    );
    return session;
  });

  try {
    return await attempt();
  } catch (err) {
    if (err.code === "23505" && String(err.message).includes("plan_id") && String(err.message).includes("session_number")) {
      // Concurrent creation collided on (plan_id, session_number) — retry once
      return await attempt();
    }
    throw err;
  }
}

async function updateSession(db, id, data) {
  const allowed = ["scheduled_at", "provider_id", "chief_complaint", "next_session_notes"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) {
    const { rows: [cur] } = await db.query("SELECT * FROM treatment_sessions WHERE id = $1", [id]);
    return cur || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE treatment_sessions SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row || null;
}

async function startSession(db, id) {
  const { rows: [row] } = await db.query(
    `UPDATE treatment_sessions
     SET status = 'in_progress', actual_start_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status IN ('scheduled')
     RETURNING *`,
    [id]
  );
  return row || null;
}

async function completeSession(db, sessionId, payload, actorId) {
  return db.transaction(async (client) => {
    const { rows: [session] } = await client.query(
      "SELECT * FROM treatment_sessions WHERE id = $1",
      [sessionId]
    );
    if (!session) {
      const err = new Error("Session not found");
      err.statusCode = 404;
      throw err;
    }
    if (session.status === "completed") {
      const err = new Error("Session already completed");
      err.statusCode = 400;
      throw err;
    }

    // 1. Update session
    await client.query(
      `UPDATE treatment_sessions
       SET status = 'completed',
           actual_start_at = COALESCE(actual_start_at, NOW()),
           actual_end_at = NOW(),
           soap_subjective = $1, soap_objective = $2,
           soap_assessment = $3, soap_plan = $4,
           next_session_notes = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        payload.soap_subjective || null, payload.soap_objective || null,
        payload.soap_assessment || null, payload.soap_plan || null,
        payload.next_session_notes || null, sessionId,
      ]
    );

    // 2. Vitals
    for (const v of payload.vitals || []) {
      await client.query(
        `INSERT INTO vital_signs
           (session_id, blood_pressure_sys, blood_pressure_dia, heart_rate,
            respiratory_rate, temperature_c, oxygen_saturation, weight_kg,
            height_cm, pain_score, custom_vitals)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          sessionId, v.blood_pressure_sys || null, v.blood_pressure_dia || null,
          v.heart_rate || null, v.respiratory_rate || null, v.temperature_c || null,
          v.oxygen_saturation || null, v.weight_kg || null, v.height_cm || null,
          v.pain_score != null ? v.pain_score : null,
          JSON.stringify(v.custom_vitals || {}),
        ]
      );
    }

    // 3. Prescriptions
    for (const p of payload.prescriptions || []) {
      await client.query(
        `INSERT INTO prescriptions
           (session_id, plan_id, medication_name, strength, dosage, frequency,
            duration, instructions, refills_remaining, prescriber_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          sessionId, session.plan_id, p.medication_name,
          p.strength || null, p.dosage || null, p.frequency || null,
          p.duration || null, p.instructions || null,
          p.refills_remaining || 0, actorId || null,
        ]
      );
    }

    // 4. Chart entries
    for (const ce of payload.chart_entries || []) {
      await client.query(
        `INSERT INTO session_chart_entries
           (session_id, area_code, condition_code, severity, notes, color_marker)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sessionId, ce.area_code, ce.condition_code,
          ce.severity || null, ce.notes || null, ce.color_marker || null,
        ]
      );
    }

    // 5. Bump plan.sessions_completed
    await client.query(
      `UPDATE treatment_plans
       SET sessions_completed = sessions_completed + 1, updated_at = NOW()
       WHERE id = $1`,
      [session.plan_id]
    );

    // 6. Folio: add session_fee line (if fee provided)
    const fee = Number(payload.session_fee || 0);
    if (fee > 0) {
      const folio = await upsertFolioForPlan(client, session.plan_id);
      await writeSessionFeeLine(client, folio.id, sessionId, fee, actorId);
    }

    // 7. Activity log
    await client.query(
      `INSERT INTO treatment_plan_activities (plan_id, actor_id, activity_type, description, metadata)
       VALUES ($1, $2, 'session_completed', $3, $4)`,
      [session.plan_id, actorId || null,
        `Session #${session.session_number} completed`,
        JSON.stringify({
          session_id: sessionId,
          vitals_count: (payload.vitals || []).length,
          prescriptions_count: (payload.prescriptions || []).length,
          chart_entries_count: (payload.chart_entries || []).length,
          fee,
        })]
    );

    const { rows: [updated] } = await client.query(
      "SELECT * FROM treatment_sessions WHERE id = $1",
      [sessionId]
    );
    return updated;
  });
}

async function markSessionNoShow(db, sessionId) {
  const { rows: [row] } = await db.query(
    `UPDATE treatment_sessions
     SET status = 'no_show', updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [sessionId]
  );
  return row || null;
}

async function cancelSession(db, sessionId) {
  const { rows: [row] } = await db.query(
    `UPDATE treatment_sessions
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [sessionId]
  );
  return row || null;
}

async function listSessions(db, planId) {
  const { rows } = await db.query(
    `SELECT s.*, e.name AS provider_name
     FROM treatment_sessions s
     LEFT JOIN employees e ON e.id = s.provider_id
     WHERE s.plan_id = $1
     ORDER BY s.session_number ASC`,
    [planId]
  );
  return rows;
}

// ── Chart ────────────────────────────────────────────────────────────

async function listChartAreas(db, preset) {
  const { rows } = await db.query(
    `SELECT * FROM chart_areas WHERE preset_key = $1 ORDER BY display_order ASC, area_code ASC`,
    [preset]
  );
  return rows;
}

async function getPlanChart(db, planId) {
  // Aggregated view: latest entry per area across all sessions for this plan
  const { rows } = await db.query(
    `SELECT DISTINCT ON (ce.area_code)
       ce.area_code, ce.condition_code, ce.severity, ce.notes, ce.color_marker,
       ce.session_id, ce.created_at
     FROM session_chart_entries ce
     JOIN treatment_sessions s ON s.id = ce.session_id
     WHERE s.plan_id = $1
     ORDER BY ce.area_code, ce.created_at DESC`,
    [planId]
  );
  return rows;
}

async function addChartEntry(db, sessionId, data) {
  const { rows: [row] } = await db.query(
    `INSERT INTO session_chart_entries
       (session_id, area_code, condition_code, severity, notes, color_marker)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      sessionId, data.area_code, data.condition_code,
      data.severity || null, data.notes || null, data.color_marker || null,
    ]
  );
  return row;
}

async function updateChartEntry(db, id, data) {
  const allowed = ["condition_code", "severity", "notes", "color_marker"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) {
    const { rows: [cur] } = await db.query("SELECT * FROM session_chart_entries WHERE id = $1", [id]);
    return cur || null;
  }
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE session_chart_entries SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row || null;
}

async function deleteChartEntry(db, id) {
  const { rows: [row] } = await db.query(
    "DELETE FROM session_chart_entries WHERE id = $1 RETURNING *",
    [id]
  );
  return row || null;
}

// ── Lab orders ───────────────────────────────────────────────────────

async function listLabOrders(db, planId) {
  const { rows } = await db.query(
    `SELECT lo.*, e.name AS ordered_by_name
     FROM lab_orders lo
     LEFT JOIN employees e ON e.id = lo.ordered_by
     WHERE lo.plan_id = $1
     ORDER BY lo.ordered_at DESC`,
    [planId]
  );
  return rows;
}

async function createLabOrder(db, planId, payload, actorId) {
  return db.transaction(async (client) => {
    const orderNumber = await generateLabOrderNumber(client);
    const { rows: [order] } = await client.query(
      `INSERT INTO lab_orders
         (plan_id, session_id, order_number, lab_vendor, test_name, test_code,
          cost, ordered_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        planId, payload.session_id || null, orderNumber,
        payload.lab_vendor || null, payload.test_name, payload.test_code || null,
        payload.cost || 0, actorId || null, payload.notes || null,
      ]
    );
    await logActivity(client, planId, actorId, "lab_ordered",
      `Lab ordered: ${payload.test_name}`,
      { order_id: order.id, order_number: orderNumber });
    return order;
  });
}

async function updateLabOrder(db, id, data) {
  const allowed = ["status", "lab_vendor", "notes", "shared_with_patient"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) {
    const { rows: [cur] } = await db.query("SELECT * FROM lab_orders WHERE id = $1", [id]);
    return cur || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE lab_orders SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return row || null;
}

async function recordLabResult(db, id, data) {
  const { rows: [row] } = await db.query(
    `UPDATE lab_orders
     SET status = 'completed',
         result_summary = $1,
         result_document_id = $2,
         result_received_at = NOW(),
         shared_with_patient = COALESCE($3, shared_with_patient),
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [data.result_summary, data.result_document_id || null,
      data.shared_with_patient ?? null, id]
  );
  return row || null;
}

// ── Consent ──────────────────────────────────────────────────────────

async function signConsent(db, planId, payload, actorId, signatureUrl = null) {
  return db.transaction(async (client) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO consent_forms
         (plan_id, session_id, form_template_key, title, body_markdown,
          signed_by_name, signed_by_relation, signature_image_url,
          witnessed_by_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        planId, payload.session_id || null, payload.form_template_key,
        payload.title, payload.body_markdown, payload.signed_by_name,
        payload.signed_by_relation || "self", signatureUrl,
        payload.witnessed_by_id || null, payload.ip_address || null,
      ]
    );
    await logActivity(client, planId, actorId, "consent_signed",
      `Consent signed: ${payload.title}`,
      { consent_id: row.id, template: payload.form_template_key });
    return row;
  });
}

async function listConsents(db, planId) {
  const { rows } = await db.query(
    "SELECT * FROM consent_forms WHERE plan_id = $1 ORDER BY signed_at DESC",
    [planId]
  );
  return rows;
}

// ── Clinical documents ───────────────────────────────────────────────

async function uploadClinicalDocument(db, planId, payload, actorId) {
  return db.transaction(async (client) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO clinical_documents
         (plan_id, session_id, document_type, title, file_url, file_mime,
          file_size_bytes, uploaded_by, notes, shared_with_patient)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, FALSE))
       RETURNING *`,
      [
        planId, payload.session_id || null, payload.document_type,
        payload.title, payload.file_url, payload.file_mime || null,
        payload.file_size_bytes || null, actorId || null,
        payload.notes || null, payload.shared_with_patient,
      ]
    );
    await logActivity(client, planId, actorId, "document_uploaded",
      `Document: ${payload.title}`,
      { document_id: row.id, type: payload.document_type });
    return row;
  });
}

async function listClinicalDocuments(db, planId) {
  const { rows } = await db.query(
    "SELECT * FROM clinical_documents WHERE plan_id = $1 ORDER BY uploaded_at DESC",
    [planId]
  );
  return rows;
}

async function deleteClinicalDocument(db, id) {
  const { rows: [row] } = await db.query(
    "DELETE FROM clinical_documents WHERE id = $1 RETURNING *",
    [id]
  );
  return row || null;
}

// ── Prescriptions ────────────────────────────────────────────────────

async function listPrescriptions(db, planId) {
  const { rows } = await db.query(
    `SELECT p.*, s.session_number
     FROM prescriptions p
     LEFT JOIN treatment_sessions s ON s.id = p.session_id
     WHERE p.plan_id = $1
     ORDER BY p.prescribed_at DESC`,
    [planId]
  );
  return rows;
}

async function createPrescription(db, sessionId, payload, actorId) {
  const { rows: [session] } = await db.query(
    "SELECT plan_id FROM treatment_sessions WHERE id = $1",
    [sessionId]
  );
  if (!session) {
    const err = new Error("Session not found");
    err.statusCode = 404;
    throw err;
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO prescriptions
       (session_id, plan_id, medication_name, strength, dosage, frequency,
        duration, instructions, refills_remaining, prescriber_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      sessionId, session.plan_id, payload.medication_name,
      payload.strength || null, payload.dosage || null,
      payload.frequency || null, payload.duration || null,
      payload.instructions || null, payload.refills_remaining || 0,
      actorId || null,
    ]
  );
  return row;
}

// ── Folio ────────────────────────────────────────────────────────────

async function upsertFolioForPlan(db, planId) {
  const { rows: [existing] } = await db.query(
    "SELECT * FROM treatment_folios WHERE plan_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    [planId]
  );
  if (existing) return existing;
  const { rows: [created] } = await db.query(
    `INSERT INTO treatment_folios (plan_id, status) VALUES ($1, 'open') RETURNING *`,
    [planId]
  );
  return created;
}

async function getFolio(db, folioId) {
  const { rows: [folio] } = await db.query(
    "SELECT * FROM treatment_folios WHERE id = $1",
    [folioId]
  );
  if (!folio) return null;
  const { rows: lines } = await db.query(
    "SELECT * FROM treatment_folio_lines WHERE folio_id = $1 ORDER BY created_at ASC",
    [folioId]
  );
  return { ...folio, lines };
}

async function getFolioForPlan(db, planId) {
  const { rows: [folio] } = await db.query(
    "SELECT * FROM treatment_folios WHERE plan_id = $1 ORDER BY created_at DESC LIMIT 1",
    [planId]
  );
  if (!folio) return null;
  const { rows: lines } = await db.query(
    "SELECT * FROM treatment_folio_lines WHERE folio_id = $1 ORDER BY created_at ASC",
    [folio.id]
  );
  return { ...folio, lines };
}

async function writeSessionFeeLine(db, folioId, sessionId, amount, actorId) {
  const { rows: [line] } = await db.query(
    `INSERT INTO treatment_folio_lines
       (folio_id, line_type, description, quantity, unit_price, line_total,
        session_id, added_by)
     VALUES ($1, 'session_fee', $2, 1, $3, $3, $4, $5)
     RETURNING *`,
    [folioId, `Session fee`, amount, sessionId, actorId || null]
  );
  await recalcFolioTotals(db, folioId);
  return line;
}

async function addFolioLine(db, folioId, data, actorId) {
  const qty = Number(data.quantity || 1);
  const unit = Number(data.unit_price || 0);
  const total = qty * unit;
  const { rows: [line] } = await db.query(
    `INSERT INTO treatment_folio_lines
       (folio_id, line_type, description, quantity, unit_price, line_total, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [folioId, data.line_type || "manual_charge", data.description,
      qty, unit, total, actorId || null]
  );
  await recalcFolioTotals(db, folioId);
  return line;
}

async function attachSaleToFolio(db, saleId, folioId, actorId) {
  return db.transaction(async (client) => {
    // Lookup sale total
    const { rows: [sale] } = await client.query(
      "SELECT id, total, timestamp FROM sales WHERE id = $1",
      [saleId]
    );
    if (!sale) {
      const err = new Error("Sale not found");
      err.statusCode = 404;
      throw err;
    }
    // Link the sale
    await client.query(
      "UPDATE sales SET treatment_folio_id = $1 WHERE id = $2",
      [folioId, saleId]
    );
    // Write folio line
    const total = Number(sale.total || 0);
    const { rows: [line] } = await client.query(
      `INSERT INTO treatment_folio_lines
         (folio_id, line_type, description, quantity, unit_price, line_total,
          sale_id, added_by)
       VALUES ($1, 'pos_sale', $2, 1, $3, $3, $4, $5)
       RETURNING *`,
      [folioId, `POS sale #${saleId}`, total, saleId, actorId || null]
    );
    await recalcFolioTotals(client, folioId);
    return line;
  });
}

async function recalcFolioTotals(db, folioId) {
  const { rows: [totals] } = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN line_type = 'session_fee' THEN line_total ELSE 0 END), 0) AS session_total,
       COALESCE(SUM(CASE WHEN line_type = 'pos_sale' THEN line_total ELSE 0 END), 0) AS pos_total,
       COALESCE(SUM(CASE WHEN line_type IN ('lab_cost','manual_charge') THEN line_total ELSE 0 END), 0) AS manual_total,
       COALESCE(SUM(CASE WHEN line_type = 'tax' THEN line_total ELSE 0 END), 0) AS tax_total,
       COALESCE(SUM(CASE WHEN line_type = 'discount' THEN line_total ELSE 0 END), 0) AS discount_total
     FROM treatment_folio_lines
     WHERE folio_id = $1`,
    [folioId]
  );
  const sessionTotal = Number(totals.session_total || 0);
  const posTotal = Number(totals.pos_total || 0);
  const manualTotal = Number(totals.manual_total || 0);
  const taxTotal = Number(totals.tax_total || 0);
  const discountTotal = Number(totals.discount_total || 0);
  const grand = sessionTotal + posTotal + manualTotal + taxTotal + discountTotal;
  await db.query(
    `UPDATE treatment_folios
     SET session_charge_total = $1, pos_charge_total = $2, tax_total = $3,
         grand_total = $4, updated_at = NOW()
     WHERE id = $5`,
    [sessionTotal, posTotal + manualTotal, taxTotal, grand, folioId]
  );
}

async function settleFolio(db, folioId, actorId, opts = {}) {
  return db.transaction(async (client) => {
    const { rows: [folio] } = await client.query(
      "SELECT * FROM treatment_folios WHERE id = $1 FOR UPDATE",
      [folioId]
    );
    if (!folio) {
      const err = new Error("Folio not found");
      err.statusCode = 404;
      throw err;
    }
    if (folio.status !== "open") {
      const err = new Error(`Folio is already ${folio.status}`);
      err.statusCode = 400;
      throw err;
    }
    const { rows: [plan] } = await client.query(
      "SELECT * FROM treatment_plans WHERE id = $1",
      [folio.plan_id]
    );
    if (!plan) {
      const err = new Error("Plan not found");
      err.statusCode = 404;
      throw err;
    }
    await recalcFolioTotals(client, folioId);
    const { rows: [refreshed] } = await client.query(
      "SELECT * FROM treatment_folios WHERE id = $1",
      [folioId]
    );

    const { rows: lines } = await client.query(
      "SELECT * FROM treatment_folio_lines WHERE folio_id = $1",
      [folioId]
    );
    const grand = Number(refreshed.grand_total || 0);
    const deposit = opts.apply_deposit !== false
      ? Number(plan.deposit_collected || 0)
      : 0;
    const totalAfterDeposit = Math.max(0, grand - deposit);

    // Create customer_invoices row
    const invoiceNumber = await generateInvoiceNumber(client);
    const { rows: [invoice] } = await client.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, outlet_id, employee_id, status,
          subtotal, tax_total, discount_amount, total_amount, balance_due)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, 0, $7, $7)
       RETURNING *`,
      [
        invoiceNumber, plan.customer_id, plan.outlet_id || null, actorId || null,
        Number(refreshed.session_charge_total || 0) + Number(refreshed.pos_charge_total || 0),
        Number(refreshed.tax_total || 0),
        totalAfterDeposit,
      ]
    );

    // Copy folio lines as invoice items
    for (const line of lines) {
      if (line.line_type === "discount" || line.line_type === "tax") continue;
      await client.query(
        `INSERT INTO customer_invoice_items
           (invoice_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, 0, $5)`,
        [invoice.id, line.description, line.quantity, line.unit_price, line.line_total]
      );
    }

    // Mark folio settled
    await client.query(
      `UPDATE treatment_folios
       SET status = 'settled', settled_at = NOW(), invoice_id = $1,
           deposit_applied = $2, updated_at = NOW()
       WHERE id = $3`,
      [invoice.id, deposit, folioId]
    );

    // Mark plan invoiced
    await client.query(
      `UPDATE treatment_plans
       SET status = 'invoiced', final_invoice_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [invoice.id, folio.plan_id]
    );

    await logActivity(client, folio.plan_id, actorId, "invoice_generated",
      `Folio settled — invoice ${invoiceNumber}`,
      { invoice_id: invoice.id, invoice_number: invoiceNumber, total: totalAfterDeposit });

    return { folio_id: folioId, invoice, deposit_applied: deposit };
  });
}

// ── Consent templates (static config) ────────────────────────────────

const CONSENT_TEMPLATES = {
  general_treatment: {
    title: "General Treatment Consent",
    body: `I acknowledge that treatment involves inherent risks and benefits. I have had the opportunity to ask questions about the proposed treatment plan, and I consent to the care described.`,
  },
  anaesthesia: {
    title: "Anaesthesia Consent",
    body: `I understand that anaesthesia carries risks including allergic reactions, nausea, and in rare cases, more serious complications. I consent to the administration of local or general anaesthesia as deemed necessary.`,
  },
  extraction: {
    title: "Tooth Extraction Consent",
    body: `I understand the nature and risks of tooth extraction, including bleeding, infection, dry socket, and damage to adjacent teeth. I consent to the extraction procedure.`,
  },
  implant: {
    title: "Dental Implant Consent",
    body: `I understand the risks and benefits of dental implant surgery, including implant failure, nerve damage, and infection. I consent to the implant procedure.`,
  },
  surgery: {
    title: "Surgical Procedure Consent",
    body: `I understand the risks and benefits of the proposed surgical procedure, including infection, bleeding, and anaesthesia-related complications. I consent to the surgery.`,
  },
  euthanasia: {
    title: "Euthanasia Consent",
    body: `I understand that the euthanasia procedure is irreversible. I have discussed the prognosis with the veterinarian and consent to the humane euthanasia of my pet.`,
  },
  manual_therapy: {
    title: "Manual Therapy Consent",
    body: `I understand that manual therapy may cause temporary soreness or stiffness. I consent to the manual therapy techniques as part of my treatment plan.`,
  },
  exercise_plan: {
    title: "Exercise Plan Consent",
    body: `I consent to the exercise programme as prescribed. I will report any pain or discomfort to my therapist and stop exercises that cause significant pain.`,
  },
};

function getConsentTemplate(key) {
  return CONSENT_TEMPLATES[key] || null;
}

function listConsentTemplateKeys() {
  return Object.keys(CONSENT_TEMPLATES);
}

// ── Queries for workers ──────────────────────────────────────────────

async function getOverduePlans(db) {
  const { rows } = await db.query(
    `SELECT p.*,
       c.email AS customer_email,
       c.name AS customer_name,
       e.email AS provider_email,
       e.name AS provider_name
     FROM treatment_plans p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN employees e ON e.id = p.provider_id
     WHERE p.status = 'active'
       AND p.expected_end_date IS NOT NULL
       AND p.expected_end_date < CURRENT_DATE - INTERVAL '7 days'
       AND p.sessions_completed < p.total_sessions_planned`
  );
  return rows;
}

async function getUpcomingSessionsNeedingReminder(db) {
  const { rows } = await db.query(
    `SELECT s.*,
       p.plan_number, p.customer_id,
       c.name AS customer_name, c.email AS customer_email,
       e.name AS provider_name
     FROM treatment_sessions s
     JOIN treatment_plans p ON p.id = s.plan_id
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN employees e ON e.id = s.provider_id
     WHERE s.status = 'scheduled'
       AND s.scheduled_at IS NOT NULL
       AND s.scheduled_at > NOW()
       AND s.scheduled_at <= NOW() + INTERVAL '24 hours'
       AND p.status = 'active'`
  );
  return rows;
}

module.exports = {
  validateStatusTransition,
  calculateSessionCompletionPct,
  resolveNextSessionNumber,
  generatePlanNumber,
  generateLabOrderNumber,
  logActivity,
  // subjects
  listPatientSubjects,
  createPatientSubject,
  updatePatientSubject,
  deletePatientSubject,
  // plans
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  transitionPlanStatus,
  addPlanNote,
  // sessions
  listSessions,
  createSession,
  updateSession,
  startSession,
  completeSession,
  markSessionNoShow,
  cancelSession,
  // chart
  listChartAreas,
  getPlanChart,
  addChartEntry,
  updateChartEntry,
  deleteChartEntry,
  // labs
  listLabOrders,
  createLabOrder,
  updateLabOrder,
  recordLabResult,
  // consent
  signConsent,
  listConsents,
  getConsentTemplate,
  listConsentTemplateKeys,
  CONSENT_TEMPLATES,
  // documents
  uploadClinicalDocument,
  listClinicalDocuments,
  deleteClinicalDocument,
  // prescriptions
  listPrescriptions,
  createPrescription,
  // folio
  upsertFolioForPlan,
  getFolio,
  getFolioForPlan,
  writeSessionFeeLine,
  addFolioLine,
  attachSaleToFolio,
  recalcFolioTotals,
  settleFolio,
  // worker queries
  getOverduePlans,
  getUpcomingSessionsNeedingReminder,
  VALID_PLAN_TRANSITIONS,
};
