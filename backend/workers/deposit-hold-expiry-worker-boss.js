/**
 * Deposit hold-expiry worker — pg-boss implementation (F04).
 *
 * A gateway pre-auth hold lapses at the acquirer after ~7 days. If a booking /
 * plan / rental is left in deposit_status='authorized' past that window, a
 * later capture at checkout/return will be declined by the gateway and jam the
 * front desk. This hourly sweep releases holds older than DEPOSIT_HOLD_MAX_DAYS
 * (default 7) so the deposit isn't stuck 'authorized' forever and the entity's
 * settle path treats it as a clean no-hold case.
 *
 * Only hold-mode deposit entities are swept — charge-mode (service tickets)
 * never sits in an 'authorized' hold. The table/column set is derived from
 * deposit-engine.ENTITY_ADAPTERS so a new hold adapter is swept automatically.
 */

const QUEUE_NAME = "deposit-hold-expiry-sweep";

function holdAdapters() {
  const engine = require("../services/deposit-engine");
  return Object.entries(engine.ENTITY_ADAPTERS)
    .filter(([, cfg]) => cfg.captureMode === "hold" && cfg.authorizedAtColumn)
    .map(([entityType, cfg]) => ({ entityType, ...cfg }));
}

async function sweepTenant(db, logger, tenantSlug, maxDays) {
  let released = 0;
  for (const cfg of holdAdapters()) {
    try {
      const { rowCount } = await db.query(
        `UPDATE ${cfg.table}
            SET ${cfg.statusColumn} = 'released', updated_at = NOW()
          WHERE ${cfg.statusColumn} = 'authorized'
            AND ${cfg.authorizedAtColumn} IS NOT NULL
            AND ${cfg.authorizedAtColumn} < NOW() - ($1 || ' days')::interval`,
        [String(maxDays)]
      );
      if (rowCount > 0) {
        released += rowCount;
        logger.info(
          { tenantSlug, table: cfg.table, released: rowCount, maxDays },
          "Released expired deposit holds"
        );
      }
    } catch (err) {
      // Table may not exist for tenants not yet migrated to v99 — skip silently.
      if (!String(err.message || "").includes("does not exist")) {
        logger.error({ err, tenantSlug, table: cfg.table }, "Deposit hold sweep failed for table");
      }
    }
  }
  return released;
}

async function registerDepositHoldExpiryWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "deposit-hold-expiry-worker" });
  const maxDays = Number(process.env.DEPOSIT_HOLD_MAX_DAYS || 7);

  global.__depositHoldExpiryWorkerStatus = global.__depositHoldExpiryWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue(QUEUE_NAME);
  await boss.schedule(QUEUE_NAME, "0 * * * *", null, { singletonKey: QUEUE_NAME });

  await boss.work(QUEUE_NAME, async () => {
    global.__depositHoldExpiryWorkerStatus.lastPollAt = Date.now();
    let total = 0;
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
            total += await sweepTenant(tenantDb, logger, tenant.slug, maxDays);
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Deposit hold sweep failed for tenant");
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        total += await sweepTenant(db, logger, "single", maxDays);
      }
      global.__depositHoldExpiryWorkerStatus.processedToday += total;
      if (total > 0) logger.info({ released: total }, "Deposit hold expiry sweep complete");
    } catch (err) {
      logger.error({ err }, "Deposit hold expiry sweep error");
      throw err;
    }
  });

  logger.info("Deposit hold-expiry worker (pg-boss) registered — hourly");
}

module.exports = { registerDepositHoldExpiryWorker, sweepTenant, QUEUE_NAME };
