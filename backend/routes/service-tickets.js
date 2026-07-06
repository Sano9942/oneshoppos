module.exports = function registerServiceTicketRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createTicketSchema, updateTicketSchema, addNoteSchema, depositCheckoutSchema } = require("../schemas/service-tickets");
  const tickets = require("../services/service-tickets");
  const customerNotify = require("../services/customer-notify");
  const depositEngine = require("../services/deposit-engine");

  const gate = [requireMode("workflow_tickets"), requireFeature("phase4_workflow_tickets"), requirePerm("manage_tickets")];

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

  // List tickets (filterable by status, customer_id, outlet_id, assigned_to, search)
  app.get("/api/service-tickets", ...gate, async (req, res) => {
    try {
      const rows = await tickets.listTickets(deps.db, req.query);
      res.json({ tickets: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Get single ticket with activities
  app.get("/api/service-tickets/:id", ...gate, async (req, res) => {
    try {
      const ticket = await tickets.getTicket(deps.db, Number(req.params.id));
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      res.json(ticket);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Create ticket
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

  // F04: gateway deposit checkout (charge, not hold — a repair deposit is a
  // payment). Returns a hosted checkout URL; the webhook marks the deposit
  // captured and records the paid amount on deposit_amount. When the gateway
  // is disabled, engine.create throws 400 and staff record a manual deposit via
  // the ticket's deposit_amount field instead. Guard the UI on payment_enabled.
  app.post("/api/service-tickets/:id/deposit/checkout", ...gate, validate(depositCheckoutSchema), async (req, res) => {
    try {
      const result = await depositEngine.create(deps.db, {
        entityType: "service_ticket",
        entityId: Number(req.params.id),
        amount: req.body?.amount,
        returnUrl: req.body?.returnUrl,
        cancelUrl: req.body?.cancelUrl,
      });
      res.json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
