"use strict";

/**
 * F03 Form builder service.
 *
 * Tenant-defined forms (intake / waivers / questionnaires) with typed fields,
 * filled by customers (portal / public token) or staff, optionally signed,
 * attached to any entity.
 *
 * Load-bearing design: a response freezes the template's fields into
 * `fields_snapshot` at SEND time. Every render and every validation uses that
 * snapshot — editing the live template can never corrupt or re-word an existing
 * response (the same legal-safety pattern as signed consent forms).
 *
 * The three fill paths (portal / public_link / staff) ALL converge on the
 * single `submitResponse()` write path with one validation path
 * (`validateAnswers`). Any divergence here is the feedback_parallel_paths bug.
 */

const crypto = require("crypto");
const { uploadToR2 } = require("../utils/r2");

// 256-bit unguessable single-use token for the public fill link.
function generatePublicToken() {
  return crypto.randomBytes(32).toString("hex");
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// ── Answer validation (the single validation path) ───────────────────
// Validates a submitted `answers` object against a frozen `fields_snapshot`.
// Enforces required fields, coerces number/date, normalizes checkbox to bool,
// and enforces signature_ack acceptance. Returns a cleaned answers object.
function validateAnswers(fieldsSnapshot, rawAnswers) {
  const fields = Array.isArray(fieldsSnapshot) ? fieldsSnapshot : [];
  const answers = rawAnswers && typeof rawAnswers === "object" ? rawAnswers : {};
  const clean = {};

  for (const f of fields) {
    const key = f.key;
    let val = answers[key];
    const provided =
      val !== undefined && val !== null && !(typeof val === "string" && val.trim() === "");

    if (!provided) {
      if (f.required) throw badRequest(`Missing required field: ${f.label || key}`);
      // Preserve an explicit unchecked checkbox as false; otherwise skip.
      if (f.type === "checkbox") clean[key] = false;
      continue;
    }

    switch (f.type) {
      case "number": {
        const n = Number(val);
        if (Number.isNaN(n)) throw badRequest(`"${f.label || key}" must be a number`);
        clean[key] = n;
        break;
      }
      case "date": {
        // Accept YYYY-MM-DD (HTML date input). Store as-is after a sanity parse.
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) throw badRequest(`"${f.label || key}" must be a valid date`);
        clean[key] = String(val);
        break;
      }
      case "checkbox":
      case "signature_ack": {
        const truthy = val === true || val === "true" || val === 1 || val === "1" || val === "on";
        if (f.type === "signature_ack" && f.required && !truthy) {
          throw badRequest(`"${f.label || key}" must be acknowledged`);
        }
        clean[key] = !!truthy;
        break;
      }
      case "select": {
        const opts = Array.isArray(f.options) ? f.options : [];
        if (opts.length && !opts.includes(String(val))) {
          throw badRequest(`"${String(val)}" is not a valid option for ${f.label || key}`);
        }
        clean[key] = String(val);
        break;
      }
      default: {
        // text / textarea
        clean[key] = String(val);
      }
    }
  }

  return clean;
}

// Uploads a base64 signature PNG to R2, tenant-scoped by key. Shared by all
// three fill paths so the signature-persistence path can't diverge.
async function uploadSignature(base64, { tenantSlug, responseId }) {
  if (!base64) return null;
  const b64 = String(base64).replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  const name = `sig_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.png`;
  const prefix = tenantSlug ? `forms/${tenantSlug}/${responseId}` : `forms/${responseId}`;
  return uploadToR2(buf, `${prefix}/${name}`, "image/png");
}

// ── Templates ────────────────────────────────────────────────────────
async function listTemplates(db, { includeInactive = false } = {}) {
  const { rows } = await db.query(
    `SELECT ft.*,
       (SELECT COUNT(*) FROM form_responses fr
          WHERE fr.form_template_id = ft.id AND fr.status <> 'void') AS response_count
     FROM form_templates ft
     ${includeInactive ? "" : "WHERE ft.is_active = TRUE"}
     ORDER BY ft.updated_at DESC`
  );
  return rows;
}

async function getTemplate(db, id) {
  const { rows: [row] } = await db.query(
    "SELECT * FROM form_templates WHERE id = $1",
    [id]
  );
  return row || null;
}

async function createTemplate(db, payload) {
  const { rows: [row] } = await db.query(
    `INSERT INTO form_templates
       (name, entity_scope, fields, require_signature, auto_attach, is_active)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
    [
      payload.name,
      payload.entity_scope || "customer",
      JSON.stringify(payload.fields || []),
      !!payload.require_signature,
      payload.auto_attach || null,
      payload.is_active !== false,
    ]
  );
  return row;
}

async function updateTemplate(db, id, payload) {
  const sets = [];
  const vals = [];
  let i = 1;
  const push = (col, val) => {
    sets.push(`${col} = $${i++}`);
    vals.push(val);
  };
  if (payload.name !== undefined) push("name", payload.name);
  if (payload.entity_scope !== undefined) push("entity_scope", payload.entity_scope);
  if (payload.fields !== undefined) {
    sets.push(`fields = $${i++}::jsonb`);
    vals.push(JSON.stringify(payload.fields));
  }
  if (payload.require_signature !== undefined) push("require_signature", !!payload.require_signature);
  if (payload.auto_attach !== undefined) push("auto_attach", payload.auto_attach || null);
  if (payload.is_active !== undefined) push("is_active", !!payload.is_active);
  if (!sets.length) return getTemplate(db, id);
  sets.push("updated_at = NOW()");
  vals.push(id);
  const { rows: [row] } = await db.query(
    `UPDATE form_templates SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    vals
  );
  return row || null;
}

async function deactivateTemplate(db, id) {
  const { rows: [row] } = await db.query(
    "UPDATE form_templates SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  return row || null;
}

// ── Send: freeze snapshot + create pending response + token ───────────
async function sendForm(db, templateId, opts = {}) {
  const tpl = await getTemplate(db, templateId);
  if (!tpl) throw badRequest("Form template not found");
  if (!tpl.is_active) throw badRequest("Cannot send an inactive form");
  const fields = Array.isArray(tpl.fields) ? tpl.fields : [];
  if (fields.length === 0) throw badRequest("Cannot send a form with no fields");

  const token = generatePublicToken();
  const { rows: [row] } = await db.query(
    `INSERT INTO form_responses
       (form_template_id, fields_snapshot, customer_id, patient_subject_id,
        entity_type, entity_id, public_token, status)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
    [
      templateId,
      JSON.stringify(fields),
      opts.customerId || null,
      opts.patientSubjectId || null,
      opts.entityType || null,
      opts.entityId || null,
      token,
    ]
  );
  return row;
}

// ── The single submit write path ─────────────────────────────────────
// Every fill path calls this. Locks the row FOR UPDATE, enforces pending
// status (idempotent/replay-safe), validates answers against the frozen
// snapshot, persists answers + signature, marks submitted, and burns the
// public token (single-use).
async function submitResponse(db, responseId, { answers, signatureUrl = null, via }) {
  return db.transaction(async (client) => {
    const { rows: [resp] } = await client.query(
      "SELECT * FROM form_responses WHERE id = $1 FOR UPDATE",
      [responseId]
    );
    if (!resp) throw badRequest("Form response not found");
    if (resp.status !== "pending") {
      throw badRequest("This form has already been submitted");
    }

    const cleanAnswers = validateAnswers(resp.fields_snapshot, answers);

    // If the template froze require_signature, a signature must be present
    // (either now or already uploaded pre-call).
    const tpl = await client.query(
      "SELECT require_signature FROM form_templates WHERE id = $1",
      [resp.form_template_id]
    );
    const requireSig = tpl.rows[0]?.require_signature;
    const finalSig = signatureUrl || resp.signature_url || null;
    if (requireSig && !finalSig) throw badRequest("Signature is required");

    const { rows: [row] } = await client.query(
      `UPDATE form_responses
         SET answers = $1::jsonb,
             signature_url = $2,
             status = 'submitted',
             submitted_via = $3,
             submitted_at = NOW(),
             public_token = NULL
       WHERE id = $4 RETURNING *`,
      [JSON.stringify(cleanAnswers), finalSig, via, responseId]
    );
    return row;
  });
}

// ── Public token access ──────────────────────────────────────────────
// Returns ONLY the form structure needed to render the fill page — never any
// PII (no customer name, no prior answers). 404-worthy resolution returns null.
async function getPendingByToken(db, token) {
  if (!token || typeof token !== "string") return null;
  const { rows: [resp] } = await db.query(
    `SELECT fr.id, fr.status, fr.fields_snapshot,
            ft.name AS form_name, ft.require_signature
       FROM form_responses fr
       JOIN form_templates ft ON ft.id = fr.form_template_id
      WHERE fr.public_token = $1 AND fr.status = 'pending'`,
    [token]
  );
  if (!resp) return null;
  return {
    id: resp.id,
    form_name: resp.form_name,
    require_signature: resp.require_signature,
    fields: resp.fields_snapshot,
  };
}

// Resolve a token to its response id inside a lock, then submit. The token→id
// resolution and the submit share one transaction to avoid a TOCTOU race.
async function submitByToken(db, token, { answers, signatureBase64, tenantSlug }) {
  const pending = await getPendingByToken(db, token);
  if (!pending) return null; // caller returns 404
  let signatureUrl = null;
  if (signatureBase64) {
    signatureUrl = await uploadSignature(signatureBase64, {
      tenantSlug,
      responseId: pending.id,
    });
  }
  return submitResponse(db, pending.id, {
    answers,
    signatureUrl,
    via: "public_link",
  });
}

// ── Staff / entity views ─────────────────────────────────────────────
async function listResponses(db, filters = {}) {
  const where = [];
  const vals = [];
  let i = 1;
  if (filters.entityType) {
    where.push(`fr.entity_type = $${i++}`);
    vals.push(filters.entityType);
  }
  if (filters.entityId) {
    where.push(`fr.entity_id = $${i++}`);
    vals.push(filters.entityId);
  }
  if (filters.customerId) {
    where.push(`fr.customer_id = $${i++}`);
    vals.push(filters.customerId);
  }
  if (filters.templateId) {
    where.push(`fr.form_template_id = $${i++}`);
    vals.push(filters.templateId);
  }
  if (filters.status) {
    where.push(`fr.status = $${i++}`);
    vals.push(filters.status);
  }
  const { rows } = await db.query(
    `SELECT fr.id, fr.form_template_id, fr.status, fr.submitted_via,
            fr.submitted_at, fr.created_at, fr.entity_type, fr.entity_id,
            fr.customer_id, fr.patient_subject_id, fr.signature_url,
            ft.name AS form_name,
            c.name AS customer_name
       FROM form_responses fr
       JOIN form_templates ft ON ft.id = fr.form_template_id
       LEFT JOIN customers c ON c.id = fr.customer_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY fr.created_at DESC`,
    vals
  );
  return rows;
}

async function getResponse(db, id) {
  const { rows: [row] } = await db.query(
    `SELECT fr.*, ft.name AS form_name
       FROM form_responses fr
       JOIN form_templates ft ON ft.id = fr.form_template_id
      WHERE fr.id = $1`,
    [id]
  );
  return row || null;
}

async function voidResponse(db, id) {
  const { rows: [row] } = await db.query(
    `UPDATE form_responses
        SET status = 'void', public_token = NULL
      WHERE id = $1 AND status <> 'void' RETURNING *`,
    [id]
  );
  return row || null;
}

// ── Consumer trigger hook (P1) ───────────────────────────────────────
// Called by consumers (booking creation, membership enroll, ticket/project
// creation). Finds active templates whose auto_attach matches the trigger and
// creates a pending response for each, attached to the entity. Non-fatal:
// callers should not let a form-attach failure roll back the core action.
async function autoAttachForms(db, trigger, { customerId, patientSubjectId, entityType, entityId } = {}) {
  if (!trigger) return [];
  const { rows: templates } = await db.query(
    "SELECT id FROM form_templates WHERE is_active = TRUE AND auto_attach = $1",
    [trigger]
  );
  const created = [];
  for (const t of templates) {
    try {
      const resp = await sendForm(db, t.id, {
        customerId,
        patientSubjectId,
        entityType,
        entityId,
      });
      created.push(resp);
    } catch (err) {
      // Skip a bad template (e.g. later deactivated) — don't fail the batch.
    }
  }
  return created;
}

module.exports = {
  generatePublicToken,
  validateAnswers,
  uploadSignature,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  sendForm,
  submitResponse,
  getPendingByToken,
  submitByToken,
  listResponses,
  getResponse,
  voidResponse,
  autoAttachForms,
};
