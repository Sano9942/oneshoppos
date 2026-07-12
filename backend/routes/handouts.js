"use strict";

/**
 * V05 — Physio home-exercise / handout library.
 *
 * A reusable document library (uploaded PDFs/images via clinicalDocFileFilter,
 * title + tags) plus attach-to-patient delivery: assigning a handout to a
 * customer (optionally scoped to a subject/plan/session) makes it visible in
 * the customer portal and fires an F05 `handout.shared` email with the portal
 * link. Deliberately NOT an exercise builder — a library with delivery.
 *
 * Gates: treatment_plans mode + clinical_handouts flag (physio preset default;
 * toggleable for other clinical presets).
 */

const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

module.exports = function registerHandoutRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm, requireAnyPerm } = require("../middleware/permissions");
  const { uploadToR2 } = require("../utils/r2");
  const {
    clinicalDocFileFilter,
    verifyImageMagicBytes,
  } = require("../middleware/upload-validation");
  const customerNotify = require("../services/customer-notify");

  const readGate = [
    requireMode("treatment_plans"),
    requireFeature("clinical_handouts"),
    requireAnyPerm(["manage_treatment_plans", "view_customer_reports"]),
  ];
  const writeGate = [
    requireMode("treatment_plans"),
    requireFeature("clinical_handouts"),
    requirePerm("manage_treatment_plans"),
  ];

  const handoutUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: clinicalDocFileFilter,
  });

  // ── Library ────────────────────────────────────────────────────────

  app.get("/api/handouts", ...readGate, async (req, res) => {
    try {
      const params = [];
      let where = "is_active = TRUE";
      if (req.query.all === "1") where = "1=1";
      if (req.query.q) {
        params.push(`%${req.query.q}%`);
        where += ` AND (title ILIKE $${params.length} OR EXISTS (
          SELECT 1 FROM unnest(tags) t WHERE t ILIKE $${params.length}))`;
      }
      const { rows } = await deps.db.query(
        `SELECT h.*, e.name AS uploaded_by_name,
                (SELECT COUNT(*)::int FROM handout_assignments ha WHERE ha.handout_id = h.id) AS assignment_count
           FROM handouts h
           LEFT JOIN employees e ON e.id = h.uploaded_by
          WHERE ${where}
          ORDER BY h.created_at DESC`,
        params
      );
      res.json({ handouts: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/handouts", ...writeGate, handoutUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });
      if (!verifyImageMagicBytes(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ error: "File contents do not match the declared type" });
      }
      const title = String(req.body.title || "").trim();
      if (!title) return res.status(400).json({ error: "title required" });
      const tags = String(req.body.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);

      const ext = path.extname(req.file.originalname || "").toLowerCase() || ".bin";
      const filename = `handout_${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
      const fileUrl = await uploadToR2(req.file.buffer, `handouts/${filename}`, req.file.mimetype);

      const { rows: [row] } = await deps.db.query(
        `INSERT INTO handouts (title, tags, file_url, file_mime, file_size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [title, tags, fileUrl, req.file.mimetype, req.file.size, req.employee?.id || null]
      );
      res.status(201).json(row);
    } catch (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large — max 25MB" });
      }
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete("/api/handouts/:id", ...writeGate, async (req, res) => {
    try {
      const { rows: [row] } = await deps.db.query(
        "UPDATE handouts SET is_active = FALSE WHERE id = $1 RETURNING *",
        [Number(req.params.id)]
      );
      if (!row) return res.status(404).json({ error: "Handout not found" });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Delivery ───────────────────────────────────────────────────────

  app.post("/api/handouts/:id/assign", ...writeGate, async (req, res) => {
    try {
      const handoutId = Number(req.params.id);
      const customerId = Number(req.body.customer_id);
      if (!customerId) return res.status(400).json({ error: "customer_id required" });

      const { rows: [handout] } = await deps.db.query(
        "SELECT * FROM handouts WHERE id = $1 AND is_active = TRUE",
        [handoutId]
      );
      if (!handout) return res.status(404).json({ error: "Handout not found" });

      const { rows: [assignment] } = await deps.db.query(
        `INSERT INTO handout_assignments
           (handout_id, customer_id, patient_subject_id, plan_id, session_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          handoutId, customerId,
          req.body.patient_subject_id ? Number(req.body.patient_subject_id) : null,
          req.body.plan_id ? Number(req.body.plan_id) : null,
          req.body.session_id ? Number(req.body.session_id) : null,
          req.employee?.id || null,
        ]
      );

      // F05 delivery — fire-and-forget; the portal copy is already live.
      const company = req.company || {};
      const portalUrl = req.tenantSlug
        ? `${process.env.FRONTEND_URL || ""}/portal/${req.tenantSlug}`
        : null;
      customerNotify.notify(deps.db, {
        event: "handout.shared",
        customerId,
        entityType: "handout",
        entityId: assignment.id,
        tenantSlug: req.tenantSlug,
        tenant: { slug: req.tenantSlug, name: company.company_name },
        data: {
          storeName: company.trading_name || company.company_name || "your clinic",
          handoutTitle: handout.title,
          portalUrl,
        },
      }).catch((err) => {
        try { req.log?.warn({ err: err.message, handoutId }, "handout notification failed"); } catch {}
      });

      res.status(201).json(assignment);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Assignments for a customer or plan (chart view).
  app.get("/api/handout-assignments", ...readGate, async (req, res) => {
    try {
      const params = [];
      const where = [];
      if (req.query.customer_id) {
        params.push(Number(req.query.customer_id));
        where.push(`ha.customer_id = $${params.length}`);
      }
      if (req.query.plan_id) {
        params.push(Number(req.query.plan_id));
        where.push(`ha.plan_id = $${params.length}`);
      }
      if (!where.length) return res.status(400).json({ error: "customer_id or plan_id required" });
      const { rows } = await deps.db.query(
        `SELECT ha.*, h.title, h.file_url, h.file_mime, h.tags,
                ps.name AS subject_name, e.name AS assigned_by_name
           FROM handout_assignments ha
           JOIN handouts h ON h.id = ha.handout_id
           LEFT JOIN patient_subjects ps ON ps.id = ha.patient_subject_id
           LEFT JOIN employees e ON e.id = ha.assigned_by
          WHERE ${where.join(" AND ")}
          ORDER BY ha.created_at DESC`,
        params
      );
      res.json({ assignments: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
