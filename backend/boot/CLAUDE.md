# backend/boot/ — Claude Guide

Single file: `workers.js`. Exports `{ startAll, recordGate, markRegistered }`. `startAll(deps)` is called once from `index.js` after the HTTP server starts listening. This is the **only** place background workers/pollers should be started — don't wire a new `setInterval` elsewhere.

---

## Worker gate registry

`global.__workerRegistry` is populated at boot by `recordGate(key, envVar, opts)` for every worker — including ones whose env var is unset — so `GET /api/admin/worker-status` can tell "env var missing" (shipped but never enabled on Railway) apart from "enabled but stopped" (crashed / never registered). Heartbeat globals alone can't make that distinction.

- `recordGate(key, envVar, { defaultOn, optOut, kind })` — three gate styles: default-off (`enabled = envVar === "1"`), default-on (`enabled = envVar !== "0"`), and opt-out (`optOut: true`, envVar *disables* the worker, e.g. `SHOPIFY_SYNC_WORKER_DISABLED=1`).
- `markRegistered(key)` flips `registered: true` once the worker actually starts. For pg-boss workers, a `register_error` field is also recorded if `tryRegister` catches a failure.
- Every `setInterval` poller AND every pg-boss worker calls `recordGate`/`markRegistered` — if you add a new worker, wire both or `worker-status` will silently omit it.

## `forEachActiveTenant(label, fn, deps)`

Shared iteration helper used by every poller below. Single-tenant mode: calls `fn(db, null)` directly. Multi-tenant mode: lazily `require("../master-db-pg")` (deliberately inside the function body, not top-level, to avoid a require-cycle — don't hoist it), loads `SELECT id, slug FROM tenants WHERE status='active'`, then calls `fn(tenantDb, tenant)` per tenant with **per-tenant try/catch** — one tenant's failure never stops the others (errors are only `console.error`'d with the tenant slug, not re-thrown).

## `setInterval` pollers (no pg-boss, always eligible to run)

- **SQLite auto-backup** (`startSqliteBackup`) — only runs when `DATABASE_URL` is unset (legacy single-tenant SQLite). Copies the DB file daily, keeps the last 7. Irrelevant to the live Postgres deployment.
- **Cleanup tasks**, run once at boot then every 24h:
  - `cleanupSyncEvents` — deletes `external_sync_events` older than 30 days (`success`/`failed` only), per tenant.
  - `cleanupReportScheduleArtifacts` — deletes old `report_schedule_runs`/`report_delivery_log` rows per tenant (retention via `REPORT_RUNS_RETENTION_DAYS` / `REPORT_DELIVERY_RETENTION_DAYS`, default 45/60 days), plus old files under `backend/exports/reports/` (`REPORT_EXPORT_FILES_RETENTION_DAYS`, default 30) — file cleanup is global (not per-tenant), scanning one shared directory.
  - `closeStaleAttendanceSessions` — force-closes `attendance_sessions` rows left open past midnight. **Tenant-local day boundary**: reads `company_profile.timezone` per tenant (via `utils/tz.js:isValidTz`) and compares `(session_start AT TIME ZONE tz)::date < (NOW() AT TIME ZONE tz)::date` — a bare `CURRENT_DATE`/UTC comparison here previously force-closed overnight shifts early for tenants west of UTC. Falls back to UTC if the timezone column is missing/invalid.
- **Shopify sync worker** (`startShopifyWorker`) — polls every 30s, calls `processPendingShopifyInventoryEvents(20, ...)` per tenant (wrapped in `asyncStore.run` to wire the tenant DB proxy in MT mode). Gate is opt-out: `SHOPIFY_SYNC_WORKER_DISABLED=1` to disable. Exposes `global.__shopifySyncWorkerStatus = { lastPollAt, processedToday, queueDepth }`.
- **Report schedule worker** (`startReportScheduleWorker`) — polls every 60s, calls `processPendingReportSchedules(5, ...)` per tenant. Opt-out: `REPORT_SCHEDULE_WORKER_DISABLED=1`. Exposes `global.__reportScheduleWorkerStatus`.
- **Scheduled catalog changes worker** — polls every 60s for `scheduled_catalog_changes` rows due (`status='pending' AND scheduled_at <= NOW()`, limit 50), applies each via `services/catalog-scheduler.js:applyScheduledChange`. Opt-in: `SCHEDULED_CATALOG_WORKER_ENABLED=1`. Exposes `global.__catalogSchedulerStatus`.
- **Booking reminders** — polls every 5 minutes (plus once immediately at boot, fire-and-forget, so anything due right at startup doesn't wait a full cycle) via `services/booking-reminders.js:processPendingReminders(tenantDb, boss, slug)`. Email-channel reminders enqueue into the shared pg-boss `email` job; SMS-channel reminders route through the notification engine, which needs the tenant slug for its logging. Opt-in: `BOOKING_REMINDER_WORKER_ENABLED=1`. Exposes `global.__bookingReminderWorkerStatus`. Registered inside the pg-boss block below (it needs the `boss` instance to enqueue email jobs) but is itself a `setInterval` poller, not a pg-boss job — it does not survive a process crash mid-cycle the way pg-boss jobs do.

These pollers (except booking reminders' boot-time run) don't survive a process crash mid-cycle, but that's generally safe by design — the next poll just picks up whatever's still pending in the DB.

## pg-boss workers (only when `DATABASE_URL` is set)

Gated by a single `if (process.env.DATABASE_URL)` block. Fetches the shared `getBoss()` singleton (`services/boss.js`), then conditionally registers each worker via `tryRegister(label, fn)`, which catches and logs per-worker (full stack trace on failure, plus a `register_error` string stashed on the registry entry) — one worker failing to register never blocks the others.

Each worker is opt-in via its own `<NAME>_WORKER_ENABLED=1` env var, **except `orphan-schema-scan`**, which defaults ON (moved a very slow cross-schema introspection query off the admin request path; opt out with `ORPHAN_SCHEMA_SCAN_WORKER_ENABLED=0`).

Workers registered here (all live in `backend/workers/*-worker-boss.js`, each exporting `register<Name>Worker(boss, pool)` unless noted): email, FBR, cleanup, orphan-schema-scan (takes `db` not `pool`), adoption-snapshot (takes `db`), marketplace-sync, reservation, subscription-grace, subscription-dunning, rental-overdue, hold-expiry, channel-sync, night-audit, deposit-hold-expiry, room-overdue, treatment-plan, recall, abc, anomaly, expiry-alert, retail-digest, shift-auto-close, attendance-auto-close, course-release, kds-snapshot, reservation-reminder.

`pool` passed to each `register*Worker` is `db.pool || db` (unwraps to the raw `pg` `Pool` if `db` is the tenant proxy).

**pg-boss workers survive process restarts** — jobs are durable rows in Postgres tables managed by pg-boss itself, unlike the `setInterval` pollers above.

---

## Gotchas

- The pg-boss registration block is a `.then()` chain off `getBoss()`, not `await`ed — `startAll` returns synchronously before pg-boss workers finish registering. Don't assume a worker is live immediately after `startAll()` returns.
- `global.__catalogSchedulerStatus` and `global.__bookingReminderWorkerStatus` are set directly in this file (they're pollers, not pg-boss registrations); every other worker sets its own status global inside its own `workers/*-worker-boss.js` file.
- `PG_BOSS_GATES` (the array of `[key, envVar, opts]` near the top of `startAll`) is purely for registry bookkeeping — it runs `recordGate` for every pg-boss worker up front, even the ones this file never conditionally registers below it if you forget to wire them. The actual `if (process.env.X === "1")` conditionals further down are the real gate and are **not derived from this array** — keep both lists in sync by hand when adding a worker.
- If adding a new worker: create the worker file under `workers/`, add an env var toggle, call `recordGate`/`markRegistered` (or wrap registration in `tryRegister` for pg-boss workers), expose a `global.__<name>WorkerStatus`, and add a slot to `GET /api/admin/worker-status` in `routes/admin/system.js`. Missing any one of these steps means the worker runs but is invisible to ops tooling.
- Module-gated workers (rental-overdue, room-overdue, night-audit, treatment-plan, hold-expiry, kds-snapshot, course-release, reservation-reminder, channel-sync, plus booking-reminders) each check the relevant tenant `feature_flags` row inside their own per-tenant loop and no-op when the flag is off — disabling a Business Module pauses its background processing without losing data. `reservation-worker-boss.js` (stale inventory reservations) is deliberately **not** gated this way — expiring a reservation releases held stock, and pausing it would strand that stock as unavailable.
