/**
 * Restaurant checks — seats, splits, coursing, tabs.
 * Checks are draft_orders with order_context != 'retail'.
 */

async function createRestaurantCheck(db, data, employeeId) {
  const { rows: [order] } = await db.query(
    `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, seat_count, dining_option, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open') RETURNING *`,
    [data.outlet_id, employeeId, data.order_context || "dine_in",
     data.table_id || null, data.table_session_id || null,
     data.tab_id || null, data.seat_count || 0,
     data.dining_option || null]
  );
  return order;
}

async function getOpenChecks(db, outletId, filters = {}) {
  const params = [outletId];
  let where = "d.outlet_id = $1 AND d.order_context != 'retail' AND d.status IN ('open','claimed')";
  let idx = 1;

  if (filters.table_session_id) {
    idx++; where += ` AND d.table_session_id = $${idx}`; params.push(filters.table_session_id);
  }
  if (filters.tab_id) {
    idx++; where += ` AND d.tab_id = $${idx}`; params.push(filters.tab_id);
  }

  const { rows } = await db.query(
    `SELECT d.*,
       rt.label AS table_label,
       e.name AS server_name,
       (SELECT COUNT(*)::int FROM draft_order_items di WHERE di.draft_order_id = d.id) AS item_count
     FROM draft_orders d
     LEFT JOIN restaurant_tables rt ON rt.id = d.table_id
     LEFT JOIN employees e ON e.id = d.created_by
     WHERE ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  return rows;
}

async function assignSeat(db, tableSessionId, draftOrderId, seatNumber, label) {
  const { rows: [seat] } = await db.query(
    `INSERT INTO restaurant_check_seats (table_session_id, draft_order_id, seat_number, label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (table_session_id, seat_number) DO UPDATE SET draft_order_id = $2, label = $4
     RETURNING *`,
    [tableSessionId, draftOrderId, seatNumber, label || null]
  );
  return seat;
}

async function splitCheckByItem(db, sourceDraftOrderId, itemAssignments, employeeId) {
  return await db.transaction(async (client) => {
    // Get source order
    const { rows: [source] } = await client.query(
      "SELECT * FROM draft_orders WHERE id = $1",
      [sourceDraftOrderId]
    );
    if (!source) throw Object.assign(new Error("Check not found"), { statusCode: 404 });

    // Group items by target
    const groups = {};
    for (const { item_id, target_check_index } of itemAssignments) {
      if (!groups[target_check_index]) groups[target_check_index] = [];
      groups[target_check_index].push(item_id);
    }

    const newChecks = [];
    for (const [, itemIds] of Object.entries(groups)) {
      // Create new draft order for split
      const { rows: [newOrder] } = await client.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING *`,
        [source.outlet_id, employeeId, source.order_context, source.table_id, source.table_session_id, source.tab_id]
      );

      // Move items
      for (const itemId of itemIds) {
        await client.query(
          "UPDATE draft_order_items SET draft_order_id = $1 WHERE id = $2 AND draft_order_id = $3",
          [newOrder.id, itemId, sourceDraftOrderId]
        );
      }

      // Recalculate new order totals
      await recalcCheckTotals(client, newOrder.id);
      const { rows: [updated] } = await client.query("SELECT * FROM draft_orders WHERE id = $1", [newOrder.id]);
      newChecks.push(updated);
    }

    // Recalculate source totals
    await recalcCheckTotals(client, sourceDraftOrderId);

    // Distribute adjustments proportionally
    await distributeAdjustments(client, sourceDraftOrderId, newChecks.map(c => c.id));

    return newChecks;
  });
}

async function splitCheckBySeat(db, sourceDraftOrderId, employeeId) {
  // Gather items and group by seat outside the transaction,
  // then delegate to splitCheckByItem which handles its own transaction.
  const { rows: items } = await db.query(
    "SELECT * FROM draft_order_items WHERE draft_order_id = $1",
    [sourceDraftOrderId]
  );

  // Group by seat
  const seatGroups = {};
  for (const item of items) {
    const seat = item.seat_number || 0;
    if (!seatGroups[seat]) seatGroups[seat] = [];
    seatGroups[seat].push(item);
  }

  const seats = Object.keys(seatGroups);
  if (seats.length < 2) throw Object.assign(new Error("Need items on at least 2 seats to split"), { statusCode: 400 });

  // Convert to item assignments format
  const assignments = [];
  let idx = 0;
  for (const seat of seats) {
    for (const item of seatGroups[seat]) {
      assignments.push({ item_id: item.id, target_check_index: idx });
    }
    idx++;
  }

  return splitCheckByItem(db, sourceDraftOrderId, assignments, employeeId);
}

async function fireCourse(db, draftOrderId, courseName, employeeId) {
  // Update or create course fire record
  const { rows: [existing] } = await db.query(
    "SELECT id FROM restaurant_course_fires WHERE draft_order_id = $1 AND course_name = $2",
    [draftOrderId, courseName]
  );

  if (existing) {
    const { rows: [fire] } = await db.query(
      `UPDATE restaurant_course_fires SET status = 'fired', fired_at = NOW(), fired_by = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [employeeId, existing.id]
    );
    return fire;
  }

  const { rows: [fire] } = await db.query(
    `INSERT INTO restaurant_course_fires (draft_order_id, course_name, status, fired_at, fired_by)
     VALUES ($1, $2, 'fired', NOW(), $3) RETURNING *`,
    [draftOrderId, courseName, employeeId]
  );
  return fire;
}

async function openTab(db, data, employeeId) {
  const { rows: [tab] } = await db.query(
    `INSERT INTO restaurant_tabs (outlet_id, customer_id, customer_name, opened_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.outlet_id, data.customer_id || null, data.customer_name || null, employeeId]
  );
  return tab;
}

async function closeTab(db, tabId) {
  // Check all checks on this tab are completed
  const { rows: openChecks } = await db.query(
    "SELECT id FROM draft_orders WHERE tab_id = $1 AND status IN ('open','claimed')",
    [tabId]
  );
  if (openChecks.length) throw Object.assign(new Error("Cannot close tab with open checks"), { statusCode: 400 });

  const { rows: [tab] } = await db.query(
    "UPDATE restaurant_tabs SET status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
    [tabId]
  );
  return tab;
}

// --- helpers ---

async function recalcCheckTotals(client, draftOrderId) {
  await client.query(`
    UPDATE draft_orders SET
      subtotal = COALESCE((SELECT SUM(price * quantity) FROM draft_order_items WHERE draft_order_id = $1), 0),
      discount_total = COALESCE((SELECT SUM(discount * quantity) FROM draft_order_items WHERE draft_order_id = $1), 0),
      tax_total = COALESCE((SELECT SUM(price * quantity * effective_tax_rate) FROM draft_order_items WHERE draft_order_id = $1), 0),
      total = COALESCE((SELECT SUM((price - discount) * quantity * (1 + effective_tax_rate)) FROM draft_order_items WHERE draft_order_id = $1), 0),
      updated_at = NOW()
    WHERE id = $1`,
    [draftOrderId]
  );
}

async function distributeAdjustments(client, sourceId, newCheckIds) {
  const { rows: adjustments } = await client.query(
    "SELECT * FROM restaurant_check_adjustments WHERE draft_order_id = $1",
    [sourceId]
  );
  if (!adjustments.length) return;

  // Get totals for proportional distribution
  const allIds = [sourceId, ...newCheckIds];
  const totals = {};
  let grandTotal = 0;
  for (const id of allIds) {
    const { rows: [{ total }] } = await client.query("SELECT total FROM draft_orders WHERE id = $1", [id]);
    totals[id] = Number(total);
    grandTotal += Number(total);
  }
  if (grandTotal === 0) return;

  for (const adj of adjustments) {
    for (const checkId of newCheckIds) {
      const proportion = totals[checkId] / grandTotal;
      const splitAmount = Math.round(Number(adj.amount) * proportion * 100) / 100;
      await client.query(
        `INSERT INTO restaurant_check_adjustments (draft_order_id, adjustment_type, label, amount, is_percentage, percentage_value)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [checkId, adj.adjustment_type, adj.label, splitAmount, adj.is_percentage, adj.percentage_value]
      );
    }
  }
}

module.exports = {
  createRestaurantCheck, getOpenChecks,
  assignSeat, splitCheckByItem, splitCheckBySeat,
  fireCourse, openTab, closeTab,
  recalcCheckTotals,
};
