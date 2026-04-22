/**
 * Shift auto-close worker — pg-boss implementation.
 *
 * Hourly cron: for each tenant with the `shift_auto_close` feature flag on,
 * force-close any `open` cash shift whose `opened_at` is older than the
 * tenant's `company_profile.shift_auto_close_hours` threshold (default 36h).
 *
 * Force-close semantics:
 *   - status            = 'closed'
 *   - closed_at         = NOW()
 *   - auto_closed_at    = NOW()
 *   - closing_method    = 'auto'
 *   - closing_note      = 'Auto-closed after inactivity threshold'
 *   - expected_cash     = NULL  (can't reliably compute — cashier absent)
 *   - variance          = NULL  (no denom count was taken)
 *
 * The cashier's next clock-in will see a fresh shift; the auto-closed record
 * is clearly flagged in shift reports so finance knows to reconcile manually.
 *
 * Mirrors the room-overdue worker pattern (workers/room-overdue-checkout-
 * worker-boss.js): tenant iteration, per-tenant try/catch, heartbeat global.
 *
 * Env gate: SHIFT_AUTO_CLOSE_WORKER_ENABLED=1
 * Tenant gate: feature flag `shift_auto_close` (default FALSE)
 */

async function registerShiftAutoCloseWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "shift-auto-close-worker" });

  global.__shiftAutoCloseWorkerStatus = global.__shiftAutoCloseWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("shift-auto-close");
  // Hourly: top of each hour. Cheap query per tenant; no real cost to frequency.
  await boss.schedule("shift-auto-close", "0 * * * *");

  await boss.work("shift-auto-close", async () => {
    logger.info("Running shift auto-close sweep");
    try {
      global.__shiftAutoCloseWorkerStatus.lastPollAt = Date.now();
      let totalClosed = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const count = await closeStaleShiftsForTenant(tenantDb, logger, tenant.slug);
            totalClosed += count;
          } catch (err) {
            // Missing columns on tenants pre-v76 — benign, just skip them.
            if (!String(err.message || "").includes("does not exist")) {
              logger.error({ err, tenantSlug: tenant.slug }, "Shift auto-close failed for tenant");
            }
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalClosed = await closeStaleShiftsForTenant(db, logger, "single");
      }

      global.__shiftAutoCloseWorkerStatus.processedToday += totalClosed;
      // Queue depth is the count of currently-open shifts still within
      // threshold — a forward-looking view of work the next tick might do.
      try {
        const { rows: [row] } = await pool.query(
          "SELECT COUNT(*)::int AS n FROM public.cash_shifts WHERE status = 'open'"
        );
        global.__shiftAutoCloseWorkerStatus.queueDepth = row?.n || 0;
      } catch {
        // public.cash_shifts may not exist in MT mode — non-fatal.
      }
      logger.info({ closed: totalClosed }, "Shift auto-close sweep complete");
    } catch (err) {
      logger.error({ err }, "Shift auto-close sweep error");
      throw err;
    }
  });

  logger.info("Shift auto-close worker (pg-boss) registered — hourly");
}

async function closeStaleShiftsForTenant(db, logger, tenantSlug) {
  // Gate 1: tenant must have opted in via feature flag.
  let flagOn = false;
  try {
    const { rows } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'shift_auto_close' LIMIT 1"
    );
    flagOn = rows[0]?.enabled === true;
  } catch {
    // feature_flags table missing → tenant is pre-flag system; skip.
    return 0;
  }
  if (!flagOn) return 0;

  // Threshold per tenant (default 36h if unset).
  let thresholdHours = 36;
  try {
    const { rows } = await db.query(
      "SELECT shift_auto_close_hours FROM company_profile LIMIT 1"
    );
    const v = rows[0]?.shift_auto_close_hours;
    if (Number.isFinite(Number(v)) && Number(v) > 0) thresholdHours = Number(v);
  } catch { /* missing column → use default */ }

  // Gather candidate shifts. Using INTERVAL $1 * '1 hour' is unsafe for
  // parameter binding — compose the interval from a validated integer.
  const hours = Math.max(1, Math.floor(thresholdHours));
  const { rows: stale } = await db.query(
    `SELECT id, outlet_id, employee_id, opened_at
       FROM cash_shifts
      WHERE status = 'open'
        AND opened_at < NOW() - ($1 || ' hours')::interval`,
    [String(hours)]
  );
  if (stale.length === 0) return 0;

  let closed = 0;
  for (const shift of stale) {
    try {
      await db.query(
        `UPDATE cash_shifts
            SET status = 'closed',
                closed_at = NOW(),
                auto_closed_at = NOW(),
                closing_method = 'auto',
                closing_note = 'Auto-closed after inactivity threshold',
                expected_cash = NULL,
                variance = NULL
          WHERE id = $1 AND status = 'open'`,
        [shift.id]
      );
      // Audit trail — shifts report + admin activity surfaces this.
      // action_history is optional; if the table lacks a column, we just
      // log the error and keep going.
      try {
        await db.query(
          `INSERT INTO action_history (user_name, action_type, description)
           VALUES ('System', 'shift_auto_closed',
                   $1)`,
          [`Shift #${shift.id} auto-closed after ${hours}h of inactivity`]
        );
      } catch (e) {
        logger.warn({ err: e, shiftId: shift.id }, "Failed to log shift auto-close to action_history");
      }
      closed++;
      logger.info(
        { tenantSlug, shiftId: shift.id, openedAt: shift.opened_at, thresholdHours: hours },
        "Shift auto-closed"
      );
    } catch (err) {
      logger.error({ err, shiftId: shift.id, tenantSlug }, "Failed to auto-close shift");
    }
  }
  return closed;
}

module.exports = { registerShiftAutoCloseWorker, closeStaleShiftsForTenant };
