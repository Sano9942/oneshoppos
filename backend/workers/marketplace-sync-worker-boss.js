/**
 * Marketplace sync worker — pg-boss implementation.
 *
 * Cron jobs:
 *   - "marketplace-order-poll"  — every 10 min: pull orders from Daraz/Facebook for tenants with active integrations
 *   - "marketplace-feed-check"  — every 6 hours: check Google Merchant feed status
 *
 * Env: MARKETPLACE_SYNC_WORKER_ENABLED=1
 * Heartbeat: global.__marketplaceSyncWorkerStatus
 */

const logger = require("../services/logger").child({ component: "marketplace-sync-worker" });

global.__marketplaceSyncWorkerStatus = {
  lastPollAt: null,
  processedToday: 0,
  queueDepth: 0,
};

async function registerMarketplaceSyncWorker(boss, pool) {
  const queueName = "marketplace-order-poll";
  const feedQueueName = "marketplace-feed-check";

  await boss.createQueue(queueName);
  await boss.createQueue(feedQueueName);

  // Schedule order polling every 10 minutes
  await boss.schedule(queueName, "*/10 * * * *", {}, {
    singletonKey: "marketplace-order-poll",
  });

  // Schedule feed check every 6 hours
  await boss.schedule(feedQueueName, "0 */6 * * *", {}, {
    singletonKey: "marketplace-feed-check",
  });

  // Order poll handler
  await boss.work(queueName, async (job) => {
    logger.info("Marketplace order poll starting");
    const now = new Date();

    try {
      // Find all tenants with active marketplace integrations
      const masterDb = require("../master-db-pg");
      const { rows: tenants } = await masterDb.query(
        "SELECT id, slug FROM tenants WHERE status = 'active'"
      );

      let totalImported = 0;

      for (const tenant of tenants) {
        try {
          const schema = `tenant_${tenant.slug}`;
          const { rows: integrations } = await pool.query(
            `SELECT provider, is_active, sync_enabled FROM ${schema}.integration_settings WHERE is_active = true AND sync_enabled = true`
          );

          for (const integration of integrations) {
            if (integration.provider === "daraz") {
              // Poll Daraz for new orders
              const since = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // last 15 min
              logger.info({ tenant: tenant.slug, provider: "daraz" }, "Polling Daraz orders");
              // Actual polling would call DarazClient.pullOrders here
              // For now, log the poll attempt
            }

            if (integration.provider === "facebook") {
              logger.info({ tenant: tenant.slug, provider: "facebook" }, "Polling Facebook orders");
              // Actual polling would call MetaCommerceClient.pullOrders here
            }
          }
        } catch (err) {
          logger.error({ tenant: tenant.slug, err }, "Error polling marketplace orders for tenant");
        }
      }

      global.__marketplaceSyncWorkerStatus.lastPollAt = now.toISOString();
      global.__marketplaceSyncWorkerStatus.processedToday += totalImported;
      logger.info({ totalImported }, "Marketplace order poll complete");
    } catch (err) {
      logger.error({ err }, "Marketplace order poll failed");
    }
  });

  // Feed check handler
  await boss.work(feedQueueName, async (job) => {
    logger.info("Google Merchant feed check starting");

    try {
      const masterDb = require("../master-db-pg");
      const { rows: tenants } = await masterDb.query(
        "SELECT id, slug FROM tenants WHERE status = 'active'"
      );

      for (const tenant of tenants) {
        try {
          const schema = `tenant_${tenant.slug}`;
          const { rows: [gmcConfig] } = await pool.query(
            `SELECT is_active FROM ${schema}.integration_settings WHERE provider = 'google_merchant' AND is_active = true`
          );

          if (gmcConfig) {
            logger.info({ tenant: tenant.slug }, "Checking Google Merchant feed status");
            // Actual check would call GoogleMerchantClient.checkFeedStatus here
          }
        } catch (err) {
          logger.error({ tenant: tenant.slug, err }, "Error checking feed for tenant");
        }
      }

      logger.info("Google Merchant feed check complete");
    } catch (err) {
      logger.error({ err }, "Google Merchant feed check failed");
    }
  });

  logger.info("Marketplace sync worker registered (order poll + feed check)");
}

module.exports = { registerMarketplaceSyncWorker };
