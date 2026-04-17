/**
 * Background workers and scheduled tasks.
 *
 * startAll(deps) kicks off all periodic jobs and inline workers.
 * Called once from index.js after the server is listening.
 */
const fs = require("fs");
const path = require("path");

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
      "DELETE FROM external_sync_events WHERE created_at < $1 AND status IN ('success', 'failed')",
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
  await forEachActiveTenant("StaleSessionCleanup", async (tenantDb) => {
    await tenantDb.query(
      `UPDATE attendance_sessions
       SET session_end = session_start, session_type = 'auto_closed'
       WHERE session_end IS NULL AND session_start::date < CURRENT_DATE`
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
  if (String(process.env.SHOPIFY_SYNC_WORKER_DISABLED || "0") === "1") return;

  setInterval(async () => {
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

function startReportScheduleWorker(deps) {
  const { IS_MULTI_TENANT, tenantDbManager, asyncStore, processPendingReportSchedules } = deps;
  if (String(process.env.REPORT_SCHEDULE_WORKER_DISABLED || "0") === "1") return;

  setInterval(async () => {
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

  // Report schedule worker
  startReportScheduleWorker(deps);

  // Scheduled catalog changes worker
  if (process.env.SCHEDULED_CATALOG_WORKER_ENABLED === "1") {
    const { applyScheduledChange } = require("../services/catalog-scheduler");
    const catalogInterval = setInterval(async () => {
      try {
        await forEachActiveTenant("catalog-scheduler", async (tenantDb) => {
          const { rows } = await tenantDb.query(
            `SELECT * FROM scheduled_catalog_changes
             WHERE status = 'pending' AND scheduled_at <= NOW()
             ORDER BY scheduled_at ASC
             LIMIT 50`
          );
          for (const change of rows) {
            await applyScheduledChange(tenantDb, change);
          }
        }, deps);
      } catch (err) {
        console.error("[catalog-scheduler] poll error:", err.message);
      }
    }, 60_000);
    global.__catalogSchedulerStatus = { lastPollAt: null, processedToday: 0 };
  }

  // pg-boss workers — email, FBR, and cleanup (requires DATABASE_URL / Postgres)
  if (process.env.DATABASE_URL) {
    const { getBoss } = require("../services/boss");
    getBoss()
      .then(async (boss) => {
        const pool = db.pool || db;

        if (String(process.env.EMAIL_WORKER_ENABLED || "0") === "1") {
          const { registerEmailWorker } = require("../workers/email-worker-boss");
          await registerEmailWorker(boss, pool);
        }

        if (String(process.env.FBR_WORKER_ENABLED || "0") === "1") {
          const { registerFbrWorker } = require("../workers/fbr-worker-boss");
          await registerFbrWorker(boss, pool);
        }

        if (String(process.env.CLEANUP_WORKER_ENABLED || "0") === "1") {
          const { registerCleanupWorker } = require("../workers/cleanup-worker-boss");
          await registerCleanupWorker(boss);
        }

        // Orphan-schema scan defaults ON whenever pg-boss is wired — moves
        // a ~104s p100 introspection query off the admin request path
        // (Phase 1.1 Tier 1, prod snapshot 2026-04-17). Set
        // ORPHAN_SCHEMA_SCAN_WORKER_ENABLED=0 to opt out.
        if (String(process.env.ORPHAN_SCHEMA_SCAN_WORKER_ENABLED || "1") !== "0") {
          const { registerOrphanSchemaScanWorker } = require("../workers/orphan-schema-scan-worker-boss");
          await registerOrphanSchemaScanWorker(boss, db);
        }

        if (String(process.env.MARKETPLACE_SYNC_WORKER_ENABLED || "0") === "1") {
          const { registerMarketplaceSyncWorker } = require("../workers/marketplace-sync-worker-boss");
          await registerMarketplaceSyncWorker(boss, pool);
        }

        if (String(process.env.RESERVATION_WORKER_ENABLED || "0") === "1") {
          const { registerReservationWorker } = require("../workers/reservation-worker-boss");
          await registerReservationWorker(boss, pool);
        }

        if (String(process.env.SUBSCRIPTION_GRACE_WORKER_ENABLED || "0") === "1") {
          const { registerSubscriptionGraceWorker } = require("../workers/subscription-grace-worker-boss");
          await registerSubscriptionGraceWorker(boss, pool);
        }

        if (String(process.env.RENTAL_OVERDUE_WORKER_ENABLED || "0") === "1") {
          const { registerRentalOverdueWorker } = require("../workers/rental-overdue-worker-boss");
          await registerRentalOverdueWorker(boss, pool);
        }

        if (String(process.env.ROOM_OVERDUE_WORKER_ENABLED || "0") === "1") {
          const { registerRoomOverdueCheckoutWorker } = require("../workers/room-overdue-checkout-worker-boss");
          await registerRoomOverdueCheckoutWorker(boss, pool);
        }

        if (String(process.env.TREATMENT_PLAN_WORKER_ENABLED || "0") === "1") {
          const { registerTreatmentPlanWorker } = require("../workers/treatment-plan-worker-boss");
          await registerTreatmentPlanWorker(boss, pool);
        }

        if (String(process.env.COURSE_RELEASE_WORKER_ENABLED || "0") === "1") {
          const { registerCourseReleaseWorker } = require("../workers/course-release-worker-boss");
          await registerCourseReleaseWorker(boss, pool);
        }

        // Booking reminders — tenant-aware setInterval poll. Uses
        // forEachActiveTenant to iterate active tenants (since it's a
        // scheduled poll, not a per-event job — there's no tenantSlug
        // to pull from a payload). Each iteration calls
        // processPendingReminders(tenantDb, boss), which SELECTs
        // pending appointment_reminders rows and enqueues them via the
        // shared "email" job. The email worker is tenant-agnostic —
        // it just calls Resend — so no further routing is needed.
        if (String(process.env.BOOKING_REMINDER_WORKER_ENABLED || "0") === "1") {
          const { processPendingReminders } = require("../services/booking-reminders");
          global.__bookingReminderWorkerStatus = {
            lastPollAt: null,
            processedToday: 0,
            queueDepth: 0,
          };
          const pollIntervalMs = 5 * 60 * 1000; // 5 minutes
          const pollBookingReminders = async () => {
            global.__bookingReminderWorkerStatus.lastPollAt = Date.now();
            let processedThisPoll = 0;
            await forEachActiveTenant("BookingReminders", async (tenantDb) => {
              const count = await processPendingReminders(tenantDb, boss);
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
      .catch((err) => console.error("[boss] Failed to start pg-boss:", err.message));
  }
}

module.exports = { startAll };
