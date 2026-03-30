# SanoPOS — Deployment Guide

> For env vars, URLs, migrations, routes, and integrations — see `CLAUDE.md`. This file covers the conceptual model and operational gotchas.

---

## The Golden Rule

**`git push` moves code. Never data.**

| Change type | What to do |
|---|---|
| Bug fix / new UI / new route | `git push` |
| New DB column | Update `schema-pg.sql` + add migration entry + `git push` |
| Add products / employees / outlets | Use the live app UI |
| Fix bad production data | `railway run node backend/scripts/fix.js` |
| Change an env var | Railway / Vercel dashboard — takes effect on next deploy |

---

## Mental Model

Think of it like a restaurant franchise:

- **Code** = the recipe book — same everywhere, updated by `git push`
- **Data** = the actual food and customers — different at each location, never synced
- **Migrations** = adding a new section to the recipe book — applied on next startup
- **Multi-tenant** = many restaurants, each with their own kitchen (Postgres schemas)
- **Provisioning a tenant** = opening a new franchise location
- **`SET search_path`** = walking into the right kitchen for each order
- **Email worker** = the franchise's automated comms team (trial warnings, payment confirmations)
- **`PAYMENT_GATEWAY` flag** = the switch that turns on the card machine

---

## What Happens on `git push`

```
YOUR LAPTOP          GITHUB           RAILWAY                    VERCEL
───────────          ──────           ───────                    ──────
git push     ──►    stores    ──►    pulls code                 pulls code
                    code            npm install                 npm run build
                                    migrate-pg.js               bakes env vars
                                    (all schemas)               into static build
                                    starts server +
                                    inline workers
```

**What NEVER goes up:** local DB, `backend/.env`, `uploads/`, `exports/`

**What Supabase looks like after a migration:** new tables/columns added (`IF NOT EXISTS` — safe to re-run). Existing rows are never touched.

**What Vercel bakes at build time:** `VITE_API_BASE`, `VITE_MULTI_TENANT`, `VITE_SENTRY_DSN` — burned in, not runtime.

---

## How a Tenant Request is Routed

```
Request arrives
    │
    ▼
loadTenantAndPerms  →  verify JWT, extract tenant_id
    │
    ▼
resolveTenant  →  look up public.tenants → get slug
    │
    ▼
tenant-db-proxy-pg.js (AsyncLocalStorage)
    →  SET search_path TO tenant_<slug>
    │
    ▼
Route handler  →  db.query() hits tenant schema only
```

Super-admin routes (`admin.js`) and webhook routes (`webhooks.js`) are mounted **before** this middleware — they use the master DB directly.

---

## What Does NOT Replicate Automatically

| Local change | How to get it to production |
|---|---|
| New feature flag row | Write a seed migration, or add it through the live app |
| New outlet / employee / product | Use the live app UI |
| Fixed bad data rows | `railway run node backend/scripts/your-fix.js` |
| `.env` changes | Update in Railway / Vercel dashboards |

---

## Common Tasks

| Task | Action |
|---|---|
| Deploy code change | `git push` — auto-deploys to both Railway and Vercel |
| Run a one-off script | `railway run node backend/scripts/name.js` |
| Check production logs | `railway logs` or Railway dashboard |
| Check errors | sanopos.sentry.io or `sentry-cli` |
| Reset a tenant's admin PIN | `/admin` → Tenant Detail → Reset PIN |
| Enable self-service signup | Set `SELF_SERVICE_SIGNUP=1` in Railway env vars |
| Enable payment gateway | Set `PAYMENT_GATEWAY=xpay` + `XPAY_API_KEY` + `XPAY_WEBHOOK_SECRET` in Railway |
| Provision a tenant manually | `/admin` → Provision New Tenant, or `railway run node backend/tenant-provisioner-pg.js` |
| Seed first super-admin | `railway run node backend/seed-admin-pg.js` |

---

## Known Gotchas

**Attendance stores LOCAL time; everything else is UTC.**
`attendance_sessions.session_start` and `employee_attendance.check_in` use `NOW()` on the server clock (`TZ=Asia/Karachi`). Use `session_start::date` with no timezone modifier. All other timestamps (`sales`, `returns`, `cash_shifts`) are UTC — use `tz.js → toUtcStart/toUtcEnd` for date filters.

**Frontend timestamp display rules.**
UTC columns → `fmtUtcDateTime` / `fmtUtcDate`. LOCAL columns → `fmtLocalDateTime` / `fmtLocalDate`. Never use raw `new Date(dt)` on any DB value.

**Tenant slugs — no hyphens.**
Slugs become Postgres schema names (`tenant_<slug>`). Only `[a-z0-9_]` allowed.

**Postgres `NUMERIC` returns strings.**
Always wrap with `Number()` before arithmetic.

**Postgres booleans are strict.**
Use `= true` / `= false`. Never `= 1` / `= 0`.

**`dotenv` must load before boot guard.**
`require("dotenv").config()` is line 1 of `index.js`. If it's not first, `DATABASE_URL` isn't in scope yet and the app falls back to SQLite.

**Tenant migration gotcha.**
Existing tenants need `schema_version` table seeded with prior versions before the first `migrate-pg.js` run. New tenants get latest schema automatically from `tenant-provisioner-pg.js`.
