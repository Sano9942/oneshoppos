# SanoPOS — Deployment & Architecture Guide

## The Big Picture

```
YOUR COMPUTER (Development)          INTERNET (Production)
┌─────────────────────────┐         ┌──────────────────────────────┐
│                         │         │                              │
│  Frontend (localhost:   │         │  Vercel (oneshoppos.        │
│    5173)                │         │    vercel.app)               │
│    React app            │         │    Same React app            │
│         │               │         │         │                    │
│         ▼               │         │         ▼                    │
│  Backend (localhost:    │  push   │  Railway (oneshoppos-        │
│    5000)                │ ──────► │    production.up.railway.app)│
│    Express server       │  code   │    Same Express server       │
│         │               │  only   │         │                    │
│         ▼               │         │         ▼                    │
│  sanopos.db             │         │  /data/sanopos.db            │
│  (YOUR local data)      │         │  (SEPARATE production data)  │
│                         │         │                              │
└─────────────────────────┘         └──────────────────────────────┘
```

## Key Concepts

### 1. Code vs Data

| | Code | Data |
|---|---|---|
| **What** | Routes, UI, logic, migrations | Categories, products, sales, employees |
| **Stored in** | GitHub repo | SQLite database files |
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
| Add a new DB column (migration) | Write `migrateN.js` + add to `run_migrations.js` + `git push` | **Yes — on next Railway restart** | Only if you run the migration locally too |
| Add products/categories/employees | Use the app UI | No | Yes (local only) |
| Fix a data problem (wrong records) | Run a script against the target DB | Only if you run it on Railway | Only if you run it locally |
| Change an environment variable | Change it in Railway/Vercel dashboard | Yes — takes effect on next deploy | No — edit your local `.env` file |

**Golden rule: `git push` only moves code, never data.**

---

### 2. Three Databases

| Database | Location | Purpose |
|---|---|---|
| `backend/sanopos.db` | Your computer | Local development & testing |
| `/data/sanopos.db` | Railway volume | Production (live app) |
| `backend/master.db` | Your computer | Super-admin & tenant registry (SaaS mode only) |

These are completely independent. Adding a category locally does NOT add it to production.

### 3. Vercel vs Railway

| | Vercel | Railway |
|---|---|---|
| **Hosts** | Frontend (React app) | Backend (Express server) |
| **Database** | None | sanopos.db on a persistent volume |
| **URL** | oneshoppos.vercel.app | oneshoppos-production.up.railway.app |
| **Auto-deploys** | Yes, on git push | Yes, on git push |
| **What it does** | Serves the UI to browsers | Handles API requests, reads/writes DB |

Vercel is just a screen. Railway is the brain + memory.

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

### How migrations work

1. You write `backend/migrateN.js` (replace N with the next number)
2. **You must also add it to `backend/run_migrations.js`** — if you forget this, Railway never runs it
3. `git push` — Railway restarts, `start.sh` calls `run_migrations.js`, new migration runs
4. Locally, run it manually: `cd backend && node migrateN.js`

### Important: always register new migrations

```js
// backend/run_migrations.js — add your new file at the bottom of the array
const migrations = [
  ...
  "migrate68.js",
  "migrate69.js",   // ← add here
  "migrate70.js",   // ← and here
];
```

Forgetting to add it = the column/table never gets created on Railway = API errors on production.

### Migrations are idempotent

Safe to run multiple times. They use `IF NOT EXISTS` and `ADD COLUMN` with duplicate-column checks, so re-running them won't break anything.

### Latest migration

Always check `backend/migrate70.js` (or the highest number) for the current DB schema.

---

## Single-Tenant vs Multi-Tenant

### Current mode: Single-Tenant (`MULTI_TENANT=0`)

- **One shop**, one database (`sanopos.db`)
- Login with username + PIN (no store code)
- All users share the same data
- Can have multiple outlets/branches within that one shop
- Railway env: `MULTI_TENANT=0` (or unset)

### Future mode: Multi-Tenant (`MULTI_TENANT=1`)

- **Unlimited shops**, each with its own isolated database
- Login with username + PIN + **Store Code**
- Each shop's data is at `/data/tenants/<slug>/sanopos.db`
- Super-admin dashboard at `/admin` to manage all shops
- Plan limits (max employees/products/outlets per shop)

### The MULTI_TENANT flag is a runtime switch, NOT separate codebases

The same code runs in both modes. Setting `MULTI_TENANT=1` just activates different middleware paths:

| What changes | Single-tenant | Multi-tenant |
|---|---|---|
| Auth | Session-based (cookie) | JWT Bearer token |
| DB routing | Direct `sanopos.db` | Per-request via AsyncLocalStorage → tenant DB |
| Login form | Username + PIN | Username + PIN + Store Code |
| DB file location | `backend/sanopos.db` | `/data/tenants/<slug>/sanopos.db` |

**All bug fixes and features you push apply to BOTH modes.** The flag only controls which auth/DB path activates at runtime.

### DO NOT flip MULTI_TENANT=1 without a proper cutover

Flipping it on Railway right now would break everything immediately:
1. Your existing data is at `/data/sanopos.db` — multi-tenant looks in `/data/tenants/<slug>/sanopos.db`
2. No tenant is registered in `master.db` — every request would fail with "Tenant not found"
3. The frontend build on Vercel has `VITE_MULTI_TENANT=false` baked in — login form won't show Store Code field

To switch properly you need to: provision a tenant, migrate existing data into the tenant directory, set JWT secrets, rebuild frontend with `VITE_MULTI_TENANT=1`, then flip the flag.

---

## Common Tasks

### "I changed the UI/backend code"
→ `git push` — both Vercel and Railway auto-deploy

### "I added a new database column (migration)"
→ Write `migrateN.js`, add it to `run_migrations.js`, then `git push`
→ Railway runs it automatically on next startup
→ Run it locally too: `cd backend && node migrateN.js`

### "I fixed a data problem locally (bad records, stale data)"
→ The fix only applies to your local DB
→ If production has the same bad data, you need to either:
  - Write a migration that cleans it up (runs on Railway automatically), or
  - Run a fix script directly against production (connect to Railway shell)

### "I added categories/products locally and want them on production"
→ Upload your local `sanopos.db` to Railway's volume (replaces ALL production data — be careful)

### "I want to add data to the live app"
→ Use the live app directly at oneshoppos.vercel.app — enter data through the UI

### "The live app shows an error"
→ Check Railway logs in the Railway dashboard

### "I want to start fresh on production"
→ Delete Railway volume, recreate it, redeploy — DB will be recreated from migrations

---

## Known Gotchas

### attendance_sessions and employee_attendance store LOCAL time
All other tables (sales, returns, shifts) store UTC. But `attendance_sessions.session_start`
and `employee_attendance.check_in` default to `datetime('now','localtime')` — already local.

**Never write** `date(session_start, 'localtime')` in queries — that applies a UTC→local
conversion on a value that is already local, shifting dates forward by your UTC offset.
Always write `date(session_start)` with no modifier.

### All other timestamps are UTC
`sales.timestamp`, `returns.timestamp`, `cash_shifts.*` are all UTC via `CURRENT_TIMESTAMP`.
Use `backend/utils/tz.js` → `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` for date filters.
Never use `date(col, 'localtime')` on these columns.

### Railway volume must be created manually
`railway.toml` alone does NOT provision the volume. You must go to Railway UI → project canvas
→ Add → Volume → mount at `/data`. Without this, the DB file is lost on every redeploy.

### The two DB name symlinks (oneshop.db / sanopos.db)
Old migrations hardcoded `oneshop.db`. `start.sh` symlinks both names to `/data/sanopos.db`
so both point to the same physical file. Locally only `sanopos.db` exists — the old name is gone.

---

## File Reference

| File | What it does |
|---|---|
| `backend/index.js` | Main server — starts Express, connects to DB |
| `backend/start.sh` | Production startup — symlinks DB, runs migrations, starts server |
| `backend/run_migrations.js` | Runs all migration files in order — **must register new migrations here** |
| `backend/sanopos.db` | Local SQLite database (YOUR data) |
| `backend/master.db` | Super-admin database (multi-tenant mode only) |
| `frontend/.env.production` | Vercel config — sets API URL, MULTI_TENANT flag |
| `backend/.env.example` | Template for backend environment variables |
| `railway.toml` | Railway build/deploy config |

---

## Quick Mental Model

Think of it like a restaurant franchise:

- **Code** = the recipe book (same for every restaurant, updated by `git push`)
- **Data** = the actual food, customers, and sales (different at each location, never synced)
- **Migrations** = adding a new section to the recipe book (structure change, applied everywhere on next startup)
- **Single-tenant** = one restaurant
- **Multi-tenant** = a franchise with many restaurants, each independent
- **`git push`** = sending updated recipes to all locations
- **Uploading the DB** = physically moving all the food and records from one location to another

---

## Full Development Cycle — End to End

### Stage 1: You work locally (your laptop)

```
Your laptop
├── frontend/    ← React app, Vite dev server at localhost:5173
├── backend/     ← Express server at localhost:5000
└── backend/sanopos.db  ← YOUR local database (test data, not real)
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
- Migration files (e.g. `backend/migrate71.js`) — the *instructions* for schema changes
- `run_migrations.js` — the list that tells Railway which migrations to run

**What NEVER goes up:**
- `backend/sanopos.db` — gitignored, your local data stays local
- `backend/master.db` — gitignored
- `backend/.env` — gitignored, your JWT secrets and ports stay local
- `backend/uploads/` — gitignored
- `backend/exports/` — gitignored

---

### Stage 3: Railway receives the push and redeploys

Railway detects the push automatically and:

1. Pulls the new code from GitHub
2. Runs `npm install` (installs any new packages)
3. Runs `start.sh` which does:
   - Symlinks `/app/sanopos.db` and `/app/oneshop.db` → `/data/sanopos.db` (the volume)
   - Runs `node run_migrations.js` — applies any new migration files against Railway's DB
   - Starts the Express server

**What changes in Railway's DB after a migration:**
- New tables are created (`IF NOT EXISTS` — safe if they already exist)
- New columns are added (`ADD COLUMN IF NOT EXISTS` — safe to re-run)
- No data is touched — migrations only change structure, never rows

**What does NOT change in Railway's DB:**
- Existing rows (products, employees, sales, feature flags, outlets, etc.)
- Any data you entered directly through the live app

---

### Stage 4: Vercel receives the push and rebuilds the frontend

Vercel detects the same push and:

1. Runs `npm run build` inside `frontend/`
2. Reads `frontend/.env.production` — this bakes `VITE_API_BASE` (Railway URL) into the build
3. Serves the compiled static files globally via CDN

The frontend build is a snapshot — environment variables are burned in at build time, not runtime.

---

### Stage 5: What does NOT automatically replicate from local → Railway

| Local change | Does it replicate? | How to replicate manually |
|---|---|---|
| New feature flag row in DB | No | Add it through the app UI on live, or write a migration that inserts it |
| New outlet/branch | No | Add it through the live app UI |
| New employee | No | Add it through the live app UI |
| Products, categories | No | Add through live app UI, or upload your local DB (replaces all production data) |
| Fixed bad data rows locally | No | Write a migration or run a fix script on Railway shell |
| `backend/.env` changes | No | Update environment variables in Railway dashboard |

---

### Stage 6: How a customer gets their own database (Multi-Tenant mode)

This is the SaaS path — currently built but not activated on Railway (`MULTI_TENANT=0`).

When a new customer signs up, here is what happens:

```
Super-Admin runs: node tenant-provisioner.js --slug acme --name "Acme Store" --plan starter
```

The provisioner does this automatically:

1. **Creates a directory**: `/data/tenants/acme/`
2. **Creates a fresh database**: `/data/tenants/acme/sanopos.db`
   - Schema is extracted from the live `sanopos.db` via `backend/schema-full.js` (reads `sqlite_master`)
   - This means the new tenant DB always has the latest schema — no migrations needed
3. **Seeds default data**: inserts default roles, permissions, feature flags into their DB
4. **Registers in master.db**: adds a row to the `tenants` table in `backend/master.db`
   - Stores: slug, company name, plan, DB path, created date

From that point on, every API request from that customer:

1. Frontend sends `Authorization: Bearer <JWT>` — the JWT contains the tenant slug
2. `loadTenantAndPerms` middleware verifies the JWT, extracts the slug
3. `resolveTenant` middleware looks up the slug in `master.db`, gets the DB path
4. Sets the AsyncLocalStorage context to that tenant's DB connection
5. All route handlers transparently read/write that tenant's DB — no code changes needed

```
Request from "acme" customer
    │
    ▼
loadTenantAndPerms  →  verify JWT, extract slug="acme"
    │
    ▼
resolveTenant  →  look up master.db → path="/data/tenants/acme/sanopos.db"
    │
    ▼
AsyncLocalStorage  →  set db context = acme's connection pool
    │
    ▼
Route handler  →  calls db.get() / db.run() → hits /data/tenants/acme/sanopos.db
```

Each customer's data is completely isolated — one customer can never see another's data.

---

### Full Cycle Summary (one diagram)

```
YOUR LAPTOP                     GITHUB                    RAILWAY                   CUSTOMER
─────────────────               ──────                    ───────                   ────────
Write code          git push →  Stores code  auto-deploy→ Pulls code
Fix bug                                                    npm install
Add migration                                              run_migrations.js
                                                           ↓
                                                           Railway DB schema updated
                                                           (structure only, no data)
                                                           ↓
                                                           Express server running
                                                                                    Signs up
                                                           tenant-provisioner.js  ←
                                                           ↓
                                                           /data/tenants/slug/sanopos.db created
                                                           master.db row inserted
                                                                                    Logs in
                                                           JWT issued with slug    ←
                                                           resolveTenant routes    →
                                                           to their DB                Their data
```
