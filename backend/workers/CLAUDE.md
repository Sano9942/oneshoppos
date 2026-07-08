# Workers — Claude Guide

Background workers started from `boot/workers.js`, which mixes pg-boss jobs with `setInterval` pollers — not everything under `boot/workers.js` lives here (e.g. Shopify sync poll, report schedule poll, catalog scheduler, booking reminders are inline in `boot/workers.js` itself, not in this directory). Every file here exports `register<Name>Worker(boss, pool)`, registered conditionally from `boot/workers.js` behind its own env var (see `backend/boot/CLAUDE.md` for the full registration table).

Heartbeat shape is always `{ lastPollAt: number|null, processedToday: number, queueDepth: number }`, exposed as `global.__<name>WorkerStatus` and read by `GET /api/admin/worker-status` (`routes/admin/system.js`).

Several worker files call `boss.schedule()`/`boss.work()` directly without a visible `createQueue()` call in older files — pg-boss v12+ requires explicit queue creation, so newer files call `boss.createQueue()` first; follow whichever pattern the nearest similar file uses.

---

## `tenant-job-context.js`

Exports: `withTenantContext(pool, tenantSlug, fn)`, `assertSafeSlug(slug)`

pg-boss jobs run outside any HTTP request, so they can't reach the AsyncLocalStorage
proxy (`tenant-db-proxy-pg.js`) that route handlers use. This helper is the alternative:
it acquires one dedicated client from the pool, runs `SET search_path TO tenant_<slug>,
public`, invokes `fn(db)`, then **always** resets `search_path TO public` and releases
the client in `finally` — even on error — so a tenant scope never leaks to the next
consumer of that pooled connection.

**`db` shape exposed to `fn`**: `{ query(sql, params), transaction(fn) }` only — no
`.pool`, no `.getClient()`. Service functions written against the full `db-pg.js`
interface will not work if handed this proxy directly.

**Slug validation**: `SLUG_PATTERN = /^[a-z0-9_]+$/`. `search_path` can't take a
parameterized placeholder, so the slug is validated then interpolated — hyphens or any
other character fail closed via `assertSafeSlug()`.

The FBR worker (below) does NOT use this helper — it interpolates `tenant_<slug>.` into
every SQL string directly instead. That's the older, more error-prone pattern; new
workers should prefer `withTenantContext`.

---

## `email-worker-boss.js`

Export: `registerEmailWorker(boss, pool)`
Env: `EMAIL_WORKER_ENABLED=1` — also requires `RESEND_API_KEY`; returns early (no queues
registered) if the key is missing
Heartbeat: `global.__emailWorkerStatus`

**6 queues:**

| Queue | Trigger | Concurrency | What it does |
|---|---|---|---|
| `email` | on-demand | teamSize 5 / teamConcurrency 5 | Send one email via Resend. Updates `queueDepth` from `pgboss.job WHERE state IN ('created','retry')` after each send. |
| `billing-lifecycle-check` | cron `0 * * * *` (hourly) | default | 7-step tenant billing lifecycle sweep against `public.tenants` (below). |
| `campaign-email` | on-demand | teamSize 5 / teamConcurrency 5 | Send one marketing delivery. Sends via Resend first, then updates `marketing_campaign_deliveries`, optionally rolls up `marketing_campaigns.status`. |
| `campaign-scheduled-send` | on-demand/delayed | default | Fan out a scheduled campaign via `services/marketing.enqueueCampaignSend()`. Requires `tenantSlug`. Uses `withTenantContext`. |
| `invoice-reminder` | on-demand | default | Send a reminder for one customer invoice. Skips if already `paid`/`void`. Requires `tenantSlug`. Uses `withTenantContext`. |
| `subscription-renewal` | on-demand | default | Process one *customer* subscription renewal via `services/subscriptions.processRenewal()`. Requires `tenantSlug`. Uses `withTenantContext`. |

**Billing lifecycle check** (7 transitions per hourly run, all against `public.tenants`):
1. Trial warning — `trial_warning` email when `trial_ends_at` within 7 days (free plan excluded).
2. Trial → Grace — sets `payment_status='grace'`, `grace_ends_at = trial_ends_at + 7d`, sends `trial_ended` (free plan excluded).
3. Grace → Expired — sets `payment_status='expired'`, sends `account_locked` (free plan excluded).
4. Billing expiry warning — non-free, `plan_expires_at` within 7 days, no `payment_records` row.
5. Billing overdue — non-free, past `plan_expires_at`, no `payment_records` row.
6. Renewal warning — active paid tenants (have payment records) within 7 days of `plan_expires_at`, sends `renewal_due`.
7. Active paid → Grace — paid tenants past `plan_expires_at`; `grace_ends_at = plan_expires_at + 7d`, sends `renewal_overdue`.

**Dedup**: lifecycle emails use `singletonKey: "${type}:${tenantId}:${today}"` so a
duplicate cron fire in the same UTC day never double-sends.

**`campaign-email` at-least-once gotcha**: Resend send happens before the delivery row
update. If the DB update throws, the email already went out — pg-boss's retry will
re-send it. Intentional at-least-once semantics, not a bug.

---

## `fbr-worker-boss.js`

Export: `registerFbrWorker(boss, pool)`
Env: `FBR_WORKER_ENABLED=1`
Heartbeat: `global.__fbrWorkerStatus`

**1 queue**: `fbr-invoice` — payload `{ tenantSlug, invoiceId }`. teamSize 10 /
teamConcurrency 10.

**Flow:**
1. Fetch `tenant_<slug>.fbr_invoices` row — skip if missing or already `posted` (idempotent).
2. Best-effort mark `processing`.
3. Fetch `fbr_api_token`/`fbr_environment` from `company_profile`. Missing credentials increments `retry_count`; at `>= max_retries` (default 5) marks `abandoned_no_creds` and stops retrying — operator must manually re-enqueue from the `/fbr` dashboard once credentials are set. Below the cap, resets to `pending` with `next_retry_at = NOW() + 10 min`.
4. POST via `services/fbr.postToFbr()`.
5. Success — `fbr_invoices.status='posted'`, writes `fbr_irn`/`fbr_qr_code` back onto `sales` or `returns` (whichever `invoice.sale_id`/`invoice.return_id` points to).
6. Failure — increments `retry_count`; at `>= 5` marks invoice + linked sale/return `failed` and does NOT rethrow (pg-boss treats as complete, no further retry); below 5, resets to `pending` and rethrows so pg-boss retries.

Uses raw `pool.query()` with `tenant_${tenantSlug}.` string interpolation throughout —
does not use `withTenantContext` (contrast with the email worker).

---

## `cleanup-worker-boss.js`

Export: `registerCleanupWorker(boss)`
Env: `CLEANUP_WORKER_ENABLED=1`
Heartbeat: `global.__cleanupWorkerStatus`
Queue: `cleanup-dead-tenants` — cron `0 2 * * *` (daily 2 AM UTC)

Delegates to `jobs/cleanup-dead-tenants.cleanupDeadTenants()`, which returns
`{ checked, deleted, skipped }`. `processedToday` accumulates `deleted`, not `checked`.

---

## `reservation-worker-boss.js`

Export: `registerReservationWorker(boss, pool)`
Env: `RESERVATION_WORKER_ENABLED=1`
Heartbeat: `global.__reservationWorkerStatus`
Queue: `expire-reservations` — cron `*/5 * * * *`

Calls `services/reservation.expireStaleReservations(db)` per active tenant. Per-tenant
try/catch — one tenant failing doesn't abort the sweep. Single-tenant mode passes a
minimal `{ query }` wrapper around the raw pool, not `withTenantContext`.

---

## `reservation-reminder-worker-boss.js`

Export: `registerReservationReminderWorker(boss, pool)`, `runOnce(db)`
Env: `RESERVATION_REMINDER_WORKER_ENABLED=1`
Heartbeat: `global.__reservationReminderWorkerStatus`
Queue: `reservation-reminder-check` — cron `*/15 * * * *`

Finds `confirmed` reservations with a phone number, no `sms_reminder_sent_at`, starting
in a `[1h50m, 2h10m]` window from now, and sends one SMS each via `services/sms.sendSms()`
(hard-capped `LIMIT 200` per tenant per run). If the SMS send throws, the row is **not**
stamped — the next 15-minute tick retries within the window. `sendSms()` is a no-op when
the tenant has no SMS provider configured, but the row still gets stamped in that case
so the worker doesn't loop forever on an unconfigured tenant.

`runOnce(db)` is exported for unit tests to drive the handler without pg-boss.

---

## `marketplace-sync-worker-boss.js`

Export: `registerMarketplaceSyncWorker(boss)` (no `pool` — it schedules nothing that needs one)
Env: `MARKETPLACE_SYNC_WORKER_ENABLED=1`
Heartbeat: `global.__marketplaceSyncWorkerStatus` (`mode: "manual"`, `note` explaining background sync isn't implemented)

**No queues, no cron.** The decorative version used to register two empty crons
(`marketplace-order-poll` every 10 min, `marketplace-feed-check` every 6h) that fired and
logged intent but never called any client. Those are gone. On boot the worker now
*unschedules* those legacy names defensively (`LEGACY_SCHEDULES`, best-effort via
`boss.unschedule`) and logs that it is MANUAL-ONLY. Marketplace sync happens only when a
tenant triggers it from the Integrations Hub (Pull Orders / Sync Products in
`routes/integrations/*`). Inbound marketplace *webhooks* (`routes/webhooks.js`) are the
only push path and they are wired (Daraz/Meta write `web_orders`, WhatsApp writes the
messaging inbox) — that's separate from this worker.

---

## `orphan-schema-scan-worker-boss.js`

Export: `registerOrphanSchemaScanWorker(boss, db)`, `runScan(db)`, `QUEUE_NAME`
Env: registered **unconditionally** from `boot/workers.js` — no dedicated toggle beyond
`ORPHAN_SCHEMA_SCAN_WORKER_ENABLED` (defaults ON, opt out with `=0`)
Heartbeat: `global.__orphanSchemaScanWorkerStatus`
Queue: `orphan-schema-scan` — cron `0 * * * *` (top of every hour)

Scans `information_schema.schemata` for `tenant_*` schemas with no matching row in
`public.tenants`, computes each orphan's size via `pg_total_relation_size`, and upserts
the result into `public.infra_cache` under key `orphaned_schemas`. `GET
/api/admin/orphaned-schemas` reads this cache instead of running a live scan — the live
query used to take ~104s p100 in production. Read-only: actual `DROP SCHEMA` happens via
`POST /api/admin/orphaned-schemas/cleanup`, not here.

Fires `runScan(db)` once at boot (not awaited) so the cache is warm before the first
hourly tick; a slow warmup scan never blocks server startup.

---

## `abc-worker-boss.js`

Export: `registerAbcWorker(boss, pool)`, `runAbcWorkerForDb({ db, windowDays })`
Env: `ABC_WORKER_ENABLED=1`
Heartbeat: `global.__abcWorkerStatus`
Queue: `abc-daily` — cron `0 2 * * *` (daily 2 AM UTC)
Feature-flag gate: `phase2g_inventory_intelligence` — no-op, no writes, for tenants with
the flag off.

Nightly ABC/inventory-intelligence rollup per tenant. Window defaults to
`company_profile.abc_window_days` (fallback 90d); trailing velocity is always a
hardcoded 30 days regardless of window so the reorder formula stays calibrated.
Aggregates sales revenue/margin/units, GRN receipts, and a current inventory-value
snapshot (current `outlet_stock × cost_price`, not a historical average). Ranks via
`services/inventory-intelligence.assignAbcRanks()`, computes GMROI + daily velocity, and
upserts `product_abc_class` on `ON CONFLICT (product_id, COALESCE(variant_id, 0))` —
reruns update in place, safe to fire manually.

`runAbcWorkerForDb` is exported for direct testing against an isolated schema, bypassing
pg-boss and tenant context entirely.

---

## `anomaly-worker-boss.js`

Export: `registerAnomalyWorker(boss, pool)`, `runAnomalyWorkerForDb({ db, windowDays })`
Env: `ANOMALY_WORKER_ENABLED=1`
Heartbeat: `global.__anomalyWorkerStatus`
Queue: `anomaly-daily` — cron `30 2 * * *` (staggered 30 min after ABC to reduce DB contention)
Feature-flag gate: `phase2g_risk_controls`

Nightly per-employee anomaly detection over a hardcoded 30-day window. Computes
`voids_pct`, `refunds_pct`, `discounts_pct` per employee+outlet. Per outlet, requires at
least `MIN_PEERS = 3` active employees before computing a peer mean/stddev (smaller
outlets are silently skipped — a stddev over 1-2 employees is unstable and would
false-positive on every new tenant). Flags any employee whose z-score exceeds
`risk_controls_config.anomaly_z_score_threshold` (default 2.0) via
`ON CONFLICT (employee_id, metric, period_start, period_end)` upsert into
`retail_anomaly_flags`.

`runAnomalyWorkerForDb` is exported for isolated-schema testing.

---

## `retail-digest-worker-boss.js`

Export: `registerRetailDigestWorker(boss, pool)`, `runRetailDigestForDb({ db, tenantId, tenant, force })`
Env: `RETAIL_DIGEST_WORKER_ENABLED=1`
Heartbeat: `global.__retailDigestWorkerStatus`
Queue: `retail-weekly-digest` — cron `0 8 * * 1` (Monday 8 AM UTC)
Feature-flag gate: `retail_weekly_digest`

Weekly last-7-day summary email to `company_profile.email` (falls back to the first
non-deleted admin employee's email). Aggregates revenue, sale count, payment-method
breakdown, top 5 products by revenue, and up to 8 products at/below `min_stock`.
Enqueues via `services/email.enqueueEmail()`.

**Idempotency**: checks `email_queue WHERE email_type='retail_weekly_digest' AND
to_email=$recipient AND created_at >= NOW() - 6 days` before enqueueing — protects
against duplicate sends on cluster restart or a catch-up run. `force: true` on
`runRetailDigestForDb` bypasses both the flag gate and the idempotency check (test-only).

---

## `hold-expiry-worker-boss.js`

Export: `registerHoldExpiryWorker(boss, pool)`, `sweepTenant(db, logger, tenantSlug)`
Env: no dedicated toggle — registered unconditionally alongside the other workers in
`boot/workers.js` (check that file for current gating before assuming it's always on)
Heartbeat: `global.__holdExpiryWorkerStatus`
Queue: `hold-expiry-sweep` — cron `0 * * * *`, `singletonKey: "hold-expiry-sweep"`

Hourly: for holds past `hold_until`, releases their linked `inventory_reservations`
(`reservation_key LIKE 'hold:<id>:%'`) inside a transaction, then flips
`holds.status='forfeit'`. Uses `SELECT ... FOR UPDATE SKIP LOCKED` on the initial select
to avoid double-processing under concurrency. Uses `withTenantContext` in MT mode.
Silently skips tenants missing the `holds` table (pre-v71 tenants).

---

## `shift-auto-close-worker-boss.js`

Export: `registerShiftAutoCloseWorker(boss, pool)`, `closeStaleShiftsForTenant(db, logger, tenantSlug)`
Env: `SHIFT_AUTO_CLOSE_WORKER_ENABLED=1`
Heartbeat: `global.__shiftAutoCloseWorkerStatus`
Queue: `shift-auto-close` — cron `0 * * * *` (hourly)
Tenant feature-flag gate: `shift_auto_close` (default FALSE) — no-op per tenant until enabled.

Force-closes `open` cash shifts whose `opened_at` exceeds
`company_profile.shift_auto_close_hours` (default 36h). Sets `status='closed'`,
`auto_closed_at=NOW()`, `closing_method='auto'`, and explicitly **nulls**
`expected_cash`/`variance` (no denomination count was taken — cashier was absent).
Writes an `action_history` audit row (non-fatal on failure). `queueDepth` reflects
currently-open shifts in `public.cash_shifts` (single-tenant view; non-fatal to read in
MT mode). Silently skips tenants missing pre-v76 columns.

---

## `subscription-grace-worker-boss.js`

Export: `registerSubscriptionGraceWorker(boss, pool)`
Env: `SUBSCRIPTION_GRACE_WORKER_ENABLED=1`
Heartbeat: `global.__subscriptionGraceWorkerStatus`
Queue: `subscription-grace-check` — cron `0 * * * *` (hourly)

Handles ***customer*** subscription grace (`customer_subscriptions` table) — this is
unrelated to tenant billing grace, which the email worker's `billing-lifecycle-check`
handles. Two-step transition per tenant:
1. `active` subscriptions past `grace_period_end` with an unpaid linked renewal invoice → `past_due`.
2. `past_due` subscriptions more than 7 days past `grace_period_end` → `expired`.

MT mode pre-filters to `plan != 'free'` tenants — Free plan tenants never use
`customer_subscriptions`, so iterating them is wasted work.

---

## `rental-overdue-worker-boss.js`

Export: `registerRentalOverdueWorker(boss, pool)`
Env: `RENTAL_OVERDUE_WORKER_ENABLED=1`
Heartbeat: `global.__rentalOverdueWorkerStatus`
Queue: `rental-overdue-check` — cron `0 8 * * *` (daily 8 AM UTC)

Calls `services/rental-service.getOverdueContracts(db)` — contracts `checked_out` past
`expected_return` that haven't had an overdue email in the last 24h. Enqueues
`rental_overdue` to `contract.customer_email` via `services/email.enqueueEmail()`, stamps
`overdue_email_sent_at`, and logs via `rental-service.logActivity()`.

---

## `room-overdue-checkout-worker-boss.js`

Export: `registerRoomOverdueCheckoutWorker(boss, pool)`
Env: `ROOM_OVERDUE_WORKER_ENABLED=1`
Heartbeat: `global.__roomOverdueWorkerStatus`
Queue: `room-overdue-check` — cron `0 11 * * *` (daily 11 AM UTC)

Mirrors the rental-overdue pattern. Calls `services/room-service.getOverdueCheckouts(db)`
— bookings still `checked_in` past `check_out_date`. Sends `room_overdue_checkout` to
**both** `company_profile.email` (staff alert) and `customer_email` (guest) per overdue
booking, then stamps via `room-service.markOverdueEmailSent()`. Silently skips tenants
whose room tables don't exist yet (pre-v38).

---

## `treatment-plan-worker-boss.js`

Export: `registerTreatmentPlanWorker(boss, pool)`
Env: `TREATMENT_PLAN_WORKER_ENABLED=1`
Heartbeat: `global.__treatmentPlanWorkerStatus`
Queue: `treatment-plan-daily-check` — cron `0 9 * * *` (daily 9 AM UTC)

Two tasks per run:
1. **Session reminders** — `getUpcomingSessionsNeedingReminder(db)`, enqueues
   `treatment_session_reminder` to the patient.
2. **Overdue plan check** (staff-facing) — `getOverduePlans(db)`, enqueues
   `treatment_plan_overdue` to `provider_email` for plans 7+ days past
   `expected_end_date` with incomplete sessions.

`queueDepth` is measured from `email_queue WHERE email_type IN
('treatment_session_reminder','treatment_plan_overdue') AND sent_at IS NULL`. Silently
skips tenants without treatment-plan tables (pre-v39).

---

## `course-release-worker-boss.js`

Export: `registerCourseReleaseWorker(boss, pool)`
Env: `COURSE_RELEASE_WORKER_ENABLED=1`
Heartbeat: `global.__courseReleaseWorkerStatus`
Queue: `course-release-sweep` — cron `* * * * *` (every minute — pg-boss's minimum
granularity; the original design called for 30s, but 1-minute kitchen pacing is
acceptable and avoids a bespoke non-pg-boss interval)

Releases `restaurant_course_fires` rows in `status='held'` whose `hold_until` has
elapsed, flips them to `fired`, and calls `services/restaurant-checks.releaseHeldCourses()`
so the course lands on the KDS. Silently skips tenants without the
`restaurant_course_fires` table. `queueDepth` (single-tenant view only) reflects
currently-overdue held rows.

---

## `attendance-auto-close-worker-boss.js`

Export: `registerAttendanceAutoCloseWorker(boss, pool)`, `closeStaleAttendanceForTenant(db, logger, tenantSlug)`, `QUEUE_NAME`
Env: `ATTENDANCE_AUTO_CLOSE_WORKER_ENABLED=1`
Heartbeat: `global.__attendanceAutoCloseWorkerStatus`
Queue: `attendance-auto-close` — cron `0 9 * * *` (daily 9 AM UTC)

Mirrors `shift-auto-close-worker-boss.js`. Finds `employee_attendance` rows from before
yesterday with `check_out IS NULL` (employee never tapped "End of Day"), capped at 500
per tenant per run. For each:
- If a completed `attendance_sessions` row exists for that day, closes out at the last
  session's `session_end` and recomputes net work hours (sum of `session_type='work'`
  durations).
- If no completed session exists at all, marks the day `status='absent'`, `hours=0`,
  `check_out = check_in`.

Either way appends `"(auto-closed)"` to the row's comment, and force-closes any
still-open `attendance_sessions` for that attendance row
(`session_end = session_start, session_type = 'auto_closed'`).

---

## `cleanup-worker-boss.js`, `orphan-schema-scan-worker-boss.js` etc. — shared conventions

- **MT tenant iteration**: most workers hand-roll their own loop over `SELECT id, slug
  FROM tenants WHERE status='active'` (from `master-db-pg.js`) rather than using
  `boot/workers.js`'s `forEachActiveTenant` helper — that helper is private to
  `boot/workers.js`, not exported for reuse here.
- **Per-tenant isolation**: nearly every worker wraps each tenant's unit of work in its
  own try/catch so one tenant's failure (schema not migrated yet, missing table) never
  aborts the whole sweep. Missing-table errors are usually pattern-matched on `"does not
  exist"` and swallowed silently rather than logged as errors.
- **Single-tenant fallback**: when `MULTI_TENANT` isn't `1`, most workers build an
  ad-hoc `{ query: (text, params) => pool.query(text, params) }` wrapper around the raw
  pool rather than using `withTenantContext` — single-tenant mode has no schema to scope.
- **pg-boss failure semantics**: throwing from inside `boss.work(...)` tells pg-boss to
  retry per its own retry policy; returning normally (even after logging an error) marks
  the job complete. Workers that have their own DB-column retry/backoff tracking (FBR)
  deliberately avoid rethrowing once their own max-retry cap is hit, to stop pg-boss from
  retrying redundantly.

---

## Adding a new worker

1. Create `workers/<name>-worker-boss.js` exporting `register<Name>Worker(boss, pool)`, following the closest existing pattern (tenant-scoped vs. cross-tenant cron, `withTenantContext` vs. raw interpolation).
2. Register it in `boot/workers.js` inside the `getBoss().then(...)` block via the `tryRegister(label, fn)` wrapper — one failed registration must not block the others.
3. Add an env var toggle: `<NAME>_WORKER_ENABLED=1` (unless it's meant to default ON like `orphan-schema-scan`).
4. Expose `global.__<name>WorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 }`.
5. Add a slot to `GET /api/admin/worker-status` in `routes/admin/system.js`.
6. Prefer `withTenantContext(pool, tenantSlug, fn)` for tenant-scoped DB access over raw
   schema string interpolation — the FBR worker is the one deliberate exception, not the
   template to copy.
