# Boot — Claude Guide

- **1 file**: `workers.js` — starts all background workers and scheduled tasks
- **Export**: `startAll(deps)` — called from `index.js` after HTTP server starts listening
- **Workers started**: sync event cleanup (30-day retention), report artifact cleanup (configurable retention), stale attendance closer, Shopify inventory sync (30s polling), report schedule worker, scheduled catalog changes (60s poll), marketplace sync (pg-boss), booking reminders (pg-boss, 5-min), reservation expiry (pg-boss)
- **SQLite backup**: also runs a `startSqliteBackup()` worker on boot if `DATABASE_URL` is not set (Postgres mode skips it)
- **Helper**: `forEachActiveTenant(label, fn, deps)` — runs `fn(tenantDb, tenant)` for each active tenant in MT mode, or once in single-tenant mode
- **pg-boss workers** (email, FBR, cleanup, marketplace sync, reservation, booking reminders): their `register*Worker` functions are called **inside** `startAll()` — they live in their own worker files but are wired up here
- **Env toggles (opt-out)**: `SHOPIFY_SYNC_WORKER_DISABLED=1`, `REPORT_SCHEDULE_WORKER_DISABLED=1`
- **Env toggles (opt-in)**: `EMAIL_WORKER_ENABLED=1`, `FBR_WORKER_ENABLED=1`, `CLEANUP_WORKER_ENABLED=1`, `MARKETPLACE_SYNC_WORKER_ENABLED=1`, `RESERVATION_WORKER_ENABLED=1`, `BOOKING_REMINDER_WORKER_ENABLED=1`, `SCHEDULED_CATALOG_WORKER_ENABLED=1`
- **Report artifact retention** (configurable env vars): `REPORT_RUNS_RETENTION_DAYS` (default 45), `REPORT_DELIVERY_RETENTION_DAYS` (default 60), `REPORT_EXPORT_FILES_RETENTION_DAYS` (default 30)
