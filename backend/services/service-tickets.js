"use strict";

/**
 * Service ticket lifecycle — CRUD, activity logging, invoice generation, plus
 * V06 repair depth: device intake (ticket_devices), per-repair-type checklist
 * templates (ticket_types), and encrypted device-passcode reveal.
 *
 * Reuses patterns from services/projects.js (activity logging, dynamic SET)
 * and services/customer-invoicing.js (invoice number generation).
 */

const { generateInvoiceNumber, computeInvoiceTotals, recomputeBalance } = require("./customer-invoicing");
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
  // Transactional: a cancel must restock its un-invoiced parts atomically.
  return await db.transaction(async (client) => {
    const { rows: [current] } = await client.query(
      "SELECT * FROM service_tickets WHERE id = $1 FOR UPDATE", [id]
    );
    if (!current) return null;

    const allowed = [
      "title", "description", "notes", "customer_id", "outlet_id",
      "assigned_to", "ticket_type_id", "expected_completion", "status", "warranty_days",
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

    // Warranty is stamped at completion: resolve the days (explicit override →
    // already-set → ticket-type default) and compute warranty_until = today + days.
    const completing = data.status === "completed" && current.status !== "completed";
    if (completing) {
      let warrantyDays = data.warranty_days != null ? Number(data.warranty_days)
        : (current.warranty_days != null ? Number(current.warranty_days) : null);
      if (warrantyDays == null && current.ticket_type_id) {
        const { rows: [tt] } = await client.query(
          "SELECT default_warranty_days FROM ticket_types WHERE id = $1", [current.ticket_type_id]
        );
        if (tt && tt.default_warranty_days != null) warrantyDays = Number(tt.default_warranty_days);
      }
      if (warrantyDays != null) {
        if (data.warranty_days === undefined) { idx++; sets.push(`warranty_days = $${idx}`); params.push(warrantyDays); }
        idx++; sets.push(`warranty_until = CURRENT_DATE + $${idx}::int`); params.push(warrantyDays);
      }
    }

    if (!sets.length) {
      current.previous_status = current.status;
      return current;
    }

    sets.push("updated_at = NOW()");
    if (data.status === "completed") sets.push("actual_completion = NOW()");

    idx++;
    params.push(id);

    const { rows: [ticket] } = await client.query(
      `UPDATE service_tickets SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );

    // Log status change
    if (data.status && data.status !== current.status) {
      await logActivity(client, id, employeeId, "status_change",
        `Status changed from ${current.status} to ${data.status}`);
    }

    // Log assignment change
    if (data.assigned_to !== undefined && data.assigned_to !== current.assigned_to) {
      await logActivity(client, id, employeeId, "assignment",
        data.assigned_to
          ? `Assigned to employee #${data.assigned_to}`
          : "Assignment removed",
        { previous: current.assigned_to, assigned_to: data.assigned_to });
    }

    // Cancelling a not-yet-invoiced ticket restocks its consumed parts.
    if (data.status === "cancelled" && current.status !== "cancelled" && current.status !== "invoiced") {
      await restockTicketParts(client, id, current.outlet_id, employeeId);
    }

    // Expose the pre-update status so the route can fire a customer notification
    // only on an actual transition (not on every field edit that re-sends status).
    ticket.previous_status = current.status;
    return ticket;
  });
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
  const items = await getItems(db, id);

  return { ...ticket, activities, devices, items };
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
            st.created_at, st.actual_completion, st.warranty_until,
            (st.warranty_until IS NOT NULL AND st.warranty_until >= CURRENT_DATE) AS in_warranty,
            td.brand, td.model, td.imei, td.serial_number
     FROM ticket_devices td
     JOIN service_tickets st ON st.id = td.service_ticket_id
     WHERE ${where}
     ORDER BY st.created_at DESC`,
    params
  );
  return rows;
}

// ── Parts / labor / fee lines (a NEW stock writer) ─────────────────

// Decrement outlet stock for a part (mirrors the sales.js FOR UPDATE
// discipline). Serialized parts flip their chosen serial to 'sold'.
async function decrementPartStock(client, { productId, variantId, outletId, qty, serialId }) {
  if (variantId) {
    const { rows: [row] } = await client.query(
      `SELECT COALESCE(quantity, 0) AS available FROM variant_outlet_stock
       WHERE variant_id = $1 AND outlet_id = $2 FOR UPDATE`,
      [variantId, outletId]
    );
    if (!row || Number(row.available) < qty) {
      throw Object.assign(new Error("Insufficient stock for this part"), { statusCode: 400, code: "insufficient_stock" });
    }
    await client.query(
      `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
         VALUES ($1, $2, 0 - $3::numeric)
         ON CONFLICT (variant_id, outlet_id)
         DO UPDATE SET quantity = variant_outlet_stock.quantity - $3::numeric`,
      [variantId, outletId, qty]
    );
    await client.query("UPDATE product_variants SET stock = stock - $1 WHERE id = $2", [qty, variantId]);
    await client.query("UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3", [qty, productId, outletId]);
  } else {
    const { rows: [row] } = await client.query(
      `SELECT COALESCE(quantity, 0) AS available FROM outlet_stock
       WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
      [productId, outletId]
    );
    if (!row || Number(row.available) < qty) {
      throw Object.assign(new Error("Insufficient stock for this part"), { statusCode: 400, code: "insufficient_stock" });
    }
    await client.query("UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3", [qty, productId, outletId]);
  }
  if (serialId) {
    await client.query("UPDATE product_serial_numbers SET status = 'sold' WHERE id = $1", [serialId]);
  }
}

// Reverse of decrementPartStock — used by remove-part and cancel-restock.
async function restockPartStock(client, { productId, variantId, outletId, qty, serialId }) {
  if (variantId) {
    await client.query(
      `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
         VALUES ($1, $2, $3::numeric)
         ON CONFLICT (variant_id, outlet_id)
         DO UPDATE SET quantity = variant_outlet_stock.quantity + $3::numeric`,
      [variantId, outletId, qty]
    );
    await client.query("UPDATE product_variants SET stock = stock + $1 WHERE id = $2", [qty, variantId]);
    await client.query("UPDATE outlet_stock SET quantity = quantity + $1 WHERE product_id = $2 AND outlet_id = $3", [qty, productId, outletId]);
  } else if (productId) {
    await client.query("UPDATE outlet_stock SET quantity = quantity + $1 WHERE product_id = $2 AND outlet_id = $3", [qty, productId, outletId]);
  }
  if (serialId) {
    await client.query("UPDATE product_serial_numbers SET status = 'available', sale_id = NULL WHERE id = $1", [serialId]);
  }
}

async function getItems(db, ticketId) {
  const { rows } = await db.query(
    `SELECT sti.*, p.name AS product_name, psn.serial_number
     FROM service_ticket_items sti
     LEFT JOIN products p ON p.id = sti.product_id
     LEFT JOIN product_serial_numbers psn ON psn.id = sti.product_serial_id
     WHERE sti.service_ticket_id = $1
     ORDER BY sti.id`,
    [ticketId]
  );
  return rows;
}

async function addPart(db, ticketId, data, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [ticket] } = await client.query(
      "SELECT id, outlet_id, status FROM service_tickets WHERE id = $1 FOR UPDATE", [ticketId]
    );
    if (!ticket) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    if (["invoiced", "cancelled"].includes(ticket.status)) {
      throw Object.assign(new Error(`Cannot add items to a ${ticket.status} ticket`), { statusCode: 400 });
    }

    const itemType = data.item_type;
    const qty = Number(data.quantity ?? 1);
    let unitPrice = data.unit_price != null ? Number(data.unit_price) : null;
    let unitCost = data.unit_cost != null ? Number(data.unit_cost) : null;
    let description = data.description || null;
    let stockDecremented = false;
    let serialId = data.product_serial_id ? Number(data.product_serial_id) : null;

    if (itemType === "part" && data.product_id) {
      const outletId = ticket.outlet_id;
      if (!outletId) {
        throw Object.assign(new Error("Assign an outlet to the ticket before adding parts from inventory"), { statusCode: 400 });
      }
      const { rows: [prod] } = await client.query(
        "SELECT name, price, cost_price FROM products WHERE id = $1", [data.product_id]
      );
      if (!prod) throw Object.assign(new Error("Product not found"), { statusCode: 404 });
      if (unitPrice == null) unitPrice = Number(prod.price);
      if (unitCost == null) unitCost = Number(prod.cost_price || 0);
      if (!description) description = prod.name;

      if (serialId) {
        const { rows: [sr] } = await client.query(
          "SELECT id, status, product_id FROM product_serial_numbers WHERE id = $1 FOR UPDATE", [serialId]
        );
        if (!sr || sr.product_id !== data.product_id) {
          throw Object.assign(new Error("Serial does not match the selected part"), { statusCode: 400 });
        }
        if (sr.status !== "available") {
          throw Object.assign(new Error("That serial is not available"), { statusCode: 400 });
        }
      }

      await decrementPartStock(client, {
        productId: data.product_id, variantId: data.variant_id || null, outletId, qty, serialId,
      });
      stockDecremented = true;
    } else {
      // labor / fee (or a part with no inventory link) — no stock movement.
      if (unitPrice == null) throw Object.assign(new Error("unit_price is required"), { statusCode: 400 });
      if (!description) throw Object.assign(new Error("description is required"), { statusCode: 400 });
      serialId = null;
    }

    const { rows: [line] } = await client.query(
      `INSERT INTO service_ticket_items
         (service_ticket_id, item_type, product_id, variant_id, product_serial_id,
          description, quantity, unit_price, unit_cost, stock_decremented)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [ticketId, itemType, data.product_id || null, data.variant_id || null, serialId,
       description, qty, unitPrice, unitCost, stockDecremented]
    );
    await logActivity(client, ticketId, employeeId, "part_added",
      `${itemType} added: ${description} × ${qty}`,
      { item_id: line.id, item_type: itemType, product_id: data.product_id || null, quantity: qty });
    return line;
  });
}

async function removePart(db, ticketId, itemId, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [ticket] } = await client.query(
      "SELECT id, outlet_id, status FROM service_tickets WHERE id = $1 FOR UPDATE", [ticketId]
    );
    if (!ticket) throw Object.assign(new Error("Ticket not found"), { statusCode: 404 });
    if (ticket.status === "invoiced") {
      throw Object.assign(new Error("Cannot modify items on an invoiced ticket"), { statusCode: 400 });
    }
    const { rows: [line] } = await client.query(
      "SELECT * FROM service_ticket_items WHERE id = $1 AND service_ticket_id = $2", [itemId, ticketId]
    );
    if (!line) return null;

    if (line.stock_decremented) {
      await restockPartStock(client, {
        productId: line.product_id, variantId: line.variant_id, outletId: ticket.outlet_id,
        qty: Number(line.quantity), serialId: line.product_serial_id,
      });
    }
    await client.query("DELETE FROM service_ticket_items WHERE id = $1", [itemId]);
    await logActivity(client, ticketId, employeeId, "part_removed",
      `${line.item_type} removed: ${line.description}`, { item_id: itemId, item_type: line.item_type });
    return { deleted: true };
  });
}

// Restock every still-decremented part on a ticket (cancel path). Caller owns
// the transaction. Flips stock_decremented off so it can't double-restock.
async function restockTicketParts(client, ticketId, outletId, employeeId) {
  const { rows: parts } = await client.query(
    "SELECT * FROM service_ticket_items WHERE service_ticket_id = $1 AND stock_decremented = TRUE", [ticketId]
  );
  for (const line of parts) {
    await restockPartStock(client, {
      productId: line.product_id, variantId: line.variant_id, outletId,
      qty: Number(line.quantity), serialId: line.product_serial_id,
    });
    await client.query("UPDATE service_ticket_items SET stock_decremented = FALSE WHERE id = $1", [line.id]);
  }
  if (parts.length) {
    await logActivity(client, ticketId, employeeId, "part_removed",
      `${parts.length} part(s) restocked on cancellation`, { restocked: parts.length });
  }
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

    // Itemized: one invoice line per ticket item (parts + labor + fees). Tax
    // per line from the product's tax rate (labor/fee → 0), matching the
    // customer-invoicing shape. Stock is NOT touched here — parts already
    // decremented at add (stock_decremented guards against double-decrement).
    const { rows: lines } = await client.query(
      `SELECT sti.item_type, sti.product_id, sti.variant_id, sti.description,
              sti.quantity, sti.unit_price, COALESCE(tx.rate, 0) AS tax_rate
       FROM service_ticket_items sti
       LEFT JOIN products p ON p.id = sti.product_id
       LEFT JOIN taxes tx ON tx.id = p.tax_id
       WHERE sti.service_ticket_id = $1
       ORDER BY sti.id`,
      [ticketId]
    );

    const deposit = Number(ticket.deposit_amount || 0);

    let invoiceItems = lines.map((l) => ({
      product_id: l.product_id, variant_id: l.variant_id, description: l.description,
      quantity: Number(l.quantity), unit_price: Number(l.unit_price), tax_rate: Number(l.tax_rate),
    }));
    // Deposit-only fallback: a plain service job with no itemized parts/labor
    // bills the ticket title at the deposit amount (preserves pre-V06 behavior).
    if (invoiceItems.length === 0) {
      invoiceItems = [{ product_id: null, variant_id: null, description: ticket.title, quantity: 1, unit_price: deposit, tax_rate: 0 }];
    }

    const totals = computeInvoiceTotals(invoiceItems, 0);
    const invoiceNumber = await generateInvoiceNumber(client);

    const { rows: [invoice] } = await client.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, outlet_id, employee_id, status,
          subtotal, tax_total, discount_amount, total_amount, balance_due, notes)
       VALUES ($1, $2, $3, $4, 'sent', $5, $6, 0, $7, $7, $8) RETURNING *`,
      [
        invoiceNumber, ticket.customer_id, ticket.outlet_id, employeeId,
        totals.subtotal, totals.tax_total, totals.total_amount,
        `Invoice for service ticket ${ticket.ticket_number}: ${ticket.title}`,
      ]
    );

    for (const it of totals.items) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, product_id, variant_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoice.id, it.product_id || null, it.variant_id || null, it.description, it.quantity, it.unit_price, it.tax_rate, it.line_total]
      );
    }

    // Net the deposit as a prepayment → balance_due = total − deposit.
    if (deposit > 0) {
      await client.query(
        `INSERT INTO customer_invoice_payments (invoice_id, amount, payment_method, payment_type, notes, recorded_by)
         VALUES ($1, $2, $3, 'deposit', $4, $5)`,
        [invoice.id, deposit, ticket.deposit_method || "cash", `Deposit from ticket ${ticket.ticket_number}`, employeeId]
      );
      await recomputeBalance(client, invoice.id);
    }

    await client.query(
      `UPDATE service_tickets
       SET final_invoice_id = $1, status = 'invoiced', actual_completion = COALESCE(actual_completion, NOW()), updated_at = NOW()
       WHERE id = $2`,
      [invoice.id, ticketId]
    );

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

    const { rows: [finalInvoice] } = await client.query(
      "SELECT * FROM customer_invoices WHERE id = $1", [invoice.id]
    );
    return { ticket_id: ticketId, invoice: finalInvoice };
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
  // parts / labor / fee
  addPart,
  removePart,
  getItems,
};
