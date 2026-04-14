"use strict";

/**
 * Rental lifecycle — items, assets, contracts, status transitions,
 * availability, overdue detection, and invoice generation.
 *
 * Mirrors patterns from services/service-tickets.js (status machine,
 * activity log, invoice generation) and services/customer-invoicing.js
 * (invoice numbering).
 */

const { generateInvoiceNumber } = require("./customer-invoicing");

// ── Contract numbering ────────────────────────────────────────────

async function generateContractNumber(db) {
  const { rows: [{ next_id }] } = await db.query(
    "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM rental_contracts"
  );
  return `RNT-${String(next_id).padStart(6, "0")}`;
}

// ── Late-fee calculation (pure, unit-testable) ────────────────────

function computeLateFee({ expectedReturn, actualReturn, dailyRate, quantity }) {
  const exp = new Date(expectedReturn);
  const act = new Date(actualReturn);
  if (!Number.isFinite(exp.getTime()) || !Number.isFinite(act.getTime())) return 0;
  const diffMs = act.getTime() - exp.getTime();
  if (diffMs <= 0) return 0;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const days = Math.ceil(diffMs / MS_PER_DAY);
  const rate = Number(dailyRate || 0);
  const qty = Number(quantity || 1);
  return Math.max(0, days * rate * qty);
}

// ── Rental items ──────────────────────────────────────────────────

async function listRentalItems(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";
  if (filters.outlet_id) { idx++; where += ` AND ri.outlet_id = $${idx}`; params.push(Number(filters.outlet_id)); }
  if (filters.is_active !== undefined) {
    idx++;
    where += ` AND ri.is_active = $${idx}`;
    params.push(filters.is_active === "false" || filters.is_active === false ? false : true);
  }
  if (filters.search) {
    idx++;
    where += ` AND (ri.name ILIKE $${idx} OR ri.sku ILIKE $${idx})`;
    params.push(`%${filters.search}%`);
  }
  const { rows } = await db.query(
    `SELECT ri.*,
       (SELECT COUNT(*) FROM rental_assets ra WHERE ra.rental_item_id = ri.id) AS asset_count,
       (SELECT COUNT(*) FROM rental_assets ra WHERE ra.rental_item_id = ri.id AND ra.status = 'available') AS available_asset_count
     FROM rental_items ri
     WHERE ${where}
     ORDER BY ri.name ASC`,
    params
  );
  return rows;
}

async function getRentalItem(db, id) {
  const { rows: [item] } = await db.query(
    "SELECT * FROM rental_items WHERE id = $1",
    [id]
  );
  if (!item) return null;
  const { rows: assets } = await db.query(
    "SELECT * FROM rental_assets WHERE rental_item_id = $1 ORDER BY id ASC",
    [id]
  );
  return { ...item, assets };
}

async function createRentalItem(db, data) {
  const { rows: [item] } = await db.query(
    `INSERT INTO rental_items
       (name, sku, description, outlet_id, total_quantity,
        daily_rate, hourly_rate, weekly_rate,
        deposit_amount, payment_policy, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, TRUE))
     RETURNING *`,
    [
      data.name,
      data.sku || null,
      data.description || null,
      data.outlet_id || null,
      data.total_quantity ?? 1,
      data.daily_rate,
      data.hourly_rate ?? null,
      data.weekly_rate ?? null,
      data.deposit_amount ?? 0,
      data.payment_policy || "upfront",
      data.is_active,
    ]
  );
  return item;
}

async function updateRentalItem(db, id, data) {
  const allowed = [
    "name", "sku", "description", "outlet_id", "total_quantity",
    "daily_rate", "hourly_rate", "weekly_rate",
    "deposit_amount", "payment_policy", "is_active",
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
  if (!sets.length) {
    const { rows: [current] } = await db.query("SELECT * FROM rental_items WHERE id = $1", [id]);
    return current || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [item] } = await db.query(
    `UPDATE rental_items SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return item || null;
}

async function deleteRentalItem(db, id) {
  // Soft-delete — preserves audit trail on historical contracts
  const { rows: [item] } = await db.query(
    "UPDATE rental_items SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  return item || null;
}

// ── Rental assets ─────────────────────────────────────────────────

async function listRentalAssets(db, rentalItemId) {
  const { rows } = await db.query(
    "SELECT * FROM rental_assets WHERE rental_item_id = $1 ORDER BY id ASC",
    [rentalItemId]
  );
  return rows;
}

async function createRentalAsset(db, rentalItemId, data) {
  const { rows: [asset] } = await db.query(
    `INSERT INTO rental_assets (rental_item_id, serial_number, label, status, condition_notes)
     VALUES ($1, $2, $3, COALESCE($4, 'available'), $5) RETURNING *`,
    [
      rentalItemId,
      data.serial_number || null,
      data.label || null,
      data.status,
      data.condition_notes || null,
    ]
  );
  return asset;
}

async function updateRentalAsset(db, id, data) {
  const allowed = ["serial_number", "label", "status", "condition_notes"];
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
  if (!sets.length) {
    const { rows: [current] } = await db.query("SELECT * FROM rental_assets WHERE id = $1", [id]);
    return current || null;
  }
  sets.push("updated_at = NOW()");
  idx++;
  params.push(id);
  const { rows: [asset] } = await db.query(
    `UPDATE rental_assets SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  return asset || null;
}

// ── Contracts ─────────────────────────────────────────────────────

async function listContracts(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "1=1";

  if (filters.status) {
    if (filters.status === "overdue") {
      where += ` AND rc.status = 'checked_out' AND rc.expected_return < NOW()`;
    } else if (filters.status === "active") {
      where += ` AND rc.status IN ('reserved','confirmed','checked_out','returned')`;
    } else {
      idx++;
      where += ` AND rc.status = $${idx}`;
      params.push(filters.status);
    }
  }
  if (filters.customer_id) { idx++; where += ` AND rc.customer_id = $${idx}`; params.push(Number(filters.customer_id)); }
  if (filters.outlet_id) { idx++; where += ` AND rc.outlet_id = $${idx}`; params.push(Number(filters.outlet_id)); }
  if (filters.search) {
    idx++;
    where += ` AND (rc.contract_number ILIKE $${idx} OR c.name ILIKE $${idx})`;
    params.push(`%${filters.search}%`);
  }

  const { rows } = await db.query(
    `SELECT rc.*,
       c.name AS customer_name,
       (SELECT string_agg(ri.name, ', ')
        FROM rental_contract_lines rcl
        JOIN rental_items ri ON ri.id = rcl.rental_item_id
        WHERE rcl.contract_id = rc.id) AS item_summary
     FROM rental_contracts rc
     LEFT JOIN customers c ON c.id = rc.customer_id
     WHERE ${where}
     ORDER BY rc.created_at DESC`,
    params
  );
  return rows;
}

async function getContract(db, id) {
  const { rows: [contract] } = await db.query(
    `SELECT rc.*,
       c.name AS customer_name,
       cb.name AS created_by_name
     FROM rental_contracts rc
     LEFT JOIN customers c ON c.id = rc.customer_id
     LEFT JOIN employees cb ON cb.id = rc.created_by
     WHERE rc.id = $1`,
    [id]
  );
  if (!contract) return null;

  const { rows: lines } = await db.query(
    `SELECT rcl.*,
       ri.name AS item_name,
       ri.sku AS item_sku,
       ra.serial_number AS asset_serial,
       ra.label AS asset_label
     FROM rental_contract_lines rcl
     JOIN rental_items ri ON ri.id = rcl.rental_item_id
     LEFT JOIN rental_assets ra ON ra.id = rcl.rental_asset_id
     WHERE rcl.contract_id = $1
     ORDER BY rcl.id ASC`,
    [id]
  );

  const { rows: activities } = await db.query(
    `SELECT rca.*, e.name AS actor_name
     FROM rental_contract_activities rca
     LEFT JOIN employees e ON e.id = rca.actor_id
     WHERE rca.contract_id = $1
     ORDER BY rca.created_at DESC LIMIT 100`,
    [id]
  );

  return { ...contract, lines, activities };
}

function computeLineTotal(rateSnapshot, durationValue, quantity) {
  return Number(rateSnapshot || 0) * Number(durationValue || 0) * Number(quantity || 1);
}

async function createContract(db, data, employeeId) {
  return await db.transaction(async (client) => {
    const contractNumber = await generateContractNumber(client);

    // Freeze rates + deposits at booking time (audit immutability)
    const lineRows = [];
    let rentalFeeTotal = 0;
    let depositTotal = 0;

    for (const line of data.lines) {
      const { rows: [item] } = await client.query(
        "SELECT * FROM rental_items WHERE id = $1 FOR UPDATE",
        [line.rental_item_id]
      );
      if (!item) {
        throw Object.assign(new Error(`Rental item ${line.rental_item_id} not found`), { statusCode: 404 });
      }
      const rate =
        line.rate_type === "hourly" ? Number(item.hourly_rate || 0) :
        line.rate_type === "weekly" ? Number(item.weekly_rate || 0) :
        Number(item.daily_rate || 0);
      const qty = line.quantity || 1;
      const lineTotal = computeLineTotal(rate, line.duration_value, qty);
      rentalFeeTotal += lineTotal;
      depositTotal += Number(item.deposit_amount || 0) * qty;
      lineRows.push({ ...line, rate_snapshot: rate, line_total: lineTotal, deposit_snapshot: Number(item.deposit_amount || 0) * qty });
    }

    const finalTotal = Math.max(0, rentalFeeTotal - Number(data.discount_amount || 0));

    const { rows: [contract] } = await client.query(
      `INSERT INTO rental_contracts
         (contract_number, customer_id, outlet_id, created_by, status,
          rental_start, rental_end, expected_return,
          deposit_collected, deposit_method, deposit_paid_at,
          payment_policy, rental_fee_total, discount_amount, final_total,
          notes)
       VALUES ($1,$2,$3,$4,'reserved',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        contractNumber,
        data.customer_id || null,
        data.outlet_id || null,
        employeeId,
        data.rental_start,
        data.rental_end || null,
        data.expected_return,
        data.deposit_collected || 0,
        data.deposit_method || null,
        data.deposit_collected > 0 ? new Date() : null,
        data.payment_policy || "upfront",
        rentalFeeTotal,
        data.discount_amount || 0,
        finalTotal,
        data.notes || null,
      ]
    );

    for (const lr of lineRows) {
      await client.query(
        `INSERT INTO rental_contract_lines
           (contract_id, rental_item_id, rental_asset_id, quantity,
            rate_type, rate_snapshot, duration_value, line_total, deposit_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          contract.id,
          lr.rental_item_id,
          lr.rental_asset_id || null,
          lr.quantity || 1,
          lr.rate_type || "daily",
          lr.rate_snapshot,
          lr.duration_value,
          lr.line_total,
          lr.deposit_snapshot,
        ]
      );
    }

    await logActivityWithClient(client, contract.id, employeeId, "status_change", "Contract created (reserved)");
    if (Number(data.deposit_collected) > 0) {
      await logActivityWithClient(client, contract.id, employeeId, "deposit_recorded",
        `Deposit of ${data.deposit_collected} recorded (${data.deposit_method || "cash"})`);
    }

    return contract;
  });
}

async function updateContract(db, id, data, employeeId) {
  const { rows: [current] } = await db.query("SELECT * FROM rental_contracts WHERE id = $1", [id]);
  if (!current) return null;
  if (["checked_out", "returned", "completed", "invoiced", "cancelled"].includes(current.status)) {
    throw Object.assign(new Error(`Cannot edit contract in status '${current.status}'`), { statusCode: 400 });
  }
  const allowed = ["customer_id", "expected_return", "rental_end", "notes", "discount_amount"];
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
  idx++;
  params.push(id);
  const { rows: [contract] } = await db.query(
    `UPDATE rental_contracts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params
  );
  await logActivity(db, id, employeeId, "note", "Contract details updated");
  return contract;
}

// ── Status transitions ────────────────────────────────────────────

async function confirmContract(db, id, employeeId) {
  const { rows: [current] } = await db.query("SELECT * FROM rental_contracts WHERE id = $1", [id]);
  if (!current) return null;
  if (current.status !== "reserved") {
    throw Object.assign(new Error(`Cannot confirm contract in status '${current.status}'`), { statusCode: 400 });
  }
  const { rows: [contract] } = await db.query(
    "UPDATE rental_contracts SET status = 'confirmed', updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  await logActivity(db, id, employeeId, "status_change", "Status changed from reserved to confirmed");
  return contract;
}

async function checkoutContract(db, id, data, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [current] } = await client.query(
      "SELECT * FROM rental_contracts WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!current) return null;
    if (current.status !== "confirmed") {
      throw Object.assign(new Error(`Cannot check out contract in status '${current.status}'`), { statusCode: 400 });
    }

    const sets = ["status = 'checked_out'", "actual_checkin = COALESCE($1, NOW())", "updated_at = NOW()"];
    const params = [data.actual_checkin || null];
    let idx = 1;
    if (data.deposit_method) {
      idx++;
      sets.push(`deposit_method = $${idx}`);
      params.push(data.deposit_method);
    }
    if (data.deposit_paid_at) {
      idx++;
      sets.push(`deposit_paid_at = $${idx}`);
      params.push(data.deposit_paid_at);
    }
    idx++;
    params.push(id);

    const { rows: [contract] } = await client.query(
      `UPDATE rental_contracts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params
    );

    // Mark any linked assets as rented
    await client.query(
      `UPDATE rental_assets SET status = 'rented', updated_at = NOW()
       WHERE id IN (
         SELECT rental_asset_id FROM rental_contract_lines
         WHERE contract_id = $1 AND rental_asset_id IS NOT NULL
       )`,
      [id]
    );

    await logActivityWithClient(client, id, employeeId, "checkin", "Checked out");
    await logActivityWithClient(client, id, employeeId, "status_change", "Status changed from confirmed to checked_out");
    return contract;
  });
}

async function returnContract(db, id, data, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [current] } = await client.query(
      "SELECT * FROM rental_contracts WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!current) return null;
    if (current.status !== "checked_out") {
      throw Object.assign(new Error(`Cannot return contract in status '${current.status}'`), { statusCode: 400 });
    }

    const actualReturn = data.actual_return ? new Date(data.actual_return) : new Date();

    // Auto-compute late fee unless the caller overrode it
    let lateFee = 0;
    let lateFeeOverridden = false;
    if (data.late_fee !== undefined && data.late_fee !== null) {
      lateFee = Number(data.late_fee);
      lateFeeOverridden = true;
    } else {
      // Sum late fee per line (each line carries its own rate + qty)
      const { rows: lines } = await client.query(
        `SELECT rcl.*, ri.daily_rate
         FROM rental_contract_lines rcl
         JOIN rental_items ri ON ri.id = rcl.rental_item_id
         WHERE rcl.contract_id = $1`,
        [id]
      );
      for (const line of lines) {
        lateFee += computeLateFee({
          expectedReturn: current.expected_return,
          actualReturn,
          dailyRate: line.daily_rate,
          quantity: line.quantity,
        });
      }
    }

    const finalTotal = Math.max(
      0,
      Number(current.rental_fee_total || 0) + Number(lateFee) - Number(current.discount_amount || 0)
    );

    const { rows: [contract] } = await client.query(
      `UPDATE rental_contracts
         SET status = 'returned',
             actual_return = $1,
             late_fee = $2,
             late_fee_overridden = $3,
             final_total = $4,
             updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [actualReturn, lateFee, lateFeeOverridden, finalTotal, id]
    );

    // Release any linked assets back to available
    await client.query(
      `UPDATE rental_assets SET status = 'available', updated_at = NOW()
       WHERE id IN (
         SELECT rental_asset_id FROM rental_contract_lines
         WHERE contract_id = $1 AND rental_asset_id IS NOT NULL
       )`,
      [id]
    );

    await logActivityWithClient(client, id, employeeId, "return", "Returned",
      { late_fee: lateFee, condition_notes: data.condition_notes || null });
    if (lateFee > 0) {
      await logActivityWithClient(client, id, employeeId, "late_fee_applied",
        `Late fee of ${lateFee} applied${lateFeeOverridden ? " (manual override)" : " (auto)"}`,
        { late_fee: lateFee, overridden: lateFeeOverridden });
    }
    await logActivityWithClient(client, id, employeeId, "status_change", "Status changed from checked_out to returned");
    return contract;
  });
}

async function completeContract(db, id, employeeId) {
  const { rows: [current] } = await db.query("SELECT * FROM rental_contracts WHERE id = $1", [id]);
  if (!current) return null;
  if (current.status !== "returned") {
    throw Object.assign(new Error(`Cannot complete contract in status '${current.status}'`), { statusCode: 400 });
  }
  const { rows: [contract] } = await db.query(
    "UPDATE rental_contracts SET status = 'completed', updated_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  await logActivity(db, id, employeeId, "status_change", "Status changed from returned to completed");
  return contract;
}

async function cancelContract(db, id, data, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [current] } = await client.query(
      "SELECT * FROM rental_contracts WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!current) return null;
    if (["invoiced", "cancelled", "completed"].includes(current.status)) {
      throw Object.assign(new Error(`Cannot cancel contract in status '${current.status}'`), { statusCode: 400 });
    }

    const { rows: [contract] } = await client.query(
      `UPDATE rental_contracts
         SET status = 'cancelled',
             cancellation_reason = $1,
             updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [data?.cancellation_reason || null, id]
    );

    // Release any linked assets
    await client.query(
      `UPDATE rental_assets SET status = 'available', updated_at = NOW()
       WHERE id IN (
         SELECT rental_asset_id FROM rental_contract_lines
         WHERE contract_id = $1 AND rental_asset_id IS NOT NULL
       )`,
      [id]
    );

    await logActivityWithClient(client, id, employeeId, "status_change",
      `Status changed from ${current.status} to cancelled${data?.cancellation_reason ? ": " + data.cancellation_reason : ""}`);
    return contract;
  });
}

// ── Invoice generation ────────────────────────────────────────────

async function generateInvoiceFromContract(db, id, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [contract] } = await client.query(
      "SELECT * FROM rental_contracts WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!contract) throw Object.assign(new Error("Contract not found"), { statusCode: 404 });
    if (contract.status !== "completed") {
      throw Object.assign(new Error("Only completed contracts can generate an invoice"), { statusCode: 400 });
    }

    const invoiceNumber = await generateInvoiceNumber(client);
    const totalAmount = Number(contract.final_total || 0);
    const deposit = Number(contract.deposit_collected || 0);
    const balanceDue = Math.max(0, totalAmount - deposit);

    const { rows: [invoice] } = await client.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, outlet_id, employee_id, status,
          subtotal, tax_total, discount_amount, total_amount, balance_due, notes)
       VALUES ($1, $2, $3, $4, 'sent', $5, 0, $6, $5, $7, $8) RETURNING *`,
      [
        invoiceNumber,
        contract.customer_id,
        contract.outlet_id,
        employeeId,
        totalAmount,
        Number(contract.discount_amount || 0),
        balanceDue,
        `Invoice for rental contract ${contract.contract_number}`,
      ]
    );

    // Build line items from contract lines
    const { rows: lines } = await client.query(
      `SELECT rcl.*, ri.name AS item_name
       FROM rental_contract_lines rcl
       JOIN rental_items ri ON ri.id = rcl.rental_item_id
       WHERE rcl.contract_id = $1`,
      [id]
    );
    for (const line of lines) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          invoice.id,
          `${line.item_name} (${line.rate_type}, ${line.duration_value})`,
          line.quantity,
          Number(line.rate_snapshot) * Number(line.duration_value),
          line.line_total,
        ]
      );
    }
    if (Number(contract.late_fee || 0) > 0) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, line_total)
         VALUES ($1, 'Late fee', 1, $2, $2)`,
        [invoice.id, Number(contract.late_fee)]
      );
    }

    await client.query(
      `UPDATE rental_contracts
         SET status = 'invoiced', invoice_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [invoice.id, id]
    );

    await logActivityWithClient(client, id, employeeId, "invoice_generated",
      `Invoice ${invoiceNumber} generated`,
      { invoice_id: invoice.id, invoice_number: invoiceNumber });
    await logActivityWithClient(client, id, employeeId, "status_change",
      "Status changed from completed to invoiced");

    return { contract_id: id, invoice };
  });
}

// ── Availability + timeline ───────────────────────────────────────

async function getItemAvailability(db, rentalItemId, from, to) {
  const { rows: [item] } = await db.query(
    "SELECT total_quantity FROM rental_items WHERE id = $1",
    [rentalItemId]
  );
  if (!item) return null;

  const { rows } = await db.query(
    `SELECT COALESCE(SUM(rcl.quantity), 0) AS booked_qty
     FROM rental_contracts rc
     JOIN rental_contract_lines rcl ON rcl.contract_id = rc.id
     WHERE rcl.rental_item_id = $1
       AND rc.status IN ('reserved','confirmed','checked_out')
       AND rc.rental_start < $3
       AND rc.expected_return > $2`,
    [rentalItemId, from, to]
  );
  const booked = Number(rows[0]?.booked_qty || 0);
  const total = Number(item.total_quantity || 0);
  return {
    rental_item_id: rentalItemId,
    total_quantity: total,
    booked_quantity: booked,
    available_quantity: Math.max(0, total - booked),
    from,
    to,
  };
}

async function getTimelineData(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "rc.status IN ('reserved','confirmed','checked_out','returned')";

  if (filters.outlet_id) { idx++; where += ` AND rc.outlet_id = $${idx}`; params.push(Number(filters.outlet_id)); }
  if (filters.from) { idx++; where += ` AND rc.expected_return >= $${idx}`; params.push(filters.from); }
  if (filters.to) { idx++; where += ` AND rc.rental_start <= $${idx}`; params.push(filters.to); }

  const { rows: items } = await db.query(
    `SELECT id, name, total_quantity FROM rental_items WHERE is_active = TRUE ORDER BY name ASC`
  );

  const { rows: bookings } = await db.query(
    `SELECT rc.id AS contract_id,
       rc.contract_number,
       rc.status,
       rc.rental_start,
       rc.expected_return,
       rc.actual_return,
       rcl.rental_item_id,
       rcl.rental_asset_id,
       rcl.quantity,
       c.name AS customer_name
     FROM rental_contracts rc
     JOIN rental_contract_lines rcl ON rcl.contract_id = rc.id
     LEFT JOIN customers c ON c.id = rc.customer_id
     WHERE ${where}
     ORDER BY rc.rental_start ASC`,
    params
  );

  return { items, bookings };
}

// ── Overdue (worker + dashboard) ──────────────────────────────────

async function getOverdueContracts(db) {
  const { rows } = await db.query(
    `SELECT rc.*, c.name AS customer_name, c.email AS customer_email,
       (SELECT string_agg(ri.name, ', ')
        FROM rental_contract_lines rcl
        JOIN rental_items ri ON ri.id = rcl.rental_item_id
        WHERE rcl.contract_id = rc.id) AS item_summary
     FROM rental_contracts rc
     LEFT JOIN customers c ON c.id = rc.customer_id
     WHERE rc.status = 'checked_out'
       AND rc.expected_return < NOW()
       AND (rc.overdue_email_sent_at IS NULL OR rc.overdue_email_sent_at < NOW() - INTERVAL '24 hours')`
  );
  return rows;
}

async function markOverdueEmailSent(db, contractId) {
  await db.query(
    "UPDATE rental_contracts SET overdue_email_sent_at = NOW() WHERE id = $1",
    [contractId]
  );
}

// ── Activity logging ──────────────────────────────────────────────

async function logActivity(db, contractId, actorId, activityType, description, metadata = {}) {
  await db.query(
    `INSERT INTO rental_contract_activities (contract_id, actor_id, activity_type, description, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [contractId, actorId, activityType, description, JSON.stringify(metadata)]
  );
}

async function logActivityWithClient(client, contractId, actorId, activityType, description, metadata = {}) {
  await client.query(
    `INSERT INTO rental_contract_activities (contract_id, actor_id, activity_type, description, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [contractId, actorId, activityType, description, JSON.stringify(metadata)]
  );
}

module.exports = {
  generateContractNumber,
  computeLateFee,
  // items
  listRentalItems,
  getRentalItem,
  createRentalItem,
  updateRentalItem,
  deleteRentalItem,
  // assets
  listRentalAssets,
  createRentalAsset,
  updateRentalAsset,
  // contracts
  listContracts,
  getContract,
  createContract,
  updateContract,
  // status transitions
  confirmContract,
  checkoutContract,
  returnContract,
  completeContract,
  cancelContract,
  // invoicing
  generateInvoiceFromContract,
  // availability + timeline
  getItemAvailability,
  getTimelineData,
  // overdue
  getOverdueContracts,
  markOverdueEmailSent,
  // activity
  logActivity,
};
