/**
 * Treatment plan worker — pg-boss implementation.
 *
 * Daily cron at 9 AM (tenant-wide, sequential):
 *   1. Upcoming session reminders — for each active plan, find sessions
 *      scheduled in the next 24h and enqueue `treatment_session_reminder` emails
 *      to the patient.
 *   2. Overdue plan check — plans still active 7+ days past `expected_end_date`
 *      with incomplete sessions → enqueue `treatment_plan_overdue` email to
 *      the provider (staff-facing, not the patient).
 */

async function registerTreatmentPlanWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "treatment-plan-worker" });
  const tp = require("../services/treatment-plan-service");
  const { enqueueEmail } = require("../services/email");

  global.__treatmentPlanWorkerStatus = global.__treatmentPlanWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("treatment-plan-daily-check");
  await boss.schedule("treatment-plan-daily-check", "0 9 * * *");

  await boss.work("treatment-plan-daily-check", async () => {
    logger.info("Running treatment plan daily check");
    try {
      global.__treatmentPlanWorkerStatus.lastPollAt = Date.now();
      let totalProcessed = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const count = await runDailyCheck(tenantDb, logger, tenant.slug, tenant.name, enqueueEmail, tp);
            totalProcessed += count;
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Treatment plan daily check failed for tenant");
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalProcessed = await runDailyCheck(db, logger, "single", null, enqueueEmail, tp);
      }

      global.__treatmentPlanWorkerStatus.processedToday += totalProcessed;

      // Refresh queue-depth gauge — count pending outbound emails tagged for this worker
      try {
        const depthQuery = { query: (text, params) => pool.query(text, params) };
        const { rows: [row] } = await depthQuery.query(
          `SELECT COUNT(*) AS n FROM email_queue
           WHERE email_type IN ('treatment_session_reminder','treatment_plan_overdue')
             AND sent_at IS NULL`
        );
        global.__treatmentPlanWorkerStatus.queueDepth = Number(row?.n || 0);
      } catch { /* email_queue may not exist in unit tests */ }

      logger.info({ processed: totalProcessed }, "Treatment plan daily check complete");
    } catch (err) {
      logger.error({ err }, "Treatment plan daily check error");
      throw err;
    }
  });

  logger.info("Treatment plan worker (pg-boss) registered — daily 9 AM");
}

async function runDailyCheck(db, logger, tenantSlug, tenantName, enqueueEmail, tp) {
  let count = 0;

  // Feature-flag gate — no-op for tenants with the Clinical / Treatment
  // Plans module off (Business Modules rule). Pattern: abc-worker-boss.js.
  const { rows: flagRows } = await db.query(
    `SELECT enabled FROM feature_flags WHERE key = 'phase4_treatment_plans'`
  );
  if (!flagRows[0]?.enabled) return 0;

  // Store/company name for email subject
  let storeName = tenantName || tenantSlug;
  try {
    const { rows } = await db.query("SELECT store_name FROM company_profile LIMIT 1");
    if (rows[0]?.store_name) storeName = rows[0].store_name;
  } catch { /* company_profile may not exist */ }

  // ── 1. Upcoming session reminders ────────────────────────────────
  let sessions = [];
  try {
    sessions = await tp.getUpcomingSessionsNeedingReminder(db);
  } catch (err) {
    // Tables may not exist for tenants that haven't migrated to v39 yet
    if (!String(err.message || "").includes("does not exist")) throw err;
    return 0;
  }
  for (const s of sessions) {
    if (!s.customer_email) continue;
    try {
      await enqueueEmail(db, {
        to: s.customer_email,
        template: "treatment_session_reminder",
        data: {
          storeName,
          customerName: s.customer_name,
          planNumber: s.plan_number,
          sessionNumber: s.session_number,
          providerName: s.provider_name,
          scheduledAt: s.scheduled_at,
        },
      });
      count++;
    } catch (err) {
      logger.error({ err, sessionId: s.id }, "Failed to enqueue session reminder email");
    }
  }

  // ── 2. Overdue plan check (staff-facing) ─────────────────────────
  let overduePlans = [];
  try {
    overduePlans = await tp.getOverduePlans(db);
  } catch (err) {
    if (!String(err.message || "").includes("does not exist")) throw err;
    return count;
  }
  for (const p of overduePlans) {
    // Recipient: provider first, fall back to store admin email if provider has none
    const recipient = p.provider_email || null;
    if (!recipient) continue;
    const expected = p.expected_end_date ? new Date(p.expected_end_date) : null;
    const daysOverdue = expected
      ? Math.max(1, Math.ceil((Date.now() - expected.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;
    try {
      await enqueueEmail(db, {
        to: recipient,
        template: "treatment_plan_overdue",
        data: {
          storeName,
          providerName: p.provider_name,
          planNumber: p.plan_number,
          customerName: p.customer_name,
          sessionsCompleted: p.sessions_completed,
          sessionsPlanned: p.total_sessions_planned,
          daysOverdue,
        },
      });
      count++;
    } catch (err) {
      logger.error({ err, planId: p.id }, "Failed to enqueue overdue plan email");
    }
  }

  return count;
}

module.exports = { registerTreatmentPlanWorker };
