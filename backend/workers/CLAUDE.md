# Workers — Claude Guide

Background workers started from `boot/workers.js`, which mixes durable pg-boss jobs with plain `setInterval` pollers. Not everything `boot/workers.js` starts lives in this directory — Shopify sync poll, report-schedule poll, catalog scheduler, and booking reminders are inline in `boot/workers.js` itself. Every file here exports `register<Name>Worker(boss, pool)` (a couple take `db` instead of `pool` — see notes), registered conditionally from `boot/workers.js` behind its own env var.

Heartbeat shape is always `{ lastPollAt: number|null, processedToday: number, queueDepth: number }`, exposed as `global.__<name>WorkerStatus` and read by `GET /api/admin/worker-status` (`routes/admin/system.js`). pg-boss v12+ requires an explicit `boss.createQueue()` call before `boss.schedule()`/`boss.work()` — all current files do this.

**Known bug class**: a worker can ship in code but never run in production because its `<NAME>_WORKER_ENABLED` env var was never set on Railway. `boot/workers.js` maintains a `global.__workerRegistry` (via `recordGate()`) precisely so `GET /api/admin/worker-status` can distinguish "env var missing" from "enabled but crashed" — check that registry (or `railway variables`) rather than assuming a worker documented here is actually live.

---

## `tenant-job-context.js`

Exports: `withTenantContext(pool, tenantSlug, fn)`, `assertSafeSlug(slug)`

pg-boss jobs run outside any HTTP request, so they can't reach the AsyncLocalStorage proxy (`tenant-db-proxy-pg.js`) that route handlers use. This helper is the alternative: acquires one dedicated client from the pool, runs `SET search_path TO tenant_<slug>, public`, invokes `fn(db)`, then **always** resets `search_path TO public` and releases the client in `finally` — even on error — so tenant scope never leaks to the next consumer of that pooled connection.

`db` shape exposed to `fn`: `{ query(sql, params), transaction(fn) }` only — no `.pool`, no `.getClient()`. Service functions written against the full `db-pg.js` interface won't work if handed this proxy directly.

Slug validation: `SLUG_PATTERN = /^[a-z0-9_]+$/`. `search_path` can't take a parameterized placeholder, so the slug is validated then interpolated — anything outside `[a-z0-9_]` fails closed via `assertSafeSlug()`.

The FBR worker deliberately does NOT use this helper — it interpolates `tenant_<slug>.` into every SQL string directly. That's the older pattern; prefer `withTenantContext` for new workers.

---

## `email-worker-boss.js`

Env: `EMAIL_WORKER_ENABLED=1` — also requires `RESEND_API_KEY`; returns early (no queues registered) if the key is missing. Heartbeat: `global.__emailWorkerStatus`.

6 queues:

| Queue | Trigger | What it does |
|---|---|---|
| `email` | on-demand, teamSize/teamConcurrency 5 | Send one email via Resend. Updates `queueDepth` from `pgboss.job` after each send. |
| `billing-lifecycle-check` | cron hourly | 7-step tenant billing lifecycle sweep against `public.tenants` (below). |
| `campaign-email` | on-demand, teamSize/teamConcurrency 5 | Send one marketing delivery; sends via Resend **before** updating `marketing_campaign_deliveries` — at-least-once semantics, a DB-update failure after a successful send causes pg-boss to retry and re-send (intentional, not a bug). Rolls up `marketing_campaigns.status` when all deliveries settle. |
| `campaign-scheduled-send` | on-demand/delayed | Fans out a scheduled campaign via `services/marketing.enqueueCampaignSend()`. Requires `tenantSlug`. Uses `withTenantContext`. |
| `invoice-reminder` | on-demand | Sends a reminder for one customer invoice; skips if already `paid`/`void`. Requires `tenantSlug`. Uses `withTenantContext`. |
| `subscription-renewal` | on-demand | Processes one *customer* subscription renewal via `services/subscriptions.processRenewal()`. Requires `tenantSlug`. Uses `withTenantContext`. |

`billing-lifecycle-check` (7 transitions per hourly run, all against `public.tenants`):
1. Trial warning — `trial_warning` email when `trial_ends_at` within 7 days (free plan excluded).
2. Trial → Grace — `payment_status='grace'`, `grace_ends_at = trial_ends_at + 7d`, sends `trial_ended`.
3. Grace → Expired — `payment_status='expired'`, sends `account_locked`.
4. Billing expiry warning — non-free, `plan_expires_at` within 7 days, no `payment_records` row.
5. Billing overdue — non-free, past `plan_expires_at`, no `payment_records` row.
6. Renewal warning — paid tenants (have payment records) within 7 days of `plan_expires_at`, sends `renewal_due`.
7. Active paid → Grace — paid tenants past `plan_expires_at`; `grace_ends_at = plan_expires_at + 7d`, sends `renewal_overdue`.

Lifecycle emails dedupe via `singletonKey: "${type}:${tenantId}:${today}"` so a duplicate cron fire in the same UTC day never double-sends.

---

## `fbr-worker-boss.js`

Env: `FBR_WORKER_ENABLED=1`. Heartbeat: `global.__fbrWorkerStatus`. Queue: `fbr-invoice`, payload `{ tenantSlug, invoiceId }`, teamSize/teamConcurrency 10.

Flow: fetch `tenant_<slug>.fbr_invoices` row (skip if missing or already `posted` — idempotent) → best-effort mark `processing` → fetch `fbr_api_token`/`fbr_environment` from `company_profile` (missing credentials increments `retry_count`; at cap (default 5) marks `abandoned_no_creds` and stops — operator must manually re-enqueue from `/fbr`; below cap resets to `pending` with `next_retry_at = NOW() + 10 min`) → POST via `services/fbr.postToFbr()` → success writes `fbr_irn`/`fbr_qr_code` back onto the linked `sales` or `returns` row → failure increments `retry_count`; at `>= 5` marks invoice + linked sale/return `failed`, records an alerting event + a durable per-tenant dead-letter row in `external_sync_events`, and does **not** rethrow (pg-boss treats as complete); below 5, resets to `pending` and rethrows so pg-boss retries. Uses raw `tenant_${tenantSlug}.` string interpolation throughout, not `withTenantContext`.

---

## `cleanup-worker-boss.js`

Env: `CLEANUP_WORKER_ENABLED=1`. Heartbeat: `global.__cleanupWorkerStatus`. Queue: `cleanup-dead-tenants` — cron daily 2 AM UTC.

Delegates to `jobs/cleanup-dead-tenants.cleanupDeadTenants()`, returns `{ checked, deleted, skipped }`. `processedToday` accumulates `deleted`, not `checked`.

---

## `reservation-worker-boss.js`

Env: `RESERVATION_WORKER_ENABLED=1`. Heartbeat: `global.__reservationWorkerStatus`. Queue: `expire-reservations` — cron every 5 minutes.

Calls `services/reservation.expireStaleReservations(db)` per active tenant, per-tenant try/catch. Single-tenant mode passes a minimal `{ query }` wrapper around the raw pool, not `withTenantContext`.

---

## `reservation-reminder-worker-boss.js`

Env: `RESERVATION_REMINDER_WORKER_ENABLED=1`. Heartbeat: `global.__reservationReminderWorkerStatus`. Queue: `reservation-reminder-check` — cron every 15 minutes.

Finds `confirmed` reservations with a phone number, no `sms_reminder_sent_at`, starting in a `[1h50m, 2h10m]` window from now, sends one SMS each via `services/sms.sendSms()` (capped `LIMIT 200` per tenant per run). If the send throws, the row is not stamped and the next tick retries within the window. `sendSms()` no-ops when the tenant has no SMS provider configured but the row is still stamped so the worker doesn't loop forever. Exports `runOnce(db)` for tests.

---

## `marketplace-sync-worker-boss.js`

Env: `MARKETPLACE_SYNC_WORKER_ENABLED=1`. Heartbeat: `global.__marketplaceSyncWorkerStatus` (`mode: "manual"`).

No queues, no cron by design — background auto-sync is intentionally not implemented (a production audit found zero tenants using it, so it's not worth the per-tenant fanout cost). On boot it best-effort `unschedule`s two legacy cron names a prior version left registered (`marketplace-order-poll`, `marketplace-feed-check`) so they stop firing. Real marketplace sync only happens when a tenant explicitly triggers Pull Orders / Sync Products from the Integrations Hub (`routes/integrations/*`). Inbound marketplace *webhooks* (`routes/webhooks.js`) are a separate, already-wired push path (Daraz/Meta write `web_orders`, WhatsApp writes the messaging inbox). If a future need justifies background polling, wire the client calls inside `withTenantContext()` — don't reintroduce a log-only stub.

---

## `orphan-schema-scan-worker-boss.js`

Registered unconditionally from `boot/workers.js`; opt out via `ORPHAN_SCHEMA_SCAN_WORKER_ENABLED=0` (defaults ON). Heartbeat: `global.__orphanSchemaScanWorkerStatus`. Queue: `orphan-schema-scan` — cron hourly.

Scans `information_schema.schemata` for `tenant_*` schemas with no matching row in `public.tenants`, sizes each orphan via `pg_total_relation_size`, upserts into `public.infra_cache` under key `orphaned_schemas`. `GET /api/admin/orphaned-schemas` reads this cache instead of running a live scan (the live query previously took ~104s). Read-only — actual `DROP SCHEMA` happens via `POST /api/admin/orphaned-schemas/cleanup`. Fires once at boot (not awaited) so the cache is warm before the first hourly tick.

---

## `adoption-snapshot-worker-boss.js`

Env: `ADOPTION_SNAPSHOT_WORKER_ENABLED=1` (opt-in). Heartbeat: `global.__adoptionSnapshotWorkerStatus`. Queue: `adoption-snapshot` — cron every 6 hours.

Fans out over every active tenant, records enabled feature flags + enabled vertical modes plus a per-mode usage count (from `config/vertical-usage-sources.js`), and upserts the aggregate into `public.infra_cache` under key `feature_adoption` (read by `GET /api/admin/adoption`). Also derives lifecycle events from each tenant's own sales history in the same pass (`first_sale`, `first_week_active` when 3+ distinct sale-days in the first 7 days, `dormant_30d` when the last sale is >30 days old) via `recordLifecycleEvent()` — all idempotent (`ON CONFLICT DO NOTHING`), so this piggybacks lifecycle derivation without its own worker/env var. Validates tenant slugs against `/^[a-z0-9_]{3,40}$/` before interpolating into any query. Fires once at boot to warm the cache.

---

## `abc-worker-boss.js`

Env: `ABC_WORKER_ENABLED=1`. Heartbeat: `global.__abcWorkerStatus`. Queue: `abc-daily` — cron daily 2 AM UTC. Feature-flag gate: `phase2g_inventory_intelligence` (no-op, no writes, when off).

Nightly ABC/inventory-intelligence rollup per tenant. Window defaults to `company_profile.abc_window_days` (fallback 90d); trailing velocity is a hardcoded 30 days regardless of window. Aggregates sales revenue/margin/units, GRN receipts, and a current inventory-value snapshot (current `outlet_stock × cost_price`). Ranks via `services/inventory-intelligence.assignAbcRanks()`, computes GMROI + daily velocity, upserts `product_abc_class` on `ON CONFLICT (product_id, COALESCE(variant_id, 0))` — reruns update in place, safe to fire manually. Exports `runAbcWorkerForDb({ db, windowDays })` for isolated-schema testing.

---

## `anomaly-worker-boss.js`

Env: `ANOMALY_WORKER_ENABLED=1`. Heartbeat: `global.__anomalyWorkerStatus`. Queue: `anomaly-daily` — cron daily 2:30 AM UTC (offset 30 min after ABC to reduce DB contention). Feature-flag gate: `phase2g_risk_controls`.

Nightly per-employee anomaly detection over a hardcoded 30-day window. Computes `voids_pct`, `refunds_pct`, `discounts_pct` per employee+outlet. Requires at least 3 active employees per outlet before computing a peer mean/stddev (smaller outlets are silently skipped — unstable stddev over 1-2 employees would false-positive constantly). Flags employees whose z-score exceeds `risk_controls_config.anomaly_z_score_threshold` (default 2.0) via upsert into `retail_anomaly_flags` (`ON CONFLICT (employee_id, metric, period_start, period_end)`). Exports `runAnomalyWorkerForDb({ db, windowDays })` for tests.

---

## `retail-digest-worker-boss.js`

Env: `RETAIL_DIGEST_WORKER_ENABLED=1`. Heartbeat: `global.__retailDigestWorkerStatus`. Queue: `retail-weekly-digest` — cron Monday 8 AM UTC. Feature-flag gate: `retail_weekly_digest`.

Weekly last-7-day summary email to `company_profile.email` (falls back to the first non-deleted admin employee). Aggregates revenue, sale count, payment-method breakdown, top 5 products by revenue, up to 8 products at/below `min_stock`. Enqueues via `services/email.enqueueEmail()`. Idempotency: checks `email_queue` for a same `email_type`/recipient row created within the last 6 days before enqueueing — protects against duplicate sends on cluster restart. Exports `runRetailDigestForDb({ db, tenantId, tenant, force })` — `force: true` bypasses both the flag gate and idempotency check (test-only).

---

## `hold-expiry-worker-boss.js`

Registered unconditionally in `boot/workers.js` (no dedicated env var — verify current gating there before assuming it's always on). Heartbeat: `global.__holdExpiryWorkerStatus`. Queue: `hold-expiry-sweep` — cron hourly, `singletonKey: "hold-expiry-sweep"`.

For holds past `hold_until`, releases their linked `inventory_reservations` (`reservation_key LIKE 'hold:<id>:%'`) inside a transaction, then flips `holds.status='forfeit'`. Uses `SELECT ... FOR UPDATE SKIP LOCKED` on the initial select to avoid double-processing under concurrency. Uses `withTenantContext` in MT mode. Silently skips tenants missing the `holds` table.

---

## `shift-auto-close-worker-boss.js`

Env: `SHIFT_AUTO_CLOSE_WORKER_ENABLED=1`. Heartbeat: `global.__shiftAutoCloseWorkerStatus`. Queue: `shift-auto-close` — cron hourly. Tenant feature-flag gate: `shift_auto_close` (default FALSE) — no-op per tenant until enabled.

Force-closes `open` cash shifts whose `opened_at` exceeds `company_profile.shift_auto_close_hours` (default 36h). Sets `status='closed'`, `auto_closed_at=NOW()`, `closing_method='auto'`, and explicitly nulls `expected_cash`/`variance` (no denomination count was taken). Writes an `action_history` audit row (non-fatal on failure). Silently skips tenants missing pre-existing columns.

---

## `attendance-auto-close-worker-boss.js`

Env: `ATTENDANCE_AUTO_CLOSE_WORKER_ENABLED=1`. Heartbeat: `global.__attendanceAutoCloseWorkerStatus`. Queue: `attendance-auto-close` — cron daily 9 AM UTC.

Mirrors `shift-auto-close-worker-boss.js`. Finds `employee_attendance` rows from before yesterday with `check_out IS NULL` (never tapped "End of Day"), capped 500 per tenant per run. If a completed `attendance_sessions` row exists for that day, closes out at the last session's `session_end` and recomputes net work hours; otherwise marks the day `status='absent'`, `hours=0`, `check_out=check_in`. Either way appends `"(auto-closed)"` to the comment and force-closes any still-open `attendance_sessions` for that row.

Note: this is distinct from the daily-midnight `closeStaleAttendanceSessions` `setInterval` poller that lives directly in `boot/workers.js` — that one force-closes session-level rows every day at process-boot-time intervals using tenant-local midnight; this pg-boss worker force-closes day-level attendance rows missing an end-of-day tap once at 9 AM UTC. Both exist and serve different granularities.

---

## `subscription-grace-worker-boss.js`

Env: `SUBSCRIPTION_GRACE_WORKER_ENABLED=1`. Heartbeat: `global.__subscriptionGraceWorkerStatus`. Queue: `subscription-grace-check` — cron hourly.

Handles ***customer*** subscription grace (`customer_subscriptions` table) — unrelated to tenant billing grace, which the email worker's `billing-lifecycle-check` handles. Two-step transition: (1) `active` subscriptions past `grace_period_end` with an unpaid linked renewal invoice → `past_due`; (2) `past_due` subscriptions more than 7 days past `grace_period_end` → `expired`. MT mode pre-filters to `plan != 'free'` tenants.

---

## `subscription-dunning-worker-boss.js`

Env: `SUBSCRIPTION_DUNNING_WORKER_ENABLED=1`. Heartbeat: `global.__subscriptionDunningWorkerStatus`. Queue: `subscription-dunning-check` — cron hourly at `:15` (offset from the grace worker).

For every failed customer-subscription renewal charge (`subscription_runs.charge_status='failed'`, dunning not yet done) whose `next_dunning_at` has arrived, retries the saved payment instrument via `payment-gateway.chargeSavedInstrument` at +1/+3/+7 days from `first_failed_at`. Success marks the run paid and closes dunning. After the 3rd failed attempt the subscription is auto-paused (`status='paused'`) and the member is notified. Re-checks subscription status before charging (closes the run without charging if no longer `active` — pause/resume race guard). Notifications ride `services/customer-notify.notify()`, so they honor the `customer_notifications` flag + per-tenant channel rules. Uses `withTenantContext`; MT mode pre-filters to `plan != 'free'`.

---

## `rental-overdue-worker-boss.js`

Env: `RENTAL_OVERDUE_WORKER_ENABLED=1`. Heartbeat: `global.__rentalOverdueWorkerStatus`. Queue: `rental-overdue-check` — cron daily 8 AM UTC.

Calls `services/rental-service.getOverdueContracts(db)` — contracts `checked_out` past `expected_return` with no overdue email in the last 24h. Enqueues `rental_overdue` to `contract.customer_email`, stamps `overdue_email_sent_at`, logs via `rental-service.logActivity()`.

---

## `room-overdue-checkout-worker-boss.js`

Env: `ROOM_OVERDUE_WORKER_ENABLED=1`. Heartbeat: `global.__roomOverdueWorkerStatus`. Queue: `room-overdue-check` — cron daily 11 AM UTC.

Mirrors the rental-overdue pattern. Calls `services/room-service.getOverdueCheckouts(db)` — bookings still `checked_in` past `check_out_date`. Sends `room_overdue_checkout` to both `company_profile.email` (staff) and the guest's `customer_email`, stamps via `markOverdueEmailSent()`. Silently skips tenants without room tables.

---

## `treatment-plan-worker-boss.js`

Env: `TREATMENT_PLAN_WORKER_ENABLED=1`. Heartbeat: `global.__treatmentPlanWorkerStatus`. Queue: `treatment-plan-daily-check` — cron daily 9 AM UTC.

Two tasks per run: (1) session reminders via `getUpcomingSessionsNeedingReminder(db)`, enqueues `treatment_session_reminder` to the patient; (2) overdue-plan check via `getOverduePlans(db)`, enqueues `treatment_plan_overdue` to `provider_email` for plans 7+ days past `expected_end_date` with incomplete sessions. Silently skips tenants without treatment-plan tables.

---

## `recall-worker-boss.js`

Registered via env `RECALL_WORKER_ENABLED=1`. Heartbeat: `global.__recallWorkerStatus`. Queue: `recall-outreach-check` — cron daily 10 AM (offset from the treatment-plan worker's 9 AM).

Per active tenant with the `clinical_recalls` flag on: rolls due recalls (`services/recall-service.getDueRecallsForOutreach()`) into outreach through the shared `customer-notify.notify()` dispatch engine — cadence from `company_profile.recall_outreach_cadence_days` (default 30d), attempt-capped, and a recall whose patient already has a future appointment is auto-marked `booked` instead of contacted (suppression re-checked again at fire time). Channel gating (`customer_notifications` flag) is enforced centrally inside `customer-notify.notify()` — this worker never bypasses it. Exports `runOnce(db, opts)` for direct testing.

---

## `channel-sync-worker-boss.js`

Env: `CHANNEL_SYNC_WORKER_ENABLED=1`. Heartbeat: `global.__channelSyncWorkerStatus`. Two queues, both cron every 10 minutes:

- `channel-sync-poll` — polls each tenant's active import iCal feeds (OTA calendars) via `services/room-channel-sync.js`; a feed conflict dead-letters + notifies, a failed feed marks `last_status='error'` and the sweep continues.
- `room-reservation-expiry` — cancels unpaid public room reservations past their TTL via `services/room-service.expireStaleRoomReservations()`. Availability already ignores TTL-lapsed reservations; this just formalizes the cancel and frees the room row.

Tenants without `room_channel_feeds` (or with no configured feeds) are skipped cheaply.

---

## `night-audit-worker-boss.js`

Env: `NIGHT_AUDIT_WORKER_ENABLED=1`. Heartbeat: `global.__nightAuditWorkerStatus`. Queue: `night-audit-run` — cron daily 22:00 UTC (03:00 Asia/Karachi, after front-desk day close).

Snapshots the hotel night that just ended (yesterday in the tenant's own `company_profile.timezone`) into `night_audit_snapshots` via `services/room-night-audit.runNightAudit()`. Front desk can also re-run any date manually via `POST /api/rooms/night-audit/run` — the underlying upsert makes both paths idempotent. Skips tenants with no `rooms` rows.

---

## `deposit-hold-expiry-worker-boss.js`

Registered unconditionally in `boot/workers.js` (no dedicated env var beyond being wired alongside the others — verify current gating there). Heartbeat: `global.__depositHoldExpiryWorkerStatus`. Queue: `deposit-hold-expiry-sweep` — cron hourly.

A gateway pre-auth hold lapses at the acquirer after ~7 days; if left `authorized` past that window, a later capture attempt at checkout/return gets declined and jams the front desk. This sweep releases holds older than `DEPOSIT_HOLD_MAX_DAYS` (env, default 7). Only hold-mode deposit entities are swept (charge-mode entities like service tickets never sit `authorized`) — the table/column set is derived dynamically from `services/deposit-engine.ENTITY_ADAPTERS` so a new hold adapter is swept automatically without a worker code change.

---

## `expiry-alert-worker-boss.js`

Registered via `EXPIRY_ALERT_WORKER_ENABLED=1`. Heartbeat: `global.__expiryAlertWorkerStatus`. Queue: `expiry-alert-daily` — cron daily 06:00 UTC. Feature-flag gate: `batch_expiry_tracking`.

Alert-only by design — it never flips a batch to `expired` (doing so would drop that quantity out of the active `remaining_qty` sum while `outlet_stock` still carries it, manufacturing drift; removing expired stock is an explicit operator write-off action that decrements `outlet_stock` in the same transaction). Counts active batches expiring within `BATCH_EXPIRY_ALERT_DAYS` (env, default 7) per outlet, judged against the tenant-local day (`tenantToday(tz)`, not `CURRENT_DATE`), and raises one summary `notifications` row per outlet. The per-batch detail and markdown/write-off actions live on `GET /api/batches/expiring`. Exports `runExpiryScanForDb({ db, windowDays })` for isolated testing.

---

## `kds-load-snapshot-worker-boss.js`

Env: `KDS_SNAPSHOT_WORKER_ENABLED=1`. Heartbeat: `global.__kdsSnapshotWorkerStatus`. Queue: `kds-load-snapshot` — cron every 15 minutes.

Per active `kds_stations` row, records open-ticket count and a rolling 60-minute average `prep_seconds` into `kds_station_load_snapshots` — drives the trend line in the KDS analytics tab. Trims snapshots older than 30 days per tenant on every run (tenant schemas can't share a global trim job). Silently skips tenants without the snapshot table. Exports `snapshotForTenant(db, logger, tenantSlug)` for tests.

---

## `course-release-worker-boss.js`

Env: `COURSE_RELEASE_WORKER_ENABLED=1`. Heartbeat: `global.__courseReleaseWorkerStatus`. Queue: `course-release-sweep` — cron every minute (pg-boss's minimum granularity; 1-minute kitchen pacing is acceptable rather than a bespoke sub-minute interval).

Releases `restaurant_course_fires` rows in `status='held'` whose `hold_until` has elapsed, flips them to `fired`, calls `services/restaurant-checks.releaseHeldCourses()` so the course lands on the KDS. Silently skips tenants without the `restaurant_course_fires` table.

---

## Shared conventions across all workers

- **MT tenant iteration**: most workers hand-roll their own loop over `SELECT id, slug FROM tenants WHERE status='active'` (from `master-db-pg.js`) rather than reusing `boot/workers.js`'s private `forEachActiveTenant` helper, which isn't exported for reuse outside that file.
- **Per-tenant isolation**: nearly every worker wraps each tenant's unit of work in its own try/catch so one tenant's failure (unmigrated schema, missing table) never aborts the whole sweep. Missing-table errors are typically pattern-matched on `"does not exist"` and swallowed silently.
- **Single-tenant fallback**: when `MULTI_TENANT` isn't `1`, most workers build an ad-hoc `{ query }` (sometimes `+ transaction`) wrapper around the raw pool rather than using `withTenantContext` — single-tenant mode has no schema to scope into.
- **pg-boss failure semantics**: throwing inside `boss.work(...)` tells pg-boss to retry per its own policy; returning normally (even after logging an error) marks the job complete. Workers with their own DB-column retry/backoff tracking (FBR) deliberately avoid rethrowing once their own max-retry cap is hit, to stop pg-boss from retrying redundantly on top of the app-level backoff.
- **Timezone-sensitive workers** (expiry-alert, night-audit) use `req.company`-equivalent `company_profile.timezone` + `utils/tz.js` helpers (`tenantToday`, `toLocalDateStr`) rather than `CURRENT_DATE` or `new Date().toISOString()`, to avoid the UTC-vs-tenant-local date-boundary bug class.

---

## Adding a new worker

1. Create `workers/<name>-worker-boss.js` exporting `register<Name>Worker(boss, pool)`, following the closest existing pattern (tenant-scoped vs. cross-tenant cron, `withTenantContext` vs. raw interpolation).
2. Register it in `boot/workers.js` inside the `getBoss().then(...)` block via the `tryRegister(label, fn)` wrapper — one failed registration must not block the others.
3. Add an env var toggle: `<NAME>_WORKER_ENABLED=1` (unless it should default ON like `orphan-schema-scan`) — and add it to `PG_BOSS_GATES` in `boot/workers.js` so `recordGate()` tracks it even when unset.
4. Expose `global.__<name>WorkerStatus = { lastPollAt: null, processedToday: 0, queueDepth: 0 }`.
5. Add a slot to `GET /api/admin/worker-status` in `routes/admin/system.js`.
6. Prefer `withTenantContext(pool, tenantSlug, fn)` for tenant-scoped DB access over raw schema-string interpolation — the FBR worker is the one deliberate legacy exception, not the template to copy.
7. **After deploying, verify the env var actually got set on Railway** — a worker that registers fine locally but never runs in prod because the flag was forgotten is a recurring failure mode here.
