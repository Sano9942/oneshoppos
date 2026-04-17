/**
 * Phase 2.1 C — tips service.
 *
 * Two halves:
 *   C1 — captureTipOnSale / listTipsForShift: per-sale tip ledger + lookup.
 *   C2 — openTipPool / closeTipPool / distributeTipPool / voidTipPool:
 *        end-of-shift pool, distribution by configurable strategy, and
 *        commission_earnings bridge so payroll has a single source of truth.
 *
 * tip_captures.pool_id is the join between halves: open captures (NULL) get
 * stamped when the pool closes. distributeTipPool turns a closed pool into
 * tip_pool_payouts + commission_earnings rows (earning_type='tip').
 */

/**
 * Capture a tip from a freshly committed sale, attributing it to the server
 * who owned the table session (if this is a restaurant check). Idempotent
 * on (sale_id) — we don't capture a sale twice even if the caller retries.
 *
 * Inputs (all required):
 *   db            — tenant-scoped pg proxy or client
 *   sale_id       — the sale row this tip belongs to
 *   draft_order_id— optional; the restaurant check the sale was committed from
 *   tip_amount    — > 0 to record, <= 0 is a no-op
 *   tip_method    — 'cash' | 'card' | 'split' (matches CHECK constraint)
 *
 * Returns the inserted row, or null if no row was written.
 */
async function captureTipOnSale(db, { sale_id, draft_order_id, tip_amount, tip_method }) {
  const amount = Number(tip_amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!sale_id) throw new Error("sale_id required");
  if (!tip_method) throw new Error("tip_method required");

  // Idempotency: skip if we already captured this sale's tip.
  const { rows: existing } = await db.query(
    "SELECT id FROM tip_captures WHERE sale_id = $1 LIMIT 1",
    [sale_id]
  );
  if (existing.length) return null;

  // Pull server_id + outlet_id from the sale's draft order → table session.
  // If the sale isn't tied to a restaurant check (retail/online/etc.), we
  // still capture the tip but server_id stays NULL. The pool can pick it
  // up by outlet anyway.
  let serverId = null;
  let outletId = null;
  if (draft_order_id) {
    const { rows } = await db.query(
      `SELECT do_.outlet_id, ts.server_id
         FROM draft_orders do_
         LEFT JOIN restaurant_table_sessions ts ON ts.id = do_.table_session_id
        WHERE do_.id = $1`,
      [draft_order_id]
    );
    if (rows[0]) {
      outletId = rows[0].outlet_id || null;
      serverId = rows[0].server_id || null;
    }
  }
  if (!outletId) {
    const { rows } = await db.query("SELECT outlet_id FROM sales WHERE id = $1", [sale_id]);
    outletId = rows[0]?.outlet_id || null;
  }

  const { rows: inserted } = await db.query(
    `INSERT INTO tip_captures (sale_id, draft_order_id, outlet_id, server_id, tip_amount, tip_method)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [sale_id, draft_order_id || null, outletId, serverId, amount, tip_method]
  );
  return inserted[0];
}

/**
 * List tip captures for a shift. Joins through sales → shifts to filter by
 * shift_id, so this honors void/refund flow (cascading sale deletes drop
 * the tip_capture too).
 */
async function listTipsForShift(db, shiftId) {
  if (!shiftId) throw new Error("shiftId required");
  const { rows } = await db.query(
    `SELECT tc.*, s.invoice_number, s.timestamp AS sale_timestamp, e.name AS server_name
       FROM tip_captures tc
       JOIN sales s ON s.id = tc.sale_id
       LEFT JOIN employees e ON e.id = tc.server_id
      WHERE s.shift_id = $1
      ORDER BY tc.created_at DESC`,
    [shiftId]
  );
  return rows;
}

// ── C2 — Tip pools ──────────────────────────────────────────────────────────

/**
 * Open today's pool for an outlet, or return the already-open one. Idempotent:
 * if a pool with status='open' already exists for (outlet_id, business_date),
 * return it instead of inserting.
 */
async function openTipPool(db, outletId, businessDate) {
  if (!outletId) throw new Error("outletId required");
  if (!businessDate) throw new Error("businessDate required");

  const { rows: existing } = await db.query(
    `SELECT * FROM tip_pools
      WHERE outlet_id = $1 AND business_date = $2 AND status = 'open'
      ORDER BY id ASC
      LIMIT 1`,
    [outletId, businessDate]
  );
  if (existing.length) return existing[0];

  const { rows: inserted } = await db.query(
    `INSERT INTO tip_pools (outlet_id, business_date, status, total_tips)
     VALUES ($1, $2, 'open', 0)
     RETURNING *`,
    [outletId, businessDate]
  );
  return inserted[0];
}

/**
 * Close the pool: stamp every unassigned tip_capture for this outlet+date
 * with pool_id, sum them into total_tips, flip status to 'closed'. The
 * pool is now ready for distribution. closed_by audits who did it.
 */
async function closeTipPool(db, poolId, employeeId) {
  if (!poolId) throw new Error("poolId required");

  return db.transaction(async (client) => {
    // Re-fetch with to_char so the date is a string immune to JS-side TZ
    // round-tripping (pg DATE → JS Date is lossy in the test harness).
    const { rows: poolRows } = await client.query(
      `SELECT *, to_char(business_date, 'YYYY-MM-DD') AS business_date_str
         FROM tip_pools WHERE id = $1 FOR UPDATE`,
      [poolId]
    );
    const pool = poolRows[0];
    if (!pool) throw Object.assign(new Error("Pool not found"), { statusCode: 404 });
    if (pool.status !== "open") {
      throw Object.assign(
        new Error(`Cannot close pool from status '${pool.status}'`),
        { statusCode: 400 }
      );
    }

    // Stamp pool_id on every capture for this outlet+business_date that
    // hasn't been assigned to any pool. Filter by sale.timestamp::date so
    // we capture sales that happened on the business day, not whenever the
    // capture row was inserted (clock skew is rare but possible).
    await client.query(
      `UPDATE tip_captures tc
          SET pool_id = $1
         FROM sales s
        WHERE tc.sale_id = s.id
          AND tc.pool_id IS NULL
          AND tc.outlet_id = $2
          AND s.timestamp::date = $3::date`,
      [poolId, pool.outlet_id, pool.business_date_str]
    );

    const { rows: totalRows } = await client.query(
      `SELECT COALESCE(SUM(tip_amount), 0)::numeric AS total
         FROM tip_captures WHERE pool_id = $1`,
      [poolId]
    );
    const total = Number(totalRows[0].total);

    const { rows: updated } = await client.query(
      `UPDATE tip_pools
          SET total_tips = $1, status = 'closed', closed_at = NOW(), closed_by = $2
        WHERE id = $3
        RETURNING *`,
      [total, employeeId || null, poolId]
    );
    return updated[0];
  });
}

/**
 * Distribute a closed pool using a rule. Strategy controls how each eligible
 * employee's weight is computed; weights then split total_tips proportionally.
 * Pennies (rounding remainder) go to whoever worked the most hours so the
 * sum-of-payouts == total_tips exactly.
 *
 * Each payout creates a commission_earnings row (earning_type='tip',
 * sale_id=NULL) so payroll reads tips and commissions from one table.
 */
async function distributeTipPool(db, poolId, ruleId) {
  if (!poolId) throw new Error("poolId required");

  return db.transaction(async (client) => {
    const { rows: poolRows } = await client.query(
      `SELECT *, to_char(business_date, 'YYYY-MM-DD') AS business_date_str
         FROM tip_pools WHERE id = $1 FOR UPDATE`,
      [poolId]
    );
    const pool = poolRows[0];
    if (!pool) throw Object.assign(new Error("Pool not found"), { statusCode: 404 });
    if (pool.status !== "closed") {
      throw Object.assign(
        new Error(`Cannot distribute pool from status '${pool.status}'`),
        { statusCode: 400 }
      );
    }
    const total = Number(pool.total_tips);
    if (total <= 0) {
      // Nothing to distribute — flip status anyway so the pool is settled.
      const { rows: updated } = await client.query(
        `UPDATE tip_pools SET status = 'distributed', distribution_rule_id = $1
          WHERE id = $2 RETURNING *`,
        [ruleId || null, poolId]
      );
      return { pool: updated[0], payouts: [] };
    }

    // Resolve the rule. If no ruleId given, fall back to the outlet default.
    let rule = null;
    if (ruleId) {
      const { rows } = await client.query(
        `SELECT * FROM tip_pool_distribution_rules WHERE id = $1 AND is_active = TRUE`,
        [ruleId]
      );
      rule = rows[0];
    }
    if (!rule) {
      const { rows } = await client.query(
        `SELECT * FROM tip_pool_distribution_rules
          WHERE outlet_id = $1 AND is_default = TRUE AND is_active = TRUE
          ORDER BY id ASC LIMIT 1`,
        [pool.outlet_id]
      );
      rule = rows[0];
    }
    if (!rule) {
      throw Object.assign(
        new Error("No active distribution rule for outlet (set is_default or pass ruleId)"),
        { statusCode: 400 }
      );
    }

    // Find employees on the clock during the business_date for this outlet.
    // We measure hours via attendance_sessions overlap, not absolute spans —
    // so a sign-out at 02:00 the next morning still counts toward the day.
    // Use the to_char string so we don't fight TZ semantics on pg DATE.
    const businessDateStr = pool.business_date_str;
    const dayStart = new Date(`${businessDateStr}T00:00:00Z`);
    const dayEnd = new Date(`${businessDateStr}T23:59:59.999Z`);
    const { rows: workers } = await client.query(
      `SELECT employee_id,
              COALESCE(SUM(EXTRACT(EPOCH FROM (
                LEAST(COALESCE(session_end, NOW()), $3::timestamptz)
                - GREATEST(session_start, $2::timestamptz)
              )) / 3600.0), 0) AS hours
         FROM attendance_sessions
        WHERE outlet_id = $1
          AND session_type = 'work'
          AND session_start < $3::timestamptz
          AND COALESCE(session_end, NOW()) > $2::timestamptz
        GROUP BY employee_id
        HAVING COALESCE(SUM(EXTRACT(EPOCH FROM (
                 LEAST(COALESCE(session_end, NOW()), $3::timestamptz)
                 - GREATEST(session_start, $2::timestamptz)
               )) / 3600.0), 0) > 0`,
      [pool.outlet_id, dayStart.toISOString(), dayEnd.toISOString()]
    );

    if (!workers.length) {
      throw Object.assign(
        new Error("No employees worked this business_date — cannot distribute"),
        { statusCode: 400 }
      );
    }

    // Compute per-employee weight from the strategy.
    const config = rule.config_jsonb || {};
    const computed = workers.map((w) => {
      const hours = Number(w.hours);
      let weight;
      switch (rule.strategy) {
        case "equal_share":
          weight = 1;
          break;
        case "hours_weighted":
          weight = hours;
          break;
        case "role_weighted": {
          // config.role_weights = { server: 1.0, busser: 0.5, ... }; we don't
          // know the role here in attendance_sessions, so fetch employees.
          // (Resolved below in a second pass for efficiency.)
          weight = hours;
          break;
        }
        case "points":
          // config.points = { [employee_id]: number }
          weight = Number(config.points?.[w.employee_id] || 0);
          break;
        default:
          weight = hours;
      }
      return { employee_id: w.employee_id, hours, weight };
    });

    if (rule.strategy === "role_weighted") {
      // Look up role names per employee, multiply weight by role_weights.
      const ids = computed.map((c) => c.employee_id);
      const { rows: roleRows } = await client.query(
        `SELECT e.id, r.name AS role_name
           FROM employees e
           LEFT JOIN roles r ON r.id = e.role_id
          WHERE e.id = ANY($1::int[])`,
        [ids]
      );
      const roleMap = new Map(roleRows.map((r) => [r.id, r.role_name]));
      const weights = config.role_weights || {};
      computed.forEach((c) => {
        const roleName = roleMap.get(c.employee_id);
        const mult = roleName ? Number(weights[roleName] ?? 1) : 1;
        c.weight = c.hours * mult;
      });
    }

    const totalWeight = computed.reduce((s, c) => s + c.weight, 0);
    if (totalWeight <= 0) {
      throw Object.assign(
        new Error("Total weight is zero — strategy or config produced no eligible weight"),
        { statusCode: 400 }
      );
    }

    // Round each payout to 2 decimals; remainder goes to the longest-hours
    // employee so totals reconcile to the cent.
    const totalCents = Math.round(total * 100);
    let assigned = 0;
    const payouts = computed.map((c) => {
      const share = (c.weight / totalWeight) * totalCents;
      const cents = Math.floor(share);
      assigned += cents;
      return { ...c, payout_cents: cents };
    });
    const remainder = totalCents - assigned;
    if (remainder !== 0 && payouts.length) {
      // Pennies go to the employee with the most hours (stable tie-break by
      // employee_id ascending — picking the first match is deterministic).
      const longest = [...payouts].sort((a, b) => {
        if (b.hours !== a.hours) return b.hours - a.hours;
        return a.employee_id - b.employee_id;
      })[0];
      const target = payouts.find((p) => p.employee_id === longest.employee_id);
      target.payout_cents += remainder;
    }

    // Insert payout + commission_earnings row per employee.
    const inserted = [];
    for (const p of payouts) {
      const payoutAmount = p.payout_cents / 100;
      const { rows: ce } = await client.query(
        `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, sale_amount, commission_amount, status, earning_type)
         VALUES ($1, NULL, NULL, 0, $2, 'pending', 'tip')
         RETURNING id`,
        [p.employee_id, payoutAmount]
      );
      const commissionEarningId = ce[0].id;

      const { rows: payoutRow } = await client.query(
        `INSERT INTO tip_pool_payouts
           (pool_id, employee_id, hours_worked, weight, payout_amount, commission_earning_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [poolId, p.employee_id, p.hours, p.weight, payoutAmount, commissionEarningId]
      );
      inserted.push(payoutRow[0]);
    }

    const { rows: updatedPool } = await client.query(
      `UPDATE tip_pools
          SET status = 'distributed', distribution_rule_id = $1
        WHERE id = $2 RETURNING *`,
      [rule.id, poolId]
    );

    return { pool: updatedPool[0], payouts: inserted };
  });
}

/**
 * Void a closed-but-not-distributed pool, or reverse a distributed one. Only
 * 'closed' pools can be voided cleanly; for 'distributed', we set the
 * commission_earnings to 'reversed' so payroll won't pay them.
 */
async function voidTipPool(db, poolId, reason) {
  if (!poolId) throw new Error("poolId required");

  return db.transaction(async (client) => {
    const { rows: poolRows } = await client.query(
      `SELECT * FROM tip_pools WHERE id = $1 FOR UPDATE`,
      [poolId]
    );
    const pool = poolRows[0];
    if (!pool) throw Object.assign(new Error("Pool not found"), { statusCode: 404 });
    if (pool.status === "voided") return pool;
    if (pool.status !== "closed" && pool.status !== "distributed") {
      throw Object.assign(
        new Error(`Cannot void pool from status '${pool.status}'`),
        { statusCode: 400 }
      );
    }

    if (pool.status === "distributed") {
      // Reverse commission_earnings linked to this pool's payouts. Only
      // reverse those still 'pending' or 'approved' — paid earnings need
      // an explicit clawback, not a silent reversal.
      await client.query(
        `UPDATE commission_earnings ce
            SET status = 'reversed', reversed_at = NOW(),
                reversal_reason = COALESCE($1, 'tip pool voided')
           FROM tip_pool_payouts pp
          WHERE pp.pool_id = $2
            AND pp.commission_earning_id = ce.id
            AND ce.status IN ('pending','approved')`,
        [reason || null, poolId]
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE tip_pools
          SET status = 'voided', notes = COALESCE(notes, '') ||
              CASE WHEN $1::text IS NULL THEN '' ELSE E'\n[void] ' || $1 END
        WHERE id = $2 RETURNING *`,
      [reason || null, poolId]
    );
    return updated[0];
  });
}

module.exports = {
  captureTipOnSale,
  listTipsForShift,
  openTipPool,
  closeTipPool,
  distributeTipPool,
  voidTipPool,
};
