# OneShopPOS → Multi-Tenant SaaS Conversion Plan

## Context

OneShopPOS is a full-featured POS system currently running as a single-tenant local app (Express + SQLite + React). The goal is to convert it into a cloud-hosted SaaS so you can sell it to multiple businesses with monthly subscriptions. Each business gets its own isolated database (database-per-tenant pattern using SQLite). Code stays on your server — customers only access it through a browser.

**Key architectural advantage:** All 26 route files already receive `db` via dependency injection (`deps` parameter), NOT via direct import. This means the multi-tenant DB swap can be done at the middleware layer with zero changes to most route files.

**Business model:** SaaS with tiered monthly subscriptions (Free / Starter / Pro).

**Target scale:** 1-20 businesses in year one.

**Hosting:** Vercel (frontend, free) + Railway or Fly.io (backend, $0-5/mo).

---

## Business Readiness Score (as of Mar 2026)

**Overall: 83 / 100 — BETA quality. Suitable for early paying customers, not broad market launch.**

| Dimension | Score | Status |
|---|---|---|
| Core POS (sales, returns, shifts) | 82 | Strong, cash/wallet only |
| Inventory management | 85 | Multi-outlet, variants, transfers |
| Reporting | 88 | 74 endpoints, 67 tabs, V2 live |
| User management + RBAC | 84 | Solid, no 2FA |
| Multi-outlet support | 86 | Context unification live |
| Customer management | 79 | Profiles + wallet, no segmentation |
| Shopify integration | 81 | 9 modules, bi-directional sync |
| Security | 80 | Good app-layer, weak infra |
| Data integrity | 87 | Transactions, shift linkage fixed |
| Missing critical features | 72 | Gaps: payments, email; printer ✅ done |
| Code quality / tests | 85 | 283/285 tests passing, modular |

### Top 5 product gaps to fix before broad launch
1. **Payment gateway** (Stripe/Razorpay) — cash-only is a deal-breaker for most retail
2. **Email receipts** (SMTP) — customers expect digital receipts *(in progress)*
3. ~~**ESC/POS printer + cash drawer driver**~~ — ✅ **Done** (Mar 2026) — `backend/services/printer.js`, USB+TCP, hardware-first print with browser fallback, Printer Settings at `/printer-settings`
4. **2FA / MFA** — security compliance requirement for B2B SaaS
5. **All-outlets aggregate reports** — multi-location operators will demand this *(in progress)*

---

## ✅ SaaS Prerequisites Already Done

### Timezone Fix (Mar 2026)
The app previously used `date(col,'localtime')` in 214+ query filters, tied to the server OS timezone. On a UTC Linux production server, customers in different timezones would see wrong date boundaries.

**Fixed:**
- `backend/utils/tz.js` — `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` converts a local `YYYY-MM-DD` to UTC range strings for direct `timestamp >= ?` / `timestamp < ?` queries. No external deps.
- `loadCompanyProfile` middleware in `backend/index.js` — caches `company_profile` (5-min TTL), sets `req.company.timezone` on every request.
- All report and non-report routes now use `req.company?.timezone || 'UTC'` for date filtering.
- `company_profile.timezone` is the per-tenant IANA timezone string — already in schema, defaults to `'UTC'`. **Set this correctly when provisioning each tenant in Phase 1.**
- Rule for new code: never use `date(col,'localtime')` in WHERE clauses. Use `toUtcStart`/`toUtcEnd` from `backend/utils/tz.js`.

### DB Dependency Injection (already done)
All 26 route files receive `db` via `deps` parameter — the AsyncLocalStorage proxy in Phase 3 works because of this pattern. Do not change this pattern.

### Shift Linkage (Mar 2026)
`shift_id` FK on `sales` and `returns` — direct FK lookup eliminates time-window race conditions. Shift reports fully migrated.

---

## Phase 1: Master Database & Tenant Management Layer — ✅ DONE (Mar 2026)
**No existing files modified — purely additive. 14 integration tests passing.**

### New Files
| File | Purpose |
|------|---------|
| `backend/master-db.js` | Master SQLite DB (`master.db`) — lazy-init tenant registry (`getMasterDb()`, `closeMasterDb()`, `initMasterDb()`) |
| `backend/tenant-db-manager.js` | Connection pool — `getDb(tenantId)` looks up master.db, opens + caches connection with WAL+FK pragmas; graceful SIGTERM/SIGINT shutdown |
| `backend/tenant-provisioner.js` | CLI provisioner — directory, schema, seed data, transactional master.db registration (tenant row + audit log in single BEGIN/COMMIT) |
| `backend/schema-full.js` | Extracts live `oneshop.db` schema via `sqlite_master` (read-only) — used to stamp out new tenant DBs |
| `backend/tests/integration/saas-phase1.test.js` | 14 integration tests — schema extraction, master DB init, provisioner workflow, db manager pool |

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
  timezone        TEXT NOT NULL DEFAULT 'UTC',   -- IANA timezone string — set at provisioning
  max_employees   INTEGER DEFAULT 3,
  max_outlets     INTEGER DEFAULT 1,
  max_products    INTEGER DEFAULT 500,
  stripe_customer_id TEXT,                       -- Stripe customer ID for billing (Phase 7)
  stripe_subscription_id TEXT,                   -- Active Stripe subscription ID (Phase 7)
  trial_ends_at   TEXT,                          -- Optional trial period end (Phase 7)
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

CREATE TABLE schema_migrations (
  version         INTEGER NOT NULL PRIMARY KEY,  -- Tracks migration version applied to ALL tenant DBs
  applied_at      TEXT DEFAULT (datetime('now'))
);
```

> **Note:** `schema_version` renamed to `schema_migrations` (clearer semantics, supports multiple version rows as migrations accumulate).

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
- **Add:** `healthCheck(tenantId)` — verify DB file is readable + WAL not corrupted (run on startup)

### Provisioner Seed Data (implemented)
CLI: `node backend/tenant-provisioner.js --slug <slug> --name <name> --timezone <tz> --pin <pin>`
- 1 default outlet (name from `--name`)
- 1 admin employee (PIN from `--pin`, column: `pin_code`)
- 1 admin role with all 10 permissions (`all_access`, `manage_customers`, etc.)
- Employee-outlet link
- `company_profile` row (column: `company_name`) + timezone from `--timezone`
- Default tax (0%)
- `schema_migrations` version = 65 (matches live schema)
- Transactional master.db registration: tenant row + audit log in single BEGIN/COMMIT

---

## Phase 2: Authentication Overhaul
**Replaces insecure `x-employee-id` header with JWT tokens**

### Tenant Identification Strategy: Login-Based
- Login page gets a **"Store Code"** field (the tenant slug, e.g., `aces-hardware`)
- Backend looks up tenant by slug -> opens tenant's DB -> authenticates employee
- JWT token embeds `{ tid, eid, rid, oid }` (tenant_id, employee_id, role_id, outlet_id)
- No subdomains needed (avoids wildcard SSL, DNS complexity) — can add later as a cosmetic feature
- Support pre-filling from URL: `https://yourpos.com/login?store=aces-hardware`

> **Added `oid` (outlet_id) to JWT** — needed because AuthProvider already injects `x-outlet-id`. Including it in the token removes the need for separate context selection state on fresh page loads.

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
  "oid": 3,           // outlet_id (active branch context)
  "iat": 1709337600,
  "exp": 1709424000   // 24h expiry
}
```

### Token Refresh Strategy
- Issue a **refresh token** (7-day expiry, stored in `httpOnly` cookie) alongside the 24h access token
- `POST /api/auth/refresh` — validates refresh token, issues new access token
- Prevents users from being logged out mid-shift when access token expires
- Refresh tokens stored in `tenant_refresh_tokens` table in master.db (revocable)

### New Env Vars
- `JWT_SECRET` — strong random string (min 64 chars) for signing tokens
- `JWT_REFRESH_SECRET` — separate secret for refresh tokens
- `MULTI_TENANT` — `0` (default, single-tenant) or `1` (multi-tenant SaaS mode)

### Suspended Tenant Handling
- On every JWT verification, check `tenants.status` in master DB
- If `suspended`, return `403` with message: `"Account suspended. Contact support."`
- Frontend catches 403 + shows suspension notice, not generic error

---

## Phase 3: Backend Multi-Tenancy Middleware (Core Change)
**The magic layer that makes all 26 route files work without modification**

### Key Technique: AsyncLocalStorage + DB Proxy

Since routes capture `db` from `deps` at registration time (via closure), we can't swap `db` per-request directly. Solution:

1. **Create `backend/tenant-db-proxy.js`** — a `Proxy` object that looks like a sqlite3.Database but delegates every call (`db.all()`, `db.get()`, `db.run()`, `db.serialize()`, `db.parallelize()`) to the current request's tenant DB using Node.js `AsyncLocalStorage`
2. **In `backend/index.js`** — when `MULTI_TENANT=1`, pass the proxy as `deps.db` instead of the singleton. Add middleware that wraps each request in an `asyncStore.run()` context with the tenant's real DB.

**Result:** All 26 route files call `db.all(...)` as usual, but it transparently hits the correct tenant's database. Zero changes to route files for DB access.

### How AsyncLocalStorage Works Here
```
Request comes in with JWT containing tenant_id=7
  -> Middleware extracts tenant_id from JWT
  -> Middleware checks tenant status in master.db (active/suspended/deleted)
  -> Middleware gets tenant's db via TenantDbManager.getDb(7)
  -> Middleware wraps the rest of the request in asyncStore.run({ db: tenantDb })
  -> Route handler calls db.all("SELECT * FROM products ...")
  -> Proxy intercepts, reads tenantDb from AsyncLocalStorage
  -> Query runs against tenant 7's database
```

### Proxy Must Cover All sqlite3 Methods
The proxy must intercept: `all`, `get`, `run`, `each`, `exec`, `prepare`, `serialize`, `parallelize`, `close`. Missing any will cause silent failures on routes that use less common methods (e.g., `db.prepare()` in sales.js for stmt.finalize).

### Files That Need Minor Modifications (File Uploads Only)
These files use hardcoded upload paths captured at registration time — need to read tenant path from `req` context instead:

| File | Change |
|------|--------|
| `backend/routes/products.js` | Multer destination reads from `req.tenantDir` |
| `backend/routes/barcode-expenses.js` | Backup/restore uses `req.tenantDir` for DB_PATH |
| `backend/routes/tier4/company-profile.js` | Company logo upload uses `req.tenantDir` |
| `backend/routes/reports/` (export routes) | Export directory becomes `req.tenantDir/exports/` |

> **Note:** The plan listed `tier4.js` and `reports.js` as monoliths — these are now modular directories. The actual files to change are `tier4/company-profile.js` and whichever report file handles CSV/PDF export.

### Static File Serving
Replace `app.use("/uploads", express.static(UPLOADS_DIR))` with tenant-scoped middleware:
```javascript
app.use("/uploads/:tenantSlug", (req, res, next) => {
  const slug = req.params.tenantSlug;
  express.static(path.join(TENANTS_DIR, `t_${slug}`, 'uploads'))(req, res, next);
});
```
Frontend must update all upload URL references to include tenant slug prefix.

### Background Workers (Shopify sync, report schedules)
These run in `setInterval` outside request context. In multi-tenant mode:
- Fetch all active tenants from master.db at each tick
- For each tenant, wrap execution in `asyncStore.run({ db: tenantDb })`
- Add per-tenant error isolation — one tenant's Shopify failure must not stop other tenants' sync
- Log per-tenant worker errors to `tenant_audit_log`

### Plan Limit Enforcement (add here, not Phase 7)
Add `requirePlanLimit(resource)` middleware in `backend/middleware/plan-limits.js`:
- Called on `POST /api/employees`, `POST /api/outlets`, `POST /api/products`
- Reads `req.tenant.max_employees` etc. from JWT/master.db
- Returns `403 { error: "Plan limit reached", limit: 3, current: 3, upgrade_url: "..." }`
- Enforce limits here rather than waiting for Phase 7 — billing can come later but limits protect infrastructure

### New Files
| File | Purpose |
|------|---------|
| `backend/tenant-db-proxy.js` | AsyncLocalStorage-based DB proxy |
| `backend/tenant-multer.js` | Tenant-aware multer storage factory |
| `backend/middleware/plan-limits.js` | Plan limit enforcement (moved from Phase 7) |

---

## Phase 4: Frontend Changes

| File | Change |
|------|--------|
| `frontend/src/config.js` | `API_BASE = import.meta.env.VITE_API_BASE \|\| 'http://localhost:5000'` |
| `frontend/src/pages/Login.jsx` | "Store Code" field + prefill from `?store=` query param |
| `frontend/src/auth/AuthProvider.jsx` | JWT Bearer token in all requests, tenant_slug in session, silent token refresh |
| `frontend/.env.development` | `VITE_API_BASE=http://localhost:5000` |
| `frontend/.env.production` | `VITE_API_BASE=https://your-api.railway.app`, `VITE_MULTI_TENANT=1` |

### Frontend Session Structure (Updated)
```javascript
{
  token: "eyJhbG...",           // JWT access token (24h)
  refreshToken: "...",          // Stored in httpOnly cookie (7d) — not in JS state
  tenant_slug: "aces-hardware", // Store code
  employee: { id, name, role_id, outlet_id },
  permissions: [...],
  loadedAt: Date.now()
}
```

### Silent Token Refresh
- AuthProvider intercepts `401 Unauthorized` responses
- Calls `POST /api/auth/refresh` with the httpOnly cookie
- On success, retries the original request with new access token
- On failure (refresh expired), redirects to login
- This prevents mid-shift logouts when the 24h access token expires

### Suspension Handling
- On `403` from any API call, check response body for `"Account suspended"` message
- Show full-screen suspension notice with support contact info
- Do not show generic error toast

### Upload URL Migration
- All `img src` and upload preview URLs must be updated from `/uploads/filename` to `/uploads/{tenant_slug}/filename`
- Audit: search for `${API}/uploads` across all frontend files

### Optional: Tenant Branding
Add a `GET /api/tenant/branding?slug=aces-hardware` public endpoint (no auth required) that returns business name, logo URL, and primary color. The login page shows the tenant's branding after typing the store code.

---

## Phase 5: Super-Admin Dashboard

### New Backend: `backend/routes/admin.js`
```
POST   /api/admin/auth/login             — super-admin login (email + password, bcrypt)
POST   /api/admin/auth/logout            — invalidate super-admin session
GET    /api/admin/tenants                — list all tenants with status/plan/usage
POST   /api/admin/tenants                — provision new tenant (calls provisioner)
GET    /api/admin/tenants/:id            — tenant details + usage stats
PUT    /api/admin/tenants/:id            — update tenant (name, plan, limits, timezone)
POST   /api/admin/tenants/:id/suspend    — suspend a tenant
POST   /api/admin/tenants/:id/activate   — reactivate a tenant
DELETE /api/admin/tenants/:id            — soft-delete a tenant
POST   /api/admin/tenants/:id/migrate    — run pending migrations on one tenant
POST   /api/admin/migrate-all            — run pending migrations on ALL tenants
GET    /api/admin/tenants/:id/stats      — per-tenant usage: sales count, product count, employees
GET    /api/admin/stats                  — aggregate stats across all tenants
POST   /api/admin/tenants/:id/reset-pin  — reset a tenant's admin employee PIN to 0000
```

### New Frontend Pages: `frontend/src/pages/admin/`
- `AdminLogin.jsx` — email + password login (separate from tenant PIN login)
- `AdminDashboard.jsx` — overview stats across all tenants (total tenants, active, MRR estimate)
- `AdminTenantList.jsx` — create, view, suspend tenants with search/filter
- `AdminTenantDetail.jsx` — single tenant management (usage, plan change, migration, PIN reset)
- `AdminLayout.jsx` — separate layout (no POS sidebar)

### Migration Runner: `backend/tenant-migrate.js`
For applying future migrations (migrate64+) to existing tenant DBs.
- New migrations written as JS files in `backend/migrations/` that export `up(db)` async function
- Runner: `node backend/tenant-migrate.js --all` or `--tenant=aces-hardware`
- Tracks applied version in `schema_migrations` table of each tenant DB
- Idempotent — won't re-apply already-applied migrations
- Admin API endpoint calls this runner

**Can be built in parallel with Phase 3/4.**

---

## Phase 5b: Product Feature Gaps (run in parallel with Phase 5)
**These close the 81→90 gap before broad market launch**

These are product improvements, independent of the SaaS infrastructure work:

### 5b-1: Payment Gateway (Stripe/Razorpay) — HIGH PRIORITY
- Add `payment_gateway` field to `sale_payments` table
- New `backend/routes/payments.js` — create payment intent, capture, refund
- Frontend POS checkout: show card payment option, poll for status
- Razorpay recommended for South Asian markets; Stripe for international
- **This is the single biggest deal-breaker for paying customers**

### 5b-2: Email Receipts — MEDIUM PRIORITY *(in progress)*
- Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` env vars
- New `backend/utils/mailer.js` — nodemailer wrapper
- On `POST /api/sales` success: if `customer.email` exists + receipt_email opt-in, send HTML receipt
- Use existing receipt template data to generate HTML email body
- **Low effort, high customer satisfaction impact**

### 5b-3: ESC/POS Printer + Cash Drawer — ✅ DONE (Mar 2026)
- `backend/services/printer.js` — `PrinterService` class, USB + TCP connections, paper-width-aware formatting, cash drawer trigger
- `backend/routes/printer.js` — `POST /api/print/receipt`, `GET /api/print/status`, `GET|PUT /api/print/config`
- `printer_config` table added in `migrate64.js`
- `printToHardware(slip, template)` in `frontend/src/utils/receipt.js` — sends to `/api/print/receipt`
- `POSContext.printSlip` tries hardware first, falls back to browser popup if `result.fallback`
- Printer Settings UI at `/printer-settings` (all_access only) — connection type, paper size, cash drawer, test print
- **No QZ Tray needed — direct USB/TCP from the Express backend**

### 5b-4: All-Outlets Aggregate Reports — MEDIUM PRIORITY *(in progress)*
- Modify report endpoints to accept `outlet_id=all` in addition to specific IDs
- When `outlet_id=all`, remove outlet filter from SQL and aggregate across all outlets
- Frontend: add "All Outlets" option to outlet selector in Reports header
- **Multi-location business owners will ask for this in week 1**

### 5b-5: 2FA / MFA — MEDIUM PRIORITY
- TOTP-based (Google Authenticator) for admin employees
- `POST /api/auth/2fa/setup` — returns QR code
- `POST /api/auth/2fa/verify` — validates TOTP code during login
- Store `totp_secret` encrypted in `employees` table
- Make optional per-role (require for admin/manager roles)
- **Required for enterprise/B2B customers and GDPR compliance**

### 5b-6: Audit Log Export — LOW PRIORITY
- `GET /api/audit-log/export?from=&to=&format=csv` — exports `action_history` table
- Required for regulated industries (food, finance) and enterprise security reviews

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
| `backend/.dockerignore` | Exclude node_modules, local .db files, tenants/ dir |
| `backend/railway.toml` or `fly.toml` | Platform config (single replica — SQLite requires it) |
| `frontend/vercel.json` | SPA rewrite rules |
| `backend/.env.example` | Full documented env var reference |

### Critical Constraint
SQLite requires **single-instance deployment** (1 replica). This is fine for 1-20 tenants. Scaling beyond ~50 concurrent tenants would need a PostgreSQL migration (future, not now).

### Backup Strategy (add before launch)
- Daily automated backup of all tenant DB files to object storage (Railway volume snapshots, or S3/Cloudflare R2)
- `backend/scripts/backup-all-tenants.js` — tar + gzip all tenant dirs, upload to R2
- Retention: 30 days
- **Without backups, a disk failure loses all customer data — this is non-negotiable**

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
JWT_REFRESH_SECRET=replace_with_different_64_char_random_string
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Shopify (per-tenant, stored in tenant DB)
SHOPIFY_SECRET_KEY=replace_with_a_strong_secret_key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_GLOBAL_MAX=600

# Email (Phase 5b-2)
# SMTP_HOST=smtp.sendgrid.net
# SMTP_PORT=587
# SMTP_USER=apikey
# SMTP_PASS=SG.xxx

# Backup (Phase 6)
# R2_ACCOUNT_ID=...
# R2_ACCESS_KEY_ID=...
# R2_SECRET_ACCESS_KEY=...
# R2_BUCKET=oneshoppos-backups

# Billing (Phase 7)
# STRIPE_SECRET_KEY=sk_...
# STRIPE_WEBHOOK_SECRET=whsec_...
```

### HTTPS Enforcement
- Railway/Fly.io provide HTTPS automatically via their proxy layer
- Add `app.set('trust proxy', 1)` in `backend/index.js` (required for correct IP detection behind Railway proxy)
- Redirect HTTP → HTTPS at the platform level (not in Express — let the proxy handle it)

---

## Phase 7: Billing (Stripe)

### New Files
| File | Purpose |
|------|---------|
| `backend/routes/billing.js` | Stripe checkout sessions, webhooks, customer portal |
| `frontend/src/pages/admin/AdminBilling.jsx` | Billing management UI |

> **Note:** `plan-limits.js` moved to Phase 3 — limits should be enforced from day one, even before Stripe billing is wired up.

### Plan Tiers
| Plan | Price | Employees | Products | Outlets |
|------|-------|-----------|----------|---------|
| Free | $0/mo | 3 | 500 | 1 |
| Starter | $29/mo | 10 | 5,000 | 2 |
| Pro | $79/mo | 50 | Unlimited | 10 |

### Stripe Flow
1. Customer selects plan on admin dashboard or self-service page
2. Backend creates Stripe Checkout Session with `tenant_id` in metadata
3. Customer pays on Stripe-hosted page
4. Stripe sends `checkout.session.completed` webhook → verified with `STRIPE_WEBHOOK_SECRET`
5. Backend updates `tenants.plan`, `tenants.stripe_customer_id`, `tenants.stripe_subscription_id` in master.db
6. Limits already enforced by `plan-limits.js` middleware (from Phase 3)

### Trial Period
- New tenants get 14-day free trial of Pro plan
- `trial_ends_at` column in master.db tracks expiry
- After trial: downgrade to Free limits unless payment on file
- Show trial banner in POS UI with days remaining

**Can be deferred until you have early adopters.**

---

## Implementation Order & Dependencies

```
Phase 1 (Master DB + Tenant Manager)         <-- START HERE, purely additive
    |
Phase 2 (JWT Auth)                            <-- depends on Phase 1
    |
Phase 3 (DB Proxy + Middleware)               <-- depends on Phase 2
  + Phase 5 (Admin Dashboard)                 <-- can run in parallel with Phase 3
  + Phase 5b (Product Feature Gaps)           <-- can run in parallel, independent of SaaS infra
    |
Phase 4 (Frontend Changes)                   <-- depends on Phase 2+3
    |
Phase 6 (Deployment + Backups)               <-- depends on Phases 1-4
    |
Phase 7 (Billing)                            <-- whenever you're ready
```

**Phases 2+3+4 must deploy together** (auth change is atomic).
**Phase 1, Phase 5, and Phase 5b are safe to build independently.**
**Phase 5b (product gaps) can be done before or after SaaS infra — they are independent.**

---

## Verification Plan

### After Phase 1 — ✅ VERIFIED
- `npx jest tests/integration/saas-phase1.test.js` — 14/14 passing
- Provisioner creates tenant directory with all subdirs, DB with 80+ tables, all seed data
- `schema_migrations` version = 65, master.db tenant row + audit log verified
- Duplicate slug rejection tested, db-manager pool + healthCheck tested
- Design: `docs/plans/2026-03-06-saas-phase1-design.md`

### After Phases 2-4
- Start backend with `MULTI_TENANT=1`
- Open frontend, enter store code `test-store`, login with default admin PIN `0000`
- Verify all POS features work (sales, inventory, reports)
- Create a second tenant `test-store-2`, log in separately, verify complete data isolation
- Verify token refresh works: wait 24h or manually expire the token and confirm silent refresh
- Verify suspended tenant gets 403 on all API calls

### After Phase 5b
- Complete a sale and verify email receipt arrives at customer email
- Complete a sale and verify receipt prints on thermal printer
- Complete a card payment via Stripe/Razorpay
- Run an all-outlets aggregate sales report

### After Phase 6
- Deploy backend to Railway/Fly.io
- Deploy frontend to Vercel
- Set `VITE_API_BASE` to the Railway/Fly.io URL
- Provision a tenant via admin API, login from the public URL
- Verify HTTPS is enforced (HTTP redirects to HTTPS)
- Verify daily backup runs and uploads to R2

### After Phase 7
- Create a Stripe test-mode checkout for a tenant
- Complete payment, verify plan + Stripe IDs update in master.db
- Try exceeding limits (e.g., add employees beyond max), verify 403 enforcement
- Test trial expiry flow: set `trial_ends_at` to past, verify Free limits kick in

---

## Summary of All New Files

| Phase | File | Purpose |
|-------|------|---------|
| 1 | `backend/master-db.js` | Master tenant registry database |
| 1 | `backend/tenant-db-manager.js` | Connection pool for tenant DBs |
| 1 | `backend/tenant-provisioner.js` | New tenant creation with seed data |
| 1 | `backend/schema-full.js` | Full schema for fresh tenant DBs |
| 3 | `backend/tenant-db-proxy.js` | AsyncLocalStorage DB proxy |
| 3 | `backend/tenant-multer.js` | Tenant-aware file uploads |
| 3 | `backend/middleware/plan-limits.js` | Plan limit enforcement |
| 5 | `backend/routes/admin.js` | Super-admin API |
| 5 | `backend/tenant-migrate.js` | Multi-tenant migration runner |
| 5 | `frontend/src/pages/admin/*.jsx` | Admin dashboard (5 pages) |
| 5b | `backend/routes/payments.js` | Payment gateway integration |
| 5b | `backend/utils/mailer.js` | Email receipt delivery |
| 5b | ~~`backend/utils/escpos.js`~~ | ✅ Done — replaced by `backend/services/printer.js` (PrinterService, USB+TCP) |
| 5b | `backend/scripts/backup-all-tenants.js` | Automated backup to R2 |
| 6 | `backend/Dockerfile` | Container for deployment |
| 6 | `backend/railway.toml` or `fly.toml` | Platform config |
| 6 | `frontend/vercel.json` | Vercel SPA config |
| 6 | `backend/.env.example` | Full env var reference |
| 7 | `backend/routes/billing.js` | Stripe billing integration |
| 7 | `frontend/src/pages/admin/AdminBilling.jsx` | Billing management UI |

## Summary of Modified Existing Files

| Phase | File | Change |
|-------|------|--------|
| 2 | `backend/routes/auth.js` | JWT + tenant_slug login + refresh token endpoint |
| 2 | `backend/index.js` | JWT middleware, AsyncLocalStorage, conditional deps, trust proxy |
| 2 | `backend/package.json` | Add: jsonwebtoken, bcryptjs, nodemailer, escpos |
| 3 | `backend/routes/products.js` | Tenant-aware upload paths via `req.tenantDir` |
| 3 | `backend/routes/barcode-expenses.js` | Tenant-aware backup/restore via `req.tenantDir` |
| 3 | `backend/routes/tier4/company-profile.js` | Tenant-aware logo uploads via `req.tenantDir` |
| 3 | `backend/routes/reports/` (export routes) | Tenant-aware export dir via `req.tenantDir` |
| 4 | `frontend/src/config.js` | Env-based API URL |
| 4 | `frontend/src/auth/AuthProvider.jsx` | JWT + silent refresh + suspension handling |
| 4 | `frontend/src/pages/Login.jsx` | Store Code field + optional branding fetch |
| 5 | `frontend/src/App.jsx` | Admin routes |
| 5b | `backend/routes/sales.js` | Trigger email receipt on completion (ESC/POS print is client-side via POSContext.printSlip — not in sales.js) |
| 5b | `backend/routes/reports/` | Accept `outlet_id=all` for aggregate reporting |
| 5b | `frontend/src/pages/redesign/POSRedesign.jsx` | Card payment UI in checkout |
