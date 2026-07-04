/**
 * Marketplace sync worker — pg-boss registration.
 *
 * HONEST STATE (completion-11, 2026-07-05): background marketplace sync is
 * NOT implemented. The previous version scheduled a `marketplace-order-poll`
 * cron (every 10 min) and a `marketplace-feed-check` cron (every 6 h) that
 * iterated every tenant, logged "Polling Daraz orders" / "Checking Google
 * Merchant feed status", and updated a heartbeat — but never called
 * DarazClient/MetaCommerceClient/GoogleMerchantClient. It was decorative: the
 * admin worker-status dashboard showed it "running" while it did nothing, and
 * it burned a per-tenant DB fanout every 10 minutes for no result.
 *
 * A read-only production audit (all active tenants) found ZERO tenants with an
 * active marketplace integration configured, so wiring real polling is not
 * justified yet. Marketplace sync is MANUAL — the tenant triggers it from the
 * Integrations Hub (Pull Orders / Sync Products, which DO call the live
 * adapters via routes/integrations/{daraz,facebook,google-merchant}.js).
 *
 * This registration therefore:
 *   - schedules NOTHING (no dead crons, no per-tenant fanout),
 *   - best-effort UNSCHEDULES any legacy schedule a prior deploy may have left
 *     in pgboss so the decorative crons stop firing,
 *   - exposes a heartbeat marked `mode: "manual"` so worker-status is honest.
 *
 * If a real tenant ever depends on background sync, wire the three client calls
 * inside `withTenantContext()` (see workers/tenant-job-context.js) and restore
 * the cron schedules — do NOT re-introduce the log-only stub.
 *
 * Env: MARKETPLACE_SYNC_WORKER_ENABLED=1
 * Heartbeat: global.__marketplaceSyncWorkerStatus
 */

const logger = require("../services/logger").child({ component: "marketplace-sync-worker" });

// Legacy queue/schedule names the decorative version registered. Kept here only
// so we can unschedule them defensively on boot.
const LEGACY_SCHEDULES = ["marketplace-order-poll", "marketplace-feed-check"];

global.__marketplaceSyncWorkerStatus = {
  lastPollAt: null,
  processedToday: 0,
  queueDepth: 0,
  mode: "manual", // read by GET /api/admin/worker-status
  note: "Background auto-sync not implemented — marketplace sync is manual via the Integrations Hub.",
};

async function registerMarketplaceSyncWorker(boss /* , pool */) {
  // Remove any leftover decorative schedules from earlier deploys so the empty
  // cron stops firing. Best-effort — a fresh pg-boss (nothing scheduled) or an
  // older API just no-ops here.
  for (const name of LEGACY_SCHEDULES) {
    try {
      if (typeof boss.unschedule === "function") {
        await boss.unschedule(name);
      }
    } catch (err) {
      // Not fatal — nothing to unschedule, or the queue never existed.
      logger.debug({ err, schedule: name }, "No legacy marketplace schedule to remove");
    }
  }

  logger.info(
    "Marketplace sync worker registered as MANUAL-ONLY — background polling is not implemented; " +
      "tenants sync via the Integrations Hub (Pull Orders / Sync Products). No cron scheduled."
  );
}

module.exports = { registerMarketplaceSyncWorker };
