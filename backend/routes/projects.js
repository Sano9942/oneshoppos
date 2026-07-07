module.exports = function registerProjectRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createProjectSchema, updateProjectSchema, createMilestoneSchema, updateMilestoneSchema } = require("../schemas/projects");
  const projects = require("../services/projects");
  const billing = require("../services/project-billing");
  const { uploadToR2 } = require("../utils/r2");
  const { rasterImageFileFilter } = require("../middleware/upload-validation");
  const { multer } = deps;

  const gate = [requireMode("service_projects"), requireFeature("phase4_service_projects"), requirePerm("manage_projects")];

  // V08 gallery: staff upload proofing images. Memory storage → sharp resize →
  // R2. rasterImageFileFilter excludes SVG (served as-is to the client portal).
  const galleryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 60 },
    fileFilter: rasterImageFileFilter,
  });

  app.get("/api/projects", ...gate, async (req, res) => {
    try {
      const rows = await projects.listProjects(deps.db, req.query);
      res.json({ projects: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/projects/:id", ...gate, async (req, res) => {
    try {
      const project = await projects.getProject(deps.db, Number(req.params.id));
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/projects", ...gate, validate(createProjectSchema), async (req, res) => {
    try {
      const project = await projects.createProject(deps.db, req.body, req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "project_created", JSON.stringify({ id: project.id })]); } catch {}
      res.status(201).json(project);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/projects/:id", ...gate, validate(updateProjectSchema), async (req, res) => {
    try {
      const project = await projects.updateProject(deps.db, Number(req.params.id), req.body, req.employee.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Milestones
  app.post("/api/projects/:id/milestones", ...gate, validate(createMilestoneSchema), async (req, res) => {
    try {
      const milestone = await projects.createMilestone(deps.db, Number(req.params.id), req.body, req.employee.id);
      res.status(201).json(milestone);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/projects/:id/milestones/:milestoneId", ...gate, validate(updateMilestoneSchema), async (req, res) => {
    try {
      const milestone = await projects.updateMilestone(deps.db, Number(req.params.milestoneId), req.body, req.employee.id);
      if (!milestone) return res.status(404).json({ error: "Milestone not found" });
      res.json(milestone);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Quotation workflow
  app.post("/api/quotations/:id/approve", ...gate, async (req, res) => {
    try {
      const quotation = await projects.approveQuotation(deps.db, Number(req.params.id), req.employee.id);
      if (!quotation) return res.status(404).json({ error: "Quotation not found" });
      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "quotation_approved", JSON.stringify({ id: quotation.id })]); } catch {}
      res.json(quotation);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/quotations/:id/convert-to-project", ...gate, async (req, res) => {
    try {
      const project = await projects.convertQuotationToProject(deps.db, Number(req.params.id), req.employee.id);
      res.status(201).json(project);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Billing
  app.get("/api/projects/:id/billing", ...gate, async (req, res) => {
    try {
      const summary = await billing.getProjectBillingSummary(deps.db, Number(req.params.id));
      res.json(summary);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/customer-invoices/:id/attach-to-project", ...gate, async (req, res) => {
    try {
      const { project_id, milestone_id, invoice_kind } = req.body || {};
      if (!project_id) return res.status(400).json({ error: "project_id required" });
      const invoice = await billing.attachInvoiceToProject(deps.db, Number(req.params.id), project_id, milestone_id || null, invoice_kind || "standard");
      res.json(invoice);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── V08 gallery (staff side) ─────────────────────────────────────────
  const sharp = require("sharp");

  // Upload one or more proofing images to a project. Each is resized (proofing
  // resolution, not full-res originals) and stored on R2; the returned URL is
  // R2-direct (R2_PUBLIC_URL) so the portal grid never streams through the
  // single-threaded Express /r2 proxy.
  app.post("/api/projects/:id/files", ...gate, galleryUpload.array("files", 60), async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const { rows: [proj] } = await deps.db.query("SELECT id FROM service_projects WHERE id = $1", [projectId]);
      if (!proj) return res.status(404).json({ error: "Project not found" });
      const uploads = req.files || [];
      if (!uploads.length) return res.status(400).json({ error: "No image files provided" });

      const actorId = req.employee?.id ?? null;
      const created = [];
      for (const f of uploads) {
        const resized = await sharp(f.buffer)
          .rotate()
          .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        const filename = `proj_${projectId}_${Date.now()}_${Math.round(Math.random() * 1e6)}.webp`;
        const url = await uploadToR2(resized, `projects/${projectId}/${filename}`, "image/webp");
        const { rows: [row] } = await deps.db.query(
          `INSERT INTO project_files (project_id, file_name, file_url, file_size, mime_type, uploaded_by, client_visible)
           VALUES ($1, $2, $3, $4, 'image/webp', $5, false) RETURNING *`,
          [projectId, f.originalname || filename, url, resized.length, actorId]
        );
        created.push(row);
      }
      await projects.logActivity(deps.db, projectId, actorId, "file_upload", `${created.length} image(s) uploaded`);
      res.status(201).json({ files: created });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Toggle a file's client-visible flag (opt a shot into the portal gallery).
  app.put("/api/projects/:id/files/:fileId", ...gate, async (req, res) => {
    try {
      const projectId = Number(req.params.id);
      const fileId = Number(req.params.fileId);
      const { client_visible } = req.body || {};
      if (typeof client_visible !== "boolean") return res.status(400).json({ error: "client_visible (boolean) required" });
      const { rows: [row] } = await deps.db.query(
        "UPDATE project_files SET client_visible = $1 WHERE id = $2 AND project_id = $3 RETURNING *",
        [client_visible, fileId, projectId]
      );
      if (!row) return res.status(404).json({ error: "File not found" });
      res.json(row);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/projects/:id/files/:fileId", ...gate, async (req, res) => {
    try {
      const { rowCount } = await deps.db.query(
        "DELETE FROM project_files WHERE id = $1 AND project_id = $2",
        [Number(req.params.fileId), Number(req.params.id)]
      );
      if (!rowCount) return res.status(404).json({ error: "File not found" });
      res.json({ deleted: true });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
