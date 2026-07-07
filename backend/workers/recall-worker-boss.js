"use strict";

/**
 * Recall outreach worker (V05 clinical depth) — pg-boss.
 *
 * Daily cron at 10 AM (offset from the treatment-plan worker's 9 AM): for
 * each active tenant with the `clinical_recalls` flag on, roll due recalls
 * into outreach via the F05 engine ("time for your 6-month checkup" with a
 * public booking link), respecting:
 *   - the tenant cadence (company_profile.recall_outreach_cadence_days)
 *   - the attempt cap (recall-service.MAX_CONTACT_ATTEMPTS)
 *   - the suppression rule: a recall whose patient already has a future
 *     appointment is auto-marked 'booked' instead of being contacted.
 *
 * Channel gating (customer_notifications flag, per-rule enable) is enforced
 * centrally inside customer-notify.notify() — this worker never bypasses it.
 */

const QUEUE_NAME = "recall-outreach-check";

async function registerRecallWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "recall-worker" });
  const { withTenantContext } = require("./tenant-job-context");

  global.__recallWorkerStatus = global.__recallWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue(QUEUE_NAME);
  await boss.schedule(QUEUE_NAME, "0 10 * * *");

  await boss.work(QUEUE_NAME, async () => {
    logger.info("Running recall outreach check");
    try {
      global.__recallWorkerStatus.lastPollAt = Date.now();
      let totalProcessed = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            totalProcessed += await withTenantContext(pool, tenant.slug, (db) =>
              runOnce(db, { tenantSlug: tenant.slug, tenantName: tenant.name, logger })
            );
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Recall outreach failed for tenant");
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalProcessed = await runOnce(db, { tenantSlug: "single", tenantName: null, logger });
      }

      global.__recallWorkerStatus.processedToday += totalProcessed;
      logger.info({ processed: totalProcessed }, "Recall outreach check complete");
    } catch (err) {
      logger.error({ err }, "Recall outreach check error");
      throw err;
    }
  });

  logger.info("Recall worker (pg-boss) registered — daily 10 AM");
}

/**
 * One tenant's sweep. Exported for tests (drive without pg-boss).
 * @returns number of recalls acted on (contacted or auto-booked).
 */
async function runOnce(db, { tenantSlug, tenantName, logger, notifyDeps } = {}) {
  const recalls = require("../services/recall-service");
  const customerNotify = require("../services/customer-notify");

  // Tenant gate: clinical_recalls flag (skip silently for non-clinical tenants
  // and pre-v120 schemas).
  let flagOn = false;
  try {
    const { rows } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'clinical_recalls'"
    );
    flagOn = rows[0]?.enabled === true;
  } catch { return 0; }
  if (!flagOn) return 0;

  let storeName = tenantName || tenantSlug;
  let storePhone = "";
  let cadenceDays = 30;
  try {
    const { rows } = await db.query(
      "SELECT store_name, trading_name, phone, recall_outreach_cadence_days FROM company_profile LIMIT 1"
    );
    if (rows[0]) {
      storeName = rows[0].trading_name || rows[0].store_name || storeName;
      storePhone = rows[0].phone || "";
      if (Number(rows[0].recall_outreach_cadence_days) > 0) {
        cadenceDays = Number(rows[0].recall_outreach_cadence_days);
      }
    }
  } catch { /* company_profile shape drift — keep defaults */ }

  let due = [];
  try {
    due = await recalls.getDueRecallsForOutreach(db, { cadenceDays });
  } catch (err) {
    if (!String(err.message || "").includes("does not exist")) throw err;
    return 0;
  }

  const base = process.env.FRONTEND_URL || "";
  const bookingUrl = tenantSlug && tenantSlug !== "single" ? `${base}/book/${tenantSlug}` : `${base}/book`;

  let count = 0;
  for (const r of due) {
    try {
      // Suppression re-check at fire time: patient booked since arming.
      if (r.future_appointment_id) {
        await db.query(
          `UPDATE patient_recalls SET status = 'booked', appointment_id = $2, updated_at = NOW()
            WHERE id = $1 AND status IN ('due','contacted')`,
          [r.id, r.future_appointment_id]
        );
        count++;
        continue;
      }

      const event = recalls.isVaccinationType(r.recall_type)
        ? "recall.vaccination_due"
        : "recall.due";
      await customerNotify.notify(
        db,
        {
          event,
          customerId: r.customer_id,
          entityType: "recall",
          entityId: r.id,
          tenantSlug,
          tenant: { slug: tenantSlug, name: storeName },
          data: {
            storeName,
            storePhone,
            subjectName: r.subject_name || r.customer_name,
            recallType: r.recall_type,
            recallLabel: recalls.humanizeRecall(r),
            dueDate: r.due_date,
            bookingUrl,
          },
        },
        notifyDeps || undefined
      );
      await recalls.markContacted(db, r.id);
      count++;
    } catch (err) {
      logger?.error({ err: err.message, recallId: r.id }, "Recall outreach failed for recall");
    }
  }
  return count;
}

module.exports = { registerRecallWorker, runOnce, QUEUE_NAME };
