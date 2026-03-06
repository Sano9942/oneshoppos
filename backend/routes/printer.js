/**
 * Printer routes — hardware receipt printing via ESC/POS
 *
 * POST /api/print/receipt  — print a sale slip to thermal printer
 * GET  /api/print/status   — check if configured printer is reachable
 * GET  /api/print/config   — load current printer_config settings
 * PUT  /api/print/config   — save printer_config settings
 *
 * All endpoints require an authenticated employee (x-employee-id header).
 * POST /api/print/receipt always returns 200 — frontend checks result.fallback.
 */

module.exports = function printerRoutes(app, deps) {
  const { db } = deps;
  const { printReceipt, printerStatus } = require("../services/printer")(db);

  // POST /api/print/receipt
  // Body: { slip: object, template: object|null }
  app.post("/api/print/receipt", async (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    const { slip, template } = req.body || {};
    if (!slip) return res.status(400).json({ error: "slip is required" });

    const result = await printReceipt(slip, template || null);
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

  // GET /api/print/config — load current printer_config row
  app.get("/api/print/config", (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
    db.get("SELECT * FROM printer_config WHERE id = 1", (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || {});
    });
  });

  // PUT /api/print/config — save printer_config row
  app.put("/api/print/config", (req, res) => {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
    const {
      connection_type, host, port, usb_vendor_id, usb_product_id,
      paper_width, cash_drawer, is_active,
    } = req.body || {};
    db.run(
      `UPDATE printer_config SET
        connection_type = ?, host = ?, port = ?,
        usb_vendor_id = ?, usb_product_id = ?,
        paper_width = ?, cash_drawer = ?, is_active = ?
       WHERE id = 1`,
      [
        connection_type || "network",
        host || "192.168.1.100",
        Number(port) || 9100,
        usb_vendor_id || null,
        usb_product_id || null,
        Number(paper_width) || 48,
        cash_drawer ? 1 : 0,
        is_active ? 1 : 0,
      ],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true });
      }
    );
  });
};
