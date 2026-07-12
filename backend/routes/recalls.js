"use strict";

/**
 * V05 — Recall / continuing-care + vet vaccinations.
 *
 * The overdue-patients screen (the "Dentrix list"): filter by type/age/status,
 * one-click contact (fires F05 outreach immediately), mark booked (links an
 * appointment), dismiss. Booking from a recall completes it on visit
 * completion and re-arms the interval (hook in treatment-plan-service).
 *
 * Gates: treatment_plans mode + clinical_recalls flag; vaccination endpoints
 * additionally require vet_vaccinations. Reads allow view_customer_reports so front
 * desk staff can work the list; writes need manage_treatment_plans.
 */

module.exports = function registerRecallRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm, requireAnyPerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createRecallSchema,
    bookRecallSchema,
    dismissRecallSchema,
    administerVaccinationSchema,
  } = require("../schemas/recalls");
  const recalls = require("../services/recall-service");
  const customerNotify = require("../services/customer-notify");

  const readGate = [
    requireMode("treatment_plans"),
    requireFeature("clinical_recalls"),
    requireAnyPerm(["manage_treatment_plans", "view_customer_reports"]),
  ];
  const writeGate = [
    requireMode("treatment_plans"),
    requireFeature("clinical_recalls"),
    requirePerm("manage_treatment_plans"),
  ];
  const vaxReadGate = [
    requireMode("treatment_plans"),
    requireFeature("vet_vaccinations"),
    requireAnyPerm(["manage_treatment_plans", "view_customer_reports"]),
  ];
  const vaxWriteGate = [
    requireMode("treatment_plans"),
    requireFeature("vet_vaccinations"),
    requirePerm("manage_treatment_plans"),
  ];

  function bookingUrl(req) {
    const base = process.env.FRONTEND_URL || "";
    return req.tenantSlug ? `${base}/book/${req.tenantSlug}` : `${base}/book`;
  }

  // Fire one recall's outreach through F05 (same event routing as the worker).
  async function sendRecallOutreach(req, recall) {
    const company = req.company || {};
    const event = recalls.isVaccinationType(recall.recall_type)
      ? "recall.vaccination_due"
      : "recall.due";
    return customerNotify.notify(deps.db, {
      event,
      customerId: recall.customer_id,
      entityType: "recall",
      entityId: recall.id,
      tenantSlug: req.tenantSlug,
      tenant: { slug: req.tenantSlug, name: company.company_name },
      data: {
        storeName: company.trading_name || company.company_name || "our clinic",
        storePhone: company.phone || "",
        subjectName: recall.subject_name || recall.customer_name,
        recallType: recall.recall_type,
        recallLabel: recalls.humanizeRecall(recall),
        dueDate: recall.due_date,
        bookingUrl: bookingUrl(req),
      },
    });
  }

  // ── Overdue-patients screen ────────────────────────────────────────

  app.get("/api/recalls", ...readGate, async (req, res) => {
    try {
      const rows = await recalls.listRecalls(deps.db, {
        status: req.query.status,
        recall_type: req.query.type,
        overdue: req.query.overdue === "1",
        open: req.query.open === "1",
        q: req.query.q,
        limit: req.query.limit,
      });
      res.json({ recalls: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/recalls", ...writeGate, validate(createRecallSchema), async (req, res) => {
    try {
      const row = await recalls.armRecall(deps.db, {
        customerId: req.body.customer_id,
        subjectId: req.body.patient_subject_id || null,
        recallType: req.body.recall_type || "checkup",
        intervalMonths: req.body.interval_months || null,
        dueDate: req.body.due_date || null,
        notes: req.body.notes || null,
      });
      if (!row) return res.status(400).json({ error: "due_date or interval_months required" });
      res.status(201).json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // One-click contact: dispatch outreach NOW + stamp the attempt.
  app.put("/api/recalls/:id/contact", ...writeGate, async (req, res) => {
    try {
      const recall = await recalls.getRecall(deps.db, Number(req.params.id));
      if (!recall) return res.status(404).json({ error: "Recall not found" });
      if (!["due", "contacted"].includes(recall.status)) {
        return res.status(400).json({ error: `Recall is ${recall.status}` });
      }
      // Dispatch failure must not block the front desk from stamping the
      // attempt (e.g. single-tenant mode has no tenantSlug for email routing).
      let result = null;
      try {
        result = await sendRecallOutreach(req, recall);
      } catch (err) {
        try { req.log?.warn({ err: err.message, recallId: recall.id }, "recall contact dispatch failed"); } catch {}
        result = { dispatched: [], reason: "dispatch_failed", error: err.message };
      }
      const row = await recalls.markContacted(deps.db, recall.id);
      res.json({ recall: row, dispatched: result?.dispatched || [], reason: result?.reason });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/recalls/:id/dismiss", ...writeGate, validate(dismissRecallSchema), async (req, res) => {
    try {
      const row = await recalls.dismissRecall(deps.db, Number(req.params.id), req.body.notes);
      if (!row) return res.status(404).json({ error: "Recall not found or already closed" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/recalls/:id/book", ...writeGate, validate(bookRecallSchema), async (req, res) => {
    try {
      const row = await recalls.bookRecall(deps.db, Number(req.params.id), {
        appointmentId: req.body.appointment_id || null,
        scheduledAt: req.body.scheduled_at || null,
        employeeId: req.body.employee_id || req.employee?.id || null,
      });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/recalls/:id/complete", ...writeGate, async (req, res) => {
    try {
      const result = await recalls.completeRecall(deps.db, Number(req.params.id));
      if (!result) return res.status(404).json({ error: "Recall not found or already closed" });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Vaccinations (vet) ─────────────────────────────────────────────

  app.post("/api/vaccinations", ...vaxWriteGate, validate(administerVaccinationSchema), async (req, res) => {
    try {
      const result = await recalls.administerVaccination(deps.db, {
        subjectId: req.body.patient_subject_id,
        vaccineName: req.body.vaccine_name,
        administeredAt: req.body.administered_at || null,
        sessionId: req.body.treatment_session_id || null,
        administeredBy: req.employee?.id || null,
        nextDue: req.body.next_due || null,
        batchNumber: req.body.batch_number || null,
        notes: req.body.notes || null,
      });
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.get("/api/patient-subjects/:id/vaccination-card", ...vaxReadGate, async (req, res) => {
    try {
      const card = await recalls.getVaccinationCard(deps.db, Number(req.params.id));
      if (!card) return res.status(404).json({ error: "Patient subject not found" });
      res.json(card);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
