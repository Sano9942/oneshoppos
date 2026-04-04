/**
 * Dead-tenant cleanup worker — pg-boss implementation.
 *
 * Replaces the setInterval in boot/workers.js with a durable cron job.
 *
 * Cron: "cleanup-dead-tenants" — runs daily at 2am UTC
 */

const { cleanupDeadTenants } = require("../jobs/cleanup-dead-tenants");

async function registerCleanupWorker(boss) {
  const logger = require("../services/logger").child({ component: "cleanup-worker-boss" });

  global.__cleanupWorkerStatus = global.__cleanupWorkerStatus || { lastPollAt: null, processedToday: 0, queueDepth: 0 };

  // Create queue (pg-boss v12+ requires explicit queue creation before work/send)
  await boss.createQueue("cleanup-dead-tenants");

  // Schedule daily at 2am UTC
  await boss.schedule("cleanup-dead-tenants", "0 2 * * *");

  await boss.work("cleanup-dead-tenants", async () => {
    logger.info("Running dead-tenant cleanup (pg-boss)");
    try {
      global.__cleanupWorkerStatus.lastPollAt = Date.now();
      const result = await cleanupDeadTenants();
      global.__cleanupWorkerStatus.processedToday += result.deleted;
      logger.info(
        { checked: result.checked, deleted: result.deleted, skipped: result.skipped },
        "Dead-tenant cleanup complete"
      );
    } catch (err) {
      logger.error({ err }, "Dead-tenant cleanup error");
      throw err; // let pg-boss record the failure
    }
  });

  logger.info("Cleanup worker (pg-boss) registered — daily at 2am UTC");
}

module.exports = { registerCleanupWorker };
