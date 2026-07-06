const multer = require("multer");
const crypto = require("crypto");

module.exports = function registerServiceTicketRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const {
    createTicketSchema, updateTicketSchema, addNoteSchema,
    deviceInputSchema, updateDeviceSchema,
    createTicketTypeSchema, updateTicketTypeSchema, addItemSchema,
  } = require("../schemas/service-tickets");
  const tickets = require("../services/service-tickets");
  const customerNotify = require("../services/customer-notify");
  const { uploadToR2 } = require("../utils/r2");
  const { rasterImageFileFilter, safeExtension, verifyImageMagicBytes } = require("../middleware/upload-validation");

  const gate = [requireMode("workflow_tickets"), requireFeature("phase4_workflow_tickets"), requirePerm("manage_tickets")];

  // Device intake condition photos → R2 (10 MB, raster only — no SVG).
  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: rasterImageFileFilter,
  });

  // F05: repair/service ticket status → customer notification. Fire-and-forget
  // so a notification failure never breaks the ticket write. The engine gates on
  // the customer_notifications flag centrally and logs its own truth rows.
  const NOTIFY_STATUSES = new Set(["approved", "in_progress", "completed", "invoiced"]);
  function fireTicketNotification(req, ticket, status) {
    if (!ticket || !ticket.customer_id || !NOTIFY_STATUSES.has(status)) return;
    const company = req.company || {};
    customerNotify.notify(deps.db, {
      event: `ticket.status_changed:${status}`,
      customerId: ticket.customer_id,
      entityType: "ticket",
      entityId: ticket.id,
      tenantSlug: req.tenantSlug,
      tenant: { slug: req.tenantSlug, name: company.company_name },
      data: {
        storeName: company.trading_name || company.company_name || "our store",
        storePhone: company.phone || "",
        ticketNumber: ticket.ticket_number,
        ticketTitle: ticket.title,
      },
    }).catch((err) => {
      try { req.log?.warn({ err: err.message, ticketId: ticket.id, status }, "ticket notification failed"); } catch {}
    });
  }

  // ── Repair-type checklist templates ─────────────────────────────
  // Registered BEFORE GET /:id so the literal "types" path isn't captured as an id.
  app.get("/api/service-tickets/types", ...gate, async (req, res) => {
    try {
      const rows = await tickets.listTicketTypes(deps.db, { includeInactive: req.query.all === "1" });
      res.json({ types: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/service-tickets/types", ...gate, validate(createTicketTypeSchema), async (req, res) => {
    try {
      const t = await tickets.createTicketType(deps.db, req.body);
      res.status(201).json(t);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/service-tickets/types/:typeId", ...gate, validate(updateTicketTypeSchema), async (req, res) => {
    try {
      const t = await tickets.updateTicketType(deps.db, Number(req.params.typeId), req.body);
      if (!t) return res.status(404).json({ error: "Ticket type not found" });
      res.json(t);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/service-tickets/types/:typeId", ...gate, async (req, res) => {
    try {
      const result = await tickets.deleteTicketType(deps.db, Number(req.params.typeId));
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Device history lookup (by IMEI/serial) ──────────────────────
  // Also registered before GET /:id. Powers "this phone was here in March".
  app.get("/api/service-tickets/device-history", ...gate, async (req, res) => {
    try {
      const rows = await tickets.getDeviceHistory(deps.db, {
        imei: req.query.imei || null,
        serial_number: req.query.serial || req.query.serial_number || null,
        excludeTicketId: req.query.exclude || null,
      });
      res.json({ history: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // List tickets (filterable by status, customer_id, outlet_id, assigned_to, search)
  app.get("/api/service-tickets", ...gate, async (req, res) => {
    try {
      const rows = await tickets.listTickets(deps.db, req.query);
      res.json({ tickets: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Get single ticket with activities + devices
  app.get("/api/service-tickets/:id", ...gate, async (req, res) => {
    try {
      const ticket = await tickets.getTicket(deps.db, Number(req.params.id));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      res.json(ticket);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Create ticket (optionally with intake devices)
  app.post("/api/service-tickets", ...gate, validate(createTicketSchema), async (req, res) => {
    try {
      const ticket = await tickets.createTicket(deps.db, req.body, req.employee.id);
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
          [req.employee.id, "ticket_created", JSON.stringify({ id: ticket.id, ticket_number: ticket.ticket_number })]
        );
      } catch {}
      res.status(201).json(ticket);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Update ticket (status changes, reassignment, field edits)
  app.put("/api/service-tickets/:id", ...gate, validate(updateTicketSchema), async (req, res) => {
    try {
      const ticket = await tickets.updateTicket(deps.db, Number(req.params.id), req.body, req.employee.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      // Only notify on a real status transition (not on every field edit).
      if (req.body.status && ticket.status !== ticket.previous_status) {
        fireTicketNotification(req, ticket, ticket.status);
      }
      res.json(ticket);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Add note to ticket
  app.post("/api/service-tickets/:id/notes", ...gate, validate(addNoteSchema), async (req, res) => {
    try {
      await tickets.logActivity(
        deps.db, Number(req.params.id), req.employee.id,
        "note", req.body.description
      );
      res.status(201).json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Devices on a ticket ─────────────────────────────────────────
  app.post("/api/service-tickets/:id/devices", ...gate, validate(deviceInputSchema), async (req, res) => {
    try {
      const device = await tickets.addDevice(deps.db, Number(req.params.id), req.body, req.employee.id);
      res.status(201).json(device);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  app.put("/api/service-tickets/:ticketId/devices/:deviceId", ...gate, validate(updateDeviceSchema), async (req, res) => {
    try {
      const device = await tickets.updateDevice(
        deps.db, Number(req.params.ticketId), Number(req.params.deviceId), req.body, req.employee.id
      );
      if (!device) return res.status(404).json({ error: "Device not found" });
      res.json(device);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/service-tickets/:ticketId/devices/:deviceId", ...gate, async (req, res) => {
    try {
      const result = await tickets.removeDevice(
        deps.db, Number(req.params.ticketId), Number(req.params.deviceId), req.employee.id
      );
      if (!result) return res.status(404).json({ error: "Device not found" });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Reveal an encrypted device passcode (POST — a side-effecting audit action,
  // never GET, so browser prefetch can't spuriously log a reveal).
  app.post("/api/service-tickets/:ticketId/devices/:deviceId/reveal-passcode", ...gate, async (req, res) => {
    try {
      const result = await tickets.revealPasscode(
        deps.db, Number(req.params.ticketId), Number(req.params.deviceId), req.employee.id
      );
      if (!result) return res.status(404).json({ error: "Device not found" });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Upload an intake condition photo → R2. Returns { key, url } for the client
  // to append to the device's photos array via a device update.
  app.post("/api/service-tickets/:ticketId/devices/:deviceId/photos", ...gate, (req, res) => {
    photoUpload.single("file")(req, res, async (multerErr) => {
      if (multerErr) {
        if (multerErr.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large (max 10 MB)" });
        return res.status(400).json({ error: multerErr.message });
      }
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "No file uploaded" });
        if (!verifyImageMagicBytes(file.buffer, file.mimetype)) {
          return res.status(400).json({ error: "File contents do not match an image format" });
        }
        const ext = safeExtension(file.originalname, file.mimetype);
        const opaqueId = crypto.randomBytes(12).toString("hex");
        const key = `tickets/${Number(req.params.ticketId)}/devices/${Number(req.params.deviceId)}/${opaqueId}${ext}`;
        const url = await uploadToR2(file.buffer, key, file.mimetype);
        res.status(201).json({ key, url });
      } catch (err) {
        req.log?.error({ err }, "device photo upload failed");
        res.status(500).json({ error: err.message });
      }
    });
  });

  // ── Parts / labor / fee lines on a ticket ───────────────────────
  app.post("/api/service-tickets/:id/items", ...gate, validate(addItemSchema), async (req, res) => {
    try {
      const line = await tickets.addPart(deps.db, Number(req.params.id), req.body, req.employee.id);
      res.status(201).json(line);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message, code: err.code }); }
  });

  app.delete("/api/service-tickets/:ticketId/items/:itemId", ...gate, async (req, res) => {
    try {
      const result = await tickets.removePart(
        deps.db, Number(req.params.ticketId), Number(req.params.itemId), req.employee.id
      );
      if (!result) return res.status(404).json({ error: "Item not found" });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Send the estimate to the customer (totals ticket items, fires notification).
  app.post("/api/service-tickets/:id/send-estimate", ...gate, async (req, res) => {
    try {
      const { ticket, total } = await tickets.sendEstimate(deps.db, Number(req.params.id), req.employee.id);
      if (ticket.customer_id) {
        const company = req.company || {};
        customerNotify.notify(deps.db, {
          event: "ticket.estimate_ready",
          customerId: ticket.customer_id,
          entityType: "ticket",
          entityId: ticket.id,
          tenantSlug: req.tenantSlug,
          tenant: { slug: req.tenantSlug, name: company.company_name },
          data: {
            storeName: company.trading_name || company.company_name || "our store",
            storePhone: company.phone || "",
            ticketNumber: ticket.ticket_number,
            ticketTitle: ticket.title,
            estimateTotal: total.toFixed(2),
          },
        }).catch((err) => {
          try { req.log?.warn({ err: err.message, ticketId: ticket.id }, "estimate notification failed"); } catch {}
        });
      }
      res.json({ ok: true, total });
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });

  // Generate invoice from completed ticket
  app.post("/api/service-tickets/:id/generate-invoice", ...gate, async (req, res) => {
    try {
      const result = await tickets.generateInvoiceFromTicket(
        deps.db, Number(req.params.id), req.employee.id
      );
      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
          [req.employee.id, "ticket_invoice_generated", JSON.stringify({
            ticket_id: result.ticket_id, invoice_id: result.invoice.id,
          })]
        );
      } catch {}
      // generate-invoice transitions the ticket to 'invoiced' — notify the customer.
      try {
        const t = await tickets.getTicket(deps.db, result.ticket_id);
        fireTicketNotification(req, t, "invoiced");
      } catch {}
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
