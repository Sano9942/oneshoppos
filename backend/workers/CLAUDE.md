# Workers — Claude Guide

- **5 files** — background job processors. Legacy polling (`*-worker.js`) + durable pg-boss (`*-worker-boss.js`)
- **Prefer pg-boss versions** — legacy kept as fallback only
- **`email-worker-boss.js`** — `registerEmailWorker(boss, pool)`. Two jobs: `"email"` (single send via Resend) + `"billing-lifecycle-check"` (hourly cron: trial→grace→expired transitions, expiry warnings). `singletonKey` prevents duplicate lifecycle emails per tenant per day
- **`fbr-worker-boss.js`** — `registerFbrWorker(boss, pool)`. Job: `"fbr-invoice"` with `{ tenantSlug, invoiceId }`. Flow: fetch → idempotency guard → mark processing → POST to FBR → update to posted. Missing credentials → reset to pending with 10-min retry
- **`cleanup-worker-boss.js`** — `registerCleanupWorker(boss)`. Cron: `"0 2 * * *"` (daily 2am UTC). Delegates to `jobs/cleanup-dead-tenants.js`. Updates `global.__cleanupWorkerStatus` for health checks
- **`email-worker.js`** (legacy) — polling every 60s, 20 emails/batch. Also runs 24h trial lifecycle check
- **`fbr-worker.js`** (legacy) — polling every 30s. Row-level locking via optimistic UPDATE. Max 20 concurrent global, 5 per tenant
- **pg-boss v12+ gotcha**: Must call `boss.createQueue(name)` before `boss.work()` or `boss.schedule()`
- **Heartbeat pattern**: Workers set `global.__<name>WorkerStatus` for `/api/admin/worker-status` endpoint
