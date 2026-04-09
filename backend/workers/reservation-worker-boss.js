/**
 * Reservation expiry worker — pg-boss implementation.
 *
 * Expires stale inventory reservations across all active tenants.
 *
 * Cron: "expire-reservations" — runs every 5 minutes
 */

const { expireStaleReservations } = require("../services/reservation");

async function registerReservationWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "reservation-worker-boss" });

  global.__reservationWorkerStatus = global.__reservationWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  // Create queue (pg-boss v12+ requires explicit queue creation before work/send)
  await boss.createQueue("expire-reservations");

  // Schedule every 5 minutes
  await boss.schedule("expire-reservations", "*/5 * * * *");

  await boss.work("expire-reservations", async () => {
    logger.info("Running reservation expiry (pg-boss)");
    try {
      global.__reservationWorkerStatus.lastPollAt = Date.now();
      let totalExpired = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const result = await expireStaleReservations(tenantDb);
            totalExpired += result.expired || 0;
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Reservation expiry failed for tenant");
          }
        }
      } else {
        const result = await expireStaleReservations({ query: (text, params) => pool.query(text, params) });
        totalExpired += result.expired || 0;
      }

      global.__reservationWorkerStatus.processedToday += totalExpired;
      logger.info({ expired: totalExpired }, "Reservation expiry complete");
    } catch (err) {
      logger.error({ err }, "Reservation expiry error");
      throw err; // let pg-boss record the failure
    }
  });

  logger.info("Reservation worker (pg-boss) registered — every 5 minutes");
}

module.exports = { registerReservationWorker };
