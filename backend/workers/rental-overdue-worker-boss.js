/**
 * Rental overdue worker — pg-boss implementation.
 *
 * Daily cron at 8 AM: for each active tenant, finds rental contracts
 * checked_out past their expected_return date, emails the customer,
 * and logs the activity. Skips tenants that have already been notified
 * in the last 24 hours.
 */

async function registerRentalOverdueWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "rental-overdue-worker" });
  const rentals = require("../services/rental-service");
  const { enqueueEmail } = require("../services/email");

  global.__rentalOverdueWorkerStatus = global.__rentalOverdueWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("rental-overdue-check");
  await boss.schedule("rental-overdue-check", "0 8 * * *");

  await boss.work("rental-overdue-check", async () => {
    logger.info("Running rental overdue check");
    try {
      global.__rentalOverdueWorkerStatus.lastPollAt = Date.now();
      let totalNotified = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const count = await checkOverdueForTenant(tenantDb, logger, tenant.slug, tenant.name, enqueueEmail, rentals);
            totalNotified += count;
          } catch (err) {
            logger.error({ err, tenantSlug: tenant.slug }, "Rental overdue check failed for tenant");
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalNotified = await checkOverdueForTenant(db, logger, "single", null, enqueueEmail, rentals);
      }

      global.__rentalOverdueWorkerStatus.processedToday += totalNotified;
      logger.info({ notified: totalNotified }, "Rental overdue check complete");
    } catch (err) {
      logger.error({ err }, "Rental overdue check error");
      throw err;
    }
  });

  logger.info("Rental overdue worker (pg-boss) registered — daily 8 AM");
}

async function checkOverdueForTenant(db, logger, tenantSlug, tenantName, enqueueEmail, rentals) {
  let count = 0;

  // Resolve store/company details once per tenant
  let storeName = tenantName || tenantSlug;
  try {
    const { rows } = await db.query("SELECT store_name FROM company_profile LIMIT 1");
    if (rows[0]?.store_name) storeName = rows[0].store_name;
  } catch { /* ignore — company_profile may not exist in edge cases */ }

  // V09: park any service-due assets into 'maintenance' so they can't be
  // booked until serviced. Guarded — pre-v118 tenants lack service_due_at.
  try {
    const flagged = await rentals.flagDueAssetsForMaintenance(db);
    if (flagged > 0) logger.info({ tenantSlug, flagged }, "Rental assets flagged for maintenance");
  } catch (err) {
    if (!/does not exist/i.test(err.message)) {
      logger.error({ err, tenantSlug }, "Rental maintenance-due flagging failed");
    }
  }

  const overdue = await rentals.getOverdueContracts(db);

  for (const contract of overdue) {
    const expected = contract.expected_return ? new Date(contract.expected_return) : null;
    const daysOverdue = expected
      ? Math.max(1, Math.ceil((Date.now() - expected.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;

    if (contract.customer_email) {
      try {
        await enqueueEmail(db, {
          to: contract.customer_email,
          template: "rental_overdue",
          data: {
            storeName,
            customerName: contract.customer_name,
            contractNumber: contract.contract_number,
            itemNames: contract.item_summary,
            expectedReturn: contract.expected_return,
            daysOverdue,
          },
        });
      } catch (err) {
        logger.error({ err, contractId: contract.id }, "Failed to enqueue rental overdue email");
      }
    }

    await rentals.markOverdueEmailSent(db, contract.id);
    await rentals.logActivity(db, contract.id, null, "overdue_alert_sent",
      `Overdue alert sent (${daysOverdue} day(s) overdue)`,
      { days_overdue: daysOverdue, recipient_email: contract.customer_email || null });

    count++;
    logger.info({ tenantSlug, contractId: contract.id, daysOverdue }, "Rental marked overdue + notified");
  }

  return count;
}

module.exports = { registerRentalOverdueWorker };
