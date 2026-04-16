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
  app.post("/api/print/test", requirePerm("all_access"), async (req, res) => {
    const result = await printTest();
    return res.json(result);
  });

  // POST /api/print/open-drawer — kick the cash drawer without printing
  // (no-sale, cash drop, safe drop scenarios). Always returns 200 — caller
  // checks result.ok. Requires authenticated employee but no specific perm.
  app.post("/api/print/open-drawer", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
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
      paper_width, cash_drawer, is_active,
    } = req.body || {};
    try {
      await db.query(
        `UPDATE printer_config SET
          connection_type = $1, host = $2, port = $3,
          usb_vendor_id = $4, usb_product_id = $5,
          paper_width = $6, cash_drawer = $7, is_active = $8
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
        ]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
