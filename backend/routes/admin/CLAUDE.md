# Admin Routes — Claude Guide

- **Mounted BEFORE tenant middleware** — no `deps.db` tenant proxy, no `req.company`, no `req.employee`
- **Auth**: `requireSuperAdmin` (separate JWT from `adminSession`), `requireAllowedIp` on ALL routes (not just login)
- **All mutations log** to `admin_activity_log` table (public schema)
- **Security events** (login success/failure) log to `admin_security_log`
- **10 files**: auth, tenants, monitoring, billing, operations, compliance, messaging, system + helpers (shared utilities) + index (orchestrator)
- **Worker status** (`GET /api/admin/worker-status`): returns 9 workers — email, fbr, cleanup, reservation, marketplace_sync, booking_reminder, rental_overdue, room_overdue, treatment_plan (`global.__rentalOverdueWorkerStatus`, `__roomOverdueWorkerStatus`, `__treatmentPlanWorkerStatus`)
- **Undocumented monitoring routes** (`monitoring.js`): `GET /api/admin/attention` (approaching limits + dormant tenants), `GET /api/admin/cleanup-preview` (dry-run dead tenant cleanup), `POST /api/admin/cleanup-run` (execute cleanup), `GET /api/admin/revenue-stats` (MRR + tenant revenue aggregation)
- **Backup routes** (`system.js`): `POST /api/admin/backup/verify`, `GET /api/admin/backup-history`
- **DB access**: Uses `masterDb` (public schema) or per-tenant `SET search_path` for cross-tenant queries
- **Frontend**: `pages/admin/*.jsx` uses `adminFetch` (NOT `api.js`)
