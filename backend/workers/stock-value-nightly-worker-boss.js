/**
 * One Toy Store pilot G2: nightly stock value — pg-boss implementation.
 *
 * Hourly at :59. For each active shop whose local time is in the 23:00 hour,
 * every branch that closed no shift that day gets its stock value saved
 * (services/stock-value.js), so the by-date list never misses a day.
 * Close Shift saves its own figure; this only fills the gaps.
 *
 * Env gate: STOCK_VALUE_NIGHTLY_WORKER_ENABLED=1
 */

async function registerStockValueNightlyWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "stock-value-nightly-worker" });
  const { nightlyStockValueTick } = require("../services/stock-value");

  global.__stockValueNightlyWorkerStatus = global.__stockValueNightlyWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("stock-value-nightly");
  await boss.schedule("stock-value-nightly", "59 * * * *");

  await boss.work("stock-value-nightly", async () => {
    global.__stockValueNightlyWorkerStatus.lastPollAt = Date.now();
    const at = new Date();
    let saved = 0;
    if (String(process.env.MULTI_TENANT || "0") === "1") {
      const masterDb = require("../master-db-pg");
      const tenantDbMgr = require("../tenant-db-manager-pg");
      const { rows: tenants } = await masterDb.query("SELECT id, slug FROM tenants WHERE status = 'active'");
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbMgr.getDb(tenant.id);
          saved += await nightlyStockValueTick(tenantDb, { at });
        } catch (err) {
          // A shop that predates the table (migration v160) is skipped quietly.
          if (!String(err.message || "").includes("does not exist")) {
            logger.error({ err, tenantSlug: tenant.slug }, "Nightly stock value failed for tenant");
          }
        }
      }
    } else {
      const db = { query: (text, params) => pool.query(text, params) };
      saved = await nightlyStockValueTick(db, { at });
    }
    global.__stockValueNightlyWorkerStatus.processedToday += saved;
    if (saved) logger.info({ saved }, "Nightly stock values saved");
  });

  logger.info("Stock value nightly worker (pg-boss) registered — hourly at :59");
}

module.exports = { registerStockValueNightlyWorker };
