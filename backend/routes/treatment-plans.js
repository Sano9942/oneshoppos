"use strict";

const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

module.exports = function registerTreatmentPlanRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createPatientSubjectSchema,
    updatePatientSubjectSchema,
    createPlanSchema,
    updatePlanSchema,
    planStatusTransitionSchema,
    planNoteSchema,
    createSessionSchema,
    updateSessionSchema,
    completeSessionSchema,
    addChartEntrySchema,
    updateChartEntrySchema,
    createLabOrderSchema,
    updateLabOrderSchema,
    recordLabResultSchema,
    signConsentSchema,
    uploadClinicalDocumentSchema,
    createPrescriptionSchema,
    addFolioLineSchema,
    attachSaleToFolioSchema,
    settleFolioSchema,
  } = require("../schemas/treatment-plans");
  const tp = require("../services/treatment-plan-service");
  const deposits = require("../services/treatment-plan-deposits");
  const { uploadToR2 } = require("../utils/r2");
  const {
    clinicalDocFileFilter,
    verifyImageMagicBytes,
  } = require("../middleware/upload-validation");

  const gate = [requireMode("treatment_plans"), requireFeature("phase4_treatment_plans"), requirePerm("manage_treatment_plans")];

  // Multer for clinical document uploads — 50MB limit per the plan.
  // M72: clinicalDocFileFilter restricts uploads to raster images, PDFs,
  // and plain text. Rejects SVG (same-origin XSS — P31) and any other
  // executable/scriptable type. Magic-byte verification post-upload (P32)
  // runs in the route handler.
  const docUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: clinicalDocFileFilter,
  });

  // ── Patient subjects ───────────────────────────────────────────────

  app.get("/api/patient-subjects", ...gate, async (req, res) => {
    try {
      const rows = await tp.listPatientSubjects(deps.db, req.query);
      res.json({ subjects: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/patient-subjects", ...gate, validate(createPatientSubjectSchema), async (req, res) => {
    try {
      const row = await tp.createPatientSubject(deps.db, req.body);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/patient-subjects/:id", ...gate, validate(updatePatientSubjectSchema), async (req, res) => {
    try {
      const row = await tp.updatePatientSubject(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Subject not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/patient-subjects/:id", ...gate, async (req, res) => {
    try {
      const row = await tp.deletePatientSubject(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Subject not found" });
      res.json({ ok: true, subject: row });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Plans ──────────────────────────────────────────────────────────

  app.get("/api/treatment-plans", ...gate, async (req, res) => {
    try {
      const rows = await tp.listPlans(deps.db, req.query);
      res.json({ plans: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/treatment-plans/:id", ...gate, async (req, res) => {
    try {
      const plan = await tp.getPlan(deps.db, Number(req.params.id));
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      res.json(plan);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans", ...gate, validate(createPlanSchema), async (req, res) => {
    try {
      const plan = await tp.createPlan(deps.db, req.body, req.employee?.id);
      res.status(201).json(plan);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/treatment-plans/:id", ...gate, validate(updatePlanSchema), async (req, res) => {
    try {
      const row = await tp.updatePlan(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Plan not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/activate", ...gate, validate(planStatusTransitionSchema), async (req, res) => {
    try {
      const row = await tp.transitionPlanStatus(deps.db, Number(req.params.id), "active", req.employee?.id, req.body?.reason);
      if (!row) return res.status(404).json({ error: "Plan not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/hold", ...gate, validate(planStatusTransitionSchema), async (req, res) => {
    try {
      const row = await tp.transitionPlanStatus(deps.db, Number(req.params.id), "on_hold", req.employee?.id, req.body?.reason);
      if (!row) return res.status(404).json({ error: "Plan not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/resume", ...gate, validate(planStatusTransitionSchema), async (req, res) => {
    try {
      const row = await tp.transitionPlanStatus(deps.db, Number(req.params.id), "active", req.employee?.id, req.body?.reason);
      if (!row) return res.status(404).json({ error: "Plan not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/complete", ...gate, validate(planStatusTransitionSchema), async (req, res) => {
    try {
      const row = await tp.transitionPlanStatus(deps.db, Number(req.params.id), "completed", req.employee?.id, req.body?.reason);
      if (!row) return res.status(404).json({ error: "Plan not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/discontinue", ...gate, validate(planStatusTransitionSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = await tp.transitionPlanStatus(deps.db, id, "discontinued", req.employee?.id, req.body?.reason);
      if (!row) return res.status(404).json({ error: "Plan not found" });
      // F04: a discontinued plan must not keep the patient's deposit frozen —
      // release any authorized hold (no-op if none). Non-fatal.
      try { await deposits.captureDepositOnSettle(deps.db, id, { capture: false }); }
      catch (depErr) { console.warn("[treatment/discontinue] deposit release failed:", depErr.message); }
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/notes", ...gate, validate(planNoteSchema), async (req, res) => {
    try {
      await tp.addPlanNote(deps.db, Number(req.params.id), req.employee?.id, req.body.description);
      res.status(201).json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Sessions ───────────────────────────────────────────────────────

  app.get("/api/treatment-plans/:id/sessions", ...gate, async (req, res) => {
    try {
      const rows = await tp.listSessions(deps.db, Number(req.params.id));
      res.json({ sessions: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/sessions", ...gate, validate(createSessionSchema), async (req, res) => {
    try {
      const row = await tp.createSession(deps.db, Number(req.params.id), req.body, req.employee?.id);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/treatment-sessions/:id", ...gate, validate(updateSessionSchema), async (req, res) => {
    try {
      const row = await tp.updateSession(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Session not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-sessions/:id/start", ...gate, async (req, res) => {
    try {
      const row = await tp.startSession(deps.db, Number(req.params.id));
      if (!row) return res.status(400).json({ error: "Session not found or not in scheduled state" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-sessions/:id/complete", ...gate, validate(completeSessionSchema), async (req, res) => {
    try {
      const row = await tp.completeSession(deps.db, Number(req.params.id), req.body, req.employee?.id);
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-sessions/:id/no-show", ...gate, async (req, res) => {
    try {
      const row = await tp.markSessionNoShow(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Session not found" });
      res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-sessions/:id/cancel", ...gate, async (req, res) => {
    try {
      const row = await tp.cancelSession(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Session not found" });
      res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Charting ───────────────────────────────────────────────────────

  app.get("/api/chart-areas", ...gate, async (req, res) => {
    try {
      const preset = req.query.preset;
      if (!preset) return res.status(400).json({ error: "preset query param required" });
      const rows = await tp.listChartAreas(deps.db, String(preset));
      res.json({ areas: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/treatment-plans/:id/chart", ...gate, async (req, res) => {
    try {
      const rows = await tp.getPlanChart(deps.db, Number(req.params.id));
      res.json({ entries: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-sessions/:id/chart-entries", ...gate, validate(addChartEntrySchema), async (req, res) => {
    try {
      const row = await tp.addChartEntry(deps.db, Number(req.params.id), req.body);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/session-chart-entries/:id", ...gate, validate(updateChartEntrySchema), async (req, res) => {
    try {
      const row = await tp.updateChartEntry(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Chart entry not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/session-chart-entries/:id", ...gate, async (req, res) => {
    try {
      const row = await tp.deleteChartEntry(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Chart entry not found" });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Lab orders ─────────────────────────────────────────────────────

  app.get("/api/treatment-plans/:id/lab-orders", ...gate, async (req, res) => {
    try {
      const rows = await tp.listLabOrders(deps.db, Number(req.params.id));
      res.json({ lab_orders: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/lab-orders", ...gate, validate(createLabOrderSchema), async (req, res) => {
    try {
      const row = await tp.createLabOrder(deps.db, Number(req.params.id), req.body, req.employee?.id);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/lab-orders/:id", ...gate, validate(updateLabOrderSchema), async (req, res) => {
    try {
      const row = await tp.updateLabOrder(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Lab order not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/lab-orders/:id/result", ...gate, validate(recordLabResultSchema), async (req, res) => {
    try {
      const row = await tp.recordLabResult(deps.db, Number(req.params.id), req.body);
      if (!row) return res.status(404).json({ error: "Lab order not found" });
      res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Consent ────────────────────────────────────────────────────────

  app.get("/api/consent-templates", ...gate, async (req, res) => {
    try {
      const keys = tp.listConsentTemplateKeys();
      const templates = keys.map((key) => ({ key, ...tp.getConsentTemplate(key) }));
      res.json({ templates });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/treatment-plans/:id/consents", ...gate, async (req, res) => {
    try {
      const rows = await tp.listConsents(deps.db, Number(req.params.id));
      res.json({ consents: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/consents", ...gate, validate(signConsentSchema), async (req, res) => {
    try {
      let signatureUrl = null;
      if (req.body.signature_image_base64) {
        const b64 = req.body.signature_image_base64.replace(/^data:image\/\w+;base64,/, "");
        const buf = Buffer.from(b64, "base64");
        const name = `consent_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.png`;
        const key = `consents/${req.params.id}/${name}`;
        signatureUrl = await uploadToR2(buf, key, "image/png");
      }
      const payload = {
        ...req.body,
        ip_address: req.ip || req.headers["x-forwarded-for"] || null,
      };
      const row = await tp.signConsent(deps.db, Number(req.params.id), payload, req.employee?.id, signatureUrl);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Clinical documents ─────────────────────────────────────────────

  app.get("/api/treatment-plans/:id/documents", ...gate, async (req, res) => {
    try {
      const rows = await tp.listClinicalDocuments(deps.db, Number(req.params.id));
      res.json({ documents: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-plans/:id/documents", ...gate, docUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });
      if (!verifyImageMagicBytes(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "File contents do not match the declared type" });
      }
      const parsed = uploadClinicalDocumentSchema.safeParse({
        document_type: req.body.document_type,
        title: req.body.title,
        session_id: req.body.session_id ? Number(req.body.session_id) : null,
        notes: req.body.notes || null,
        shared_with_patient: req.body.shared_with_patient === "true" || req.body.shared_with_patient === true,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.errors });
      }
      const ext = path.extname(req.file.originalname || "").toLowerCase() || ".bin";
      const filename = `doc_${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
      const key = `clinical/${req.params.id}/${filename}`;
      const fileUrl = await uploadToR2(req.file.buffer, key, req.file.mimetype);

      const row = await tp.uploadClinicalDocument(
        deps.db,
        Number(req.params.id),
        {
          ...parsed.data,
          file_url: fileUrl,
          file_mime: req.file.mimetype,
          file_size_bytes: req.file.size,
        },
        req.employee?.id
      );
      res.status(201).json(row);
    } catch (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large — max 50MB" });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete("/api/clinical-documents/:id", ...gate, async (req, res) => {
    try {
      const row = await tp.deleteClinicalDocument(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Document not found" });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Prescriptions ──────────────────────────────────────────────────

  app.get("/api/treatment-plans/:id/prescriptions", ...gate, async (req, res) => {
    try {
      const rows = await tp.listPrescriptions(deps.db, Number(req.params.id));
      res.json({ prescriptions: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-sessions/:id/prescriptions", ...gate, validate(createPrescriptionSchema), async (req, res) => {
    try {
      const row = await tp.createPrescription(deps.db, Number(req.params.id), req.body, req.employee?.id);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Folio ──────────────────────────────────────────────────────────

  app.get("/api/treatment-folios/:id", ...gate, async (req, res) => {
    try {
      const row = await tp.getFolio(deps.db, Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Folio not found" });
      res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/treatment-folios/:id/lines", ...gate, validate(addFolioLineSchema), async (req, res) => {
    try {
      const row = await tp.addFolioLine(deps.db, Number(req.params.id), req.body, req.employee?.id);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-folios/:id/attach-sale", ...gate, validate(attachSaleToFolioSchema), async (req, res) => {
    try {
      const row = await tp.attachSaleToFolio(deps.db, Number(req.body.sale_id), Number(req.params.id), req.employee?.id);
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/treatment-folios/:id/settle", ...gate, validate(settleFolioSchema), async (req, res) => {
    try {
      const result = await tp.settleFolio(deps.db, Number(req.params.id), req.employee?.id, req.body || {});
      // After settle, capture/release deposit if authorized
      try {
        const { rows: [folio] } = await deps.db.query("SELECT plan_id FROM treatment_folios WHERE id = $1", [Number(req.params.id)]);
        if (folio) {
          await deposits.captureDepositOnSettle(deps.db, folio.plan_id, { capture: true });
        }
      } catch (depErr) {
        // Non-fatal
      }
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Deposit pre-auth ───────────────────────────────────────────────

  app.post("/api/treatment-plans/:id/deposit/preauth", ...gate, async (req, res) => {
    try {
      const result = await deposits.createDepositPreAuth(deps.db, {
        planId: Number(req.params.id),
        amount: req.body?.amount,
        returnUrl: req.body?.return_url,
        cancelUrl: req.body?.cancel_url,
      });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
