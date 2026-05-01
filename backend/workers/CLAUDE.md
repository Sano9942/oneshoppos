# Workers — Claude Guide

All workers are pg-boss backed unless noted as legacy. Every worker must call
`boss.createQueue(name)` before `boss.work()` or `boss.schedule()` — pg-boss v12+
requirement. Heartbeat shape is always `{ lastPollAt: number|null, processedToday: number, queueDepth: number }`.

---

## `tenant-job-context.js`

Exports: `withTenantContext(pool, tenantSlug, fn)`, `assertSafeSlug(slug)`

Helper that gives pg-boss workers a tenant-scoped `db` proxy equivalent to what
route handlers see via AsyncLocalStorage. Acquires a dedicated pool client, sets
`search_path TO tenant_<slug>, public`, runs `fn(db)`, and always resets
`search_path TO public` + releases the client in `finally` — even on error.

**`db` shape exposed to `fn`**: `{ query(sql, params), transaction(fn) }` — no
`.pool`, no `.getClient()`. Service functions expecting the full `db-pg.js`
interface will fail if passed this proxy.

**Slug validation**: `SLUG_PATTERN = /^[a-z0-9_]+$/` — hyphens are rejected at
`assertSafeSlug()`. Call sites must pass slugs that match the provisioner's
restrictions.

**Cross-tenant contamination guard**: if the `search_path` reset itself fails
(dead connection), the client is still released so the pool doesn't hang.

---

## `email-worker-boss.js`

Export: `registerEmailWorker(boss, pool)`
Env: `EMAIL_WORKER_ENABLED=1` (also requires `RESEND_API_KEY` — returns early without
registering any workers if key is missing)
Heartbeat: `global.__emailWorkerStatus`

**6 queues registered:**

| Queue name | Trigger | Concurrency | What it does |
|------------|---------|-------------|-------------|
| `email` | on-demand | teamSize 5 / teamConcurrency 5 | Send one email via Resend. After each send, updates `queueDepth` from `pgboss.job WHERE state IN ('created','retry')`. |
| `billing-lifecycle-check` | cron `0 * * * *` (hourly) | default 1 | 7-step tenant billing lifecycle check (see below). |
| `campaign-email` | on-demand | teamSize 5 / teamConcurrency 5 | Send one marketing delivery. Sends via Resend first, then updates `marketing_campaign_deliveries` status and optionally rolls up `marketing_campaigns.status`. |
| `campaign-scheduled-send` | on-demand / delayed | default 1 | Fan-out a scheduled campaign via `services/marketing.enqueueCampaignSend()`. Requires `tenantSlug` in payload. Uses `withTenantContext`. |
| `invoice-reminder` | on-demand | default 1 | Send reminder for one customer invoice. Skips if invoice already `paid` or `void`. Requires `tenantSlug`. Uses `withTenantContext`. |
| `subscription-renewal` | on-demand | default 1 | Process one customer subscription renewal via `services/subscriptions.processRenewal()`. Requires `tenantSlug`. Uses `withTenantContext`. Handles *customer* recurring subscriptions — not tenant billing. |

**Billing lifecycle check (7 transitions per hourly run, all against `public.tenants`):**
1. Trial warning — enqueues `trial_warning` email when `trial_ends_at` within 7 days. Free plan tenants excluded.
2. Trial → Grace — `payment_status = 'grace'`, `grace_ends_at = trial_ends_at + 7 days`. Sends `trial_ended` email. Free plan excluded.
3. Grace → Expired — `payment_status = 'expired'`. Sends `account_locked` email. Free plan excluded.
4. Billing expiry warning — non-free tenants with `plan_expires_at` within 7 days and no `payment_records` row.
5. Billing overdue — non-free tenants past `plan_expires_at` with no `payment_records` row.
6. Renewal warning — active paid tenants (have payment records) within 7 days of `plan_expires_at`. Sends `renewal_due`.
7. Active paid → Grace — paid tenants past `plan_expires_at`; sets `grace_ends_at = plan_expires_at + 7 days`, sends `renewal_overdue`.

**Deduplication**: lifecycle emails use `singletonKey: \`${type}:${tenantId}:${today}\`` —
pg-boss drops duplicates within the same calendar day even if the cron fires multiple times.

**`campaign-email` at-least-once gotcha**: email is sent via Resend first, then the
delivery row is updated. If the DB update fails the email was already sent — pg-boss
retry will re-send. This is intentional at-least-once delivery.

---

## `fbr-worker-boss.js`

Export: `registerFbrWorker(boss, pool)`
Env: `FBR_WORKER_ENABLED=1`
Heartbeat: `global.__fbrWorkerStatus`

**1 queue**: `fbr-invoice` — payload `{ tenantSlug, invoiceId }`.
teamSize 10 / teamConcurrency 10.

**Flow per job:**
1. Fetch invoice from `tenant_<slug>.fbr_invoices` — skip if not found or already `posted` (idempotent).
2. Mark `processing` (best-effort UPDATE ignored if already processing).
3. Fetch `fbr_api_token` + `fbr_environment` from `tenant_<slug>.company_profile`. If missing, resets to `pending` with `next_retry_at = NOW() + 10 min` and returns without rethrowing — pg-boss records this as complete (no retry). Credential absence is treated as configuration error, not transient failure.
4. POST to FBR API via `services/fbr.postToFbr()`.
5. On success — updates `fbr_invoices.status = 'posted'`, writes `fbr_irn` and `fbr_qr_code` back to `sales` or `returns` depending on `invoice.sale_id` / `invoice.return_id`.
6. On failure — increments `retry_count`. If `>= 5` (maxRetries), marks invoice `failed` and the linked sale/return `failed`; does NOT rethrow — pg-boss sees this as complete and won't retry. If `< 5`, resets to `pending` and rethrows so pg-boss schedules a retry.

**Schema access**: uses raw `pool.query()` with `tenant_${tenantSlug}.` prefix — does
NOT use `withTenantContext`. (Contrast with email worker which does.)

**Retry delay**: fixed `next_retry_at = NOW() + 60 seconds` in the DB column — pg-boss
retry timing is controlled by pg-boss's own retry policy, not this column.

---

## `cleanup-worker-boss.js`

Export: `registerCleanupWorker(boss)`
Env: `CLEANUP_WORKER_ENABLED=1`
Heartbeat: `global.__cleanupWorkerStatus`
Queue: `cleanup-dead-tenants`
Schedule: `0 2 * * *` (daily 2 AM UTC)

Delegates entirely to `jobs/cleanup-dead-tenants.cleanupDeadTenants()`. Returns
`{ checked, deleted, skipped }` — `processedToday` is incremented by `result.deleted`
(not `result.checked`).

---

## `reservation-worker-boss.js`

Export: `registerReservationWorker(boss, pool)`
Env: `RESERVATION_WORKER_ENABLED=1`
Heartbeat: `global.__reservationWorkerStatus`
Queue: `expire-reservations`
Schedule: `*/5 * * * *` (every 5 minutes)

Calls `services/reservation.expireStaleReservations(db)` for each active tenant.
Per-tenant errors are caught individually — one failing tenant does not abort the run.
Single-tenant mode passes `{ query: (text, params) => pool.query(text, params) }` directly.

---

## `reservation-reminder-worker-boss.js`

Export: `registerReservationReminderWorker(boss, pool)`, `runOnce(db)`
Env: `RESERVATION_REMINDER_WORKER_ENABLED=1`
Heartbeat: `global.__reservationReminderWorkerStatus`
Queue: `reservation-reminder-check`
Schedule: `*/15 * * * *` (every 15 minutes)

For each active tenant, finds `confirmed` reservations in the 2h ± 10-minute window
that have not yet had `sms_reminder_sent_at` stamped, and sends one SMS per reservation
via `services/sms.sendSms()`. If SMS fails, the row is NOT stamped — the next 15-minute
tick retries within the window. Limit: 200 reservations per run per tenant (hard-coded
`LIMIT 200`).

`sendSms()` is a no-op when the tenant has no SMS provider configured — the row still
gets `sms_reminder_sent_at` stamped so the worker doesn't retry indefinitely.

`runOnce(db)` is exported for unit tests to drive the tenant-scoped handler without pg-boss.

---

## `marketplace-sync-worker-boss.js`

Export: `registerMarketplaceSyncWorker(boss, pool)`
Env: `MARKETPLACE_SYNC_WORKER_ENABLED=1`
Heartbeat: `global.__marketplaceSyncWorkerStatus`

**2 queues:**

| Queue name | Schedule | What it does |
|------------|---------|-------------|
| `marketplace-order-poll` | `*/10 * * * *` (every 10 min) | Poll Daraz/Facebook orders for all active tenants. Uses `singletonKey: "marketplace-order-poll"` on `boss.schedule()`. |
| `marketplace-feed-check` | `0 */6 * * *` (every 6 hours) | Check Google Merchant feed status. Uses `singletonKey: "marketplace-feed-check"`. |

**Both handlers are stubs.** They log intent (`"Polling Daraz orders"`, `"Checking
Google Merchant feed status"`) but the actual client calls (`DarazClient.pullOrders`,
`MetaCommerceClient.pullOrders`, `GoogleMerchantClient.checkFeedStatus`) are commented
out. The cron fires and no orders are imported, no feeds are checked. The `singletonKey`
on `boss.schedule()` prevents duplicate cron entries if the worker restarts.

---

## `orphan-schema-scan-worker-boss.js`

Export: `registerOrphanSchemaScanWorker(boss, db)`, `runScan(db)`, `QUEUE_NAME`
Env: registered unconditionally from `boot/workers.js` (no separate env toggle)
Heartbeat: `global.__orphanSchemaScanWorkerStatus`
Queue: `orphan-schema-scan`
Schedule: `0 * * * *` (top of every hour)

Scans `information_schema.schemata` for `tenant_*` schemas with no row in
`public.tenants`. For each orphan, computes size via `pg_total_relation_size`. Upserts
result into `public.infra_cache` under key `orphaned_schemas` — the admin endpoint
`GET /api/admin/orphaned-schemas` reads this cache instead of running a live scan (live
scans took ~104s p100 in production). The worker is read-only — actual `DROP SCHEMA`
happens inline via `POST /api/admin/orphaned-schemas/cleanup`.

**Boot-time warmup**: `runScan(db)` is fired once at startup without awaiting, so the
cache is warm before the first hourly tick. Failure is logged but does not block startup.

---

## `course-release-worker-boss.js`

Export: `registerCourseReleaseWorker(boss, pool)`
Env: `COURSE_RELEASE_WORKER_ENABLED=1`
Heartbeat: `global.__courseReleaseWorkerStatus`
Queue: `course-release-sweep`
Schedule: `* * * * *` (every minute — pg-boss minimum granularity)

Every minute, releases `restaurant_course_fires` rows with `status = 'held'` whose
`hold_until` has elapsed, flipping them to `fired` and calling
`services/restaurant-checks.releaseHeldCourses()` so those items land on the KDS.

Design intent was 30-second interval but pg-boss cron granularity is 1 minute — 1-minute
kitchen pacing delay is acceptable. Silently skips tenants where
`restaurant_course_fires` table doesn't exist. `queueDepth` in single-tenant mode
reflects current overdue held rows.

---

## `kds-load-snapshot-worker-boss.js`

Export: `registerKdsSnapshotWorker(boss, pool)`, `snapshotForTenant(db, logger, tenantSlug)`
Env: (no dedicated toggle — registered from `boot/workers.js` when KDS feature is active)
Heartbeat: `global.__kdsSnapshotWorkerStatus`
Queue: `kds-load-snapshot`
Schedule: `*/15 * * * *` (every 15 minutes)

For each active `kds_stations` row per tenant, inserts one row into
`kds_station_load_snapshots` with `open_tickets` count and `avg_prep_seconds` from the
rolling 60-minute window. Retention: rows older than 30 days are deleted per-tenant
after each sweep. Silently skips tenants missing the snapshot table (pre-migration).

`snapshotForTenant` is exported for test access without firing the cron.

---

## `abc-worker-boss.js`

Export: `registerAbcWorker(boss, pool)`, `runAbcWorkerForDb({ db, windowDays })`
Env: (no dedicated toggle — registered from `boot/workers.js`)
Heartbeat: `global.__abcWorkerStatus`
Queue: `abc-daily`
Schedule: `0 2 * * *` (daily 2 AM UTC)
Feature-flag gate: `phase2g_inventory_intelligence` — skips tenants with flag off, no DB writes.

Nightly ABC/inventory-intelligence rollup per tenant. Window defaults to
`company_profile.abc_window_days` (fallback 90 days). Aggregates sales revenue/margin/units,
trailing 30-day velocity, GRN receipts, and current inventory value snapshot. Ranks
products using `services/inventory-intelligence.assignAbcRanks()`, computes GMROI and
daily velocity, and upserts into `product_abc_class` via `ON CONFLICT (product_id,
COALESCE(variant_id, 0))` — idempotent reruns update in place.

`runAbcWorkerForDb` is exported for direct testing against an isolated schema without
pg-boss or tenant context.

---

## `anomaly-worker-boss.js`

Export: `registerAnomalyWorker(boss, pool)`, `runAnomalyWorkerForDb({ db, windowDays })`
Env: (no dedicated toggle — registered from `boot/workers.js`)
Heartbeat: `global.__anomalyWorkerStatus`
Queue: `anomaly-daily`
Schedule: `30 2 * * *` (daily 2:30 AM UTC — 30 min after ABC to reduce DB contention)
Feature-flag gate: `phase2g_risk_controls` — skips tenants with flag off.

Nightly per-employee anomaly detection. 30-day window (hardcoded). Computes three
metrics per employee+outlet: `voids_pct`, `refunds_pct`, `discounts_pct`. For each
outlet with at least 3 active employees (`MIN_PEERS = 3`), computes peer mean and
sample stddev and upserts a `retail_anomaly_flags` row for any employee whose z-score
exceeds `risk_controls_config.anomaly_z_score_threshold` (default 2.0). Uses
`ON CONFLICT (employee_id, metric, period_start, period_end)` — reruns update in place.

Outlets with fewer than 3 peers are silently skipped to avoid unstable z-scores on small
samples.

`runAnomalyWorkerForDb` is exported for direct testing against an isolated schema.

---

## `retail-digest-worker-boss.js`

Export: `registerRetailDigestWorker(boss, pool)`, `runRetailDigestForDb({ db, tenantId, tenant, force })`
Env: (no dedicated toggle — registered from `boot/workers.js`)
Heartbeat: `global.__retailDigestWorkerStatus`
Queue: `retail-weekly-digest`
Schedule: `0 8 * * 1` (Monday 8 AM UTC)
Feature-flag gate: `retail_weekly_digest` — tenants with flag off are skipped.

Weekly last-7-day summary email to `company_profile.email` (falls back to first admin
employee email). Aggregates revenue, sale count, payment method breakdown, top 5 selling
products, and up to 8 low-stock products. Enqueues via `services/email.enqueueEmail()`.

**Idempotency**: before enqueueing, checks `email_queue WHERE email_type = 'retail_weekly_digest' AND created_at >= NOW() - 6 days`. If a recent duplicate exists, skips — prevents double-sends on cluster restart or catch-up jobs.

`force = true` on `runRetailDigestForDb` skips the flag gate and idempotency check —
used in tests.

---

## `hold-expiry-worker-boss.js`

Export: `registerHoldExpiryWorker(boss, pool)`, `sweepTenant(db, logger, tenantSlug)`
Env: (no dedicated toggle — registered from `boot/workers.js`)
Heartbeat: `global.__holdExpiryWorkerStatus`
Queue: `hold-expiry-sweep`
Schedule: `0 * * * *` (hourly). Uses `singletonKey: "hold-expiry-sweep"` on `boss.schedule()`.

Hourly sweep that expires active holds past their `hold_until`. For each due hold:
1. Releases linked `inventory_reservations` (`reservation_key LIKE 'hold:<id>:%'`) in a transaction.
2. Flips `holds.status = 'forfeit'`.

Uses `SELECT ... FOR UPDATE SKIP LOCKED` to avoid double-processing when concurrency
is high. Uses `withTenantContext` in MT mode. Silently skips tenants missing `holds`
table (pre-migration: `does not exist` error pattern).

---

## `shift-auto-close-worker-boss.js`

Export: `registerShiftAutoCloseWorker(boss, pool)`, `closeStaleShiftsForTenant(db, logger, tenantSlug)`
Env: `SHIFT_AUTO_CLOSE_WORKER_ENABLED=1`
Heartbeat: `global.__shiftAutoCloseWorkerStatus`
Queue: `shift-auto-close`
Schedule: `0 * * * *` (hourly)
Tenant feature-flag gate: `shift_auto_close` (default FALSE per tenant) — no-op for
tenants that haven't enabled it.

Force-closes `open` cash shifts whose `opened_at` is older than
`company_profile.shift_auto_close_hours` (default 36h). Sets `status = 'closed'`,
`auto_closed_at = NOW()`, `closing_method = 'auto'`, clears `expected_cash` and
`variance` (cashier was absent — no denom count). Writes a row to `action_history`
for the shift reports audit trail (failure is non-fatal, logged as warn).

`queueDepth` reflects current open shifts count in `public.cash_shifts` (single-tenant
proxy — non-fatal in MT mode). Silently skips tenants with missing columns (pre-v76).

---

## `subscription-grace-worker-boss.js`

Export: `registerSubscriptionGraceWorker(boss, pool)`
Env: `SUBSCRIPTION_GRACE_WORKER_ENABLED=1`
Heartbeat: `global.__subscriptionGraceWorkerStatus`
Queue: `subscription-grace-check`
Schedule: `0 * * * *` (hourly)

Handles *customer* subscription grace (in `customer_subscriptions` table) — NOT tenant
billing grace. Two-step transition per tenant:
1. `active` subscriptions with `grace_period_end < NOW()` AND an unpaid linked renewal
   invoice → `past_due`.
2. `past_due` subscriptions with `grace_period_end + 7 days < NOW()` → `expired`.

In MT mode, skips Free plan tenants (`plan != 'free'`) because `customer_subscriptions`
is unused there.

---

## `rental-overdue-worker-boss.js`

Export: `registerRentalOverdueWorker(boss, pool)`
Env: `RENTAL_OVERDUE_WORKER_ENABLED=1`
Heartbeat: `global.__rentalOverdueWorkerStatus`
Queue: `rental-overdue-check`
Schedule: `0 8 * * *` (daily 8 AM UTC)

Calls `services/rental-service.getOverdueContracts(db)` — finds contracts in
`checked_out` status past `expected_return` where overdue email hasn't been sent within
24h. For each overdue contract, enqueues a `rental_overdue` email to
`contract.customer_email` via `services/email.enqueueEmail()`, stamps
`overdue_email_sent_at`, and logs activity via `rental-service.logActivity()`.

---

## `room-overdue-checkout-worker-boss.js`

Export: `registerRoomOverdueCheckoutWorker(boss, pool)`
Env: `ROOM_OVERDUE_WORKER_ENABLED=1`
Heartbeat: `global.__roomOverdueWorkerStatus`
Queue: `room-overdue-check`
Schedule: `0 11 * * *` (daily 11 AM UTC)

Calls `services/room-service.getOverdueCheckouts(db)` — finds bookings still `checked_in`
past `check_out_date`. Enqueues `room_overdue_checkout` email to BOTH `company_profile.email`
(staff alert) AND `customer_email` (guest) for each overdue booking. Stamps overdue email
sent via `room-service.markOverdueEmailSent()`. Silently skips tenants whose room tables
don't exist (catches `does not exist` errors).

---

## `treatment-plan-worker-boss.js`

Export: `registerTreatmentPlanWorker(boss, pool)`
Env: `TREATMENT_PLAN_WORKER_ENABLED=1`
Heartbeat: `global.__treatmentPlanWorkerStatus`
Queue: `treatment-plan-daily-check`
Schedule: `0 9 * * *` (daily 9 AM UTC)

Two tasks per run:
1. **Session reminders**: calls `treatment-plan-service.getUpcomingSessionsNeedingReminder(db)`,
   enqueues `treatment_session_reminder` email to patient for each upcoming session.
2. **Overdue plan check** (staff-facing): calls `getOverduePlans(db)`, enqueues
   `treatment_plan_overdue` email to `p.provider_email` for plans 7+ days past
   `expected_end_date` with incomplete sessions.

`queueDepth` is measured from `email_queue WHERE email_type IN ('treatment_session_reminder','treatment_plan_overdue') AND sent_at IS NULL`. Silently skips tenants without treatment plan tables (pre-migration).

---

## Adding a new worker

1. Create `workers/<name>-worker-boss.js` using pg-boss pattern.
2. Register startup in `boot/workers.js`.
3. Add env var toggle: `<NAME>_WORKER_ENABLED=1`.
4. Expose heartbeat: `global.__<name>WorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 }`.
5. Add to `GET /api/admin/worker-status` in `routes/admin/system.js`.
6. Call `await boss.createQueue(name)` before `boss.work()` or `boss.schedule()`.
7. Use `withTenantContext(pool, tenantSlug, fn)` for tenant-scoped operations rather
   than raw schema string interpolation — except where the service already does its own
   schema routing (e.g. FBR worker).
