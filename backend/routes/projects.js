module.exports = function registerProjectRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createProjectSchema, updateProjectSchema, createMilestoneSchema, updateMilestoneSchema } = require("../schemas/projects");
  const projects = require("../services/projects");
  const billing = require("../services/project-billing");

  const gate = [requireMode("service_projects"), requireFeature("phase4_service_projects"), requirePerm("manage_projects")];

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
};
