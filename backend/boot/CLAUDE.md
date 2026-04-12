# Boot — Claude Guide

- **1 file**: `workers.js` — starts all background workers and scheduled tasks
- **Export**: `startAll(deps)` — called from `index.js` after HTTP server starts listening
- **Workers started**: sync event cleanup (30-day retention), report artifact cleanup (configurable retention), stale attendance closer, Shopify inventory sync (30s polling), report schedule worker, scheduled catalog changes (60s poll), marketplace sync (pg-boss), booking reminders (pg-boss, 5-min), reservation expiry (pg-boss)
- **Helper**: `forEachActiveTenant(label, fn, deps)` — runs `fn(tenantDb, tenant)` for each active tenant in MT mode, or once in single-tenant mode
- **pg-boss workers** (email, FBR, cleanup, marketplace sync, reservation, booking reminders) are registered separately via their own `register*Worker` functions — not started here
- **Env toggles**: `SHOPIFY_SYNC_WORKER_DISABLED=1`, `REPORT_SCHEDULE_WORKER_DISABLED=1`, `MARKETPLACE_SYNC_WORKER_ENABLED=1`, `SCHEDULED_CATALOG_WORKER_ENABLED=1`, `BOOKING_REMINDER_WORKER_ENABLED=1`, `RESERVATION_WORKER_ENABLED=1`
