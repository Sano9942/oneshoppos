"use strict";

/**
 * Rental lifecycle — items, assets, contracts, status transitions,
 * availability, overdue detection, and invoice generation.
 *
 * Mirrors patterns from services/service-tickets.js (status machine,
 * activity log, invoice generation) and services/customer-invoicing.js
 * (invoice numbering).
 */

const { generateInvoiceNumber, recomputeBalance } = require("./customer-invoicing");
const { resolveTaxForExplicitRate } = require("./tax-snapshot");
const contractsService = require("./contracts");
const depositEngine = require("./deposit-engine");

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

    // Tax mode for folio-tax snapshots (resolve-at-charge; NULL item.tax_id → 0)
    const { rows: [cp] } = await client.query("SELECT tax_mode FROM company_profile WHERE id = 1");
    const taxMode = cp?.tax_mode || "none";

    // Freeze rates + deposits at booking time (audit immutability)
    const lineRows = [];
    let rentalFeeTotal = 0;
    let depositTotal = 0;

    // Aggregate requested quantity per item so multiple lines for the same
    // item are validated against availability together (not line-by-line).
    const requestedByItem = new Map();
    for (const line of data.lines) {
      const k = Number(line.rental_item_id);
      requestedByItem.set(k, (requestedByItem.get(k) || 0) + Number(line.quantity || 1));
    }
    const availabilityChecked = new Set();

    for (const line of data.lines) {
      const { rows: [item] } = await client.query(
        "SELECT * FROM rental_items WHERE id = $1 FOR UPDATE",
        [line.rental_item_id]
      );
      if (!item) {
        throw Object.assign(new Error(`Rental item ${line.rental_item_id} not found`), { statusCode: 404 });
      }

      // ── Availability re-check INSIDE the FOR UPDATE lock ──────────────
      // This is the single point that prevents double-booking the last unit
      // (V09 harden). Because the rental_items row is locked for this txn,
      // concurrent contract creations for the same item serialize here: a
      // second transaction blocks until the first commits, then its count
      // below sees the first's freshly-'reserved' line. The online-booking
      // reserve path goes through this same fn, so it inherits the guard
      // (never a route-local availability check — [[feedback_parallel_paths]]).
      // Skipped when total_quantity is untracked (0) or the window is
      // open-ended — preserves pre-V09 unbounded behavior exactly.
      if (!availabilityChecked.has(item.id) && data.rental_start && data.expected_return) {
        const total = Number(item.total_quantity || 0);
        if (total > 0) {
          const { rows: [b] } = await client.query(
            `SELECT COALESCE(SUM(rcl.quantity), 0) AS booked_qty
               FROM rental_contracts rc
               JOIN rental_contract_lines rcl ON rcl.contract_id = rc.id
              WHERE rcl.rental_item_id = $1
                AND rc.status IN ('reserved','confirmed','checked_out')
                AND rc.rental_start < $3
                AND rc.expected_return > $2`,
            [item.id, data.rental_start, data.expected_return]
          );
          const booked = Number(b.booked_qty || 0);
          const requested = requestedByItem.get(Number(item.id)) || 0;
          if (booked + requested > total) {
            const available = Math.max(0, total - booked);
            throw Object.assign(
              new Error(`Insufficient availability for "${item.name}": ${available} of ${total} available for the selected dates (${requested} requested)`),
              { statusCode: 409 }
            );
          }
        }
        availabilityChecked.add(item.id);
      }

      // If a specific asset is named, it must belong to the item and be
      // available — blocks assigning a rented/maintenance/retired unit
      // (V09 maintenance: a service-due asset flagged 'maintenance' is refused).
      if (line.rental_asset_id) {
        const { rows: [asset] } = await client.query(
          "SELECT id, status, rental_item_id FROM rental_assets WHERE id = $1 FOR UPDATE",
          [line.rental_asset_id]
        );
        if (!asset || Number(asset.rental_item_id) !== Number(item.id)) {
          throw Object.assign(new Error(`Asset ${line.rental_asset_id} not found for item "${item.name}"`), { statusCode: 400 });
        }
        if (asset.status !== "available") {
          throw Object.assign(new Error(`Asset ${line.rental_asset_id} is '${asset.status}', not available`), { statusCode: 409 });
        }
      }

      const rate =
        line.rate_type === "hourly" ? Number(item.hourly_rate || 0) :
        line.rate_type === "weekly" ? Number(item.weekly_rate || 0) :
        Number(item.daily_rate || 0);
      const qty = line.quantity || 1;
      const lineTotal = computeLineTotal(rate, line.duration_value, qty);
      rentalFeeTotal += lineTotal;
      depositTotal += Number(item.deposit_amount || 0) * qty;

      // Folio-tax: snapshot the tax on this rental charge at booking time
      // (per-unit price × qty = line base). NULL item.tax_id → 0, mode 'none' → 0.
      const tax = await resolveTaxForExplicitRate(client, {
        taxId: item.tax_id,
        price: Number(rate) * Number(line.duration_value || 0),
        quantity: qty,
        taxMode,
      });

      lineRows.push({
        ...line,
        rate_snapshot: rate,
        line_total: lineTotal,
        deposit_snapshot: Number(item.deposit_amount || 0) * qty,
        tax_rate_at_charge: tax.rate,
        tax_amount_at_charge: tax.amount,
      });
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
            rate_type, rate_snapshot, duration_value, line_total, deposit_snapshot,
            tax_rate_at_charge, tax_amount_at_charge)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
          lr.tax_rate_at_charge || 0,
          lr.tax_amount_at_charge || 0,
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

    // V5: re-check physical availability at checkout. getItemAvailability's
    // overlap window filters on `expected_return > from`, so a unit still out on
    // an OVERDUE contract (expected_return already past) is invisible to it and
    // would be re-let. Count units currently checked out on OTHER contracts for
    // each line's item (any expected_return — overdue included) and block if
    // handing these out would oversubscribe the fleet.
    const { rows: coLines } = await client.query(
      `SELECT rental_item_id, SUM(quantity) AS qty
         FROM rental_contract_lines
        WHERE contract_id = $1 AND rental_item_id IS NOT NULL
        GROUP BY rental_item_id`,
      [id]
    );
    for (const line of coLines) {
      const { rows: [it] } = await client.query(
        "SELECT total_quantity, name FROM rental_items WHERE id = $1",
        [line.rental_item_id]
      );
      const total = Number(it?.total_quantity || 0);
      if (total <= 0) continue; // 0 = untracked fleet size; don't block
      const { rows: [out] } = await client.query(
        `SELECT COALESCE(SUM(rcl.quantity), 0) AS out_qty
           FROM rental_contracts rc
           JOIN rental_contract_lines rcl ON rcl.contract_id = rc.id
          WHERE rcl.rental_item_id = $1
            AND rc.status = 'checked_out'
            AND rc.id <> $2`,
        [line.rental_item_id, id]
      );
      const alreadyOut = Number(out.out_qty || 0);
      const need = Number(line.qty || 0);
      if (alreadyOut + need > total) {
        throw Object.assign(
          new Error(`Cannot check out: ${it?.name || "item"} is still out on another rental (${alreadyOut}/${total} out, ${need} requested). Return the overdue unit first.`),
          { statusCode: 409, code: "rental_unavailable" }
        );
      }
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

    // Car-legal: capture odometer/fuel readings per line at checkout.
    await applyLineReadings(client, id, data.checkout_readings, "checkout_reading");

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

    // Car-legal: capture return odometer/fuel readings per line.
    await applyLineReadings(client, id, data.return_readings, "return_reading");

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

    // Rental lines carry the per-line tax snapshot frozen at booking (V09
    // folio-tax). Late fee + damage are penalty charges — untaxed by design.
    const { rows: lines } = await client.query(
      `SELECT rcl.*, ri.name AS item_name
       FROM rental_contract_lines rcl
       JOIN rental_items ri ON ri.id = rcl.rental_item_id
       WHERE rcl.contract_id = $1`,
      [id]
    );

    // Damage charges captured at return inspection → an invoice LINE (never
    // netted against the deposit twice — the captured deposit posts as a
    // PAYMENT that reduces balance_due below; the damage sits on the invoice).
    const { rows: [dmg] } = await client.query(
      `SELECT COALESCE(SUM(damage_charge), 0) AS total
         FROM rental_inspections
        WHERE rental_contract_id = $1 AND phase = 'return' AND damage_charge IS NOT NULL`,
      [id]
    );
    const damageTotal = Number(dmg.total || 0);

    // Tax = Σ per-line snapshot. Grand-total math respects the tenant's mode:
    // inclusive → tax already inside final_total; exclusive → tax adds on top.
    const taxTotal = lines.reduce((s, l) => s + Number(l.tax_amount_at_charge || 0), 0);
    const { rows: [cp] } = await client.query("SELECT tax_mode FROM company_profile WHERE id = 1");
    const inclusive = cp?.tax_mode === "inclusive";

    // final_total already = rental_fee_total + late_fee - discount. Damage adds on top.
    const baseTotal = Number(contract.final_total || 0) + damageTotal;
    const subtotal = inclusive ? Math.max(0, baseTotal - taxTotal) : baseTotal;
    const grandTotal = inclusive ? baseTotal : baseTotal + taxTotal;

    // Manual deposit (cash/card at counter) + any captured gateway hold both
    // count as money already collected against the rental (F04). V4 fix: the
    // invoice books the FULL grand total with balance_due = grandTotal, then the
    // deposit is posted as an actual customer_invoice_payments row below and
    // recomputeBalance derives amount_paid/balance_due/status. The old path
    // netted the deposit straight into balance_due while amount_paid stayed 0,
    // so amount_paid + balance_due ≠ total_amount and no payment was recorded.
    const deposit = Number(contract.deposit_collected || 0) + Number(contract.deposit_captured_amount || 0);
    const balanceDue = grandTotal;

    const { rows: [invoice] } = await client.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, outlet_id, employee_id, status,
          subtotal, tax_total, discount_amount, total_amount, balance_due, notes)
       VALUES ($1, $2, $3, $4, 'sent', $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        invoiceNumber,
        contract.customer_id,
        contract.outlet_id,
        employeeId,
        subtotal,
        taxTotal,
        Number(contract.discount_amount || 0),
        grandTotal,
        balanceDue,
        `Invoice for rental contract ${contract.contract_number}`,
      ]
    );

    for (const line of lines) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          invoice.id,
          `${line.item_name} (${line.rate_type}, ${line.duration_value})`,
          line.quantity,
          Number(line.rate_snapshot) * Number(line.duration_value),
          Number(line.tax_rate_at_charge || 0),
          line.line_total,
        ]
      );
    }
    if (Number(contract.late_fee || 0) > 0) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, 'Late fee', 1, $2, 0, $2)`,
        [invoice.id, Number(contract.late_fee)]
      );
    }
    if (damageTotal > 0) {
      await client.query(
        `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, 'Damage charge', 1, $2, 0, $2)`,
        [invoice.id, damageTotal]
      );
    }

    // Post the collected deposit as a payment against the invoice, then let
    // recomputeBalance set amount_paid + balance_due + status coherently.
    if (deposit > 0) {
      await client.query(
        `INSERT INTO customer_invoice_payments
           (invoice_id, amount, payment_method, payment_type, notes, recorded_by)
         VALUES ($1, $2, $3, 'payment', $4, $5)`,
        [invoice.id, deposit, contract.deposit_method || "cash", "Rental deposit", employeeId]
      );
      const rb = await recomputeBalance(client, invoice.id);
      if (rb) {
        invoice.amount_paid = rb.amount_paid;
        invoice.balance_due = rb.balance_due;
        invoice.status = rb.status;
      }
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

// ── V09: line readings helper ─────────────────────────────────────
// readings: [{ line_id, odometer, fuel_pct }] → stamps checkout_reading /
// return_reading JSONB on the matching contract line.
async function applyLineReadings(client, contractId, readings, column) {
  if (!Array.isArray(readings)) return;
  for (const r of readings) {
    if (!r || !r.line_id) continue;
    await client.query(
      `UPDATE rental_contract_lines SET ${column} = $1 WHERE id = $2 AND contract_id = $3`,
      [JSON.stringify({ odometer: r.odometer ?? null, fuel_pct: r.fuel_pct ?? null }), r.line_id, contractId]
    );
  }
}

// ── V09: driver records (car-legal, PII — staff-only surfaces) ─────

async function listDrivers(db, contractId) {
  const { rows } = await db.query(
    "SELECT * FROM rental_contract_drivers WHERE rental_contract_id = $1 ORDER BY is_primary DESC, id ASC",
    [contractId]
  );
  return rows;
}

async function addDriver(db, contractId, data, employeeId) {
  // Reject an expired licence up front — a car cannot legally leave on it.
  if (data.license_expiry && new Date(data.license_expiry) < new Date(new Date().toDateString())) {
    throw Object.assign(new Error("Driver licence has expired"), { statusCode: 400 });
  }
  const { rows: [driver] } = await db.query(
    `INSERT INTO rental_contract_drivers
       (rental_contract_id, name, cnic, license_number, license_expiry, phone, document_photos, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      contractId, data.name, data.cnic || null, data.license_number || null,
      data.license_expiry || null, data.phone || null,
      JSON.stringify(data.document_photos || []), data.is_primary !== false,
    ]
  );
  await logActivity(db, contractId, employeeId, "note", `Driver recorded: ${data.name}`);
  return driver;
}

// ── V09: e-sign rental agreement (reuses services/contracts.js) ────

function buildAgreementHtml(contract, drivers, lines) {
  const driver = drivers.find((d) => d.is_primary) || drivers[0] || {};
  const itemRows = lines
    .map((l) => `<tr><td>${l.item_name || ""}</td><td>${l.rate_type} × ${l.duration_value}</td><td>${l.line_total}</td></tr>`)
    .join("");
  return `
    <h2>Rental Agreement — ${contract.contract_number}</h2>
    <p><strong>Renter/Driver:</strong> ${driver.name || "-"} · CNIC ${driver.cnic || "-"} · Licence ${driver.license_number || "-"}</p>
    <p><strong>Period:</strong> ${contract.rental_start} → ${contract.expected_return}</p>
    <table border="1" cellpadding="4"><thead><tr><th>Item</th><th>Rate</th><th>Total</th></tr></thead><tbody>${itemRows}</tbody></table>
    <p><strong>Deposit:</strong> ${contract.deposit_collected || 0}</p>
    <p>The renter acknowledges the vehicle/equipment condition recorded at checkout and accepts liability for damage, overage, and late-return charges per this agreement.</p>
  `;
}

async function createRentalAgreement(db, contractId, employeeId) {
  const { rows: [contract] } = await db.query("SELECT * FROM rental_contracts WHERE id = $1", [contractId]);
  if (!contract) throw Object.assign(new Error("Contract not found"), { statusCode: 404 });
  const drivers = await listDrivers(db, contractId);
  const { rows: lines } = await db.query(
    `SELECT rcl.*, ri.name AS item_name FROM rental_contract_lines rcl
       JOIN rental_items ri ON ri.id = rcl.rental_item_id WHERE rcl.contract_id = $1`,
    [contractId]
  );
  const signerName = (drivers.find((d) => d.is_primary) || drivers[0] || {}).name || "Renter";
  const doc = await contractsService.createContract(db, {
    customer_id: contract.customer_id,
    title: `Rental Agreement ${contract.contract_number}`,
    body_html: buildAgreementHtml(contract, drivers, lines),
    signers: [{ name: signerName, role: "renter" }],
  }, employeeId);
  await db.query(
    "UPDATE rental_contracts SET contract_document_id = $1, updated_at = NOW() WHERE id = $2",
    [doc.id, contractId]
  );
  await contractsService.sendContract(db, doc.id).catch(() => {}); // draft → sent (non-fatal)
  await logActivity(db, contractId, employeeId, "note", `E-sign agreement generated (doc #${doc.id})`);
  const { rows: [signer] } = await db.query(
    "SELECT id FROM contract_signers WHERE contract_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT 1",
    [doc.id]
  );
  return { document_id: doc.id, signer_id: signer?.id || null, body_html: doc.body_html };
}

async function signRentalAgreement(db, contractId, signatureData, ipAddress) {
  const { rows: [contract] } = await db.query(
    "SELECT contract_document_id FROM rental_contracts WHERE id = $1", [contractId]
  );
  if (!contract?.contract_document_id) {
    throw Object.assign(new Error("No agreement generated for this contract"), { statusCode: 400 });
  }
  const { rows: [signer] } = await db.query(
    "SELECT id FROM contract_signers WHERE contract_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT 1",
    [contract.contract_document_id]
  );
  if (!signer) throw Object.assign(new Error("Agreement already signed"), { statusCode: 400 });
  return contractsService.signContract(db, contract.contract_document_id, signer.id, signatureData, ipAddress);
}

// ── V09: condition inspections (→ damage charge → deposit capture) ─

async function listInspections(db, contractId) {
  const { rows } = await db.query(
    "SELECT * FROM rental_inspections WHERE rental_contract_id = $1 ORDER BY created_at ASC",
    [contractId]
  );
  return rows;
}

async function createInspection(db, contractId, data, employeeId) {
  const { rows: [contract] } = await db.query(
    "SELECT id, deposit_status FROM rental_contracts WHERE id = $1", [contractId]
  );
  if (!contract) throw Object.assign(new Error("Contract not found"), { statusCode: 404 });
  const phase = data.phase;
  if (!["checkout", "return"].includes(phase)) {
    throw Object.assign(new Error("Inspection phase must be 'checkout' or 'return'"), { statusCode: 400 });
  }
  const damageCharge = data.damage_charge != null ? Number(data.damage_charge) : null;

  const { rows: [inspection] } = await db.query(
    `INSERT INTO rental_inspections
       (rental_contract_id, rental_asset_id, phase, checklist, photos,
        damage_notes, damage_charge, inspected_by, customer_ack_signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      contractId, data.rental_asset_id || null, phase,
      JSON.stringify(data.checklist || {}), JSON.stringify(data.photos || []),
      data.damage_notes || null, damageCharge, employeeId,
      data.customer_ack_signature || null,
    ]
  );
  await logActivity(db, contractId, employeeId, "note",
    `${phase === "checkout" ? "Checkout" : "Return"} inspection recorded${damageCharge ? ` (damage ${damageCharge})` : ""}`);

  // On a return inspection with damage, capture exactly the damage from the
  // pre-authorized deposit hold and release the remainder (F04). No-ops for
  // manual (cash) deposits — capture() skips unless status='authorized'.
  let depositResult = null;
  if (phase === "return" && damageCharge && damageCharge > 0) {
    depositResult = await depositEngine.capture(db, {
      entityType: "rental_contract", entityId: contractId, amount: damageCharge,
    });
  }
  return { inspection, deposit: depositResult };
}

// ── V09: maintenance scheduling ───────────────────────────────────

async function logMaintenance(db, assetId, data, employeeId) {
  return db.transaction(async (client) => {
    const { rows: [asset] } = await client.query(
      "SELECT * FROM rental_assets WHERE id = $1 FOR UPDATE", [assetId]
    );
    if (!asset) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });

    const servicedAt = data.serviced_at ? new Date(data.serviced_at) : new Date();
    const { rows: [log] } = await client.query(
      `INSERT INTO asset_maintenance_log (rental_asset_id, serviced_at, odometer, cost, notes, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [assetId, servicedAt, data.odometer ?? null, data.cost ?? null, data.notes || null, employeeId]
    );

    // Reset the service clock: next due = serviced_at + interval; clear the
    // 'maintenance' flag back to 'available' if it was parked for service.
    const nextDue = asset.service_interval_days
      ? new Date(servicedAt.getTime() + Number(asset.service_interval_days) * 86400000)
      : null;
    await client.query(
      `UPDATE rental_assets
         SET last_serviced_at = $1,
             last_serviced_odometer = COALESCE($2, last_serviced_odometer),
             service_due_at = $3,
             status = CASE WHEN status = 'maintenance' THEN 'available' ELSE status END,
             updated_at = NOW()
       WHERE id = $4`,
      [servicedAt, data.odometer ?? null, nextDue, assetId]
    );
    return log;
  });
}

// Assets due for service (time-based). Used by the dashboard + worker.
async function getDueAssets(db) {
  const { rows } = await db.query(
    `SELECT a.*, ri.name AS item_name
       FROM rental_assets a JOIN rental_items ri ON ri.id = a.rental_item_id
      WHERE a.status <> 'retired'
        AND a.service_due_at IS NOT NULL
        AND a.service_due_at <= NOW()
      ORDER BY a.service_due_at ASC`
  );
  return rows;
}

// Worker helper: park time-due available assets into 'maintenance' so they
// can't be booked until serviced. Returns the count flagged.
async function flagDueAssetsForMaintenance(db) {
  const { rowCount } = await db.query(
    `UPDATE rental_assets
        SET status = 'maintenance', updated_at = NOW()
      WHERE status = 'available'
        AND service_due_at IS NOT NULL
        AND service_due_at <= NOW()`
  );
  return rowCount;
}

// ── V09: delivery & setup scheduling (furniture/party) ────────────

async function updateDelivery(db, contractId, data, employeeId) {
  const sets = [];
  const params = [];
  let idx = 0;
  for (const key of ["delivery_required", "delivery_at", "setup_notes", "delivery_status"]) {
    if (data[key] !== undefined) { idx++; sets.push(`${key} = $${idx}`); params.push(data[key]); }
  }
  if (data.delivery_crew !== undefined) {
    idx++; sets.push(`delivery_crew = $${idx}`); params.push(JSON.stringify(data.delivery_crew || []));
  }
  if (!sets.length) return null;
  sets.push("updated_at = NOW()");
  idx++; params.push(contractId);
  const { rows: [contract] } = await db.query(
    `UPDATE rental_contracts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, params
  );
  await logActivity(db, contractId, employeeId, "note", "Delivery details updated");
  return contract;
}

// Day-view: contracts with a delivery scheduled on a given date (or window).
async function getDeliveries(db, filters = {}) {
  const params = [];
  let idx = 0;
  let where = "rc.delivery_required = TRUE AND rc.delivery_at IS NOT NULL";
  if (filters.date) {
    // delivery_at is TIMESTAMPTZ and the date is a tenant-local day — use
    // UTC bounds (a bare ::date cast evaluates in the DB session timezone).
    const { toUtcStart, toUtcEnd } = require("../utils/tz");
    let tz = "UTC";
    try {
      const { rows: [prof] } = await db.query(
        "SELECT timezone FROM company_profile WHERE id = 1"
      );
      if (prof?.timezone) tz = prof.timezone;
    } catch { /* fall back to UTC */ }
    idx++; where += ` AND rc.delivery_at >= $${idx}`; params.push(toUtcStart(String(filters.date), tz));
    idx++; where += ` AND rc.delivery_at < $${idx}`; params.push(toUtcEnd(String(filters.date), tz));
  }
  if (filters.from) { idx++; where += ` AND rc.delivery_at >= $${idx}`; params.push(filters.from); }
  if (filters.to) { idx++; where += ` AND rc.delivery_at <= $${idx}`; params.push(filters.to); }
  const { rows } = await db.query(
    `SELECT rc.id, rc.contract_number, rc.status, rc.delivery_at, rc.delivery_status,
            rc.setup_notes, rc.delivery_crew, c.name AS customer_name, c.mobile AS customer_mobile
       FROM rental_contracts rc
       LEFT JOIN customers c ON c.id = rc.customer_id
      WHERE ${where}
      ORDER BY rc.delivery_at ASC`,
    params
  );
  return rows;
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
  // V09 — drivers / e-sign / inspections / maintenance / delivery
  listDrivers,
  addDriver,
  createRentalAgreement,
  signRentalAgreement,
  listInspections,
  createInspection,
  logMaintenance,
  getDueAssets,
  flagDueAssetsForMaintenance,
  updateDelivery,
  getDeliveries,
};
