"use strict";

/**
 * Night audit worker (V10) — nightly cron. Snapshots the hotel night that
 * just ended (yesterday in the tenant's timezone) into night_audit_snapshots
 * via services/room-night-audit.js. Front desk can also run/re-run any date
 * manually through POST /api/rooms/night-audit/run — the upsert makes both
 * paths idempotent.
 *
 * Cron 0 22 * * * UTC = 3 AM PKT — after the front desk day closes.
 */

async function registerNightAuditWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "night-audit-worker" });
  const nightAudit = require("../services/room-night-audit");
  const { toLocalDateStr } = require("../utils/tz");
  const { withTenantContext } = require("./tenant-job-context");

  global.__nightAuditWorkerStatus = global.__nightAuditWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  const auditTenant = async (db, tenantSlug) => {
    // Skip tenants without room management (no rooms → nothing to audit).
    const { rows: hasRooms } = await db.query("SELECT 1 FROM rooms LIMIT 1");
    if (!hasRooms.length) return false;
    let tz = "UTC";
    try {
      const { rows: [cp] } = await db.query("SELECT timezone FROM company_profile LIMIT 1");
      if (cp?.timezone) tz = cp.timezone;
    } catch { /* default UTC */ }
    const todayLocal = toLocalDateStr(new Date().toISOString(), tz);
    const d = new Date(`${todayLocal}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const auditDate = d.toISOString().slice(0, 10);
    await nightAudit.runNightAudit(db, auditDate, null);
    logger.info({ tenantSlug, auditDate }, "night audit snapshot written");
    return true;
  };

  await boss.createQueue("night-audit-run");
  await boss.schedule("night-audit-run", "0 22 * * *", null, { singletonKey: "night-audit-run" });
  await boss.work("night-audit-run", async () => {
    global.__nightAuditWorkerStatus.lastPollAt = Date.now();
    let processed = 0;
    if (String(process.env.MULTI_TENANT || "0") === "1") {
      const masterDb = require("../master-db-pg");
      const { rows: tenants } = await masterDb.query(
        "SELECT id, slug FROM tenants WHERE status = 'active'"
      );
      for (const tenant of tenants) {
        try {
          if (await withTenantContext(pool, tenant.slug, (db) => auditTenant(db, tenant.slug))) processed++;
        } catch (err) {
          if (!String(err.message || "").includes("does not exist")) {
            logger.error({ err, tenantSlug: tenant.slug }, "night audit failed for tenant");
          }
        }
      }
    } else {
      const db = { query: (text, params) => pool.query(text, params) };
      try {
        if (await auditTenant(db, "single")) processed++;
      } catch (err) {
        if (!String(err.message || "").includes("does not exist")) {
          logger.error({ err }, "night audit failed");
        }
      }
    }
    global.__nightAuditWorkerStatus.processedToday += processed;
  });

  logger.info("Night audit worker (pg-boss) registered — nightly 22:00 UTC");
}

module.exports = { registerNightAuditWorker };
