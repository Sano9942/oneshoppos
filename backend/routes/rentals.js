module.exports = function registerRentalRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createRentalItemSchema,
    updateRentalItemSchema,
    createRentalAssetSchema,
    updateRentalAssetSchema,
    createContractSchema,
    updateContractSchema,
    checkoutSchema,
    returnSchema,
    cancelSchema,
    noteSchema,
  } = require("../schemas/rentals");
  const rentals = require("../services/rental-service");

  const gate = [requireMode("rentals"), requireFeature("phase4_rentals"), requirePerm("manage_rentals")];

  // ── Rental items ────────────────────────────────────────────────

  app.get("/api/rental-items", ...gate, async (req, res) => {
    try {
      const rows = await rentals.listRentalItems(deps.db, req.query);
      res.json({ items: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/rental-items/:id", ...gate, async (req, res) => {
    try {
      const item = await rentals.getRentalItem(deps.db, Number(req.params.id));
      if (!item) return res.status(404).json({ error: "Rental item not found" });
      res.json(item);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/rental-items", ...gate, validate(createRentalItemSchema), async (req, res) => {
    try {
      const item = await rentals.createRentalItem(deps.db, req.body);
      res.status(201).json(item);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/rental-items/:id", ...gate, validate(updateRentalItemSchema), async (req, res) => {
    try {
      const item = await rentals.updateRentalItem(deps.db, Number(req.params.id), req.body);
      if (!item) return res.status(404).json({ error: "Rental item not found" });
      res.json(item);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.delete("/api/rental-items/:id", ...gate, async (req, res) => {
    try {
      const item = await rentals.deleteRentalItem(deps.db, Number(req.params.id));
      if (!item) return res.status(404).json({ error: "Rental item not found" });
      res.json({ ok: true, item });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/rental-items/:id/availability", ...gate, async (req, res) => {
    try {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: "from and to query params required" });
      const availability = await rentals.getItemAvailability(deps.db, Number(req.params.id), from, to);
      if (!availability) return res.status(404).json({ error: "Rental item not found" });
      res.json(availability);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Rental assets ───────────────────────────────────────────────

  app.get("/api/rental-items/:id/assets", ...gate, async (req, res) => {
    try {
      const rows = await rentals.listRentalAssets(deps.db, Number(req.params.id));
      res.json({ assets: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/rental-items/:id/assets", ...gate, validate(createRentalAssetSchema), async (req, res) => {
    try {
      const asset = await rentals.createRentalAsset(deps.db, Number(req.params.id), req.body);
      res.status(201).json(asset);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/rental-items/:id/assets/:assetId", ...gate, validate(updateRentalAssetSchema), async (req, res) => {
    try {
      const asset = await rentals.updateRentalAsset(deps.db, Number(req.params.assetId), req.body);
      if (!asset) return res.status(404).json({ error: "Rental asset not found" });
      res.json(asset);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── Contracts ───────────────────────────────────────────────────

  app.get("/api/rental-contracts", ...gate, async (req, res) => {
    try {
      const rows = await rentals.listContracts(deps.db, req.query);
      res.json({ contracts: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/rental-contracts/timeline", ...gate, async (req, res) => {
    try {
      const data = await rentals.getTimelineData(deps.db, req.query);
      res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/rental-contracts/:id", ...gate, async (req, res) => {
    try {
      const contract = await rentals.getContract(deps.db, Number(req.params.id));
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts", ...gate, validate(createContractSchema), async (req, res) => {
    try {
      const contract = await rentals.createContract(deps.db, req.body, req.employee.id);
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
          [req.employee.id, "rental_contract_created", JSON.stringify({ id: contract.id, contract_number: contract.contract_number })]
        );
      } catch {}
      res.status(201).json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/rental-contracts/:id", ...gate, validate(updateContractSchema), async (req, res) => {
    try {
      const contract = await rentals.updateContract(deps.db, Number(req.params.id), req.body, req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/confirm", ...gate, async (req, res) => {
    try {
      const contract = await rentals.confirmContract(deps.db, Number(req.params.id), req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/checkout", ...gate, validate(checkoutSchema), async (req, res) => {
    try {
      const contract = await rentals.checkoutContract(deps.db, Number(req.params.id), req.body, req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/return", ...gate, validate(returnSchema), async (req, res) => {
    try {
      const contract = await rentals.returnContract(deps.db, Number(req.params.id), req.body, req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/complete", ...gate, async (req, res) => {
    try {
      const contract = await rentals.completeContract(deps.db, Number(req.params.id), req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/invoice", ...gate, async (req, res) => {
    try {
      const result = await rentals.generateInvoiceFromContract(deps.db, Number(req.params.id), req.employee.id);
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
          [req.employee.id, "rental_invoice_generated", JSON.stringify({ contract_id: result.contract_id, invoice_id: result.invoice.id })]
        );
      } catch {}
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/cancel", ...gate, validate(cancelSchema), async (req, res) => {
    try {
      const contract = await rentals.cancelContract(deps.db, Number(req.params.id), req.body, req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/notes", ...gate, validate(noteSchema), async (req, res) => {
    try {
      await rentals.logActivity(deps.db, Number(req.params.id), req.employee.id, "note", req.body.description);
      res.status(201).json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
