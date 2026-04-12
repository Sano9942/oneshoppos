# Workers — Claude Guide

- **8 files** — background job processors. Legacy polling (`*-worker.js`) + durable pg-boss (`*-worker-boss.js`) + shared utility (`tenant-job-context.js`)
- **Prefer pg-boss versions** — legacy kept as fallback only
- **pg-boss v12+ gotcha**: Must call `boss.createQueue(name)` before `boss.work()` or `boss.schedule()`
- **Heartbeat pattern**: Workers set `global.__<name>WorkerStatus` (`{ lastPollAt, processedToday, queueDepth }`) for `/api/admin/worker-status`

---

## `email-worker-boss.js`

Export: `registerEmailWorker(boss, pool)`

**6 jobs registered:**

| Job name | Type | What it does |
|----------|------|-------------|
| `"email"` | on-demand | Send one email via Resend; teamSize 5/5 |
| `"billing-lifecycle-check"` | cron `0 * * * *` (hourly) | 7-step lifecycle check (see below) |
| `"campaign-email"` | on-demand | Send one marketing delivery; teamSize 5/5 |
| `"campaign-scheduled-send"` | delayed/scheduled | Fan-out a scheduled campaign via `services/marketing` |
| `"invoice-reminder"` | on-demand | Send customer invoice reminder; skips if invoice paid/void |
| `"subscription-renewal"` | on-demand | Process renewal via `services/subscriptions.processRenewal()` |

**Billing lifecycle check (7 transitions, all in one hourly run):**
1. Trial warning — sent when `trial_ends_at` within 7 days
2. Trial → Grace — updates `payment_status = 'grace'`, sets `grace_ends_at = trial_ends_at + 7 days`
3. Grace → Expired — updates `payment_status = 'expired'`
4. Billing expiry warning — non-free tenants with `plan_expires_at` within 7 days and no payment record
5. Billing overdue — non-free tenants past `plan_expires_at` with no payment record
6. Renewal warning — active paid tenants (have payment records) within 7 days of `plan_expires_at`
7. Active paid → Grace — paid tenants past `plan_expires_at`; sends `renewal_overdue` email

**`singletonKey` deduplication**: lifecycle emails use `singletonKey: \`${type}:${tenantId}:${today}\`` — prevents duplicate emails per tenant per day even if the cron fires multiple times.

**`campaign-email` delivery gotcha**: email is sent via Resend first, DB delivery row updated after. If the DB update fails, email was already sent — pg-boss will retry, which re-sends the email. This is at-least-once delivery, not exactly-once.

**Guards**: if `RESEND_API_KEY` is unset, `registerEmailWorker` returns early without registering any workers — no error thrown.

---

## `fbr-worker-boss.js`

Export: `registerFbrWorker(boss, pool)`

**1 job**: `"fbr-invoice"` with payload `{ tenantSlug, invoiceId }`. teamSize 10/teamConcurrency 10.

**Flow:**
1. Fetch invoice — if not found or already `posted`, skip (idempotent)
2. Mark `processing` (best-effort UPDATE, ignored if already processing)
3. Fetch `fbr_api_token` + `fbr_environment` from `company_profile` — if missing, reset to `pending` with `next_retry_at = NOW() + 10 min`, return (no rethrow → pg-boss sees it as complete)
4. POST to FBR API via `services/fbr.postToFbr()`
5. On success — updates `fbr_invoices.status = 'posted'`, writes `fbr_irn` + `fbr_qr_code` back to `sales` or `returns`
6. On failure — increments `retry_count`; if `>= 5` (maxRetries), marks `failed` on invoice + source record, does **not rethrow** (pg-boss records as complete, failure is in DB). If `< 5`, resets to `pending` and rethrows so pg-boss retries.

**Schema interpolation**: uses raw `pool.query()` with `tenant_${tenantSlug}.` schema prefix directly — does **not** use `withTenantContext`. (Email worker does; FBR worker does not.)

**Retry delay**: fixed 60s (`next_retry_at = NOW() + 60 seconds`) — unlike the legacy worker which uses exponential backoff via `getNextRetryDelay()`.

---

## `cleanup-worker-boss.js`

Export: `registerCleanupWorker(boss)`

- Cron: `"cleanup-dead-tenants"` at `0 2 * * *` (daily 2am UTC)
- Delegates entirely to `jobs/cleanup-dead-tenants.cleanupDeadTenants()`
- Returns `{ checked, deleted, skipped }` — `processedToday` incremented by `result.deleted`

---

## `reservation-worker-boss.js`

Export: `registerReservationWorker(boss, pool)`

- Cron: `"expire-reservations"` every `*/5 * * * *` (every 5 minutes)
- Calls `services/reservation.expireStaleReservations(db)` across all active tenants
- **MT mode** (`MULTI_TENANT=1`): queries `masterDb` for active tenants, calls `tenantDbMgr.getDb(tenant.id)` per tenant — errors per tenant are caught and logged individually, does not abort the full run
- **Single-tenant mode**: passes `{ query: (text, params) => pool.query(text, params) }` directly
- Env: `RESERVATION_WORKER_ENABLED=1`

---

## `marketplace-sync-worker-boss.js`

Export: `registerMarketplaceSyncWorker(boss, pool)`

**2 jobs:**

| Job name | Cron | What it does |
|----------|------|-------------|
| `"marketplace-order-poll"` | `*/10 * * * *` | Poll Daraz/Facebook orders for all active tenants |
| `"marketplace-feed-check"` | `0 */6 * * *` | Check Google Merchant feed status |

**⚠️ Stub warning**: Both job handlers are **placeholders** — they log the intent (`"Polling Daraz orders"`, `"Checking Google Merchant feed status"`) but the actual `DarazClient.pullOrders` / `MetaCommerceClient.pullOrders` / `GoogleMerchantClient.checkFeedStatus` calls are commented-out. The worker registers and cron fires, but **no orders are imported and no feeds are checked**. Env: `MARKETPLACE_SYNC_WORKER_ENABLED=1`.

**`singletonKey`** on `boss.schedule()` calls prevents duplicate cron job entries in pg-boss.

---

## `tenant-job-context.js`

Export: `withTenantContext(pool, tenantSlug, fn)`, `assertSafeSlug(slug)`

**Why it exists**: Route handlers get tenant DB via AsyncLocalStorage (request-lifecycle bound). pg-boss workers run outside HTTP context — this helper gives them an equivalent tenant-scoped `db` object.

**Slug validation**: `SLUG_PATTERN = /^[a-z0-9_]+$/` — **hyphens are rejected**. Slugs with `-` will throw at `assertSafeSlug()`. Match the provisioner's slug restrictions.

**`db` proxy shape**: exposes only `{ query(sql, params), transaction(fn) }` — no `.pool`, no `.getClient()`. Service functions that expect the full `db-pg.js` interface will fail if called via `withTenantContext`.

**Cleanup guarantee**: `search_path` is always reset to `public` in the `finally` block before `client.release()` — even on error. This prevents pool client cross-tenant contamination. If the reset query itself fails (dead connection), the client is still released.

**Usage pattern**:
```js
await withTenantContext(pool, tenantSlug, async (db) => {
  await someService(db, ...args);
});
```

---

## `email-worker.js` (legacy)

Export: `startEmailWorker(db)` — also runnable standalone (`node backend/workers/email-worker.js`)

- Polls `public.email_queue` table every **60s**, batch of **20**
- Queue columns: `to_email`, `subject`, `html_body`, `from_address`, `attempts`, `max_attempts`, `sent_at`
- Also runs trial lifecycle check + paid expiry check on every poll tick
- **Deduplication**: checks `email_queue` for recent `email_type + tenant_id` row within 24h before enqueueing (different from boss version's `singletonKey` approach)
- `EMAIL_WORKER_ENABLED` env toggles inline start in `boot/workers.js`; can also run as separate process

---

## `fbr-worker.js` (legacy)

Export: `startFbrWorker(db)` — also runnable standalone

- Polls every **30s**; max 20 concurrent global / 5 per tenant
- **Row-level locking**: `UPDATE ... WHERE status = 'pending' RETURNING *` — if another worker already claimed the row, UPDATE returns nothing and the invoice is skipped
- **Exponential backoff**: uses `services/fbr.getNextRetryDelay(retryCount)` (not available in boss version which uses fixed 60s)
- **Standalone health endpoint**: `GET /health` on `FBR_WORKER_PORT` (default 8081) returns `{ status: "ok", activeGlobal }`
- **SIGTERM drain**: waits for `activeGlobal === 0` before closing pool and exiting

---

## Adding a new worker

1. Create `workers/<name>-worker-boss.js` using pg-boss pattern
2. Register startup in `boot/workers.js`
3. Add env var toggle: `<NAME>_WORKER_ENABLED=1`
4. Expose heartbeat: `global.__<name>WorkerStatus = { lastPollAt, processedToday, queueDepth }`
5. Add to `GET /api/admin/worker-status` in `routes/admin/monitoring.js`
6. Call `await boss.createQueue(name)` before `boss.work()` or `boss.schedule()`
7. Use `withTenantContext(pool, tenantSlug, fn)` for tenant-scoped operations (not raw schema interpolation)
