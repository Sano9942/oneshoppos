"use strict";

/**
 * Service ticket lifecycle — CRUD, activity logging, invoice generation.
 *
 * Reuses patterns from services/projects.js (activity logging, dynamic SET)
 * and services/customer-invoicing.js (invoice number generation).
 */

const { generateInvoiceNumber } = require("./customer-invoicing");

// ── Ticket numbering ──────────────────────────────────────────────

async function generateTicketNumber(db) {
  const { rows: [{ next_id }] } = await db.query(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM service_tickets"
  );
  return `TKT-${String(next_id).padStart(6, "0")}`;
}

// ── CRUD ──────────────────────────────────────────────────────────

async function createTicket(db, data, employeeId) {
  const ticketNumber = await generateTicketNumber(db);

  const { rows: [ticket] } = await db.query(
    `INSERT INTO service_tickets
       (ticket_number, customer_id, outlet_id, created_by, assigned_to, title, description, notes,
        deposit_amount, deposit_paid_at, deposit_method, expected_completion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      ticketNumber,
      data.customer_id || null,
      data.outlet_id || null,
      employeeId,
      data.assigned_to || null,
      data.title,
      data.description || null,
      data.notes || null,
      data.deposit_amount || 0,
      data.deposit_amount > 0 ? new Date() : null,
      data.deposit_method || null,
      data.expected_completion || null,
    ]
  );

  await logActivity(db, ticket.id, employeeId, "status_change", "Ticket created");

  if (data.deposit_amount > 0) {
    await logActivity(db, ticket.id, employeeId, "deposit_recorded",
      `Deposit of ${data.deposit_amount} recorded (${data.deposit_method || "cash"})`);
  }

  if (data.assigned_to) {
    await logActivity(db, ticket.id, employeeId, "assignment",
      `Assigned to employee #${data.assigned_to}`,
      { assigned_to: data.assigned_to });
  }

  return ticket;
}

async function updateTicket(db, id, data, employeeId) {
  // Fetch current ticket to detect changes
  const { rows: [current] } = await db.query(
    "SELECT * FROM service_tickets WHERE id = $1", [id]
  );
  if (!current) return null;

  const allowed = [
    "title", "description", "notes", "customer_id", "outlet_id",
    "assigned_to", "expected_completion", "status",
  ];
  const sets = [];
  const params = [];
  let idx = 0;

  for (const key of allowed) {
    if (data[key] !== undefined) {
      idx++;
      sets.push(`${key} = $${idx}`);
      params.push(data[key]);
    }
  }
  if (!sets.length) return current;

  sets.push("updated_at = NOW()");
  if (data.status === "completed") sets.push("actual_completion = NOW()");

  idx++;
  params.push(id);

  const { rows: [ticket] } = await db.query(
    `UPDATE service_tickets SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );

  // Log status change
  if (data.status && data.status !== current.status) {
    await logActivity(db, id, employeeId, "status_change",
      `Status changed from ${current.status} to ${data.status}`);
  }

  // Log assignment change
  if (data.assigned_to !== undefined && data.assigned_to !== current.assigned_to) {
    await logActivity(db, id, employeeId, "assignment",
      data.assigned_to
        ? `Assigned to employee #${data.assigned_to}`
        : "Assignment removed",
      { previous: current.assigned_to, assigned_to: data.assigned_to });
  }

  return ticket;
}

async function getTicket(db, id) {
  const { rows: [ticket] } = await db.query(
    `SELECT st.*,
       c.name AS customer_name,
       cr.name AS created_by_name,
       asn.name AS assigned_to_name
     FROM service_tickets st
     LEFT JOIN customers c ON c.id = st.customer_id
     LEFT JOIN employees cr ON cr.id = st.created_by
     LEFT JOIN employees asn ON asn.id = st.assigned_to
     WHERE st.id = $1`,
    [id]
  );
  if (!ticket) return null;

  const { rows: activities } = await db.query(
    `SELECT sta.*, e.name AS actor_name
     FROM service_ticket_activities sta
     LEFT JOIN employees e ON e.id = sta.actor_id
     WHERE sta.ticket_id = $1
     ORDER BY sta.created_at DESC LIMIT 50`,
    [id]
  );

  return { ...ticket, activities };
}

async function listTickets(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";

  if (filters.status) { idx++; where += ` AND st.status = $${idx}`; params.push(filters.status); }
  if (filters.customer_id) { idx++; where += ` AND st.customer_id = $${idx}`; params.push(Number(filters.customer_id)); }
  if (filters.outlet_id) { idx++; where += ` AND st.outlet_id = $${idx}`; params.push(Number(filters.outlet_id)); }
  if (filters.assigned_to) { idx++; where += ` AND st.assigned_to = $${idx}`; params.push(Number(filters.assigned_to)); }
  if (filters.search) {
    idx++;
    where += ` AND (st.ticket_number ILIKE $${idx} OR st.title ILIKE $${idx})`;
    params.push(`%${filters.search}%`);
  }

  const { rows } = await db.query(
    `SELECT st.*,
       c.name AS customer_name,
       asn.name AS assigned_to_name
     FROM service_tickets st
     LEFT JOIN customers c ON c.id = st.customer_id
     LEFT JOIN employees asn ON asn.id = st.assigned_to
     WHERE ${where}
     ORDER BY st.updated_at DESC`,
    params
  );
  return rows;
}

// ── Invoice generation ────────────────────────────────────────────

async function generateInvoiceFromTicket(db, ticketId, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [ticket] } = await client.query(
      "SELECT * FROM service_tickets WHERE id = $1 FOR UPDATE",
      [ticketId]
    );
    if (!ticket) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    if (ticket.status !== "completed") {
      throw Object.assign(new Error("Only completed tickets can generate an invoice"), { statusCode: 400 });
    }

    const invoiceNumber = await generateInvoiceNumber(client);
    const deposit = Number(ticket.deposit_amount || 0);

    // Estimate total as deposit (minimum) — in practice the staff should set a proper total.
    // For now, we create the invoice shell; staff can edit the amount on the invoice page.
    const totalAmount = deposit > 0 ? deposit : 0;
    const balanceDue = Math.max(0, totalAmount - deposit);

    const { rows: [invoice] } = await client.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, outlet_id, employee_id, status,
          subtotal, tax_total, discount_amount, total_amount, balance_due, notes)
       VALUES ($1, $2, $3, $4, 'sent', $5, 0, 0, $5, $6, $7) RETURNING *`,
      [
        invoiceNumber,
        ticket.customer_id,
        ticket.outlet_id,
        employeeId,
        totalAmount,
        balanceDue,
        `Invoice for service ticket ${ticket.ticket_number}: ${ticket.title}`,
      ]
    );

    // Create line item
    await client.query(
      `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, line_total)
       VALUES ($1, $2, 1, $3, $3)`,
      [invoice.id, ticket.title, totalAmount]
    );

    // Link invoice to ticket
    await client.query(
      `UPDATE service_tickets
       SET final_invoice_id = $1, status = 'invoiced', actual_completion = COALESCE(actual_completion, NOW()), updated_at = NOW()
       WHERE id = $2`,
      [invoice.id, ticketId]
    );

    // Log activities
    await client.query(
      `INSERT INTO service_ticket_activities (ticket_id, actor_id, activity_type, description, metadata)
       VALUES ($1, $2, 'invoice_generated', $3, $4)`,
      [ticketId, employeeId, `Invoice ${invoiceNumber} generated`,
       JSON.stringify({ invoice_id: invoice.id, invoice_number: invoiceNumber })]
    );
    await client.query(
      `INSERT INTO service_ticket_activities (ticket_id, actor_id, activity_type, description)
       VALUES ($1, $2, 'status_change', 'Status changed from completed to invoiced')`,
      [ticketId, employeeId]
    );

    return { ticket_id: ticketId, invoice };
  });
}

// ── Activity logging ──────────────────────────────────────────────

async function logActivity(db, ticketId, actorId, activityType, description, metadata = {}) {
  await db.query(
    `INSERT INTO service_ticket_activities (ticket_id, actor_id, activity_type, description, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [ticketId, actorId, activityType, description, JSON.stringify(metadata)]
  );
}

module.exports = {
  generateTicketNumber,
  createTicket,
  updateTicket,
  getTicket,
  listTickets,
  generateInvoiceFromTicket,
  logActivity,
};
