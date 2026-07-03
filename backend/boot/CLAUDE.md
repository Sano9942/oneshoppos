# backend/boot/ — Claude Guide

Single file: `workers.js`. Exports `{ startAll }`, called once from `index.js` after the HTTP server starts listening. This is the **only** place background workers/pollers should be started — don't wire a new `setInterval` elsewhere.

---

## `startAll(deps)`

`deps` includes `db`, `DATA_DIR`, `DB_PATH`, `IS_MULTI_TENANT`, `tenantDbManager`, `asyncStore`, plus a few feature-specific callbacks (`processPendingShopifyInventoryEvents`, `processPendingReportSchedules`).

Two distinct kinds of background work live here, run side by side:

### 1. `setInterval` pollers (always active, no pg-boss)

These start unconditionally (or via a simple env-var kill switch) regardless of whether `DATABASE_URL`/pg-boss is configured:

- **SQLite auto-backup** (`startSqliteBackup`) — only runs when `DATABASE_URL` is NOT set (legacy single-tenant SQLite mode). Copies the DB file daily, keeps last 7. Not relevant to the live Postgres deployment.
- **Cleanup tasks**, run once at boot then every 24h:
  - `cleanupSyncEvents` — deletes `external_sync_events` older than 30 days (`success`/`failed` only)
  - `cleanupReportScheduleArtifacts` — deletes old `report_schedule_runs`/`report_delivery_log` rows (retention configurable via `REPORT_RUNS_RETENTION_DAYS`, `REPORT_DELIVERY_RETENTION_DAYS`) and old files in `backend/exports/reports/` (`REPORT_EXPORT_FILES_RETENTION_DAYS`, default 30). File cleanup is global, not per-tenant.
  - `closeStaleAttendanceSessions` — force-closes `attendance_sessions` rows left open past midnight (`session_end = session_start`, `session_type = 'auto_closed'`)
- **Shopify sync worker** (`startShopifyWorker`) — polls every 30s, calls `processPendingShopifyInventoryEvents(20, ...)`. Disable via `SHOPIFY_SYNC_WORKER_DISABLED=1`.
- **Report schedule worker** (`startReportScheduleWorker`) — polls every 60s, calls `processPendingReportSchedules(5, ...)`. Disable via `REPORT_SCHEDULE_WORKER_DISABLED=1`.
- **Scheduled catalog changes worker** — polls every 60s for `scheduled_catalog_changes` rows due (`status='pending' AND scheduled_at <= NOW()`), applies via `services/catalog-scheduler.js`. Opt-in: `SCHEDULED_CATALOG_WORKER_ENABLED=1`. Exposes `global.__catalogSchedulerStatus`.
- **Booking reminders** — polls every 5 minutes (plus once immediately at boot) via `services/booking-reminders.js:processPendingReminders`, enqueues into the shared pg-boss `email` job (so it's tenant-agnostic once queued). Opt-in: `BOOKING_REMINDER_WORKER_ENABLED=1`. Exposes `global.__bookingReminderWorkerStatus`.

All of the above use the shared **`forEachActiveTenant(label, fn, deps)`** helper: in single-tenant mode it just calls `fn(db, null)`; in multi-tenant mode it loads `SELECT id, slug FROM tenants WHERE status='active'` from the master DB and runs `fn(tenantDb, tenant)` per tenant, with try/catch **per tenant** — one tenant's failure doesn't stop the others (matches the migration-runner convention).

**These pollers do not survive a process crash mid-cycle** — if Railway restarts the dyno, in-flight polling state is lost (though the next poll just picks up whatever's still `pending` in the DB, so this is generally safe by design, not fragile).

### 2. pg-boss workers (only when `DATABASE_URL` is set)

Gated by a single `if (process.env.DATABASE_URL)` block. Fetches the shared `getBoss()` singleton (`services/boss.js`), then conditionally registers each worker via a `tryRegister(label, fn)` wrapper that **catches and logs per-worker** — one worker failing to register never blocks the others from starting.

Each worker is opt-in via its own env var (`<NAME>_WORKER_ENABLED=1`), except **`orphan-schema-scan`**, which defaults **ON** (`ORPHAN_SCHEMA_SCAN_WORKER_ENABLED` defaults to `1`, opt out with `=0`) — it moved a ~104s p100 introspection query off the admin request path.

Registered workers (all live in `backend/workers/*-worker-boss.js`, each exporting `register<Name>Worker(boss, pool)`):

| Env var | Worker file |
|---|---|
| `EMAIL_WORKER_ENABLED` | `email-worker-boss.js` |
| `FBR_WORKER_ENABLED` | `fbr-worker-boss.js` |
| `CLEANUP_WORKER_ENABLED` | `cleanup-worker-boss.js` |
| `ORPHAN_SCHEMA_SCAN_WORKER_ENABLED` (default ON) | `orphan-schema-scan-worker-boss.js` (takes `db`, not `pool`) |
| `MARKETPLACE_SYNC_WORKER_ENABLED` | `marketplace-sync-worker-boss.js` |
| `RESERVATION_WORKER_ENABLED` | `reservation-worker-boss.js` |
| `SUBSCRIPTION_GRACE_WORKER_ENABLED` | `subscription-grace-worker-boss.js` |
| `RENTAL_OVERDUE_WORKER_ENABLED` | `rental-overdue-worker-boss.js` |
| `HOLD_EXPIRY_WORKER_ENABLED` | `hold-expiry-worker-boss.js` |
| `ROOM_OVERDUE_WORKER_ENABLED` | `room-overdue-checkout-worker-boss.js` |
| `TREATMENT_PLAN_WORKER_ENABLED` | `treatment-plan-worker-boss.js` |
| `ABC_WORKER_ENABLED` | `abc-worker-boss.js` |
| `ANOMALY_WORKER_ENABLED` | `anomaly-worker-boss.js` |
| `RETAIL_DIGEST_WORKER_ENABLED` | `retail-digest-worker-boss.js` |
| `SHIFT_AUTO_CLOSE_WORKER_ENABLED` | `shift-auto-close-worker-boss.js` — hourly, force-closes cash shifts older than `company_profile.shift_auto_close_hours` (default 36h), gated by `shift_auto_close` feature flag |
| `ATTENDANCE_AUTO_CLOSE_WORKER_ENABLED` | `attendance-auto-close-worker-boss.js` — daily 9 AM UTC, force-closes day-level attendance rows missing an end-of-day tap, appends "(auto-closed)" |
| `COURSE_RELEASE_WORKER_ENABLED` | `course-release-worker-boss.js` |
| `KDS_SNAPSHOT_WORKER_ENABLED` | `kds-load-snapshot-worker-boss.js` |
| `RESERVATION_REMINDER_WORKER_ENABLED` | `reservation-reminder-worker-boss.js` |

`pool` passed to each `register*Worker` is `db.pool || db` (unwraps to the raw pg Pool if `db` is the proxy).

**pg-boss workers survive process restarts** — jobs are durable rows in Postgres tables managed by pg-boss itself, unlike the `setInterval` pollers above.

---

## Gotchas

- `forEachActiveTenant` lazily `require("../master-db-pg")` inside the function body (not top-level) — this is deliberate to avoid a require-cycle at module load time; don't hoist it.
- The pg-boss registration block is a `.then()` chain off `getBoss()`, not `await`ed — `startAll` itself returns before pg-boss workers finish registering. Don't assume workers are live immediately after `startAll()` returns.
- Two workers use `.status` globals for `GET /api/admin/worker-status` (in `routes/admin/system.js`): `global.__catalogSchedulerStatus` and `global.__bookingReminderWorkerStatus` are set here in `boot/workers.js` directly (not inside the worker files) since they're `setInterval` pollers, not pg-boss registrations. Other workers set their own status globals inside their respective `workers/*-worker-boss.js` files.
- If adding a new pg-boss worker: follow the `tryRegister` pattern, add an env var toggle, and register a status global + a slot in `routes/admin/system.js` worker-status endpoint (see `backend/CLAUDE.md` "Workers — adding a new one" checklist).
