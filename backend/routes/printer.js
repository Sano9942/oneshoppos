/**
 * Printer routes — hardware receipt printing via ESC/POS
 *
 * POST /api/print/receipt       — print a sale slip to thermal printer
 * POST /api/print/test          — send a sample test receipt to the configured printer
 * POST /api/print/open-drawer   — kick the cash drawer without printing (no-sale / drop)
 * GET  /api/print/status        — check if configured printer is reachable
 * GET  /api/print/config        — load current printer_config settings
 * PUT  /api/print/config        — save printer_config settings
 *
 * All endpoints require an authenticated employee (x-employee-id header).
 * POST /api/print/receipt always returns 200 — frontend checks result.fallback.
 */

module.exports = function printerRoutes(app, deps) {
  const { db, requirePerm } = deps;
  const { printReceipt, printerStatus, printTest, openDrawer } = require("../services/printer")(db);

  // POST /api/print/receipt
  // Body: { slip: object, template: object|null }
  app.post("/api/print/receipt", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    const { slip, template, labels: bodyLabels } = req.body || {};
    if (!slip) return res.status(400).json({ error: "slip is required" });

    const currencySymbol = req.company?.currency_symbol || "$";
    // Use labels from request body, fall back to preset labels based on tenant's industry_type
    const labels = bodyLabels || (req.company?.industry_type ? require("../config/industry-config").getPresetLabels(req.company.industry_type) : {});
    const result = await printReceipt(slip, template || null, currencySymbol, labels);
    // Always return 200 — frontend checks result.fallback, not HTTP status
    return res.json(result);
  });

  // GET /api/print/status
  // Used by the Test Print button in Printer Settings
  app.get("/api/print/status", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    const result = await printerStatus();
    return res.json(result);
  });

  // POST /api/print/test — send a sample test receipt to the configured printer
  //
  // PR 7 onboarding: stamp company_profile.test_receipt_printed_at the first
  // time a successful test prints. Drives the "Print a test receipt" step in
  // the merchant onboarding checklist. Best-effort — never blocks the print
  // result on the bookkeeping write.
  app.post("/api/print/test", requirePerm("all_access"), async (req, res) => {
    const result = await printTest();
    if (result?.ok) {
      try {
        await db.query(
          `UPDATE company_profile
              SET test_receipt_printed_at = NOW()
            WHERE id = 1 AND test_receipt_printed_at IS NULL`
        );
      } catch { /* column missing on stale schema — non-fatal */ }
    }
    return res.json(result);
  });

  // POST /api/print/open-drawer — kick the cash drawer without printing
  // (no-sale, cash drop, safe drop scenarios). Always returns 200 — caller
  // checks result.ok. Requires authenticated employee but no specific perm.
  //
  // 2-G.17: when phase2g_risk_controls is ON, we require a reason_code in
  // the body and write a no_sale_events audit row. The POS is expected to
  // hit /api/risk/no-sale directly in that mode, so this path is a legacy
  // fallback — but enforcing the same contract keeps an out-of-band drawer
  // kick from bypassing the audit trail.
  app.post("/api/print/open-drawer", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    let riskEnabled = false;
    try {
      const { rows } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = 'phase2g_risk_controls'",
      );
      riskEnabled = !!rows[0]?.enabled;
    } catch { /* flag table may be absent in legacy tests */ }

    if (riskEnabled) {
      const reasonCode = req.body?.reason_code;
      if (!reasonCode) {
        return res.status(400).json({ error: "reason_code is required when risk controls are enabled" });
      }
      const { rows: reasonRows } = await db.query(
        "SELECT code FROM no_sale_reasons WHERE code = $1 AND is_active = true",
        [reasonCode],
      );
      if (!reasonRows.length) {
        return res.status(400).json({ error: `Unknown or inactive reason_code "${reasonCode}"` });
      }

      const outletId = req.body?.outlet_id ? Number(req.body.outlet_id) : null;
      let shiftId = null;
      if (outletId) {
        const { rows: shiftRows } = await db.query(
          "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
          [outletId],
        );
        shiftId = shiftRows.length ? shiftRows[0].id : null;
      }

      const result = await openDrawer();
      await db.query(
        `INSERT INTO no_sale_events (employee_id, outlet_id, shift_id, reason_code, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [employeeId, outletId, shiftId, reasonCode, req.body?.note || null],
      );
      return res.json(result);
    }

    const result = await openDrawer();
    return res.json(result);
  });

  // GET /api/print/config — load current printer_config row
  app.get("/api/print/config", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { rows } = await db.query("SELECT * FROM printer_config WHERE id = 1");
      res.json(rows[0] || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/print/config — save printer_config row
  app.put("/api/print/config", requirePerm("all_access"), async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
    const {
      connection_type, host, port, usb_vendor_id, usb_product_id,
      paper_width, cash_drawer, is_active, purpose,
    } = req.body || {};
    const allowedPurposes = ["receipt", "fire_chit", "guest_bill", "expo"];
    const safePurpose = allowedPurposes.includes(purpose) ? purpose : "receipt";
    try {
      await db.query(
        `UPDATE printer_config SET
          connection_type = $1, host = $2, port = $3,
          usb_vendor_id = $4, usb_product_id = $5,
          paper_width = $6, cash_drawer = $7, is_active = $8, purpose = $9
         WHERE id = 1`,
        [
          connection_type || "network",
          host || "192.168.1.100",
          Number(port) || 9100,
          usb_vendor_id || null,
          usb_product_id || null,
          Number(paper_width) || 48,
          cash_drawer ? true : false,
          is_active ? true : false,
          safePurpose,
        ]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
