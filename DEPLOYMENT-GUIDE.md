# SanoPOS — Deployment & Architecture Guide

## The Big Picture

```
YOUR COMPUTER (Development)          INTERNET (Production)
┌─────────────────────────┐         ┌──────────────────────────────────┐
│                         │         │                                  │
│  Frontend (localhost:   │         │  Vercel (sanopos.vercel.app)     │
│    5173)                │         │    Same React app                │
│    React app            │         │         │                        │
│         │               │         │         ▼                        │
│         ▼               │  push   │  Railway (oneshoppos-            │
│  Backend (localhost:    │ ──────► │    production.up.railway.app)    │
│    5000)                │  code   │    Same Express server           │
│    Express server       │  only   │         │                        │
│         │               │         │         ▼                        │
│         ▼               │         │  Supabase Postgres               │
│  Local Postgres or      │         │    public schema → master tables │
│  SQLite fallback        │         │    tenant_<slug> schemas →       │
│  (YOUR local data)      │         │    per-tenant business data      │
│                         │         │                                  │
└─────────────────────────┘         └──────────────────────────────────┘
```

## Key Concepts

### 1. Code vs Data

| | Code | Data |
|---|---|---|
| **What** | Routes, UI, logic, migrations | Categories, products, sales, employees |
| **Stored in** | GitHub repo | Supabase Postgres (production) |
| **Deployed by** | `git push` | NOT deployed — each environment has its own DB |
| **Shared?** | Yes — same everywhere | No — local and production are separate |

**When you `git push`:**
- Code changes go to Railway (backend) and Vercel (frontend)
- Data stays where it is — your local DB is never uploaded

---

## What Affects What — Quick Reference

This is the most important section. When you make a change, ask yourself which row it falls into.

| Change type | What to do | Affects Railway DB? | Affects local DB? |
|---|---|---|---|
| Fix a bug in a route/component | `git push` | No (code only) | No |
| Add a new UI page or component | `git push` | No (code only) | No |
| Add a new DB column (migration) | Update `schema-pg.sql` + write Postgres migration + `git push` | **Yes — on next Railway restart** | Only if you run the migration locally too |
| Add products/categories/employees | Use the app UI | No | Yes (local only) |
| Fix a data problem (wrong records) | Run a script against the target DB | Only if you run it on Railway | Only if you run it locally |
| Change an environment variable | Change it in Railway/Vercel dashboard | Yes — takes effect on next deploy | No — edit your local `.env` file |

**Golden rule: `git push` only moves code, never data.**

---

### 2. Databases

| Database | Location | Purpose |
|---|---|---|
| Supabase Postgres `public` schema | Supabase cloud (ap-southeast-1) | Master tables — tenant registry, super-admins, audit log, schema_migrations |
| Supabase Postgres `tenant_<slug>` schema | Same Supabase instance | Per-tenant business data — fully isolated per customer |
| Local Postgres (docker-compose) or SQLite fallback | Your computer | Local development & testing |

These are completely independent. Adding a category locally does NOT add it to production.

**The `public` schema contains only 6 master tables:**
`tenants`, `super_admins`, `tenant_audit_log`, `schema_migrations`, `tenant_refresh_tokens`, `company_profile`

**Each tenant gets their own schema** (e.g. `tenant_packagesmall`) with the full set of business tables. One tenant can never see another's data.

### 3. Vercel vs Railway

| | Vercel | Railway |
|---|---|---|
| **Hosts** | Frontend (React app) | Backend (Express server) |
| **Database** | None | Connects to Supabase Postgres via `DATABASE_URL` |
| **URL** | sanopos.vercel.app | oneshoppos-production.up.railway.app |
| **Auto-deploys** | Yes, on git push | Yes, on git push |
| **What it does** | Serves the UI to browsers | Handles API requests, reads/writes DB |

Vercel is just a screen. Railway is the brain. Supabase is the memory.

### 4. Cloudflare R2 (File Storage)

| | Local | Production |
|---|---|---|
| **What** | Product images, logos, uploads | Same files, same bucket |
| **Stored in** | Cloudflare R2 bucket | Cloudflare R2 bucket (shared) |
| **URL** | Via Railway `/r2/*` proxy | Via Railway `/r2/*` proxy |

R2 is Cloudflare's file storage (like AWS S3). Unlike the database, **R2 is shared between local and production** — when you upload a product image locally, it goes to the same R2 bucket as production.

- Product images uploaded locally ARE visible on the live app
- Product images uploaded on the live app ARE visible locally
- R2 credentials are stored in Railway environment variables (`R2_*`)

---

## Migrations (Schema Changes)

Migrations create/modify **database structure** (tables, columns), NOT data.

### How Postgres migrations work

1. Update `backend/schema-pg.sql` with the structural changes
2. `backend/migrate-pg.js` is the version-tracked migration runner — it reads from the `schema_migrations` table to know what has already run
3. `git push` — Railway restarts, `start.sh` detects `DATABASE_URL` and runs `migrate-pg.js` automatically
4. Locally, run it manually: `cd backend && node migrate-pg.js`

### The two migration systems

| System | File | When used |
|---|---|---|
| **Postgres** (production) | `backend/migrate-pg.js` | Active — used on Railway (has `DATABASE_URL`) |
| **SQLite** (legacy) | `backend/run_migrations.js` + `backend/migrate*.js` files | Legacy only — local fallback if no `DATABASE_URL` |

`start.sh` automatically detects which system to use based on whether `DATABASE_URL` is set.

### Latest schema

The canonical schema is `backend/schema-pg.sql`. For individual migration history, check `backend/migrate74.js` (the highest-numbered SQLite migration, for reference) or the `schema_migrations` table in Supabase.

### Migrations are idempotent

Safe to run multiple times. They use `IF NOT EXISTS` and `ON CONFLICT DO NOTHING`, so re-running them won't break anything.

---

## Multi-Tenant Mode — LIVE (Mar 13 2026)

**`MULTI_TENANT=1` is active on both Railway and Vercel.** This is the only supported production mode.

### What multi-tenant means

- **Every customer gets their own isolated Postgres schema** (`tenant_packagesmall`, `tenant_acme`, etc.)
- **Login requires a Store Code** (slug) in addition to username + PIN
- **Super-admin dashboard** at `/admin` manages all tenants
- **Plan limits** enforced per tenant (`max_employees`, `max_products`, `max_outlets`)

### How requests are routed to the right tenant

```
Request from "packagesmall" customer
    │
    ▼
loadTenantAndPerms  →  verify JWT, extract tenant_id
    │
    ▼
resolveTenant  →  look up Supabase public.tenants → get tenant slug
    │
    ▼
tenant-db-proxy-pg.js (AsyncLocalStorage)
    →  SET search_path TO tenant_packagesmall
    │
    ▼
Route handler  →  calls db.query() → hits tenant_packagesmall schema
```

Each tenant's data is completely isolated — one customer can never see another's data.

### The MULTI_TENANT flag

The same codebase runs in multi-tenant mode. The flag controls which middleware paths activate:

| What changes | Multi-tenant (production) |
|---|---|
| Auth | JWT Bearer token (access + httpOnly refresh cookie) |
| DB routing | Per-request via AsyncLocalStorage → SET search_path → tenant schema |
| Login form | Username + PIN + Store Code |
| Admin panel | `/admin/*` — separate JWT, separate auth session |

### Railway environment variables (required)

```
MULTI_TENANT=1
DATABASE_URL=<supabase postgres connection string>
JWT_SECRET=<64-byte hex>
JWT_REFRESH_SECRET=<64-byte hex>
CORS_ORIGIN=https://sanopos.vercel.app
TZ=Asia/Karachi
```

### Vercel environment variables (required)

```
VITE_MULTI_TENANT=1
VITE_API_BASE=https://oneshoppos-production.up.railway.app
```

---

## Provisioning a New Tenant

When a new customer signs up, here is what happens:

### Option A — Super-admin dashboard (preferred)

1. Log in to `https://sanopos.vercel.app/admin`
2. Click "Provision New Tenant" — enter slug (only `[a-z0-9_]` allowed, **no hyphens**), company name, plan
3. Dashboard shows the setup URL — send it to the customer
4. Customer completes the 4-step setup wizard (store info, timezone/currency, outlet, admin account)

### Option B — Railway CLI

```bash
railway run node backend/tenant-provisioner-pg.js --slug acme --name "Acme Store" --plan starter
```

### What provisioning does

1. **Creates a Postgres schema**: `CREATE SCHEMA tenant_acme`
2. **Runs `schema-pg.sql`** into that schema — full table set, always on latest schema
3. **Seeds default data**: roles, permissions, feature flags
4. **Registers in `public.tenants`**: slug, company name, plan limits, created date
5. **Generates a setup token**: one-time token for the customer to complete the setup wizard

From that point on, every API request from that tenant is automatically routed to `tenant_acme` schema via `SET search_path`.

### Seeding a super-admin (first time only)

```bash
railway run node backend/seed-admin-pg.js --email admin@example.com --password <password> --name "Admin Name"
```

---

## Common Tasks

### "I changed the UI/backend code"
→ `git push` — both Vercel and Railway auto-deploy

### "I added a new database column (migration)"
→ Update `backend/schema-pg.sql` with the new column
→ Add a migration entry to `backend/migrate-pg.js`
→ `git push` — Railway runs it automatically on next startup
→ Run locally too: `cd backend && node migrate-pg.js`

### "I fixed a data problem locally (bad records, stale data)"
→ The fix only applies to your local DB
→ If production has the same bad data, you need to either:
  - Write a migration that cleans it up (runs on Railway automatically), or
  - Run a fix script via Railway shell: `railway run node scripts/fix-something.js`

### "I want to add data to the live app"
→ Use the live app directly at sanopos.vercel.app — enter data through the UI

### "The live app shows an error"
→ Check Railway logs in the Railway dashboard

### "I need to run a one-off script against production"
→ `railway run node backend/scripts/your-script.js`

### "A tenant needs their admin PIN reset"
→ Super-admin dashboard → Tenant Detail → Reset PIN

### "I want to check tenant health / usage"
→ Super-admin dashboard → Tenant List (health dots, revenue, last activity)
→ Tenant Detail → Activity + Plan Usage + Storage sections
→ Dashboard → "Needs Attention" card (approaching limits, dormant, setup pending)

---

## Known Gotchas

### attendance_sessions and employee_attendance store LOCAL time
All other tables (sales, returns, shifts) store UTC. But `attendance_sessions.session_start`
and `employee_attendance.check_in` default to `NOW()` on the server's local clock (Railway `TZ=Asia/Karachi`).

**In queries**, always use `col::date` with NO timezone conversion. Writing `AT TIME ZONE` on an already-local value shifts dates forward by your UTC offset.
Always write `date(session_start)` (SQLite) or `session_start::date` (Postgres) with no modifier.

### All other timestamps are UTC
`sales.timestamp`, `returns.timestamp`, `cash_shifts.*` are all UTC via `CURRENT_TIMESTAMP` / `NOW()`.
Use `backend/utils/tz.js` → `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` for date filters.

### Frontend timestamp display
- **UTC columns** (sales, returns, cash_shifts, stock_adjustments, transfers, action_history): use `fmtUtcDateTime` / `fmtUtcDate` / `fmtUtcTime` from `frontend/src/utils/dates.js`
- **LOCAL columns** (attendance, expenses, GRN, parked_sales): use `fmtLocalDateTime` / `fmtLocalDate` / `fmtLocalTime` from `frontend/src/utils/dates.js`
- **NEVER** use raw `new Date(dt)` on any DB value — SQLite/Postgres timestamp strings without a `Z` suffix are parsed as local time by Chrome, causing wrong display

### Slug validation — no hyphens
Tenant slugs must match `[a-z0-9_]` only. Hyphens are NOT allowed because slugs become Postgres schema names (`tenant_<slug>`) and Postgres schema names cannot contain hyphens without quoting everywhere.

### Postgres NUMERIC returns strings
Postgres `NUMERIC`/`DECIMAL` columns return JS strings. Always wrap with `Number()` before arithmetic (e.g. gift card `remaining_value`, prices, totals).

### Postgres booleans are strict
Boolean columns (`is_active`, `voided`, `show_barcode`, etc.) require `= true` / `= false`. Never use `= 1` / `= 0`.

### dotenv must load before boot guard
`require("dotenv").config(...)` is line 1 of `index.js` — before the conditional `require("./db-pg")` on line 5. Without this, `DATABASE_URL` isn't in `process.env` yet and the app falls back to SQLite.

### Railway volume (SQLite legacy)
If you ever need to run in SQLite fallback mode locally, `railway.toml` alone does NOT provision a volume. You must go to Railway UI → project canvas → Add → Volume → mount at `/data`. (Not needed for Postgres production mode.)

---

## File Reference

| File | What it does |
|---|---|
| `backend/index.js` | Main server — loads dotenv, boots db-pg or db based on DATABASE_URL, mounts middleware + routes |
| `backend/db-pg.js` | Postgres pool wrapper — `query()`, `transaction()`, `getPool()` |
| `backend/schema-pg.sql` | Full DDL for all tables + indexes + seed data — canonical schema reference |
| `backend/migrate-pg.js` | Version-tracked Postgres migration runner — reads `schema_migrations` table |
| `backend/master-db-pg.js` | Master DB wrapper — tenant registry in `public` schema |
| `backend/tenant-db-manager-pg.js` | Shared pg.Pool + `SET search_path TO tenant_<slug>` per request, 60s tenant cache |
| `backend/tenant-db-proxy-pg.js` | AsyncLocalStorage proxy — transparently routes `db.query()` to current tenant schema |
| `backend/tenant-provisioner-pg.js` | CLI — provisions new tenant (schema, seed data, master DB registration, setup token) |
| `backend/seed-admin-pg.js` | CLI — creates first super-admin in Postgres |
| `backend/cleanup-public-schema.js` | One-time script — dropped 89 stale single-tenant tables (already run Mar 13 2026) |
| `backend/start.sh` | Production startup — detects DATABASE_URL, runs migrate-pg.js or run_migrations.js, starts server |
| `backend/run_migrations.js` | SQLite legacy migration runner — only runs when DATABASE_URL is not set |
| `frontend/.env.production` | Vercel config — sets VITE_API_BASE (Railway URL) and VITE_MULTI_TENANT=1 |
| `frontend/.env.development` | Local dev config — sets VITE_API_BASE to localhost:5000 |
| `backend/.env.example` | Template for all backend environment variables |
| `railway.toml` | Railway build/deploy config |

---

## Quick Mental Model

Think of it like a restaurant franchise:

- **Code** = the recipe book (same for every restaurant, updated by `git push`)
- **Data** = the actual food, customers, and sales (different at each location, never synced)
- **Migrations** = adding a new section to the recipe book (structure change, applied everywhere on next startup)
- **Multi-tenant** = a franchise with many restaurants, each with their own section of the kitchen (Postgres schemas)
- **`git push`** = sending updated recipes to all locations
- **Provisioning a tenant** = opening a new franchise location (schema + seed data + registration)
- **`SET search_path`** = walking into the right restaurant's kitchen for each order

---

## Full Development Cycle — End to End

### Stage 1: You work locally (your laptop)

```
Your laptop
├── frontend/    ← React app, Vite dev server at localhost:5173
├── backend/     ← Express server at localhost:5000
└── Local Postgres (docker-compose) or SQLite fallback (YOUR local database)
```

You make changes — fix a bug, add a feature, add a new DB column.
Everything runs and is tested locally first.

---

### Stage 2: What exactly transfers when you `git push`

```
git add <files>
git commit -m "..."
git push
```

**What goes up:**
- All `.js`, `.jsx`, `.json`, `.css`, `.md` files you changed
- `backend/schema-pg.sql` (schema changes)
- `backend/migrate-pg.js` (migration runner updates)

**What NEVER goes up:**
- Your local database — gitignored, your local data stays local
- `backend/.env` — gitignored, your JWT secrets and ports stay local
- `backend/uploads/` — gitignored
- `backend/exports/` — gitignored

---

### Stage 3: Railway receives the push and redeploys

Railway detects the push automatically and:

1. Pulls the new code from GitHub
2. Runs `npm install` (installs any new packages)
3. Runs `start.sh` which does:
   - Detects `DATABASE_URL` is set → runs `node migrate-pg.js`
   - `migrate-pg.js` checks `schema_migrations` table, runs any new migrations against Supabase
   - Starts the Express server

**What changes in Supabase after a migration:**
- New tables are created (`IF NOT EXISTS` — safe if they already exist)
- New columns are added (`ADD COLUMN IF NOT EXISTS` — safe to re-run)
- No data is touched — migrations only change structure, never rows

**What does NOT change in Supabase:**
- Existing rows (products, employees, sales, feature flags, outlets, etc.)
- Any data entered directly through the live app

---

### Stage 4: Vercel receives the push and rebuilds the frontend

Vercel detects the same push and:

1. Runs `npm run build` inside `frontend/`
2. Reads `frontend/.env.production` — this bakes `VITE_API_BASE` (Railway URL) and `VITE_MULTI_TENANT=1` into the build
3. Serves the compiled static files globally via CDN

The frontend build is a snapshot — environment variables are burned in at build time, not runtime.

---

### Stage 5: What does NOT automatically replicate from local → Railway

| Local change | Does it replicate? | How to replicate manually |
|---|---|---|
| New feature flag row in DB | No | Add it through the app UI on live, or write a migration that inserts it |
| New outlet/branch | No | Add it through the live app UI |
| New employee | No | Add it through the live app UI |
| Products, categories | No | Add through live app UI |
| Fixed bad data rows locally | No | Write a migration or run a fix script via `railway run` |
| `backend/.env` changes | No | Update environment variables in Railway dashboard |

---

### Stage 6: How a customer gets their own database (Multi-Tenant)

Multi-tenant is **active on production** (`MULTI_TENANT=1`). Here is the provisioning flow:

**Via super-admin dashboard (preferred):**
1. Log in to `/admin`
2. Fill in tenant slug (e.g. `acme`), company name, plan
3. Click "Provision" — backend runs provisioner automatically
4. Copy the setup URL and send it to the customer

**What the provisioner does:**

```
POST /api/admin/tenants  (super-admin API)
    │
    ▼
tenant-provisioner-pg.js
    │
    ├── CREATE SCHEMA tenant_acme
    ├── Run schema-pg.sql into tenant_acme (full table set, latest schema)
    ├── Seed default roles, permissions, feature flags
    ├── INSERT INTO public.tenants (slug, name, plan, ...)
    └── Generate setup_token → store in tenant_acme.company_profile
```

From that point on, every API request from that customer:

```
Request from "acme" customer
    │
    ▼
loadTenantAndPerms  →  verify JWT Bearer token, extract tenant_id
    │
    ▼
resolveTenant  →  look up public.tenants → get tenant slug = "acme"
    │
    ▼
tenant-db-proxy-pg.js (AsyncLocalStorage)
    →  SET search_path TO tenant_acme
    │
    ▼
Route handler  →  calls db.query() → reads/writes tenant_acme schema
```

---

### Full Cycle Summary (one diagram)

```
YOUR LAPTOP                     GITHUB                    RAILWAY + SUPABASE        CUSTOMER
─────────────────               ──────                    ──────────────────────    ────────
Write code          git push →  Stores code  auto-deploy→ Pulls code
Fix bug                                                    npm install
Add migration                                              migrate-pg.js
(schema-pg.sql)                                            ↓
                                                           Supabase schema updated
                                                           (structure only, no data)
                                                           ↓
                                                           Express server running
                                                                                    New customer
                                                           POST /api/admin/tenants ←
                                                           ↓
                                                           CREATE SCHEMA tenant_acme
                                                           Schema + seed data loaded
                                                           Setup token generated
                                                                                    Setup wizard
                                                           Setup wizard completes  ←
                                                           (store info, outlet,
                                                            admin account created)
                                                                                    Logs in daily
                                                           JWT issued with tenant  →
                                                           SET search_path = acme  →
                                                           Routes to their schema     Their data
```
