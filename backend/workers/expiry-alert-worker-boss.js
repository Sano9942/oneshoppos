/**
 * Expiry-alert worker — pg-boss implementation (F07).
 *
 * Daily at 06:00 UTC (11:00 Asia/Karachi): for each active tenant with the
 * batch_expiry_tracking flag on, counts active batches expiring within the
 * near-expiry window and raises a SINGLE summary notification per outlet
 * ("N batches expiring within Nd — review the Expiring Soon list"). The
 * Expiring-Soon page (GET /api/batches/expiring) holds the per-batch detail
 * and the markdown / write-off actions.
 *
 * ALERT-ONLY by design: it never flips a batch to 'expired'. Doing so would drop
 * that quantity out of Σ active remaining_qty while outlet_stock still carries it
 * — i.e. it would manufacture drift. Removing expired stock is an explicit
 * operator action (write-off), which decrements outlet_stock in the same tx.
 *
 * runExpiryScanForDb() takes a scoped db proxy (same shape as deps.db) so it is
 * directly testable against an isolated schema without pg-boss or tenant context.
 */

const NEAR_EXPIRY_DAYS = Number(process.env.BATCH_EXPIRY_ALERT_DAYS) || 7;

global.__expiryAlertWorkerStatus = global.__expiryAlertWorkerStatus || {
  lastPollAt: null,
  processedToday: 0,
  queueDepth: 0,
};

/**
 * Scan one tenant's batches and raise near-expiry summary notifications.
 * @returns {Promise<number>} number of expiring batches found (0 when flag off)
 */
async function runExpiryScanForDb({ db, windowDays = NEAR_EXPIRY_DAYS } = {}) {
  // 1. Feature-flag gate — no-op for tenants that don't track batches.
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'batch_expiry_tracking'`
  );
  if (!flagRows[0]?.enabled) return 0;

  // Expiry is judged against the TENANT-local day (CURRENT_DATE is the DB
  // session's day — UTC on prod — which lags PK tenants by 5 hours).
  const { tenantToday } = require("../utils/tz");
  let tz = "UTC";
  try {
    const { rows: [prof] } = await db.query(
      "SELECT timezone FROM company_profile WHERE id = 1"
    );
    if (prof?.timezone) tz = prof.timezone;
  } catch { /* fall back to UTC */ }
  const todayLocal = tenantToday(tz);

  // 2. Count active batches expiring within the window, grouped by outlet.
  //    Includes already-expired (still sitting in stock, not yet written off).
  const { rows: byOutlet } = await db.query(
    `SELECT sb.outlet_id, o.name AS outlet_name,
            COUNT(*) AS batch_count,
            SUM(CASE WHEN sb.expiry_date < $2::date THEN 1 ELSE 0 END) AS expired_count
       FROM stock_batches sb
       LEFT JOIN outlets o ON o.id = sb.outlet_id
      WHERE sb.status = 'active'
        AND sb.remaining_qty > 0
        AND sb.expiry_date IS NOT NULL
        AND sb.expiry_date <= $2::date + ($1::int)
      GROUP BY sb.outlet_id, o.name`,
    [windowDays, todayLocal]
  );

  let total = 0;
  for (const row of byOutlet) {
    const count = Number(row.batch_count) || 0;
    const expired = Number(row.expired_count) || 0;
    total += count;
    const where = row.outlet_name ? ` at ${row.outlet_name}` : "";
    const expiredNote = expired > 0 ? ` (${expired} already expired)` : "";
    await db.query(
      `INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)`,
      [
        "batch_expiring",
        "Stock expiring soon",
        `${count} batch(es)${where} expiring within ${windowDays} day(s)${expiredNote} — review the Expiring Soon list.`,
        "/inventory/expiring",
      ]
    ).catch(() => {});
  }
  return total;
}

async function registerExpiryAlertWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "expiry-alert-worker" });

  await boss.createQueue("expiry-alert-daily");
  await boss.schedule("expiry-alert-daily", "0 6 * * *");

  await boss.work("expiry-alert-daily", async () => {
    logger.info("Running daily near-expiry scan");
    global.__expiryAlertWorkerStatus.lastPollAt = Date.now();
    let totalFound = 0;
    try {
      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            totalFound += await runExpiryScanForDb({ db: tenantDb });
          } catch (err) {
            if (!/does not exist/.test(String(err.message))) {
              logger.error({ err, tenantSlug: tenant.slug }, "Expiry scan failed for tenant");
            }
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalFound = await runExpiryScanForDb({ db });
      }
      global.__expiryAlertWorkerStatus.processedToday += totalFound;
      logger.info({ expiringBatches: totalFound }, "Near-expiry scan complete");
    } catch (err) {
      logger.error({ err }, "Near-expiry scan error");
      throw err;
    }
  });

  logger.info("Expiry-alert worker (pg-boss) registered — daily 06:00 UTC");
}

module.exports = { registerExpiryAlertWorker, runExpiryScanForDb, NEAR_EXPIRY_DAYS };
