/**
 * Adoption-snapshot worker — pg-boss implementation.
 *
 * Fans out over every active tenant and records which feature flags + vertical
 * modes each has enabled, plus a usage count per mode (from
 * config/vertical-usage-sources.js). The aggregate is persisted to
 * `public.infra_cache` under key `feature_adoption`, so the admin endpoint
 * `GET /api/admin/adoption` serves it without a live cross-tenant fanout.
 *
 * Cron: every 6 hours (adoption changes slowly). Read-only.
 *
 * Env: ADOPTION_SNAPSHOT_WORKER_ENABLED=1 (opt-in). Without it the worker never
 * registers and the worker-status panel flags it as ENV VAR MISSING.
 */

const { VALID_MODES } = require("../config/mode-registry");
const { VERTICAL_USAGE_SOURCES } = require("../config/vertical-usage-sources");

const QUEUE_NAME = "adoption-snapshot";
const CACHE_KEY = "feature_adoption";
const SLUG_RE = /^[a-z0-9_]{3,40}$/;

async function snapshotTenant(db, tenant) {
  const s = `tenant_${tenant.slug}`;
  const row = {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    industry_type: null,
    enabled_modes: [],
    enabled_flags: [],
    enabled_flag_count: 0,
    mode_usage: {}, // mode -> summed count across its sources
  };

  try {
    const { rows: [profile] } = await db.query(`SELECT industry_type FROM ${s}.company_profile WHERE id = 1`);
    row.industry_type = profile?.industry_type || null;
  } catch { /* pre-preset schema */ }

  try {
    const { rows } = await db.query(`SELECT key FROM ${s}.feature_flags WHERE enabled = true ORDER BY key`);
    row.enabled_flags = rows.map((r) => r.key);
    row.enabled_flag_count = row.enabled_flags.length;
  } catch { /* feature_flags missing */ }

  try {
    const { rows } = await db.query(`SELECT mode FROM ${s}.tenant_modes WHERE enabled = true ORDER BY mode`);
    row.enabled_modes = rows.map((r) => r.mode);
  } catch { /* tenant_modes missing */ }

  for (const src of VERTICAL_USAGE_SOURCES) {
    if (!src.mode) continue; // only mode-linked sources feed the matrix columns
    const where = src.where ? ` WHERE ${src.where}` : "";
    try {
      const { rows: [c] } = await db.query(`SELECT COUNT(*)::int AS count FROM ${s}.${src.table}${where}`);
      row.mode_usage[src.mode] = (row.mode_usage[src.mode] || 0) + (c?.count || 0);
    } catch { /* table missing on this schema — skip */ }
  }

  return row;
}

async function runSnapshot(db) {
  const started = Date.now();

  const { rows: tenants } = await db.query(
    "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
  );

  const rows = [];
  const flagAdoption = {}; // flag -> count of tenants with it on
  const modeAdoption = {}; // mode -> count of tenants with it on
  for (const m of VALID_MODES) modeAdoption[m] = 0;

  for (const tenant of tenants) {
    if (!SLUG_RE.test(tenant.slug)) continue; // never interpolate an unsafe slug
    try {
      const row = await snapshotTenant(db, tenant);
      rows.push(row);
      for (const f of row.enabled_flags) flagAdoption[f] = (flagAdoption[f] || 0) + 1;
      for (const mode of row.enabled_modes) {
        if (mode in modeAdoption) modeAdoption[mode] += 1;
      }
    } catch {
      /* one tenant failing must not abort the sweep */
    }
  }

  const durationMs = Date.now() - started;
  const payload = {
    generated_at: new Date().toISOString(),
    tenant_count: rows.length,
    modes: VALID_MODES,
    tenants: rows,
    flag_adoption: flagAdoption,
    mode_adoption: modeAdoption,
  };

  await db.query(
    `INSERT INTO public.infra_cache (cache_key, payload, computed_at, duration_ms)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (cache_key)
     DO UPDATE SET payload = EXCLUDED.payload,
                   computed_at = EXCLUDED.computed_at,
                   duration_ms = EXCLUDED.duration_ms`,
    [CACHE_KEY, JSON.stringify(payload), durationMs]
  );

  return { ...payload, durationMs };
}

async function registerAdoptionSnapshotWorker(boss, db) {
  const logger = require("../services/logger").child({ component: "adoption-snapshot-worker-boss" });

  global.__adoptionSnapshotWorkerStatus = global.__adoptionSnapshotWorkerStatus || {
    lastPollAt: null,
    processedToday: 0,
    queueDepth: 0,
  };

  await boss.createQueue(QUEUE_NAME);
  await boss.schedule(QUEUE_NAME, "0 */6 * * *"); // every 6 hours

  await boss.work(QUEUE_NAME, async () => {
    logger.info("Running adoption snapshot (pg-boss)");
    try {
      global.__adoptionSnapshotWorkerStatus.lastPollAt = Date.now();
      const result = await runSnapshot(db);
      global.__adoptionSnapshotWorkerStatus.processedToday += 1;
      logger.info({ tenant_count: result.tenant_count, duration_ms: result.durationMs }, "Adoption snapshot complete");
    } catch (err) {
      logger.error({ err }, "Adoption snapshot error");
      throw err;
    }
  });

  // Warm the cache once at boot so /admin/adoption isn't empty before the first
  // 6-hour tick. Not awaited — a slow fanout must not block server startup.
  runSnapshot(db)
    .then((r) => {
      global.__adoptionSnapshotWorkerStatus.lastPollAt = Date.now();
      logger.info({ tenant_count: r.tenant_count, duration_ms: r.durationMs }, "Adoption snapshot warmup done");
    })
    .catch((err) => logger.error({ err }, "Adoption snapshot warmup failed"));

  logger.info("Adoption snapshot worker (pg-boss) registered — every 6h");
}

module.exports = { registerAdoptionSnapshotWorker, runSnapshot, QUEUE_NAME, CACHE_KEY };
