# Multi-Tenant Go-Live Design

**Goal:** Flip `MULTI_TENANT=1` in production so the SaaS platform is live — new tenants can be provisioned and onboarded.

**Architecture:** Schema-based multi-tenancy on Postgres. `public` schema holds master tables (tenants, super_admins). Each tenant gets `tenant_<slug>` schema. AsyncLocalStorage proxy routes DB calls to correct schema per request.

**Approach:** Big Bang cutover — start fresh (no data migration from single-tenant). Instant rollback via `MULTI_TENANT=0` env var flip.

## Blocker Fixes (6 items)

### 1. master-db-pg not initialized at boot
**File:** `backend/index.js`
**Problem:** `masterDbPg.init(db)` is never called at startup when `IS_MULTI_TENANT && HAS_POSTGRES`. Any route that calls `getTenantBySlug()` or `query()` throws "Not initialized."
**Fix:** Add `await masterDbPg.init(db)` in the server startup block when MT+Postgres.

### 2. loadCompanyProfile queries wrong schema
**File:** `backend/index.js` (~line 451)
**Problem:** Uses raw `db` pool (always hits `public` schema) instead of tenant-scoped proxy. Returns wrong company profile in MT mode.
**Fix:** In MT mode, use `dbProxy` instead of `db` for the company profile query.

### 3. auth.js MT routes have no ALS context
**File:** `backend/routes/auth.js`
**Problem:** `mt-login`, `refresh`, `kiosk-login` run BEFORE `resolveTenant` middleware, so the DB proxy has no AsyncLocalStorage context and throws.
**Fix:** These routes manually resolve the tenant DB via `tenantDbManagerPg.getDb(slug)` with explicit `SET search_path` instead of relying on the proxy.

### 4. plan-limits.js imports SQLite modules
**File:** `backend/middleware/plan-limits.js`
**Problem:** `require("../master-db")` and `require("../tenant-db-proxy")` — SQLite modules that crash on import in Postgres environment.
**Fix:** Conditional import: use `master-db-pg` and `tenant-db-proxy-pg` when `DATABASE_URL` is set.

### 5. Currency endpoint has no tenant context
**File:** `backend/routes/tier4/company-profile.js`
**Problem:** `GET /api/company-profile/currency` is public (no auth, no ALS context). In MT mode, it doesn't know which tenant's currency to return.
**Fix:** Accept `?tenant=<slug>` query param. Resolve tenant DB manually and query currency from correct schema. Frontend `CurrencyProvider` passes tenant slug in MT mode.

### 6. Setup wizard depends on master-db-pg init
**File:** `backend/routes/setup.js`
**Problem:** `getSetupDb()` calls `masterDb.getTenantBySlug()` which requires init.
**Fix:** Resolved by Fix #1 (boot init). No additional code change needed.

## New Files

### seed-admin-pg.js
Postgres version of `seed-admin.js`. Uses `db-pg` pool, `$1/$2` params, `RETURNING id`.
CLI: `node backend/seed-admin-pg.js --email <email> --password <pass> --name <name>`

### cleanup-public-schema.js
One-time script to drop stale single-tenant business tables from `public` schema (products, sales, employees, etc.). Only master tables (tenants, super_admins, tenant_audit_log, schema_migrations, tenant_refresh_tokens) remain.

## Frontend Changes

- `frontend/.env.production`: `VITE_MULTI_TENANT=1`
- `frontend/src/contexts/CurrencyContext.jsx`: Pass `?tenant=<slug>` in MT mode

## Deployment Warnings

1. **CORS:** Verify `allowedOrigins` in `index.js` includes the Vercel production domain
2. **JWT secrets:** Confirm `JWT_SECRET` and `JWT_REFRESH_SECRET` are set on Railway
3. **Super-admin seeding:** Run `seed-admin-pg.js` on Railway after deploy, before flipping MT flag

## Rollback Plan

- Tag `v1.0-pre-multitenant` already pushed to remote
- Instant rollback: `MULTI_TENANT=0` on Railway + `VITE_MULTI_TENANT=0` on Vercel
- No data migration = no data to roll back

## Credentials (first super-admin)
- Email: sano9942@hotmail.com
- Name: Hassan
- Password: Danish11 (recommend changing post-setup)
