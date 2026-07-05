/**
 * Restaurant checks — seats, splits, coursing, tabs.
 * Checks are draft_orders with order_context != 'retail'.
 */

const crypto = require("crypto");

// Contexts that need a QR public token. Retail/takeout/delivery don't need
// a public menu URL because the customer isn't sitting at a table scanning
// a code. See also routes/public-restaurant.js which looks up
// draft_orders by source_token_id.
const TOKEN_CONTEXTS = new Set(["dine_in", "bar"]);

function makeSourceToken(orderContext) {
  return TOKEN_CONTEXTS.has(orderContext) ? crypto.randomUUID() : null;
}

async function createRestaurantCheck(db, data, employeeId) {
  const orderContext = data.order_context || "dine_in";
  const sourceToken = makeSourceToken(orderContext);
  const { rows: [order] } = await db.query(
    `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, seat_count, dining_option, source_token_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open') RETURNING *`,
    [data.outlet_id, employeeId, orderContext,
     data.table_id || null, data.table_session_id || null,
     data.tab_id || null, data.seat_count || 0,
     data.dining_option || null, sourceToken]
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
      // Create new draft order for split. Each split child gets its own
      // fresh source_token_id — never inherit from the source, because
      // that would make one QR URL resolve to multiple checks after a
      // split (violates the partial UNIQUE index and confuses the
      // public menu lookup). Non-restaurant contexts still get NULL.
      const newSourceToken = makeSourceToken(source.order_context);
      const { rows: [newOrder] } = await client.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, source_token_id, status, split_parent_id, split_strategy)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, 'by_item') RETURNING *`,
        [source.outlet_id, employeeId, source.order_context, source.table_id, source.table_session_id, source.tab_id, newSourceToken, sourceDraftOrderId]
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

  const result = await splitCheckByItem(db, sourceDraftOrderId, assignments, employeeId);
  // Overwrite the strategy stamp set by splitCheckByItem so audit reflects
  // the real caller — UI and reports filter on split_strategy.
  await db.query(
    "UPDATE draft_orders SET split_strategy = 'by_seat' WHERE split_parent_id = $1",
    [sourceDraftOrderId]
  );
  return result;
}

/**
 * splitCheckByAmount — create N zero-item child checks and distribute the
 * source total evenly. Pennies modulo go to the last check. Adjustments are
 * copied proportionally. Items stay on the source (by design — this split
 * models "everyone pays an equal share of one shared bill" rather than moving
 * items around).
 *
 * recalcCheckTotals is intentionally skipped on the children — they have no
 * items, so SUM(price * quantity) would zero out the carefully-distributed
 * totals. Children carry their share purely as draft_orders.total.
 */
async function splitCheckByAmount(db, sourceDraftOrderId, parts, employeeId, strategyOverride) {
  if (!parts || parts < 2) {
    throw Object.assign(new Error("parts must be >= 2"), { statusCode: 400 });
  }
  return await db.transaction(async (client) => {
    const { rows: [source] } = await client.query(
      "SELECT * FROM draft_orders WHERE id = $1",
      [sourceDraftOrderId]
    );
    if (!source) throw Object.assign(new Error("Check not found"), { statusCode: 404 });

    const sourceTotal = Math.round(Number(source.total) * 100); // work in cents
    const baseShare = Math.floor(sourceTotal / parts);
    const remainder = sourceTotal - baseShare * parts;
    const strategy = strategyOverride || "by_amount";

    const newChecks = [];
    for (let i = 0; i < parts; i++) {
      const shareCents = i === parts - 1 ? baseShare + remainder : baseShare;
      const shareAmount = shareCents / 100;
      const newSourceToken = makeSourceToken(source.order_context);
      const { rows: [newOrder] } = await client.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, table_id, table_session_id, tab_id, source_token_id, status, split_parent_id, split_strategy, subtotal, tax_total, discount_total, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, 0, 0, 0, $10) RETURNING *`,
        [source.outlet_id, employeeId, source.order_context, source.table_id,
         source.table_session_id, source.tab_id, newSourceToken,
         sourceDraftOrderId, strategy, shareAmount]
      );
      newChecks.push(newOrder);
    }

    // Proportionally copy adjustments (share amount / source total).
    const { rows: adjustments } = await client.query(
      "SELECT * FROM restaurant_check_adjustments WHERE draft_order_id = $1",
      [sourceDraftOrderId]
    );
    if (adjustments.length && sourceTotal > 0) {
      for (const adj of adjustments) {
        for (const child of newChecks) {
          const proportion = Math.round(Number(child.total) * 100) / sourceTotal;
          const splitAmount = Math.round(Number(adj.amount) * proportion * 100) / 100;
          await client.query(
            `INSERT INTO restaurant_check_adjustments (draft_order_id, adjustment_type, label, amount, is_percentage, percentage_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [child.id, adj.adjustment_type, adj.label, splitAmount, adj.is_percentage, adj.percentage_value]
          );
        }
      }
    }

    return newChecks;
  });
}

// Even split is a by-amount split with parts = N; surfaces under a distinct
// strategy label so the UI can render "Evenly" separately from "By amount".
async function splitCheckEvenly(db, sourceDraftOrderId, parts, employeeId) {
  return splitCheckByAmount(db, sourceDraftOrderId, parts, employeeId, "evenly");
}

/**
 * mergeChecks — move items from N source checks onto a target, recalc target
 * totals, and close sources with status='merged'. Used when a split was wrong
 * or a table wants one unified bill after all.
 */
async function mergeChecks(db, targetId, sourceIds, employeeId) {
  if (!Array.isArray(sourceIds) || !sourceIds.length) {
    throw Object.assign(new Error("source_ids required"), { statusCode: 400 });
  }
  if (sourceIds.includes(targetId)) {
    throw Object.assign(new Error("Target cannot be in source list"), { statusCode: 400 });
  }
  return await db.transaction(async (client) => {
    const { rows: [target] } = await client.query(
      "SELECT * FROM draft_orders WHERE id = $1",
      [targetId]
    );
    if (!target) throw Object.assign(new Error("Target check not found"), { statusCode: 404 });

    for (const sourceId of sourceIds) {
      const { rows: [source] } = await client.query(
        "SELECT id FROM draft_orders WHERE id = $1",
        [sourceId]
      );
      if (!source) continue;
      await client.query(
        "UPDATE draft_order_items SET draft_order_id = $1 WHERE draft_order_id = $2",
        [targetId, sourceId]
      );
      await client.query(
        "UPDATE draft_orders SET status = 'merged', updated_at = NOW() WHERE id = $1",
        [sourceId]
      );
    }

    await recalcCheckTotals(client, targetId);
    const { rows: [updated] } = await client.query(
      "SELECT * FROM draft_orders WHERE id = $1",
      [targetId]
    );
    return updated;
  });
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

/**
 * holdCourse — upsert a course fire row with status='held' + hold_until. No
 * KDS tickets are created. The course-release worker sweeps `status='held'`
 * rows where `hold_until <= NOW()` and transitions them to `fired` via
 * releaseHeldCourses.
 */
async function holdCourse(db, draftOrderId, courseName, holdUntil, employeeId) {
  const { rows: [existing] } = await db.query(
    "SELECT id FROM restaurant_course_fires WHERE draft_order_id = $1 AND course_name = $2",
    [draftOrderId, courseName]
  );
  if (existing) {
    const { rows: [fire] } = await db.query(
      `UPDATE restaurant_course_fires
         SET status = 'held', hold_until = $1, fired_at = NULL, fired_by = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [holdUntil, employeeId, existing.id]
    );
    return fire;
  }
  const { rows: [fire] } = await db.query(
    `INSERT INTO restaurant_course_fires (draft_order_id, course_name, status, hold_until, fired_by)
     VALUES ($1, $2, 'held', $3, $4) RETURNING *`,
    [draftOrderId, courseName, holdUntil, employeeId]
  );
  return fire;
}

/**
 * expediteCourse — mark a course as urgent. Bumps priority on any open
 * kds_tickets for matching items so expedited tickets jump to the top of
 * the KDS (getTickets ORDER BY priority DESC). Upserts a course_fires row
 * with expedite=true so reporting can surface expedite frequency.
 */
async function expediteCourse(db, draftOrderId, courseName, employeeId) {
  return await db.transaction(async (client) => {
    const { rows: [existing] } = await client.query(
      "SELECT id FROM restaurant_course_fires WHERE draft_order_id = $1 AND course_name = $2",
      [draftOrderId, courseName]
    );
    let fire;
    if (existing) {
      const { rows } = await client.query(
        `UPDATE restaurant_course_fires
           SET expedite = TRUE, fired_by = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [employeeId, existing.id]
      );
      fire = rows[0];
    } else {
      const { rows } = await client.query(
        `INSERT INTO restaurant_course_fires (draft_order_id, course_name, status, expedite, fired_by)
         VALUES ($1, $2, 'fired', TRUE, $3) RETURNING *`,
        [draftOrderId, courseName, employeeId]
      );
      fire = rows[0];
    }
    // Raise priority on any open ticket for this draft_order + course.
    await client.query(
      `UPDATE kds_tickets
         SET priority = 100, updated_at = NOW()
       WHERE draft_order_id = $1 AND course_name = $2
         AND status IN ('new','in_progress')`,
      [draftOrderId, courseName]
    );
    return fire;
  });
}

/**
 * releaseHeldCourses — worker-facing sweep. For each outlet-scoped
 * status='held' row where hold_until has elapsed, transition to 'fired'
 * and fire the matching course items via sendToKitchen. Returns the
 * number of courses released.
 */
async function releaseHeldCourses(db, outletId) {
  const { sendToKitchen } = require("./restaurant-kds");

  // Find due courses. Scope by outlet if provided; otherwise sweep all.
  const params = [];
  let where = `cf.status = 'held' AND cf.hold_until IS NOT NULL AND cf.hold_until <= NOW()`;
  if (outletId) {
    params.push(outletId);
    where += ` AND d.outlet_id = $${params.length}`;
  }
  const { rows: due } = await db.query(
    `SELECT cf.id, cf.draft_order_id, cf.course_name
     FROM restaurant_course_fires cf
     JOIN draft_orders d ON d.id = cf.draft_order_id
     WHERE ${where}`,
    params
  );

  let released = 0;
  for (const row of due) {
    // Flip status to 'fired' BEFORE sendToKitchen so the KDS filter
    // (which skips items in held courses) doesn't skip this one.
    await db.query(
      `UPDATE restaurant_course_fires
         SET status = 'fired', fired_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    try {
      await sendToKitchen(db, row.draft_order_id);
      released++;
    } catch (err) {
      // Non-fatal: log and continue. A stale held row can be retried next
      // poll. We already stamped fired_at, so the worker won't re-attempt
      // this specific row — acceptable because kitchen tickets may have
      // already been created before the error, and a second attempt
      // would create duplicates.
      if (typeof console !== "undefined") {
        console.error(`[releaseHeldCourses] sendToKitchen failed for draft_order ${row.draft_order_id}:`, err.message);
      }
    }
  }
  return released;
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
      tax_total = COALESCE((SELECT SUM(price * quantity * effective_tax_rate / 100) FROM draft_order_items WHERE draft_order_id = $1), 0),
      total = COALESCE((SELECT SUM((price - discount) * quantity * (1 + effective_tax_rate / 100)) FROM draft_order_items WHERE draft_order_id = $1), 0),
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
  splitCheckByAmount, splitCheckEvenly, mergeChecks,
  fireCourse, holdCourse, expediteCourse, releaseHeldCourses,
  openTab, closeTab,
  recalcCheckTotals,
};
