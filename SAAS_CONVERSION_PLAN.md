# OneShopPOS → Multi-Tenant SaaS Conversion Plan

## Context

OneShopPOS is a full-featured POS system currently running as a single-tenant local app (Express + SQLite + React). The goal is to convert it into a cloud-hosted SaaS so you can sell it to multiple businesses with monthly subscriptions. Each business gets its own isolated database (database-per-tenant pattern using SQLite). Code stays on your server — customers only access it through a browser.

**Key architectural advantage:** All 26 route files already receive `db` via dependency injection (`deps` parameter), NOT via direct import. This means the multi-tenant DB swap can be done at the middleware layer with zero changes to most route files.

**Business model:** SaaS with tiered monthly subscriptions (Free / Starter / Pro).

**Target scale:** 1-20 businesses in year one.

**Hosting:** Vercel (frontend, free) + Railway or Fly.io (backend, $0-5/mo).

---

## ✅ SaaS Prerequisite Already Done: Timezone Fix (Mar 2026)

The app previously used `date(col,'localtime')` in 214+ query filters, tied to the server OS timezone. On a UTC Linux production server, customers in New York or Auckland would see wrong date boundaries.

**Fixed:**
- `backend/utils/tz.js` — `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` converts a local `YYYY-MM-DD` to UTC range strings for direct `timestamp >= ?` / `timestamp < ?` queries. Uses `Intl.DateTimeFormat` + binary search, handles DST, UTC+14 through UTC-12. No external deps.
- `loadCompanyProfile` middleware in `backend/index.js` — caches `company_profile` (5-min TTL), sets `req.company.timezone` on every request.
- All report and non-report routes now use `req.company?.timezone || 'UTC'` for date filtering.
- `company_profile.timezone` is the per-tenant IANA timezone string — already in schema, defaults to `'UTC'`. **Set this correctly when provisioning each tenant in Phase 1.**
- Rule for new code: never use `date(col,'localtime')` in WHERE clauses. Use `toUtcStart`/`toUtcEnd` from `backend/utils/tz.js`.

---

## Phase 1: Master Database & Tenant Management Layer
**No existing files modified — purely additive**

### New Files
| File | Purpose |
|------|---------|
| `backend/master-db.js` | Master SQLite DB (`master.db`) — stores tenant registry |
| `backend/tenant-db-manager.js` | Connection pool — given a `tenant_id`, returns correct `db` handle |
| `backend/tenant-provisioner.js` | Creates new tenant: directory, DB file, schema, seed data |
| `backend/schema-full.js` | Complete current schema as a single runnable script (extracted from `db.js` + all 56 migrations) — used to initialize new tenant DBs |

### Master DB Schema (`master.db`)
```sql
CREATE TABLE tenants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,          -- 'aces-hardware' (URL-safe, 3-40 chars)
  name            TEXT NOT NULL,                 -- 'Aces Hardware Store'
  owner_email     TEXT NOT NULL,                 -- For account recovery / billing
  status          TEXT NOT NULL DEFAULT 'active', -- active | suspended | deleted
  plan            TEXT NOT NULL DEFAULT 'free',   -- free | starter | pro
  db_path         TEXT NOT NULL,                 -- relative path: tenants/t_aces-hardware/data.db
  max_employees   INTEGER DEFAULT 3,
  max_outlets     INTEGER DEFAULT 1,
  max_products    INTEGER DEFAULT 500,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  suspended_at    TEXT,
  deleted_at      TEXT
);

CREATE TABLE super_admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,                 -- bcrypt hash
  name            TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE tenant_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  action          TEXT NOT NULL,                 -- 'created' | 'suspended' | 'migrated' | 'plan_changed'
  details         TEXT,                          -- JSON blob
  actor           TEXT,                          -- 'system' | 'admin:email' | 'stripe:webhook'
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE schema_version (
  version         INTEGER NOT NULL               -- Tracks migration version for tenant DBs
);
```

### Tenant Directory Structure
```
backend/
  master.db
  tenants/
    t_aces-hardware/
      data.db              <-- tenant's SQLite database
      uploads/products/
      uploads/company/
      backups/
      exports/reports/
    t_bobs-shop/
      data.db
      ...
```

### Tenant DB Manager Design
- Cache of open SQLite connections (Map of tenant_id -> db handle)
- For 1-20 tenants, keep all connections open (~50KB each)
- Each connection gets `PRAGMA foreign_keys = ON` and WAL mode
- Methods: `getDb(tenantId)` / `closeDb(tenantId)` / `closeAll()`

---

## Phase 2: Authentication Overhaul
**Replaces insecure `x-employee-id` header with JWT tokens**

### Tenant Identification Strategy: Login-Based
- Login page gets a **"Store Code"** field (the tenant slug, e.g., `aces-hardware`)
- Backend looks up tenant by slug -> opens tenant's DB -> authenticates employee
- JWT token embeds `{ tid, eid, rid }` (tenant_id, employee_id, role_id)
- No subdomains needed (avoids wildcard SSL, DNS complexity) — can add later as a cosmetic feature
- Support pre-filling from URL: `https://yourpos.com/login?store=aces-hardware`

### Files to Modify
| File | Change |
|------|--------|
| `backend/package.json` | Add `jsonwebtoken`, `bcryptjs` dependencies |
| `backend/routes/auth.js` | Accept `tenant_slug` in login, look up tenant in master DB, authenticate against tenant DB, return JWT |
| `backend/index.js` | Replace `loadEmployeePerms` middleware with JWT-based `loadTenantAndPerms` — verifies token, sets `req.tenantId`, `req.tenantDb`, `req.employeePerms` |
| `frontend/src/config.js` | Use `import.meta.env.VITE_API_BASE` with localhost fallback |
| `frontend/src/auth/AuthProvider.jsx` | Send `Authorization: Bearer <token>` instead of `x-employee-id` header; store JWT + tenant_slug |
| `frontend/src/pages/Login.jsx` | Add "Store Code" input field (conditionally shown when `VITE_MULTI_TENANT=1`) |

### Backward Compatibility
- Env var `MULTI_TENANT=1` (default `0`) toggles between old and new auth
- When `0`: everything works exactly as today (singleton DB, x-employee-id header)
- When `1`: JWT auth, tenant DB routing
- This lets you develop incrementally without breaking local dev

### JWT Token Structure
```json
{
  "tid": 7,           // tenant_id
  "eid": 42,          // employee_id
  "rid": 1,           // role_id
  "iat": 1709337600,
  "exp": 1709424000   // 24h expiry
}
```

### New Env Vars
- `JWT_SECRET` — strong random string for signing tokens
- `MULTI_TENANT` — `0` (default, single-tenant) or `1` (multi-tenant SaaS mode)

---

## Phase 3: Backend Multi-Tenancy Middleware (Core Change)
**The magic layer that makes all 26 route files work without modification**

### Key Technique: AsyncLocalStorage + DB Proxy

Since routes capture `db` from `deps` at registration time (via closure), we can't swap `db` per-request directly. Solution:

1. **Create `backend/tenant-db-proxy.js`** — a `Proxy` object that looks like a sqlite3.Database but delegates every call (`db.all()`, `db.get()`, `db.run()`) to the current request's tenant DB using Node.js `AsyncLocalStorage`
2. **In `backend/index.js`** — when `MULTI_TENANT=1`, pass the proxy as `deps.db` instead of the singleton. Add middleware that wraps each request in an `asyncStore.run()` context with the tenant's real DB.

**Result:** All 26 route files call `db.all(...)` as usual, but it transparently hits the correct tenant's database. Zero changes to route files for DB access.

### How AsyncLocalStorage Works Here
```
Request comes in with JWT containing tenant_id=7
  -> Middleware extracts tenant_id from JWT
  -> Middleware gets tenant's db via TenantDbManager.getDb(7)
  -> Middleware wraps the rest of the request in asyncStore.run({ db: tenantDb })
  -> Route handler calls db.all("SELECT * FROM products ...")
  -> Proxy intercepts, reads tenantDb from AsyncLocalStorage
  -> Query runs against tenant 7's database
```

### Files That Need Minor Modifications (File Uploads Only)
These files use hardcoded upload paths captured at registration time — need to read tenant path from `req` context instead:

| File | Change |
|------|--------|
| `backend/routes/products.js` | Multer destination reads from tenant-aware path |
| `backend/routes/barcode-expenses.js` | Backup/restore uses tenant-specific DB_PATH |
| `backend/routes/tier4.js` | Company logo upload path |
| `backend/routes/reports.js` | Export directory becomes tenant-aware |

### Static File Serving
Replace `app.use("/uploads", express.static(UPLOADS_DIR))` with tenant-scoped middleware that serves from `tenants/t_{slug}/uploads/`.

### Background Workers (Shopify sync, report schedules)
These run in `setInterval` outside request context. In multi-tenant mode, they iterate over all active tenants and run inside an `asyncStore.run()` context for each.

### New Files
| File | Purpose |
|------|---------|
| `backend/tenant-db-proxy.js` | AsyncLocalStorage-based DB proxy |
| `backend/tenant-multer.js` | Tenant-aware multer storage factory |

---

## Phase 4: Frontend Changes

| File | Change |
|------|--------|
| `frontend/src/config.js` | `API_BASE = import.meta.env.VITE_API_BASE \|\| 'http://localhost:5000'` |
| `frontend/src/pages/Login.jsx` | "Store Code" field + prefill from `?store=` query param |
| `frontend/src/auth/AuthProvider.jsx` | JWT Bearer token in all requests, tenant_slug in session |
| `frontend/.env.development` | `VITE_API_BASE=http://localhost:5000` |
| `frontend/.env.production` | `VITE_API_BASE=https://your-api.railway.app`, `VITE_MULTI_TENANT=1` |

### Frontend Session Structure (Updated)
```javascript
{
  token: "eyJhbG...",           // JWT token
  tenant_slug: "aces-hardware", // Store code
  employee: { id, name, role_id, outlet_id },
  permissions: [...],
  loadedAt: Date.now()
}
```

### Optional: Tenant Branding
Add a `GET /api/tenant/branding?slug=aces-hardware` public endpoint that returns business name, logo URL, and primary color. The login page shows the tenant's branding after typing the store code.

---

## Phase 5: Super-Admin Dashboard

### New Backend: `backend/routes/admin.js`
```
POST   /api/admin/auth/login        — super-admin login (email + password, bcrypt)
GET    /api/admin/tenants            — list all tenants with status/plan
POST   /api/admin/tenants            — provision new tenant (calls provisioner)
GET    /api/admin/tenants/:id        — tenant details + usage stats
PUT    /api/admin/tenants/:id        — update tenant (name, plan, limits)
POST   /api/admin/tenants/:id/suspend    — suspend a tenant
POST   /api/admin/tenants/:id/activate   — reactivate a tenant
DELETE /api/admin/tenants/:id            — soft-delete a tenant
POST   /api/admin/tenants/:id/migrate    — run pending migrations on one tenant
POST   /api/admin/migrate-all            — run pending migrations on ALL tenants
GET    /api/admin/stats                  — aggregate stats across all tenants
```

### New Frontend Pages: `frontend/src/pages/admin/`
- `AdminLogin.jsx` — email + password login (separate from tenant PIN login)
- `AdminDashboard.jsx` — overview stats across all tenants
- `AdminTenantList.jsx` — create, view, suspend tenants
- `AdminTenantDetail.jsx` — single tenant management
- `AdminLayout.jsx` — separate layout (no POS sidebar)

### Migration Runner: `backend/tenant-migrate.js`
For applying future migrations (migrate57+) to existing tenant DBs. New migrations written as SQL files in `backend/migrations/` that can target any DB path.

**Can be built in parallel with Phase 3/4.**

---

## Phase 6: Deployment

### Hosting Architecture
| Component | Platform | Cost |
|-----------|----------|------|
| Frontend (React SPA) | **Vercel** free tier | $0 |
| Backend (Express API) | **Railway** starter ($5/mo) or **Fly.io** free tier | $0-5/mo |
| SQLite files | Persistent volume on Railway/Fly.io | Included |
| Domain | Custom domain (optional) | ~$10/year |

**Why not Vercel for backend?** Vercel is serverless — no persistent filesystem, so SQLite databases can't live there. Backend needs a platform with persistent storage.

### New Files
| File | Purpose |
|------|---------|
| `backend/Dockerfile` | Container image for Railway/Fly.io |
| `backend/.dockerignore` | Exclude node_modules, local .db files |
| `backend/railway.toml` or `fly.toml` | Platform config (single replica — SQLite requires it) |
| `frontend/vercel.json` | SPA rewrite rules |
| `backend/.env.example` | Full documented env var reference |

### Critical Constraint
SQLite requires **single-instance deployment** (1 replica). This is fine for 1-20 tenants. Scaling beyond ~50 concurrent tenants would need a PostgreSQL migration (future, not now).

### Production Environment Variables
```env
# Server
PORT=5000
NODE_ENV=production

# Multi-tenant mode
MULTI_TENANT=1
MASTER_DB_PATH=./master.db
TENANTS_DIR=./tenants

# JWT
JWT_SECRET=replace_with_64_char_random_string
JWT_EXPIRES_IN=24h

# Shopify (per-tenant, stored in tenant DB)
SHOPIFY_SECRET_KEY=replace_with_a_strong_secret_key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_GLOBAL_MAX=600

# Billing (Phase 7)
# STRIPE_SECRET_KEY=sk_...
# STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Phase 7: Billing (Stripe)

### New Files
| File | Purpose |
|------|---------|
| `backend/routes/billing.js` | Stripe checkout sessions, webhooks, customer portal |
| `backend/middleware/plan-limits.js` | Enforce max_employees, max_products, max_outlets per plan |
| `frontend/src/pages/admin/AdminBilling.jsx` | Billing management UI |

### Plan Tiers
| Plan | Price | Employees | Products | Outlets |
|------|-------|-----------|----------|---------|
| Free | $0/mo | 3 | 500 | 1 |
| Starter | $29/mo | 10 | 5,000 | 2 |
| Pro | $79/mo | 50 | Unlimited | 10 |

### Stripe Flow
1. Customer selects plan on admin dashboard or self-service page
2. Backend creates Stripe Checkout Session
3. Customer pays on Stripe-hosted page
4. Stripe sends `checkout.session.completed` webhook
5. Backend updates `tenants.plan` and limit columns in master.db
6. Plan limits enforced via middleware on relevant POST endpoints

**Can be deferred until you have early adopters.**

---

## Implementation Order & Dependencies

```
Phase 1 (Master DB + Tenant Manager)     <-- START HERE, purely additive
    |
Phase 2 (JWT Auth)                        <-- depends on Phase 1
    |
Phase 3 (DB Proxy + Middleware)           <-- depends on Phase 2
  + Phase 5 (Admin Dashboard)             <-- can run in parallel with Phase 3
    |
Phase 4 (Frontend Changes)               <-- depends on Phase 2+3
    |
Phase 6 (Deployment)                      <-- depends on Phases 1-4
    |
Phase 7 (Billing)                         <-- whenever you're ready
```

**Phases 2+3+4 must deploy together** (auth change is atomic).
**Phase 1 and Phase 5 are safe to build independently.**

---

## Verification Plan

### After Phase 1
- Run `node backend/tenant-provisioner.js --slug test-store --name "Test Store"`
- Verify `backend/tenants/t_test-store/data.db` exists with full schema
- Open it in a SQLite browser and confirm all tables exist

### After Phases 2-4
- Start backend with `MULTI_TENANT=1`
- Open frontend, enter store code `test-store`, login with default admin PIN
- Verify all POS features work (sales, inventory, reports)
- Create a second tenant, log in separately, verify data isolation

### After Phase 6
- Deploy backend to Railway/Fly.io
- Deploy frontend to Vercel
- Set `VITE_API_BASE` to the Railway/Fly.io URL
- Provision a tenant via admin API, login from the public URL

### After Phase 7
- Create a Stripe test-mode checkout for a tenant
- Complete payment, verify plan limits update in master.db
- Try exceeding limits (e.g., add employees beyond max), verify enforcement

---

## Summary of All New Files

| Phase | File | Purpose |
|-------|------|---------|
| 1 | `backend/master-db.js` | Master tenant registry database |
| 1 | `backend/tenant-db-manager.js` | Connection pool for tenant DBs |
| 1 | `backend/tenant-provisioner.js` | New tenant creation |
| 1 | `backend/schema-full.js` | Full schema for fresh tenant DBs |
| 3 | `backend/tenant-db-proxy.js` | AsyncLocalStorage DB proxy |
| 3 | `backend/tenant-multer.js` | Tenant-aware file uploads |
| 5 | `backend/routes/admin.js` | Super-admin API |
| 5 | `backend/tenant-migrate.js` | Multi-tenant migration runner |
| 5 | `frontend/src/pages/admin/*.jsx` | Admin dashboard (4-5 pages) |
| 6 | `backend/Dockerfile` | Container for deployment |
| 6 | `frontend/vercel.json` | Vercel SPA config |
| 7 | `backend/routes/billing.js` | Stripe billing integration |
| 7 | `backend/middleware/plan-limits.js` | Plan enforcement |

## Summary of Modified Existing Files

| Phase | File | Change |
|-------|------|--------|
| 2 | `backend/routes/auth.js` | JWT + tenant_slug login |
| 2 | `backend/index.js` | JWT middleware, AsyncLocalStorage, conditional deps |
| 2 | `backend/package.json` | New dependencies |
| 3 | `backend/routes/products.js` | Tenant-aware upload paths |
| 3 | `backend/routes/barcode-expenses.js` | Tenant-aware backup/restore |
| 3 | `backend/routes/tier4.js` | Tenant-aware logo uploads |
| 3 | `backend/routes/reports.js` | Tenant-aware export dir |
| 4 | `frontend/src/config.js` | Env-based API URL |
| 4 | `frontend/src/auth/AuthProvider.jsx` | JWT + tenant context |
| 4 | `frontend/src/pages/Login.jsx` | Store Code field |
| 5 | `frontend/src/App.jsx` | Admin routes |
