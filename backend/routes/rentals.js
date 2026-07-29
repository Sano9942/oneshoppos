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
    depositPreauthSchema,
    cancelSchema,
    noteSchema,
    driverSchema,
    inspectionSchema,
    agreementSignSchema,
    deliverySchema,
    maintenanceLogSchema,
  } = require("../schemas/rentals");
  const rentals = require("../services/rental-service");
  const depositEngine = require("../services/deposit-engine");

  const gate = [requireMode("rentals"), requireFeature("phase4_rentals"), requirePerm("manage_rentals")];
  const inspectGate = [...gate, requireFeature("rental_inspections")];

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
          "INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)",
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
      const id = Number(req.params.id);
      const contract = await rentals.returnContract(deps.db, id, req.body, req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      // F04/V09: if the return screen passes an explicit capture amount
      // (damage/late fee), capture it from the hold now. Otherwise LEAVE the
      // hold authorized — a return condition inspection may capture damage
      // moments later, and completion releases any remainder for a clean
      // return. Auto-releasing here would race (and lose) the inspection
      // capture. Non-fatal — the return itself already committed.
      try {
        const captureAmt = Number(req.body?.deposit_capture_amount || 0);
        if (captureAmt > 0) {
          await depositEngine.capture(deps.db, { entityType: "rental_contract", entityId: id, amount: captureAmt });
        }
      } catch (depErr) {
        console.warn("[rentals/return] deposit capture failed:", depErr.message);
      }
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // F04: rental gateway deposit pre-auth (security deposit hold). Guard the UI
  // button on billing payment_enabled — engine.create throws 400 when the
  // gateway isn't configured.
  app.post("/api/rental-contracts/:id/deposit/preauth", ...gate, validate(depositPreauthSchema), async (req, res) => {
    try {
      const result = await depositEngine.create(deps.db, {
        entityType: "rental_contract",
        entityId: Number(req.params.id),
        amount: req.body?.amount,
        returnUrl: req.body?.returnUrl,
        cancelUrl: req.body?.cancelUrl,
      });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/complete", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const contract = await rentals.completeContract(deps.db, id, req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      // V09: release any deposit hold still authorized at completion — a clean
      // return with no damage capture. Idempotent (skips a captured/partially-
      // captured/released hold). Non-fatal.
      try {
        await depositEngine.release(deps.db, { entityType: "rental_contract", entityId: id });
      } catch (depErr) {
        console.warn("[rentals/complete] deposit release failed:", depErr.message);
      }
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/invoice", ...gate, async (req, res) => {
    try {
      const result = await rentals.generateInvoiceFromContract(deps.db, Number(req.params.id), req.employee.id);
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action_type, description) VALUES ($1, $2, $3)",
          [req.employee.id, "rental_invoice_generated", JSON.stringify({ contract_id: result.contract_id, invoice_id: result.invoice.id })]
        );
      } catch {}
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/cancel", ...gate, validate(cancelSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const contract = await rentals.cancelContract(deps.db, id, req.body, req.employee.id);
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      // F04: a cancelled contract must not keep the customer's deposit frozen —
      // release any authorized hold. Non-fatal.
      try {
        await depositEngine.release(deps.db, { entityType: "rental_contract", entityId: id });
      } catch (depErr) {
        console.warn("[rentals/cancel] deposit release failed:", depErr.message);
      }
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/notes", ...gate, validate(noteSchema), async (req, res) => {
    try {
      await rentals.logActivity(deps.db, Number(req.params.id), req.employee.id, "note", req.body.description);
      res.status(201).json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── V09: driver records (car-legal, staff-only PII) ─────────────

  app.get("/api/rental-contracts/:id/drivers", ...gate, async (req, res) => {
    try {
      const rows = await rentals.listDrivers(deps.db, Number(req.params.id));
      res.json({ drivers: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/drivers", ...gate, validate(driverSchema), async (req, res) => {
    try {
      const driver = await rentals.addDriver(deps.db, Number(req.params.id), req.body, req.employee.id);
      res.status(201).json(driver);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── V09: e-sign rental agreement ────────────────────────────────

  app.post("/api/rental-contracts/:id/agreement", ...gate, async (req, res) => {
    try {
      const result = await rentals.createRentalAgreement(deps.db, Number(req.params.id), req.employee.id);
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/agreement/sign", ...gate, validate(agreementSignSchema), async (req, res) => {
    try {
      const signer = await rentals.signRentalAgreement(deps.db, Number(req.params.id), req.body.signature_data, req.ip);
      res.json({ ok: true, signer });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── V09: condition inspections (checkout/return) ────────────────

  app.get("/api/rental-contracts/:id/inspections", ...inspectGate, async (req, res) => {
    try {
      const rows = await rentals.listInspections(deps.db, Number(req.params.id));
      res.json({ inspections: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/rental-contracts/:id/inspections", ...inspectGate, validate(inspectionSchema), async (req, res) => {
    try {
      const result = await rentals.createInspection(deps.db, Number(req.params.id), req.body, req.employee.id);
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // ── V09: delivery & setup scheduling ────────────────────────────

  app.put("/api/rental-contracts/:id/delivery", ...gate, validate(deliverySchema), async (req, res) => {
    try {
      const contract = await rentals.updateDelivery(deps.db, Number(req.params.id), req.body, req.employee.id);
      if (!contract) return res.status(400).json({ error: "No delivery fields provided" });
      res.json(contract);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Day-view of scheduled deliveries. Top-level path (not under
  // /rental-contracts/:id) to avoid the :id param route shadowing it.
  app.get("/api/rental-deliveries", ...gate, async (req, res) => {
    try {
      const rows = await rentals.getDeliveries(deps.db, req.query);
      res.json({ deliveries: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── V09: maintenance scheduling ─────────────────────────────────

  app.get("/api/rental-assets/maintenance-due", ...gate, async (req, res) => {
    try {
      const rows = await rentals.getDueAssets(deps.db);
      res.json({ assets: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/rental-items/:id/assets/:assetId/maintenance", ...gate, validate(maintenanceLogSchema), async (req, res) => {
    try {
      const log = await rentals.logMaintenance(deps.db, Number(req.params.assetId), req.body, req.employee.id);
      res.status(201).json(log);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
