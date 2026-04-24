/**
 * Subscription grace period worker — pg-boss implementation.
 *
 * Hourly cron: checks all active tenants for subscriptions past their
 * grace period and transitions them to past_due → expired.
 */

async function registerSubscriptionGraceWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "subscription-grace-worker" });

  global.__subscriptionGraceWorkerStatus = global.__subscriptionGraceWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("subscription-grace-check");
  await boss.schedule("subscription-grace-check", "0 * * * *"); // hourly

  await boss.work("subscription-grace-check", async () => {
    logger.info("Running subscription grace period check");
    try {
      global.__subscriptionGraceWorkerStatus.lastPollAt = Date.now();
      let totalTransitioned = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        // Skip Free tenants — they have no customer subscription billing surface
        // (the customer_subscriptions table is unused on Free), so iterating
        // them is wasted work and avoids "table does not exist" noise on any
        // tenant where the subscription tables aren't provisioned yet.
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active' AND plan != 'free'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const count = await checkGracePeriods(tenantDb, logger, tenant.slug);
            totalTransitioned += count;
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Grace check failed for tenant");
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalTransitioned = await checkGracePeriods(db, logger, "single");
      }

      global.__subscriptionGraceWorkerStatus.processedToday += totalTransitioned;
      logger.info({ transitioned: totalTransitioned }, "Subscription grace check complete");
    } catch (err) {
      logger.error({ err }, "Subscription grace check error");
      throw err;
    }
  });

  logger.info("Subscription grace worker (pg-boss) registered — hourly");
}

/**
 * Check grace periods for one tenant and transition overdue subscriptions.
 */
async function checkGracePeriods(db, logger, tenantSlug) {
  let count = 0;

  // Active subscriptions past their grace period with unpaid renewal invoices → past_due
  const { rows: overdue } = await db.query(
    `SELECT cs.id
     FROM customer_subscriptions cs
     WHERE cs.status = 'active'
       AND cs.grace_period_end IS NOT NULL
       AND cs.grace_period_end < NOW()
       AND EXISTS (
         SELECT 1 FROM subscription_runs sr
         JOIN customer_invoices ci ON ci.id = sr.invoice_id
         WHERE sr.subscription_id = cs.id
           AND ci.balance_due > 0
         ORDER BY sr.period_start DESC LIMIT 1
       )`
  );

  for (const { id } of overdue) {
    await db.query(
      "UPDATE customer_subscriptions SET status = 'past_due', updated_at = NOW() WHERE id = $1",
      [id]
    );
    count++;
    logger.info({ tenantSlug, subscriptionId: id }, "Subscription moved to past_due");
  }

  // Past-due subscriptions 7 days beyond grace period → expired
  const { rows: expired } = await db.query(
    `SELECT id FROM customer_subscriptions
     WHERE status = 'past_due'
       AND grace_period_end IS NOT NULL
       AND grace_period_end + INTERVAL '7 days' < NOW()`
  );

  for (const { id } of expired) {
    await db.query(
      "UPDATE customer_subscriptions SET status = 'expired', updated_at = NOW() WHERE id = $1",
      [id]
    );
    count++;
    logger.info({ tenantSlug, subscriptionId: id }, "Subscription expired");
  }

  return count;
}

module.exports = { registerSubscriptionGraceWorker };
