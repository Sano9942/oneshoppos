# Workers — Claude Guide

- **8 files** — background job processors. Legacy polling (`*-worker.js`) + durable pg-boss (`*-worker-boss.js`) + shared utility (`tenant-job-context.js`)
- **Prefer pg-boss versions** — legacy kept as fallback only
- **`email-worker-boss.js`** — `registerEmailWorker(boss, pool)`. Two jobs: `"email"` (single send via Resend) + `"billing-lifecycle-check"` (hourly cron: trial→grace→expired transitions, expiry warnings). `singletonKey` prevents duplicate lifecycle emails per tenant per day
- **`fbr-worker-boss.js`** — `registerFbrWorker(boss, pool)`. Job: `"fbr-invoice"` with `{ tenantSlug, invoiceId }`. Flow: fetch → idempotency guard → mark processing → POST to FBR → update to posted. Missing credentials → reset to pending with 10-min retry
- **`cleanup-worker-boss.js`** — `registerCleanupWorker(boss)`. Cron: `"0 2 * * *"` (daily 2am UTC). Delegates to `jobs/cleanup-dead-tenants.js`. Updates `global.__cleanupWorkerStatus` for health checks
- **`email-worker.js`** (legacy) — polling every 60s, 20 emails/batch. Also runs 24h trial lifecycle check
- **`marketplace-sync-worker-boss.js`** — pg-boss backed marketplace order poll + feed status check. Job: `marketplace-sync`, 5-min cron. Env: `MARKETPLACE_SYNC_WORKER_ENABLED=1`. Heartbeat: `global.__marketplaceSyncWorkerStatus`
- **`reservation-worker-boss.js`** — `registerReservationWorker(boss, pool)`. Cron: `"expire-reservations"` every 5 minutes. Calls `expireStaleReservations()` from `services/reservation.js` across all active tenants. Env: `RESERVATION_WORKER_ENABLED=1`. Heartbeat: `global.__reservationWorkerStatus`
- **`tenant-job-context.js`** — utility (not a worker): `withTenantContext(pool, tenantSlug, fn)`, `assertSafeSlug(slug)`. Gives pg-boss job handlers a tenant-scoped `db` object (sets `search_path` on a dedicated pool client, runs `fn`, always resets + releases). Use this instead of raw slug interpolation in new workers
- **`fbr-worker.js`** (legacy) — polling every 30s. Row-level locking via optimistic UPDATE. Max 20 concurrent global, 5 per tenant
- **pg-boss v12+ gotcha**: Must call `boss.createQueue(name)` before `boss.work()` or `boss.schedule()`
- **Heartbeat pattern**: Workers set `global.__<name>WorkerStatus` for `/api/admin/worker-status` endpoint
