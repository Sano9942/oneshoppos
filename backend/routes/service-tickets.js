module.exports = function registerServiceTicketRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createTicketSchema, updateTicketSchema, addNoteSchema } = require("../schemas/service-tickets");
  const tickets = require("../services/service-tickets");

  const gate = [requireMode("workflow_tickets"), requireFeature("phase4_workflow_tickets"), requirePerm("manage_tickets")];

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
      res.status(201).json(result);
    } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
  });
};
