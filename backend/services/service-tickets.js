"use strict";

/**
 * Service ticket lifecycle — CRUD, activity logging, invoice generation, plus
 * V06 repair depth: device intake (ticket_devices), per-repair-type checklist
 * templates (ticket_types), and encrypted device-passcode reveal.
 *
 * Reuses patterns from services/projects.js (activity logging, dynamic SET)
 * and services/customer-invoicing.js (invoice number generation).
 */

const { generateInvoiceNumber } = require("./customer-invoicing");
const { encryptSecret, decryptSecret } = require("./crypto");

// ── Ticket numbering ──────────────────────────────────────────────

async function generateTicketNumber(db) {
  const { rows: [{ next_id }] } = await db.query(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM service_tickets"
  );
  return `TKT-${String(next_id).padStart(6, "0")}`;
}

// ── Device serialization: NEVER leak the stored passcode ciphertext ──
// General reads expose only `has_passcode`; the plaintext is available solely
// through revealPasscode (which logs an audit row). This also guarantees the
// passcode can't ride out through any portal payload built from a device row.
function publicDevice(d) {
  if (!d) return d;
  const { passcode, ...rest } = d;
  return { ...rest, has_passcode: !!passcode };
}

// ── CRUD ──────────────────────────────────────────────────────────

async function createTicket(db, data, employeeId) {
  return await db.transaction(async (client) => {
    const ticketNumber = await generateTicketNumber(client);

    const { rows: [ticket] } = await client.query(
      `INSERT INTO service_tickets
         (ticket_number, customer_id, outlet_id, created_by, assigned_to, ticket_type_id,
          title, description, notes, deposit_amount, deposit_paid_at, deposit_method, expected_completion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        ticketNumber,
        data.customer_id || null,
        data.outlet_id || null,
        employeeId,
        data.assigned_to || null,
        data.ticket_type_id || null,
        data.title,
        data.description || null,
        data.notes || null,
        data.deposit_amount || 0,
        data.deposit_amount > 0 ? new Date() : null,
        data.deposit_method || null,
        data.expected_completion || null,
      ]
    );

    await logActivity(client, ticket.id, employeeId, "status_change", "Ticket created");

    if (data.deposit_amount > 0) {
      await logActivity(client, ticket.id, employeeId, "deposit_recorded",
        `Deposit of ${data.deposit_amount} recorded (${data.deposit_method || "cash"})`);
    }

    if (data.assigned_to) {
      await logActivity(client, ticket.id, employeeId, "assignment",
        `Assigned to employee #${data.assigned_to}`,
        { assigned_to: data.assigned_to });
    }

    // Attach intake devices in the same transaction — checklist seeded from the
    // ticket type's template so intake captures the standard pre-repair checks.
    if (Array.isArray(data.devices)) {
      for (const dev of data.devices) {
        await insertDevice(client, ticket.id, ticket.ticket_type_id, dev, employeeId);
      }
    }

    return ticket;
  });
}

async function updateTicket(db, id, data, employeeId) {
  // Fetch current ticket to detect changes
  const { rows: [current] } = await db.query(
    "SELECT * FROM service_tickets WHERE id = $1", [id]
  );
  if (!current) return null;

  const allowed = [
    "title", "description", "notes", "customer_id", "outlet_id",
    "assigned_to", "ticket_type_id", "expected_completion", "status",
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

  // Expose the pre-update status so the route can fire a customer notification
  // only on an actual transition (not on every field edit that re-sends status).
  ticket.previous_status = current.status;
  return ticket;
}

async function getTicket(db, id) {
  const { rows: [ticket] } = await db.query(
    `SELECT st.*,
       c.name AS customer_name,
       c.mobile AS customer_mobile,
       cr.name AS created_by_name,
       asn.name AS assigned_to_name,
       tt.name AS ticket_type_name
     FROM service_tickets st
     LEFT JOIN customers c ON c.id = st.customer_id
     LEFT JOIN employees cr ON cr.id = st.created_by
     LEFT JOIN employees asn ON asn.id = st.assigned_to
     LEFT JOIN ticket_types tt ON tt.id = st.ticket_type_id
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

  const devices = await getDevices(db, id);

  return { ...ticket, activities, devices };
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
    // Search ticket number/title, plus device IMEI/serial and customer phone
    // (the counter looks a ticket up by any of these — V06 findings [07]).
    idx++;
    where += ` AND (st.ticket_number ILIKE $${idx} OR st.title ILIKE $${idx}
      OR EXISTS (SELECT 1 FROM ticket_devices d WHERE d.service_ticket_id = st.id
        AND (d.imei ILIKE $${idx} OR d.serial_number ILIKE $${idx}))
      OR EXISTS (SELECT 1 FROM customers cu WHERE cu.id = st.customer_id AND cu.mobile ILIKE $${idx}))`;
    params.push(`%${filters.search}%`);
  }

  const { rows } = await db.query(
    `SELECT st.*,
       c.name AS customer_name,
       asn.name AS assigned_to_name,
       tt.name AS ticket_type_name
     FROM service_tickets st
     LEFT JOIN customers c ON c.id = st.customer_id
     LEFT JOIN employees asn ON asn.id = st.assigned_to
     LEFT JOIN ticket_types tt ON tt.id = st.ticket_type_id
     WHERE ${where}
     ORDER BY st.updated_at DESC`,
    params
  );
  return rows;
}

// ── Ticket types (per-repair-type checklist templates) ─────────────

async function listTicketTypes(db, { includeInactive } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM ticket_types ${includeInactive ? "" : "WHERE active = TRUE"}
     ORDER BY sort_order, name`
  );
  return rows;
}

async function createTicketType(db, data) {
  const { rows: [t] } = await db.query(
    `INSERT INTO ticket_types (name, checklist_template, default_warranty_days, sort_order, active)
     VALUES ($1, $2, $3, $4, COALESCE($5, TRUE)) RETURNING *`,
    [
      data.name,
      JSON.stringify(data.checklist_template || []),
      data.default_warranty_days ?? null,
      data.sort_order ?? 0,
      data.active,
    ]
  );
  return t;
}

async function updateTicketType(db, id, data) {
  const allowed = ["name", "checklist_template", "default_warranty_days", "sort_order", "active"];
  const sets = [];
  const params = [];
  let idx = 0;
  for (const k of allowed) {
    if (data[k] !== undefined) {
      idx++;
      sets.push(`${k} = $${idx}`);
      params.push(k === "checklist_template" ? JSON.stringify(data[k]) : data[k]);
    }
  }
  if (!sets.length) {
    const { rows: [t] } = await db.query("SELECT * FROM ticket_types WHERE id = $1", [id]);
    return t || null;
  }
  idx++;
  params.push(id);
  const { rows: [t] } = await db.query(
    `UPDATE ticket_types SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
  );
  return t || null;
}

async function deleteTicketType(db, id) {
  // Deactivate if referenced by a ticket (preserve history); hard-delete if unused.
  const { rows: [{ c }] } = await db.query(
    "SELECT count(*)::int c FROM service_tickets WHERE ticket_type_id = $1", [id]
  );
  if (c > 0) {
    const { rows: [t] } = await db.query(
      "UPDATE ticket_types SET active = FALSE WHERE id = $1 RETURNING *", [id]
    );
    return { deactivated: true, type: t };
  }
  await db.query("DELETE FROM ticket_types WHERE id = $1", [id]);
  return { deleted: true };
}

// ── Devices ────────────────────────────────────────────────────────

// Build the initial checklist from the ticket type's template (keys → null =
// "not yet checked"). An explicit checklist on the device wins.
async function seedChecklist(client, ticketTypeId, provided) {
  if (provided && Object.keys(provided).length) return provided;
  if (!ticketTypeId) return {};
  const { rows: [tt] } = await client.query(
    "SELECT checklist_template FROM ticket_types WHERE id = $1", [ticketTypeId]
  );
  const template = tt && Array.isArray(tt.checklist_template) ? tt.checklist_template : [];
  const map = {};
  for (const label of template) map[label] = null;
  return map;
}

// Insert a device row inside a caller-owned transaction (used by createTicket
// and addDevice). Encrypts the passcode; seeds the checklist; logs the mutation.
async function insertDevice(client, ticketId, ticketTypeId, dev, employeeId) {
  const checklist = await seedChecklist(client, ticketTypeId, dev.checklist);
  const passcode = dev.passcode ? encryptSecret(String(dev.passcode)) : null;
  const { rows: [device] } = await client.query(
    `INSERT INTO ticket_devices
       (service_ticket_id, device_type, brand, model, serial_number, imei, passcode,
        condition_notes, accessories, checklist, photos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      ticketId,
      dev.device_type || null,
      dev.brand || null,
      dev.model || null,
      dev.serial_number || null,
      dev.imei || null,
      passcode,
      dev.condition_notes || null,
      JSON.stringify(dev.accessories || []),
      JSON.stringify(checklist),
      JSON.stringify(dev.photos || []),
    ]
  );
  const label = [dev.brand, dev.model].filter(Boolean).join(" ") || dev.device_type || "device";
  await logActivity(client, ticketId, employeeId, "device_added",
    `Device added: ${label}`,
    { device_id: device.id, imei: dev.imei || null, serial_number: dev.serial_number || null });
  return device;
}

async function addDevice(db, ticketId, dev, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [ticket] } = await client.query(
      "SELECT id, ticket_type_id FROM service_tickets WHERE id = $1", [ticketId]
    );
    if (!ticket) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    const device = await insertDevice(client, ticketId, ticket.ticket_type_id, dev, employeeId);
    return publicDevice(device);
  });
}

async function updateDevice(db, ticketId, deviceId, data, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [current] } = await client.query(
      "SELECT * FROM ticket_devices WHERE id = $1 AND service_ticket_id = $2", [deviceId, ticketId]
    );
    if (!current) return null;

    const allowed = ["device_type", "brand", "model", "serial_number", "imei", "condition_notes", "accessories", "checklist", "photos"];
    const jsonCols = new Set(["accessories", "checklist", "photos"]);
    const sets = [];
    const params = [];
    let idx = 0;
    for (const k of allowed) {
      if (data[k] !== undefined) {
        idx++;
        sets.push(`${k} = $${idx}`);
        params.push(jsonCols.has(k) ? JSON.stringify(data[k]) : data[k]);
      }
    }
    // passcode handled separately — re-encrypt on set; empty string clears it.
    if (data.passcode !== undefined) {
      idx++;
      sets.push(`passcode = $${idx}`);
      params.push(data.passcode ? encryptSecret(String(data.passcode)) : null);
    }
    if (!sets.length) return publicDevice(current);

    sets.push("updated_at = NOW()");
    idx++;
    params.push(deviceId);
    const { rows: [device] } = await client.query(
      `UPDATE ticket_devices SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
    );
    await logActivity(client, ticketId, employeeId, "device_updated",
      `Device #${deviceId} updated`, { device_id: deviceId });
    return publicDevice(device);
  });
}

async function removeDevice(db, ticketId, deviceId, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [d] } = await client.query(
      "SELECT id FROM ticket_devices WHERE id = $1 AND service_ticket_id = $2", [deviceId, ticketId]
    );
    if (!d) return null;
    await client.query("DELETE FROM ticket_devices WHERE id = $1", [deviceId]);
    await logActivity(client, ticketId, employeeId, "device_removed",
      `Device #${deviceId} removed`, { device_id: deviceId });
    return { deleted: true };
  });
}

async function getDevices(db, ticketId) {
  const { rows } = await db.query(
    "SELECT * FROM ticket_devices WHERE service_ticket_id = $1 ORDER BY id", [ticketId]
  );
  return rows.map(publicDevice);
}

// Reveal-on-click: decrypt the passcode and log a passcode_revealed audit row.
async function revealPasscode(db, ticketId, deviceId, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [d] } = await client.query(
      "SELECT passcode FROM ticket_devices WHERE id = $1 AND service_ticket_id = $2", [deviceId, ticketId]
    );
    if (!d) return null;
    if (!d.passcode) return { passcode: null };
    const passcode = decryptSecret(d.passcode);
    await logActivity(client, ticketId, employeeId, "passcode_revealed",
      `Passcode revealed for device #${deviceId}`, { device_id: deviceId });
    return { passcode };
  });
}

// Prior tickets for the same physical device (IMEI/serial) — powers the intake
// "this phone was here in March" lookup and the P1 warranty-return banner.
async function getDeviceHistory(db, { imei, serial_number, excludeTicketId } = {}) {
  if (!imei && !serial_number) return [];
  const params = [];
  let idx = 0;
  const conds = [];
  if (imei) { idx++; conds.push(`td.imei = $${idx}`); params.push(imei); }
  if (serial_number) { idx++; conds.push(`td.serial_number = $${idx}`); params.push(serial_number); }
  let where = `(${conds.join(" OR ")})`;
  if (excludeTicketId) { idx++; where += ` AND st.id <> $${idx}`; params.push(Number(excludeTicketId)); }

  const { rows } = await db.query(
    `SELECT st.id AS ticket_id, st.ticket_number, st.status, st.title,
            st.created_at, st.actual_completion,
            td.brand, td.model, td.imei, td.serial_number
     FROM ticket_devices td
     JOIN service_tickets st ON st.id = td.service_ticket_id
     WHERE ${where}
     ORDER BY st.created_at DESC`,
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
    // NOTE (V06): the parts-P0 rewrite replaces this with itemized parts+labor
    // lines minus the deposit (services/service-tickets.js, task 6).
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
  // ticket types
  listTicketTypes,
  createTicketType,
  updateTicketType,
  deleteTicketType,
  // devices
  addDevice,
  updateDevice,
  removeDevice,
  getDevices,
  revealPasscode,
  getDeviceHistory,
  publicDevice,
};
