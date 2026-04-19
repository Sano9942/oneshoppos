/**
 * KDS load snapshot worker — pg-boss implementation (Phase 2-R Wave C / 2-R.5).
 *
 * Every 15 min: for each active tenant, record open-ticket count + rolling
 * 60-min average prep_seconds per active kds_station. Drives the trend line
 * in the KDS analytics tab. Retention: 30 days per station.
 *
 * Mirrors the room-overdue-checkout worker pattern.
 */

async function registerKdsSnapshotWorker(boss, pool) {
  const logger = require("../services/logger").child({ component: "kds-snapshot-worker" });

  global.__kdsSnapshotWorkerStatus = global.__kdsSnapshotWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue("kds-load-snapshot");
  await boss.schedule("kds-load-snapshot", "*/15 * * * *");

  await boss.work("kds-load-snapshot", async () => {
    logger.info("Running KDS load-snapshot sweep");
    try {
      global.__kdsSnapshotWorkerStatus.lastPollAt = Date.now();
      let totalInserts = 0;

      if (String(process.env.MULTI_TENANT || "0") === "1") {
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: tenants } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE status = 'active'"
        );
        for (const tenant of tenants) {
          try {
            const tenantDb = await tenantDbMgr.getDb(tenant.id);
            totalInserts += await snapshotForTenant(tenantDb, logger, tenant.slug);
          } catch (err) {
            // Tenants pre-v60 won't have the snapshot table — silently skip.
            if (!String(err.message || "").includes("does not exist")) {
              logger.error({ err, tenantSlug: tenant.slug }, "KDS snapshot failed for tenant");
            }
          }
        }
      } else {
        const db = { query: (text, params) => pool.query(text, params) };
        totalInserts = await snapshotForTenant(db, logger, "single");
      }

      global.__kdsSnapshotWorkerStatus.processedToday += totalInserts;
      logger.info({ inserts: totalInserts }, "KDS load-snapshot sweep complete");
    } catch (err) {
      logger.error({ err }, "KDS load-snapshot sweep error");
      throw err;
    }
  });

  logger.info("KDS load-snapshot worker (pg-boss) registered — every 15 min");
}

/**
 * Capture one snapshot per active kds_stations row for the tenant. Also trims
 * snapshots older than 30 days so the table doesn't grow unbounded.
 * Exported for test access without firing the cron.
 */
async function snapshotForTenant(db, logger, tenantSlug) {
  let inserts = 0;

  const { rows: stations } = await db.query(
    "SELECT id FROM kds_stations WHERE is_active = true"
  );

  for (const station of stations) {
    try {
      const { rows: [counts] } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('new','in_progress'))::int AS open_tickets,
           ROUND(AVG(prep_seconds) FILTER (
             WHERE bumped_at IS NOT NULL
               AND bumped_at >= NOW() - INTERVAL '60 minutes'
           ))::int AS avg_prep_seconds
         FROM kds_tickets
         WHERE station_id = $1`,
        [station.id]
      );
      await db.query(
        `INSERT INTO kds_station_load_snapshots (station_id, open_tickets, avg_prep_seconds)
         VALUES ($1, $2, $3)`,
        [station.id, counts.open_tickets || 0, counts.avg_prep_seconds]
      );
      inserts++;
    } catch (err) {
      logger.error({ err, stationId: station.id, tenantSlug }, "Snapshot insert failed");
    }
  }

  // 30-day retention — trim aggressively to keep the table thin. Each tenant
  // handles its own trimming rather than a global sweep because snapshot rows
  // live inside the tenant schema.
  try {
    await db.query(
      `DELETE FROM kds_station_load_snapshots WHERE recorded_at < NOW() - INTERVAL '30 days'`
    );
  } catch (err) {
    // Swallow — table missing or permission issue shouldn't abort the run.
    logger.warn({ err, tenantSlug }, "Snapshot retention trim failed");
  }

  return inserts;
}

module.exports = { registerKdsSnapshotWorker, snapshotForTenant };
