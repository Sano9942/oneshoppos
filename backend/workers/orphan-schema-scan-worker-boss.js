/**
 * Orphan-schema scan worker — pg-boss implementation.
 *
 * Scans `tenant_*` schemas that no longer have a row in `public.tenants`
 * and persists the result + per-schema size into `public.infra_cache`
 * under key `orphaned_schemas`. The admin endpoint
 * `GET /api/admin/orphaned-schemas` then reads the cached row instead of
 * doing a live scan, which previously took up to ~104s p100 in prod
 * (Phase 1.1 prod snapshot, 2026-04-17).
 *
 * Cron: hourly. The scan itself is read-only — DROP SCHEMA still happens
 * inline via POST /api/admin/orphaned-schemas/cleanup.
 */

const QUEUE_NAME = "orphan-schema-scan";

async function runScan(db) {
  const started = Date.now();

  const { rows: schemas } = await db.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`
  );
  const { rows: tenants } = await db.query("SELECT slug FROM tenants");
  const tenantSlugs = new Set(tenants.map((t) => `tenant_${t.slug}`));

  const orphans = [];
  for (const s of schemas) {
    if (!tenantSlugs.has(s.schema_name)) {
      const { rows: [size] } = await db.query(
        `SELECT pg_size_pretty(
           COALESCE(SUM(pg_total_relation_size(quote_ident($1)||'.'||quote_ident(tablename)))::bigint, 0)
         ) AS size
         FROM pg_tables WHERE schemaname = $1`,
        [s.schema_name]
      );
      orphans.push({ schema: s.schema_name, size: size.size });
    }
  }

  const durationMs = Date.now() - started;
  const payload = { orphans, count: orphans.length };

  await db.query(
    `INSERT INTO public.infra_cache (cache_key, payload, computed_at, duration_ms)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (cache_key)
     DO UPDATE SET payload = EXCLUDED.payload,
                   computed_at = EXCLUDED.computed_at,
                   duration_ms = EXCLUDED.duration_ms`,
    ["orphaned_schemas", JSON.stringify(payload), durationMs]
  );

  return { ...payload, durationMs };
}

async function registerOrphanSchemaScanWorker(boss, db) {
  const logger = require("../services/logger").child({ component: "orphan-schema-scan-worker-boss" });

  global.__orphanSchemaScanWorkerStatus = global.__orphanSchemaScanWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue(QUEUE_NAME);
  await boss.schedule(QUEUE_NAME, "0 * * * *"); // top of every hour

  await boss.work(QUEUE_NAME, async () => {
    logger.info("Running orphan-schema scan (pg-boss)");
    try {
      global.__orphanSchemaScanWorkerStatus.lastPollAt = Date.now();
      const result = await runScan(db);
      global.__orphanSchemaScanWorkerStatus.processedToday += 1;
      logger.info(
        { count: result.count, duration_ms: result.durationMs },
        "Orphan-schema scan complete"
      );
    } catch (err) {
      logger.error({ err }, "Orphan-schema scan error");
      throw err;
    }
  });

  // Run once at boot so the cache is warm even before the first cron tick.
  // Don't await — we don't want a slow scan to block server startup.
  runScan(db)
    .then((r) => {
      global.__orphanSchemaScanWorkerStatus.lastPollAt = Date.now();
      logger.info({ count: r.count, duration_ms: r.durationMs }, "Orphan-schema warmup scan done");
    })
    .catch((err) => logger.error({ err }, "Orphan-schema warmup scan failed"));

  logger.info("Orphan-schema scan worker (pg-boss) registered — hourly");
}

module.exports = { registerOrphanSchemaScanWorker, runScan, QUEUE_NAME };
