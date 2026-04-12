# Admin Routes — Claude Guide

- **Mounted BEFORE tenant middleware** — no `deps.db` tenant proxy, no `req.company`, no `req.employee`
- **Auth**: `requireSuperAdmin` (separate JWT from `adminSession`), `requireAllowedIp` on ALL routes (not just login)
- **All mutations log** to `admin_activity_log` table (public schema)
- **Security events** (login success/failure) log to `admin_security_log`
- **10 files**: auth, tenants, monitoring, billing, operations, compliance, messaging, system + helpers (shared utilities) + index (orchestrator)
- **DB access**: Uses `masterDb` (public schema) or per-tenant `SET search_path` for cross-tenant queries
- **Frontend**: `pages/admin/*.jsx` uses `adminFetch` (NOT `api.js`)
