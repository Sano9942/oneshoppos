/**
 * Background workers and scheduled tasks.
 *
 * startAll(deps) kicks off all periodic jobs and inline workers.
 * Called once from index.js after the server is listening.
 */
const fs = require("fs");
const path = require("path");

// ── Worker gate registry ────────────────────────────────────────────────
// Records every worker's env gate at boot — including workers whose env var
// is UNSET — so GET /api/admin/worker-status can distinguish "env var
// missing" (worker shipped but never enabled on Railway) from "enabled but
// stopped" (worker crashed / never registered). Heartbeat globals alone
// cannot make that distinction.
global.__workerRegistry = {};

function recordGate(key, envVar, { defaultOn = false, optOut = false, kind = "pg-boss" } = {}) {
  const raw = process.env[envVar];
  let enabled;
  if (optOut) {
    // envVar DISABLES the worker (e.g. SHOPIFY_SYNC_WORKER_DISABLED=1)
    enabled = String(raw ?? "0") !== "1";
  } else if (defaultOn) {
    enabled = String(raw ?? "1") !== "0";
  } else {
    enabled = String(raw ?? "0") === "1";
  }
  global.__workerRegistry[key] = {
    env_var: envVar,
    env_value: raw === undefined ? null : String(raw),
    env_enabled: enabled,
    default_on: defaultOn,
    opt_out: optOut,
    kind,
    registered: false,
    register_error: null,
  };
  return enabled;
}

function markRegistered(key) {
  const entry = global.__workerRegistry[key];
  if (entry) entry.registered = true;
}

// Helper: run a function for each active tenant (or once for single-tenant)
async function forEachActiveTenant(label, fn, deps) {
  const { db, IS_MULTI_TENANT, tenantDbManager } = deps;
  if (!IS_MULTI_TENANT || !tenantDbManager) {
    try {
      await fn(db, null);
    } catch (err) {
      console.error(`[${label}]`, err.message);
    }
    return;
  }
  try {
    const masterMod = require("../master-db-pg");
    const { rows: tenants } = await masterMod.query(
      "SELECT id, slug FROM tenants WHERE status = 'active'"
    );
    for (const tenant of tenants) {
      try {
        const tenantDb = await tenantDbManager.getDb(tenant.id);
        await fn(tenantDb, tenant);
      } catch (err) {
        console.error(`[${label}] tenant ${tenant.slug}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[${label}] Error loading tenants:`, err.message);
  }
}

// --- Scheduled cleanup tasks ---

async function cleanupSyncEvents(deps) {
  await forEachActiveTenant("SyncCleanup", async (tenantDb) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { rowCount } = await tenantDb.query(
      // 'processed' and 'superseded' are what the Shopify sync actually writes;
      // 'success' was never written, so sent events piled up forever.
      "DELETE FROM external_sync_events WHERE created_at < $1 AND status IN ('success', 'processed', 'superseded', 'failed')",
      [cutoff]
    );
    if (rowCount > 0) console.log(`[SyncCleanup] Deleted ${rowCount} old sync events`);
  }, deps);
}

async function cleanupReportScheduleArtifacts(deps) {
  const runsRetentionDays = Math.max(1, Number(process.env.REPORT_RUNS_RETENTION_DAYS || 45));
  const deliveryRetentionDays = Math.max(1, Number(process.env.REPORT_DELIVERY_RETENTION_DAYS || 60));
  const filesRetentionDays = Math.max(1, Number(process.env.REPORT_EXPORT_FILES_RETENTION_DAYS || 30));
  const runsCutoff = new Date(Date.now() - runsRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deliveryCutoff = new Date(Date.now() - deliveryRetentionDays * 24 * 60 * 60 * 1000).toISOString();

  await forEachActiveTenant("ReportCleanup", async (tenantDb) => {
    try {
      const { rowCount: runsDeleted } = await tenantDb.query(
        "DELETE FROM report_schedule_runs WHERE COALESCE(run_finished_at, run_started_at) < $1::timestamptz",
        [runsCutoff]
      );
      if (runsDeleted > 0) console.log(`[ReportCleanup] Deleted ${runsDeleted} old schedule runs`);
    } catch (err) {
      console.error("[ReportCleanup] run cleanup error:", err.message);
    }
    try {
      const { rowCount: deliveryDeleted } = await tenantDb.query(
        "DELETE FROM report_delivery_log WHERE created_at < $1::timestamptz",
        [deliveryCutoff]
      );
      if (deliveryDeleted > 0) console.log(`[ReportCleanup] Deleted ${deliveryDeleted} old delivery logs`);
    } catch (err) {
      console.error("[ReportCleanup] delivery cleanup error:", err.message);
    }
  }, deps);

  // File cleanup is global (export files are not tenant-scoped)
  const exportsDir = path.resolve(__dirname, "..", "exports", "reports");
  const filesCutoffMs = Date.now() - filesRetentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(exportsDir)) return;
  let deleted = 0;
  for (const fileName of fs.readdirSync(exportsDir)) {
    const filePath = path.join(exportsDir, fileName);
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) continue;
      if (st.mtimeMs < filesCutoffMs) { fs.unlinkSync(filePath); deleted += 1; }
    } catch (e) {
      console.error("[ReportCleanup] file cleanup error:", e.message);
    }
  }
  if (deleted > 0) console.log(`[ReportCleanup] Deleted ${deleted} old export files`);
}

async function closeStaleAttendanceSessions(deps) {
  const { isValidTz } = require("../utils/tz");
  await forEachActiveTenant("StaleSessionCleanup", async (tenantDb) => {
    // "Before today" must be the TENANT-local day: session_start is
    // TIMESTAMPTZ, and a bare ::date / CURRENT_DATE uses the DB session TZ
    // (UTC on prod) — that force-closed overnight staff who clocked in after
    // local midnight, and missed genuinely stale sessions in west-of-UTC zones.
    let tz = "UTC";
    try {
      const { rows: [prof] } = await tenantDb.query(
        "SELECT timezone FROM company_profile WHERE id = 1"
      );
      if (isValidTz(prof?.timezone)) tz = prof.timezone;
    } catch { /* fall back to UTC */ }
    await tenantDb.query(
      `UPDATE attendance_sessions
       SET session_end = session_start, session_type = 'auto_closed'
       WHERE session_end IS NULL
         AND (session_start AT TIME ZONE $1)::date < (NOW() AT TIME ZONE $1)::date`,
      [tz]
    );
  }, deps);
}

// Auto backup only runs in SQLite mode (Postgres uses pg_dump/Supabase backups)
function startSqliteBackup(DATA_DIR, DB_PATH) {
  const BACKUP_DIR = path.resolve(DATA_DIR, "backups");
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  function runAutoBackup() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(BACKUP_DIR, `sanopos_backup_${ts}.db`);
    try {
      fs.copyFileSync(DB_PATH, dest);
      const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith("sanopos_backup_"))
        .sort();
      if (files.length > 7) {
        files
          .slice(0, files.length - 7)
          .forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
      }
      console.log(`[AutoBackup] Saved → ${dest}`);
    } catch (e) {
      console.error("[AutoBackup] Failed:", e.message);
    }
  }

  runAutoBackup();
  setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
}

function startShopifyWorker(deps) {
  const { IS_MULTI_TENANT, tenantDbManager, asyncStore, processPendingShopifyInventoryEvents } = deps;
  if (!recordGate("shopify_sync", "SHOPIFY_SYNC_WORKER_DISABLED", { optOut: true, kind: "poller" })) return;
  global.__shopifySyncWorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 };
  markRegistered("shopify_sync");

  setInterval(async () => {
    global.__shopifySyncWorkerStatus.lastPollAt = Date.now();
    if (!IS_MULTI_TENANT || !tenantDbManager) {
      processPendingShopifyInventoryEvents(20, () => {});
      return;
    }
    try {
      const masterMod = require("../master-db-pg");
      const { rows: tenants } = await masterMod.query("SELECT id, slug FROM tenants WHERE status = 'active'");
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          await asyncStore.run({ db: tenantDb }, async () => {
            await processPendingShopifyInventoryEvents(20, () => {});
          });
        } catch (err) {
          console.error(`[ShopifyWorker] tenant ${tenant.slug}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[ShopifyWorker] Error loading tenants:", err.message);
    }
  }, 30000);
}

// Daily SanoPOS vs Shopify stock check (One Toy Store blocker 2e). Report
// only: saves the comparison for the Reconciliation screen and notifies the
// owner when counts differ; never changes a count. Ticks hourly and runs for a
// tenant when its last check is 23h+ old, so a restart can't skip or double a day.
function startShopifyStockCheckWorker(deps) {
  const { IS_MULTI_TENANT, tenantDbManager, asyncStore, db } = deps;
  if (!recordGate("shopify_stock_check", "SHOPIFY_STOCK_CHECK_WORKER_DISABLED", { optOut: true, kind: "poller" })) return;
  global.__shopifyStockCheckWorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 };
  markRegistered("shopify_stock_check");

  const stockCheck = require("../shopify/stock-check");
  const { getActiveShopifyConnection } = require("../shopify/utils");
  const { decryptShopifySecret } = require("../shopify/crypto");
  const { fetchInventoryLevelsBatch, setShopifyInventory } = require("../shopify/client");

  const tick = async () => {
    global.__shopifyStockCheckWorkerStatus.lastPollAt = Date.now();
    await forEachActiveTenant("ShopifyStockCheck", async (tenantDb) => {
      const run = async () => {
        const conn = await getActiveShopifyConnection(tenantDb, decryptShopifySecret);
        if (!conn) return;
        if (!(await stockCheck.dailyCheckDue(tenantDb))) return;
        await stockCheck.runDailyCheck(tenantDb, conn, { fetchInventoryLevelsBatch, setShopifyInventory });
        global.__shopifyStockCheckWorkerStatus.processedToday += 1;
      };
      if (IS_MULTI_TENANT && asyncStore) await asyncStore.run({ db: tenantDb }, run);
      else await run();
    }, { db, IS_MULTI_TENANT, tenantDbManager });
  };

  setTimeout(() => tick().catch((e) => console.error("[ShopifyStockCheck]", e.message)), 5 * 60 * 1000);
  setInterval(() => tick().catch((e) => console.error("[ShopifyStockCheck]", e.message)), 60 * 60 * 1000);
}

function startReportScheduleWorker(deps) {
  const { IS_MULTI_TENANT, tenantDbManager, asyncStore, processPendingReportSchedules } = deps;
  if (!recordGate("report_schedule", "REPORT_SCHEDULE_WORKER_DISABLED", { optOut: true, kind: "poller" })) return;
  global.__reportScheduleWorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 };
  markRegistered("report_schedule");

  setInterval(async () => {
    global.__reportScheduleWorkerStatus.lastPollAt = Date.now();
    if (!IS_MULTI_TENANT || !tenantDbManager) {
      processPendingReportSchedules(5, () => {});
      return;
    }
    try {
      const masterMod = require("../master-db-pg");
      const { rows: tenants } = await masterMod.query("SELECT id, slug FROM tenants WHERE status = 'active'");
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          await asyncStore.run({ db: tenantDb }, async () => {
            await processPendingReportSchedules(5, () => {});
          });
        } catch (err) {
          console.error(`[ReportScheduler] tenant ${tenant.slug}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[ReportScheduler] Error loading tenants:", err.message);
    }
  }, 60000);
}

function startAll(deps) {
  const { db, DATA_DIR, DB_PATH } = deps;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // SQLite auto-backup (only when no DATABASE_URL)
  if (!process.env.DATABASE_URL) {
    startSqliteBackup(DATA_DIR, DB_PATH);
  }

  // Periodic cleanup tasks — run once on boot, then daily
  cleanupSyncEvents(deps).catch(e => console.error("[SyncCleanup]", e.message));
  cleanupReportScheduleArtifacts(deps).catch(e => console.error("[ReportCleanup]", e.message));
  closeStaleAttendanceSessions(deps).catch(e => console.error("Stale session cleanup error:", e.message));

  setInterval(() => cleanupSyncEvents(deps).catch(e => console.error("[SyncCleanup]", e.message)), DAY_MS);
  setInterval(() => cleanupReportScheduleArtifacts(deps).catch(e => console.error("[ReportCleanup]", e.message)), DAY_MS);
  setInterval(() => closeStaleAttendanceSessions(deps).catch(e => console.error("Stale session cleanup error:", e.message)), DAY_MS);

  // Shopify sync worker
  startShopifyWorker(deps);
  startShopifyStockCheckWorker(deps);

  // Report schedule worker
  startReportScheduleWorker(deps);

  // Scheduled catalog changes worker
  if (recordGate("catalog_scheduler", "SCHEDULED_CATALOG_WORKER_ENABLED", { kind: "poller" })) {
    const { applyScheduledChange } = require("../services/catalog-scheduler");
    global.__catalogSchedulerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 };
    markRegistered("catalog_scheduler");
    const catalogInterval = setInterval(async () => {
      global.__catalogSchedulerStatus.lastPollAt = Date.now();
      try {
        let appliedThisPoll = 0;
        await forEachActiveTenant("catalog-scheduler", async (tenantDb) => {
          const { rows } = await tenantDb.query(
            `SELECT * FROM scheduled_catalog_changes
             WHERE status = 'pending' AND scheduled_at <= NOW()
             ORDER BY scheduled_at ASC
             LIMIT 50`
          );
          for (const change of rows) {
            await applyScheduledChange(tenantDb, change);
            appliedThisPoll += 1;
          }
        }, deps);
        global.__catalogSchedulerStatus.processedToday += appliedThisPoll;
      } catch (err) {
        console.error("[catalog-scheduler] poll error:", err.message);
      }
    }, 60_000);
  }

  // Record every pg-boss worker's env gate up front (even when the env var
  // is unset) so worker-status can flag env-var drift. The `if` blocks below
  // still read process.env directly — recordGate mirrors, never replaces,
  // their semantics. Keys use snake_case to match routes/admin/system.js.
  const PG_BOSS_GATES = [
    ["email", "EMAIL_WORKER_ENABLED"],
    ["fbr", "FBR_WORKER_ENABLED"],
    ["cleanup", "CLEANUP_WORKER_ENABLED"],
    ["orphan_schema_scan", "ORPHAN_SCHEMA_SCAN_WORKER_ENABLED", { defaultOn: true }],
    ["marketplace_sync", "MARKETPLACE_SYNC_WORKER_ENABLED"],
    ["reservation", "RESERVATION_WORKER_ENABLED"],
    ["subscription_grace", "SUBSCRIPTION_GRACE_WORKER_ENABLED"],
    ["subscription_dunning", "SUBSCRIPTION_DUNNING_WORKER_ENABLED"],
    ["rental_overdue", "RENTAL_OVERDUE_WORKER_ENABLED"],
    ["hold_expiry", "HOLD_EXPIRY_WORKER_ENABLED"],
    ["channel_sync", "CHANNEL_SYNC_WORKER_ENABLED"],
    ["night_audit", "NIGHT_AUDIT_WORKER_ENABLED"],
    ["deposit_hold_expiry", "DEPOSIT_HOLD_EXPIRY_WORKER_ENABLED"],
    ["room_overdue", "ROOM_OVERDUE_WORKER_ENABLED"],
    ["treatment_plan", "TREATMENT_PLAN_WORKER_ENABLED"],
    ["recall", "RECALL_WORKER_ENABLED"],
    ["abc", "ABC_WORKER_ENABLED"],
    ["anomaly", "ANOMALY_WORKER_ENABLED"],
    ["expiry_alert", "EXPIRY_ALERT_WORKER_ENABLED"],
    ["retail_digest", "RETAIL_DIGEST_WORKER_ENABLED"],
    ["shift_auto_close", "SHIFT_AUTO_CLOSE_WORKER_ENABLED"],
    ["stock_value_nightly", "STOCK_VALUE_NIGHTLY_WORKER_ENABLED"],
    ["attendance_auto_close", "ATTENDANCE_AUTO_CLOSE_WORKER_ENABLED"],
    ["course_release", "COURSE_RELEASE_WORKER_ENABLED"],
    ["kds_snapshot", "KDS_SNAPSHOT_WORKER_ENABLED"],
    ["reservation_reminder", "RESERVATION_REMINDER_WORKER_ENABLED"],
    ["adoption_snapshot", "ADOPTION_SNAPSHOT_WORKER_ENABLED"],
    ["booking_reminder", "BOOKING_REMINDER_WORKER_ENABLED", { kind: "poller" }],
  ];
  for (const [key, envVar, opts] of PG_BOSS_GATES) recordGate(key, envVar, opts);

  // pg-boss workers — email, FBR, and cleanup (requires DATABASE_URL / Postgres)
  if (process.env.DATABASE_URL) {
    const { getBoss } = require("../services/boss");
    // Isolate each worker registration so one failure doesn't kill the rest.
    // Logs full stack so we can trace which worker actually threw.
    const tryRegister = async (label, fn) => {
      const registryKey = label.replace(/-/g, "_");
      try {
        await fn();
        markRegistered(registryKey);
      } catch (err) {
        const entry = global.__workerRegistry[registryKey];
        if (entry) entry.register_error = err && err.message ? err.message : String(err);
        console.error(`[boss] register ${label} failed:`, err && err.stack ? err.stack : err && err.message ? err.message : err);
      }
    };
    getBoss()
      .then(async (boss) => {
        const pool = db.pool || db;

        if (String(process.env.EMAIL_WORKER_ENABLED || "0") === "1") {
          await tryRegister("email", async () => {
            const { registerEmailWorker } = require("../workers/email-worker-boss");
            await registerEmailWorker(boss, pool);
          });
        }

        if (String(process.env.FBR_WORKER_ENABLED || "0") === "1") {
          await tryRegister("fbr", async () => {
            const { registerFbrWorker } = require("../workers/fbr-worker-boss");
            await registerFbrWorker(boss, pool);
          });
        }

        if (String(process.env.CLEANUP_WORKER_ENABLED || "0") === "1") {
          await tryRegister("cleanup", async () => {
            const { registerCleanupWorker } = require("../workers/cleanup-worker-boss");
            await registerCleanupWorker(boss);
          });
        }

        // Orphan-schema scan defaults ON whenever pg-boss is wired — moves
        // a ~104s p100 introspection query off the admin request path
        // (Phase 1.1 Tier 1, prod snapshot 2026-04-17). Set
        // ORPHAN_SCHEMA_SCAN_WORKER_ENABLED=0 to opt out.
        if (String(process.env.ORPHAN_SCHEMA_SCAN_WORKER_ENABLED || "1") !== "0") {
          await tryRegister("orphan-schema-scan", async () => {
            const { registerOrphanSchemaScanWorker } = require("../workers/orphan-schema-scan-worker-boss");
            await registerOrphanSchemaScanWorker(boss, db);
          });
        }

        if (String(process.env.ADOPTION_SNAPSHOT_WORKER_ENABLED || "0") === "1") {
          await tryRegister("adoption-snapshot", async () => {
            const { registerAdoptionSnapshotWorker } = require("../workers/adoption-snapshot-worker-boss");
            await registerAdoptionSnapshotWorker(boss, db);
          });
        }

        if (String(process.env.MARKETPLACE_SYNC_WORKER_ENABLED || "0") === "1") {
          await tryRegister("marketplace-sync", async () => {
            const { registerMarketplaceSyncWorker } = require("../workers/marketplace-sync-worker-boss");
            await registerMarketplaceSyncWorker(boss, pool);
          });
        }

        if (String(process.env.RESERVATION_WORKER_ENABLED || "0") === "1") {
          await tryRegister("reservation", async () => {
            const { registerReservationWorker } = require("../workers/reservation-worker-boss");
            await registerReservationWorker(boss, pool);
          });
        }

        if (String(process.env.SUBSCRIPTION_GRACE_WORKER_ENABLED || "0") === "1") {
          await tryRegister("subscription-grace", async () => {
            const { registerSubscriptionGraceWorker } = require("../workers/subscription-grace-worker-boss");
            await registerSubscriptionGraceWorker(boss, pool);
          });
        }

        if (String(process.env.SUBSCRIPTION_DUNNING_WORKER_ENABLED || "0") === "1") {
          await tryRegister("subscription-dunning", async () => {
            const { registerSubscriptionDunningWorker } = require("../workers/subscription-dunning-worker-boss");
            await registerSubscriptionDunningWorker(boss, pool);
          });
        }

        if (String(process.env.RENTAL_OVERDUE_WORKER_ENABLED || "0") === "1") {
          await tryRegister("rental-overdue", async () => {
            const { registerRentalOverdueWorker } = require("../workers/rental-overdue-worker-boss");
            await registerRentalOverdueWorker(boss, pool);
          });
        }

        if (String(process.env.HOLD_EXPIRY_WORKER_ENABLED || "0") === "1") {
          await tryRegister("hold-expiry", async () => {
            const { registerHoldExpiryWorker } = require("../workers/hold-expiry-worker-boss");
            await registerHoldExpiryWorker(boss, pool);
          });
        }

        // V10 lodging: OTA iCal import polling + unpaid-reservation TTL sweep.
        if (String(process.env.CHANNEL_SYNC_WORKER_ENABLED || "0") === "1") {
          await tryRegister("channel-sync", async () => {
            const { registerChannelSyncWorker } = require("../workers/channel-sync-worker-boss");
            await registerChannelSyncWorker(boss, pool);
          });
        }

        // V10 lodging: nightly occupancy/ADR/RevPAR snapshot.
        if (String(process.env.NIGHT_AUDIT_WORKER_ENABLED || "0") === "1") {
          await tryRegister("night-audit", async () => {
            const { registerNightAuditWorker } = require("../workers/night-audit-worker-boss");
            await registerNightAuditWorker(boss, pool);
          });
        }

        // F04: releases stale gateway deposit pre-auth holds (rooms/treatments/
        // rentals) so a lapsed hold isn't captured (and declined) at checkout.
        if (String(process.env.DEPOSIT_HOLD_EXPIRY_WORKER_ENABLED || "0") === "1") {
          await tryRegister("deposit-hold-expiry", async () => {
            const { registerDepositHoldExpiryWorker } = require("../workers/deposit-hold-expiry-worker-boss");
            await registerDepositHoldExpiryWorker(boss, pool);
          });
        }

        if (String(process.env.ROOM_OVERDUE_WORKER_ENABLED || "0") === "1") {
          await tryRegister("room-overdue", async () => {
            const { registerRoomOverdueCheckoutWorker } = require("../workers/room-overdue-checkout-worker-boss");
            await registerRoomOverdueCheckoutWorker(boss, pool);
          });
        }

        if (String(process.env.TREATMENT_PLAN_WORKER_ENABLED || "0") === "1") {
          await tryRegister("treatment-plan", async () => {
            const { registerTreatmentPlanWorker } = require("../workers/treatment-plan-worker-boss");
            await registerTreatmentPlanWorker(boss, pool);
          });
        }

        if (String(process.env.RECALL_WORKER_ENABLED || "0") === "1") {
          await tryRegister("recall", async () => {
            const { registerRecallWorker } = require("../workers/recall-worker-boss");
            await registerRecallWorker(boss, pool);
          });
        }

        if (String(process.env.ABC_WORKER_ENABLED || "0") === "1") {
          await tryRegister("abc", async () => {
            const { registerAbcWorker } = require("../workers/abc-worker-boss");
            await registerAbcWorker(boss, pool);
          });
        }

        if (String(process.env.ANOMALY_WORKER_ENABLED || "0") === "1") {
          await tryRegister("anomaly", async () => {
            const { registerAnomalyWorker } = require("../workers/anomaly-worker-boss");
            await registerAnomalyWorker(boss, pool);
          });
        }

        if (String(process.env.EXPIRY_ALERT_WORKER_ENABLED || "0") === "1") {
          await tryRegister("expiry-alert", async () => {
            const { registerExpiryAlertWorker } = require("../workers/expiry-alert-worker-boss");
            await registerExpiryAlertWorker(boss, pool);
          });
        }

        if (String(process.env.RETAIL_DIGEST_WORKER_ENABLED || "0") === "1") {
          await tryRegister("retail-digest", async () => {
            const { registerRetailDigestWorker } = require("../workers/retail-digest-worker-boss");
            await registerRetailDigestWorker(boss, pool);
          });
        }

        // Bucket F (Phase 2-G): hourly sweep that force-closes open cash shifts
        // older than each tenant's `company_profile.shift_auto_close_hours`
        // (default 36h). Tenant-gated by `shift_auto_close` feature flag.
        if (String(process.env.SHIFT_AUTO_CLOSE_WORKER_ENABLED || "0") === "1") {
          await tryRegister("shift-auto-close", async () => {
            const { registerShiftAutoCloseWorker } = require("../workers/shift-auto-close-worker-boss");
            await registerShiftAutoCloseWorker(boss, pool);
          });
        }

        // One Toy Store pilot G2: hourly at :59, saves the stock value at
        // 23:59 shop time for each branch that closed no shift that day.
        if (String(process.env.STOCK_VALUE_NIGHTLY_WORKER_ENABLED || "0") === "1") {
          await tryRegister("stock-value-nightly", async () => {
            const { registerStockValueNightlyWorker } = require("../workers/stock-value-nightly-worker-boss");
            await registerStockValueNightlyWorker(boss, pool);
          });
        }

        // Daily 9 AM UTC sweep that force-closes day-level attendance rows
        // where employee never tapped "End of Day" (check_out NULL,
        // check_in older than yesterday). Stamps check_out from last
        // completed session (or check_in if none) and appends "(auto-closed)".
        if (String(process.env.ATTENDANCE_AUTO_CLOSE_WORKER_ENABLED || "0") === "1") {
          await tryRegister("attendance-auto-close", async () => {
            const { registerAttendanceAutoCloseWorker } = require("../workers/attendance-auto-close-worker-boss");
            await registerAttendanceAutoCloseWorker(boss, pool);
          });
        }

        if (String(process.env.COURSE_RELEASE_WORKER_ENABLED || "0") === "1") {
          await tryRegister("course-release", async () => {
            const { registerCourseReleaseWorker } = require("../workers/course-release-worker-boss");
            await registerCourseReleaseWorker(boss, pool);
          });
        }

        if (String(process.env.KDS_SNAPSHOT_WORKER_ENABLED || "0") === "1") {
          await tryRegister("kds-snapshot", async () => {
            const { registerKdsSnapshotWorker } = require("../workers/kds-load-snapshot-worker-boss");
            await registerKdsSnapshotWorker(boss, pool);
          });
        }

        if (String(process.env.RESERVATION_REMINDER_WORKER_ENABLED || "0") === "1") {
          await tryRegister("reservation-reminder", async () => {
            const { registerReservationReminderWorker } = require("../workers/reservation-reminder-worker-boss");
            await registerReservationReminderWorker(boss, pool);
          });
        }

        // Booking reminders — tenant-aware setInterval poll. Uses
        // forEachActiveTenant to iterate active tenants; the tenant slug is
        // passed to processPendingReminders(tenantDb, boss, slug). Email-channel
        // reminders enqueue via the shared tenant-agnostic "email" job; SMS-channel
        // reminders route through the F05 notification engine (customer-notify),
        // which needs the slug for its pg-boss email payloads and truth logging.
        if (String(process.env.BOOKING_REMINDER_WORKER_ENABLED || "0") === "1") {
          const { processPendingReminders } = require("../services/booking-reminders");
          global.__bookingReminderWorkerStatus = {
            lastPollAt: null,
            processedToday: 0,
            queueDepth: 0,
          };
          markRegistered("booking_reminder");
          const pollIntervalMs = 5 * 60 * 1000; // 5 minutes
          const pollBookingReminders = async () => {
            global.__bookingReminderWorkerStatus.lastPollAt = Date.now();
            let processedThisPoll = 0;
            await forEachActiveTenant("BookingReminders", async (tenantDb, tenant) => {
              const count = await processPendingReminders(tenantDb, boss, tenant && tenant.slug);
              processedThisPoll += count || 0;
            }, deps);
            if (processedThisPoll > 0) {
              global.__bookingReminderWorkerStatus.processedToday += processedThisPoll;
              console.log(`[BookingReminders] Processed ${processedThisPoll} reminders across tenants`);
            }
          };
          // Run once on boot so any reminders due at startup get processed
          // without waiting a full 5 minutes. Fire-and-forget — startup errors
          // are logged by forEachActiveTenant's inner try/catch.
          pollBookingReminders().catch((err) =>
            console.error("[BookingReminders] boot poll error:", err.message)
          );
          setInterval(() => {
            pollBookingReminders().catch((err) =>
              console.error("[BookingReminders] poll error:", err.message)
            );
          }, pollIntervalMs);
          console.log("[BookingReminders] Worker enabled (5-minute poll)");
        }
      })
      .catch((err) => console.error("[boss] Failed to start pg-boss:", err && err.stack ? err.stack : err && err.message ? err.message : err));
  }
}

module.exports = { startAll, recordGate, markRegistered };
