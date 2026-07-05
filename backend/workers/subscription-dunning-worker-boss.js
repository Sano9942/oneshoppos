/**
 * Subscription dunning worker — pg-boss implementation (F02 billing hardening).
 *
 * Hourly cron. For every failed customer-subscription renewal charge
 * (subscription_runs.charge_status='failed', dunning not yet done) whose
 * next_dunning_at has arrived, retries the saved instrument via
 * paymentGateway.chargeSavedInstrument at +1/+3/+7 days from first_failed_at.
 * After the 3rd failed attempt the subscription is auto-paused and the member
 * is notified. Success marks the run paid and closes the dunning cycle.
 *
 * Notifications ride the F05 dispatch engine (services/customer-notify.notify),
 * so they honour the customer_notifications flag + per-tenant channel rules.
 *
 * Enable: SUBSCRIPTION_DUNNING_WORKER_ENABLED=1
 * Heartbeat: global.__subscriptionDunningWorkerStatus
 */

const { withTenantContext } = require("./tenant-job-context");

// Retry cadence, measured in days from first_failed_at. processRenewal seeds
// next_dunning_at = first_failed_at + 1 day and dunning_attempts = 0; each
// failed retry bumps attempts and schedules the next offset. After MAX_ATTEMPTS
// failures the subscription is paused.
const RETRY_OFFSET_DAYS = { 1: 3, 2: 7 };
const MAX_ATTEMPTS = 3;

async function registerSubscriptionDunningWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "subscription-dunning-worker" });

  global.__subscriptionDunningWorkerStatus = global.__subscriptionDunningWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("subscription-dunning-check");
  await boss.schedule("subscription-dunning-check", "15 * * * *"); // hourly, offset from grace worker

  await boss.work("subscription-dunning-check", async () => {
    logger.info("Running subscription dunning check");
    try {
      global.__subscriptionDunningWorkerStatus.lastPollAt = Date.now();
      let totalProcessed = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active' AND plan != 'free'"
        );
        for (const tenant of tenants) {
          try {
            const n = await withTenantContext(pool, tenant.slug, (db) =>
              processDunningForTenant(db, logger, tenant.slug));
            totalProcessed += n;
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Dunning check failed for tenant");
          }
        }
      } else {
        const db = {
          query: (text, params) => pool.query(text, params),
          transaction: async (fn) => {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              const r = await fn(client);
              await client.query("COMMIT");
              return r;
            } catch (e) {
              await client.query("ROLLBACK");
              throw e;
            } finally {
              client.release();
            }
          },
        };
        totalProcessed = await processDunningForTenant(db, logger, "single");
      }

      global.__subscriptionDunningWorkerStatus.processedToday += totalProcessed;
      logger.info({ processed: totalProcessed }, "Subscription dunning check complete");
    } catch (err) {
      logger.error({ err }, "Subscription dunning check error");
      throw err;
    }
  });

  logger.info("Subscription dunning worker (pg-boss) registered — hourly");
}

/**
 * Process all due dunning retries for one tenant. Returns the number of runs
 * acted on. Missing-table tenants (pre-v101) are silently skipped.
 */
async function processDunningForTenant(db, logger, tenantSlug) {
  let due;
  try {
    const { rows } = await db.query(
      `SELECT sr.id AS run_id, sr.subscription_id, sr.invoice_id, sr.charge_amount,
              sr.dunning_attempts, sr.first_failed_at, sr.period_end,
              cs.customer_id, cs.gateway_token, cs.status AS sub_status,
              sp.name AS plan_name, sp.price
         FROM subscription_runs sr
         JOIN customer_subscriptions cs ON cs.id = sr.subscription_id
         JOIN subscription_plans sp ON sp.id = cs.plan_id
        WHERE sr.charge_status = 'failed'
          AND sr.dunning_done_at IS NULL
          AND sr.next_dunning_at IS NOT NULL
          AND sr.next_dunning_at <= NOW()
        ORDER BY sr.next_dunning_at ASC
        LIMIT 200`
    );
    due = rows;
  } catch (err) {
    if (/does not exist/i.test(err.message)) return 0; // pre-v101 tenant
    throw err;
  }

  const paymentGateway = require("../services/payment-gateway");
  let processed = 0;

  for (const run of due) {
    try {
      // Pause/resume-vs-dunning race guard: re-read status and close the run
      // out without charging if the subscription is no longer active.
      if (run.sub_status !== "active") {
        await db.query(
          "UPDATE subscription_runs SET dunning_done_at = NOW() WHERE id = $1",
          [run.run_id]
        );
        continue;
      }
      if (!run.gateway_token || !paymentGateway.isEnabled()) {
        // No card on file (or gateway off) — nothing to retry. Leave the run
        // open for a manual resolution rather than looping forever.
        continue;
      }

      const amount = Number(run.charge_amount ?? run.price);
      let ok = false;
      let failReason = null;
      try {
        const charge = await paymentGateway.chargeSavedInstrument({
          token: run.gateway_token,
          amount,
          currency: "PKR",
          reference: `sub-dun-${run.subscription_id}-${run.run_id}`,
        });
        if (charge?.status === "completed") ok = true;
        else failReason = charge?.error || `charge status ${charge?.status || "unknown"}`;
      } catch (chargeErr) {
        failReason = chargeErr.message;
      }

      if (ok) {
        await db.query(
          `UPDATE subscription_runs
             SET charge_status = 'completed', charge_amount = $2, dunning_done_at = NOW()
           WHERE id = $1`,
          [run.run_id, amount]
        );
        if (run.invoice_id) {
          await db.query(
            "UPDATE customer_invoices SET status = 'paid', balance_due = 0 WHERE id = $1",
            [run.invoice_id]
          );
        }
        logger.info({ tenantSlug, subscriptionId: run.subscription_id, runId: run.run_id },
          "Dunning retry succeeded — invoice paid");
        processed += 1;
        continue;
      }

      const attempts = Number(run.dunning_attempts) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Final failure → pause the subscription and notify the member.
        await db.query(
          `UPDATE subscription_runs
             SET dunning_attempts = $2, error = $3, dunning_done_at = NOW()
           WHERE id = $1`,
          [run.run_id, attempts, String(failReason).slice(0, 500)]
        );
        await db.query(
          "UPDATE customer_subscriptions SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'active'",
          [run.subscription_id]
        );
        await dispatchNotice(db, logger, tenantSlug, run, "subscription.paused", { attempt: attempts, maxAttempts: MAX_ATTEMPTS });
        logger.warn({ tenantSlug, subscriptionId: run.subscription_id },
          "Dunning exhausted — subscription auto-paused");
      } else {
        // Schedule the next retry from the ORIGINAL failure anchor.
        const offsetDays = RETRY_OFFSET_DAYS[attempts] || 7;
        await db.query(
          `UPDATE subscription_runs
             SET dunning_attempts = $2, error = $3,
                 next_dunning_at = first_failed_at + ($4 || ' days')::interval
           WHERE id = $1`,
          [run.run_id, attempts, String(failReason).slice(0, 500), String(offsetDays)]
        );
        await dispatchNotice(db, logger, tenantSlug, run, "subscription.payment_failed", { attempt: attempts + 1, maxAttempts: MAX_ATTEMPTS });
        logger.info({ tenantSlug, subscriptionId: run.subscription_id, attempts },
          "Dunning retry failed — rescheduled");
      }
      processed += 1;
    } catch (err) {
      logger.error({ err, tenantSlug, runId: run.run_id }, "Dunning run failed");
    }
  }
  return processed;
}

async function dispatchNotice(db, logger, tenantSlug, run, event, extra) {
  try {
    const { notify } = require("../services/customer-notify");
    const { rows: [cp] } = await db.query("SELECT company_name FROM company_profile WHERE id = 1");
    await notify(db, {
      event,
      customerId: run.customer_id,
      tenantSlug,
      tenant: { slug: tenantSlug, name: cp?.company_name },
      data: {
        storeName: cp?.company_name,
        planName: run.plan_name,
        amount: Number(run.charge_amount ?? run.price),
        currency: "PKR",
        ...extra,
      },
      entityType: "subscription",
      entityId: run.subscription_id,
    });
  } catch (err) {
    logger.warn({ err: err.message, tenantSlug, event }, "Dunning notify failed");
  }
}

module.exports = { registerSubscriptionDunningWorker, processDunningForTenant };
