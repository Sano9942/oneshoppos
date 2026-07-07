/**
 * Customer portal "Treatments" endpoints (M10).
 *
 * Read-only — lists a patient's treatment plans (their own + their subjects')
 * with per-plan detail including sessions, prescriptions, chart, consent, and
 * lab results / documents flagged `shared_with_patient=true`.
 *
 * Privacy: SOAP fields are whitelisted — subjective only. Objective, assessment,
 * and plan fields are provider-facing and not exposed here.
 */

const express = require("express");
const { loadCustomerAuth } = require("../../middleware/customer-auth");

module.exports = function registerCustomerPortalTreatments(app, deps) {
  const router = express.Router();
  const authMw = loadCustomerAuth(deps);

  // List plans owned by the authenticated customer (or their subjects)
  router.get("/me/treatment-plans", authMw, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT p.id, p.plan_number, p.title, p.status, p.start_date, p.expected_end_date,
                p.sessions_completed, p.total_sessions_planned, p.final_invoice_id,
                p.subject_id,
                ps.name AS subject_name, ps.subject_type,
                e.name AS provider_name,
                ci.invoice_number, ci.balance_due
         FROM treatment_plans p
         LEFT JOIN patient_subjects ps ON ps.id = p.subject_id
         LEFT JOIN employees e ON e.id = p.provider_id
         LEFT JOIN customer_invoices ci ON ci.id = p.final_invoice_id
         WHERE p.customer_id = $1
         ORDER BY p.created_at DESC`,
        [req.customerId]
      );
      res.json({ plans: rows });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        return res.json({ plans: [] });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Full detail with whitelisted fields
  router.get("/me/treatment-plans/:id", authMw, async (req, res) => {
    try {
      const planId = Number(req.params.id);
      const { rows: [plan] } = await req.db.query(
        `SELECT p.id, p.plan_number, p.title, p.status,
                p.start_date, p.expected_end_date, p.actual_end_date,
                p.sessions_completed, p.total_sessions_planned, p.final_invoice_id,
                p.diagnosis_code, p.subject_id,
                ps.name AS subject_name, ps.subject_type,
                e.name AS provider_name
         FROM treatment_plans p
         LEFT JOIN patient_subjects ps ON ps.id = p.subject_id
         LEFT JOIN employees e ON e.id = p.provider_id
         WHERE p.id = $1 AND p.customer_id = $2`,
        [planId, req.customerId]
      );
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      // Sessions — SOAP subjective only (provider-facing fields withheld)
      const { rows: sessions } = await req.db.query(
        `SELECT s.id, s.session_number, s.scheduled_at, s.actual_start_at, s.actual_end_at,
                s.status, s.soap_subjective,
                e.name AS provider_name
         FROM treatment_sessions s
         LEFT JOIN employees e ON e.id = s.provider_id
         WHERE s.plan_id = $1
         ORDER BY s.session_number ASC`,
        [planId]
      );

      // Prescriptions — patient-visible
      const { rows: prescriptions } = await req.db.query(
        `SELECT id, medication_name, strength, dosage, frequency, duration,
                instructions, refills_remaining, prescribed_at
         FROM prescriptions
         WHERE plan_id = $1
         ORDER BY prescribed_at DESC`,
        [planId]
      );

      // Chart entries — always visible (patient's own record)
      const { rows: chartEntries } = await req.db.query(
        `SELECT DISTINCT ON (ce.area_code)
                ce.area_code, ce.condition_code, ce.severity, ce.notes, ce.created_at
         FROM session_chart_entries ce
         JOIN treatment_sessions s ON s.id = ce.session_id
         WHERE s.plan_id = $1
         ORDER BY ce.area_code, ce.created_at DESC`,
        [planId]
      );

      // Consent — always visible (patient signed it)
      const { rows: consents } = await req.db.query(
        `SELECT id, title, body_markdown, signed_by_name, signed_by_relation,
                signed_at, document_pdf_url
         FROM consent_forms
         WHERE plan_id = $1
         ORDER BY signed_at DESC`,
        [planId]
      );

      // Lab orders — ONLY shared_with_patient=true
      const { rows: labOrders } = await req.db.query(
        `SELECT id, order_number, test_name, lab_vendor, status,
                ordered_at, result_received_at, result_summary
         FROM lab_orders
         WHERE plan_id = $1 AND shared_with_patient = TRUE
         ORDER BY ordered_at DESC`,
        [planId]
      );

      // Clinical documents — ONLY shared_with_patient=true
      const { rows: documents } = await req.db.query(
        `SELECT id, title, document_type, file_url, uploaded_at
         FROM clinical_documents
         WHERE plan_id = $1 AND shared_with_patient = TRUE
         ORDER BY uploaded_at DESC`,
        [planId]
      );

      res.json({
        plan,
        sessions,
        prescriptions,
        chart_entries: chartEntries,
        consents,
        lab_orders: labOrders,
        documents,
      });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        return res.status(404).json({ error: "Plan not found" });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── V05: handouts shared with me ────────────────────────────────────
  // Subject-scope re-check: assignments are filtered by the authed
  // customer's id — a handout assigned to another owner never appears.
  router.get("/me/handouts", authMw, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT ha.id, ha.created_at, ha.plan_id,
                h.title, h.file_url, h.file_mime, h.tags,
                ps.name AS subject_name
           FROM handout_assignments ha
           JOIN handouts h ON h.id = ha.handout_id AND h.is_active = TRUE
           LEFT JOIN patient_subjects ps ON ps.id = ha.patient_subject_id
          WHERE ha.customer_id = $1
          ORDER BY ha.created_at DESC`,
        [req.customerId]
      );
      res.json({ handouts: rows });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        return res.json({ handouts: [] });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── V05: read-only vaccination card (vet) ──────────────────────────
  // The subject must belong to the authed customer — an owner can never
  // read another owner's pet card (completion-08 portal lens).
  router.get("/me/subjects/:id/vaccination-card", authMw, async (req, res) => {
    try {
      const subjectId = Number(req.params.id);
      const { rows: [subject] } = await req.db.query(
        `SELECT id, name, subject_type, species, breed, dob
           FROM patient_subjects
          WHERE id = $1 AND customer_id = $2`,
        [subjectId, req.customerId]
      );
      if (!subject) return res.status(404).json({ error: "Patient not found" });

      const { rows: records } = await req.db.query(
        `SELECT vr.id, vr.vaccine_name,
                vr.administered_at::text AS administered_at,
                vr.next_due::text AS next_due,
                vr.batch_number
           FROM vaccination_records vr
          WHERE vr.patient_subject_id = $1
          ORDER BY vr.administered_at DESC, vr.id DESC`,
        [subjectId]
      );
      res.json({ subject, records });
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) {
        return res.status(404).json({ error: "Patient not found" });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.use("/api/portal", router);
};
