/**
 * Course-release worker — pg-boss implementation (Phase 2.1 A3).
 *
 * Every 30 seconds, across all active tenants, releases held course fires
 * whose `hold_until` has elapsed. For each released course it flips
 * restaurant_course_fires.status from 'held' → 'fired' and calls
 * sendToKitchen so the matching course items land on the KDS.
 *
 * pg-boss schedules cron-style. This worker uses "* * * * *" (once per
 * minute — pg-boss does not support sub-minute cron). The plan calls for
 * 30s but pg-boss cron granularity is 1 minute — a 1-minute delay on a
 * course that should have fired at 8 PM is acceptable for kitchen pacing,
 * and avoids the complexity of a non-pg-boss setInterval. Env toggle is
 * COURSE_RELEASE_WORKER_ENABLED=1.
 */

async function registerCourseReleaseWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "course-release-worker" });
  const checksSvc = require("../services/restaurant-checks");

  global.__courseReleaseWorkerStatus = global.__courseReleaseWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("course-release-sweep");
  await boss.schedule("course-release-sweep", "* * * * *");

  await boss.work("course-release-sweep", async () => {
    try {
      global.__courseReleaseWorkerStatus.lastPollAt = Date.now();
      let totalReleased = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            const n = await checksSvc.releaseHeldCourses(tenantDb, null);
            totalReleased += n;
          } catch (err) {
            // Skip tenants where restaurant_course_fires table doesn't exist.
            if (!/does not exist/i.test(err.message)) {
              logger.error({ err, tenantSlug: tenant.slug }, "Course release failed for tenant");
            }
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        try {
          totalReleased = await checksSvc.releaseHeldCourses(db, null);
        } catch (err) {
          if (!/does not exist/i.test(err.message)) throw err;
        }
      }

      // Measure queue depth as the count of overdue held rows pending —
      // a positive number means the worker is behind. Only meaningful in
      // single-tenant mode (MT aggregation would need cross-tenant sum).
      try {
        if (String(process.env.MULTI_TENANT || "0") !== "1") {
          const { rows: [{ n }] } = await pool.query(
            `SELECT COUNT(*)::int AS n
             FROM restaurant_course_fires
             WHERE status = 'held' AND hold_until IS NOT NULL AND hold_until <= NOW()`
          );
          global.__courseReleaseWorkerStatus.queueDepth = n;
        }
      } catch { /* table may not exist */ }

      global.__courseReleaseWorkerStatus.processedToday += totalReleased;
      if (totalReleased > 0) {
        logger.info({ released: totalReleased }, "Course-release sweep complete");
      }
    } catch (err) {
      logger.error({ err }, "Course-release sweep error");
      throw err;
    }
  });

  logger.info("Course-release worker (pg-boss) registered — every minute");
}

module.exports = { registerCourseReleaseWorker };
