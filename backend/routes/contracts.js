module.exports = function registerContractRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createContractSchema, updateContractSchema, createTemplateSchema, signContractSchema } = require("../schemas/contracts");
  const contracts = require("../services/contracts");

  const gate = [requireMode("service_projects"), requireFeature("phase4_service_contracts"), requirePerm("manage_contracts")];

  app.get("/api/contracts", ...gate, async (req, res) => {
    try {
      const { status, project_id, customer_id } = req.query;
      const params = []; let idx = 0; let where = "1=1";
      if (status) { idx++; where += ` AND c.status = $${idx}`; params.push(status); }
      if (project_id) { idx++; where += ` AND c.project_id = $${idx}`; params.push(Number(project_id)); }
      if (customer_id) { idx++; where += ` AND c.customer_id = $${idx}`; params.push(Number(customer_id)); }
      const { rows } = await deps.db.query(
        `SELECT c.*, cust.name AS customer_name
         FROM contracts c LEFT JOIN customers cust ON cust.id = c.customer_id
         WHERE ${where} ORDER BY c.updated_at DESC`,
        params
      );
      res.json({ contracts: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/contracts/:id", ...gate, async (req, res) => {
    try {
      const contract = await contracts.getContract(deps.db, Number(req.params.id));
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/contracts", ...gate, validate(createContractSchema), async (req, res) => {
    try {
      const contract = await contracts.createContract(deps.db, req.body, req.employee.id);
      try { await deps.db.query("INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)", [req.employee.id, "contract_created", JSON.stringify({ id: contract.id })]); } catch {}
      res.status(201).json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/contracts/:id", ...gate, validate(updateContractSchema), async (req, res) => {
    try {
      const contract = await contracts.updateContract(deps.db, Number(req.params.id), req.body);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/contracts/:id/send", ...gate, async (req, res) => {
    try {
      const contract = await contracts.sendContract(deps.db, Number(req.params.id));
      try { await deps.db.query("INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)", [req.employee.id, "contract_sent", JSON.stringify({ id: contract.id })]); } catch {}
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/contracts/:id/sign", ...gate, validate(signContractSchema), async (req, res) => {
    try {
      const signer = await contracts.signContract(deps.db, Number(req.params.id), req.body.signer_id, req.body.signature_data, req.ip);
      res.json(signer);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Templates
  app.get("/api/contract-templates", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query("SELECT * FROM contract_templates WHERE is_active = true ORDER BY name");
      res.json({ templates: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/contract-templates", ...gate, validate(createTemplateSchema), async (req, res) => {
    try {
      const { rows: [template] } = await deps.db.query(
        "INSERT INTO contract_templates (name, body_html, variables, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
        [req.body.name, req.body.body_html, JSON.stringify(req.body.variables || []), req.employee.id]
      );
      res.status(201).json(template);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
