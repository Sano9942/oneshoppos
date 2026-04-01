# SanoPOS Backend Architecture Audit (Codex)

**Date:** 2026-04-02
**Audited scope:** `backend/` only
**Primary runtime assumption:** PostgreSQL is the current intended backend. SQLite is treated here as historical/legacy baggage, not the target production architecture.
**Method:** Manual code audit of the backend source. I did **not** rely on the project's test suite for conclusions.

---

## Executive Summary

The backend has a strong core architecture for a growing SaaS product:

- Postgres schema-per-tenant isolation is a serious, defensible architecture choice.
- JWT auth, refresh-token storage, token revocation, impersonation, audit logging, plan enforcement, and request correlation are all real and meaningful.
- The codebase has broad product coverage: sales, inventory, HR, accounting, reporting, billing, support, FBR, Shopify, WooCommerce, couriers, and super-admin operations.

The main weaknesses are **operational consistency and execution hygiene**, not lack of product capability.

The most important backend risks I found are:

1. The advertised "full backup" endpoint appears to back up only the `public` schema, not tenant schemas.
2. `/api/health` is registered twice, and the second implementation is both unreachable and conceptually wrong for the Postgres multi-tenant model.
3. The web process owns too many schedulers/workers, including duplicated cleanup scheduling.
4. There is an admin-only dynamic SQL injection risk via `tenant_slug` interpolation.
5. Input validation is scattered and ad hoc, with no shared validation layer.
6. Legacy SQLite-era files are still tracked heavily enough to obscure the current architecture.
7. Tenant provisioning and migration paths have drifted apart in a way that may break new tenant creation.

**Overall verdict:** The backend is capable and structurally above-average for a startup SaaS, but it now needs a focused backend hardening sprint. I would keep this architecture and improve it, not replace it.

---

## Audit Basis

### What I reviewed

- Runtime boot flow: `backend/index.js`, `backend/routes/registerAllRoutes.js`
- Multi-tenant internals: `backend/tenant-db-manager-pg.js`, `backend/tenant-db-proxy-pg.js`, `backend/master-db-pg.js`, `backend/tenant-provisioner-pg.js`
- Security/auth: `backend/routes/auth.js`, `backend/jwt-auth.js`, `backend/middleware/request-id.js`, `backend/middleware/plan-limits.js`
- Core transactional paths: `backend/routes/sales.js`, `backend/routes/products.js`
- Background processing: `backend/workers/email-worker.js`, `backend/workers/fbr-worker.js`, `backend/jobs/cleanup-dead-tenants.js`
- Admin surface: `backend/routes/admin.js`
- Integration and ops support: `backend/routes/webhooks.js`, `backend/services/payment-gateway.js`, `backend/utils/backup-pg.js`, `backend/services/alerting.js`, `backend/routes/support.js`
- Schema and migration shape: `backend/schema-pg.sql`, `backend/migrate-pg.js`

### Backend metrics

- Route files under `backend/routes`: **69**
- Approximate route registrations (`app.get/post/put/delete/patch`): **434**
- Backend JS source files: **257**
- Backend TypeScript source files: **0**
- Backend test files present: **53**  
  Note: present, but not relied upon for this audit.

### Largest backend files

- `backend/routes/admin.js`: **2209 lines**
- `backend/routes/reports/inventory.js`: **1575 lines**
- `backend/routes/reports/sales.js`: **1478 lines**
- `backend/schema-pg.sql`: **1401 lines**
- `backend/index.js`: **1328 lines**
- `backend/routes/reports/finance.js`: **1153 lines**
- `backend/routes/products.js`: **965 lines**
- `backend/routes/orders.js`: **913 lines**

---

## Verified Strengths

### 1. Postgres schema-per-tenant architecture is real and well-centered

This is the biggest architectural strength in the backend.

- `backend/index.js:14` conditionally selects `db-pg` in Postgres mode.
- `backend/tenant-db-manager-pg.js` provides schema-scoped DB handles.
- `backend/tenant-db-proxy-pg.js` uses `AsyncLocalStorage` so route closures can transparently hit the current tenant DB.
- `backend/master-db-pg.js` cleanly separates tenant registry/master concerns into `public`.

This is a solid basis for tenant isolation without requiring one database per tenant.

### 2. Auth and session handling are materially better than "basic CRUD app" quality

- Multi-tenant JWT login, refresh, and context update flows exist in `backend/routes/auth.js`.
- Refresh tokens are stored hashed in `tenant_refresh_tokens`.
- Access tokens carry `jti`, and revocation is enforced.
- `tokens_revoked_before` supports blanket employee session invalidation.
- Kiosk scope is explicitly restricted in `backend/index.js`.

This is thoughtful auth design, not placeholder auth.

### 3. Operational permissions and plan gating are real

- Role permissions are enforced in route middleware and global permission rules.
- `requirePlanLimit` and `requireActiveSubscription` exist and are wired into the request path.
- Sales also enforce real operational constraints like open shift and attendance state.

The backend is not merely authenticated; it is context-aware and policy-aware.

### 4. Sales flow shows real transactional thinking

`backend/routes/sales.js` does important things correctly:

- validates checkout basics
- checks shift and attendance
- uses idempotency keys
- locks stock rows before decrement
- writes sale, sale items, payments, wallet effects, and follow-up side effects coherently

This is one of the strongest transaction paths in the codebase.

### 5. Request tracing and logging are production-meaningful

- `backend/middleware/request-id.js` generates or forwards request IDs
- response header `X-Request-Id` is set
- log enrichment happens after auth/tenant resolution
- slow requests are surfaced

This materially improves supportability.

---

## Findings

## Critical

### 1. The "full backup" endpoint appears to omit tenant business data

**Evidence**

- `backend/routes/admin.js:2170` names the artifact `full-backup-...`
- `backend/routes/admin.js:2172` calls `backupSchema("public")`

In the current Postgres architecture, tenant business tables live in tenant schemas like `tenant_<slug>`, not only `public`.

**Impact**

- A successful admin backup may capture master/public metadata while excluding the bulk of tenant transactional data.
- This creates a false sense of recoverability.

**Assessment**

This is the most serious backend finding in the audit because it affects disaster recovery, not just cleanliness.

**Recommendation**

- Replace this with either:
  - whole-database backup, or
  - orchestrated backup across `public` plus every active tenant schema.
- Rename the endpoint immediately if behavior is not fixed.

### 2. `/api/health` is duplicated, and the hidden version is wrong for the multi-tenant model

**Evidence**

- `backend/routes/registerAllRoutes.js:52` registers `/api/health`
- `backend/routes/registerAllRoutes.js:385` registers `/api/health` again

The second implementation checks for tables such as `sales`, `sale_items`, and `feature_flags` in `table_schema = 'public'` at `backend/routes/registerAllRoutes.js:396`.

But in the current architecture, those are tenant-schema tables, not public master tables.

**Impact**

- The first route makes the second effectively unreachable.
- If the second were ever activated, it would produce misleading health results in multi-tenant Postgres mode.

**Recommendation**

- Keep exactly one health route.
- Split into explicit `liveness` and `readiness` semantics if needed.
- Readiness should validate the actual master-path and, if desired, sample tenant-path health intentionally.

---

## High

### 3. Worker/scheduler responsibility is too concentrated in the web process

**Evidence**

- `backend/index.js:1220-1229` schedules recurring maintenance tasks
- `backend/index.js:1243` schedules Shopify inventory sync work
- `backend/index.js:1270` schedules report schedule work
- `backend/index.js:1295` starts inline FBR worker
- `backend/index.js:1301` starts inline email worker
- `backend/index.js:1307` starts cleanup worker

There is also duplicated dead-tenant cleanup scheduling:

- unconditional multi-tenant scheduling at `backend/index.js:1226-1229`
- worker-flag-based scheduling at `backend/index.js:1307-1325`

**Impact**

- harder operational reasoning
- double-processing risk
- web-node crashes affect background work
- scaling the API tier can accidentally scale workers too unless carefully pinned

**Recommendation**

- Separate API and worker processes cleanly
- make exactly one owner for each scheduler
- stop scheduling cleanup in two places

### 4. Admin tax-rate suggestion approval has an interpolation-based SQL injection risk

**Evidence**

- `backend/routes/admin.js:1508` accepts `tenant_slug` from `req.body`
- `backend/routes/admin.js:1514` executes:
  `UPDATE tenant_${tenant_slug}.tax_rate_suggestions ...`

This value is interpolated into SQL identifier context without validation or quoting.

**Impact**

- The route is protected by super-admin auth and optional IP allowlisting, so exposure is limited.
- But this is still unsafe dynamic SQL in a high-privilege route.

**Recommendation**

- Do not trust `tenant_slug` from the request body for schema selection.
- Resolve tenant schema server-side from tenant ID or whitelist-validate against the master tenant registry before interpolation.

### 5. Tenant provisioning and migration logic have drifted apart

**Evidence**

- `backend/tenant-provisioner-pg.js:57-58` runs `schema-pg.sql` with `SET search_path = '<tenant_schema>'`
- `backend/schema-pg.sql` contains public/admin tables and a foreign key `tenant_notes.tenant_id REFERENCES tenants(id)` at `backend/schema-pg.sql:1357-1359`
- `backend/migrate-pg.js` migrates tenant schemas with `SET search_path TO <schema>, public` at `backend/migrate-pg.js:573,582`

**Assessment**

The migration path and the provisioning path no longer apply the schema under the same assumptions.

That means new-tenant provisioning may be more fragile than migrations against already-existing tenants.

**Impact**

- latent onboarding/provisioning failure risk
- schema file is trying to serve both tenant and public concerns

**Recommendation**

- Split schema concerns:
  - tenant schema DDL
  - public/master schema DDL
- Make provisioning and migration use the same schema contract

---

## Medium

### 6. Validation is broad but not centralized

**Evidence**

- No direct validation dependency is declared in `backend/package.json`
- backend contains roughly **203** `req.body` references
- validation is route-local and inconsistent

There is some good local validation in places, but there is no uniform request-contract layer.

**Impact**

- inconsistent error behavior
- harder API maintenance
- more reliance on route-by-route defensive coding

**Recommendation**

- Add a boundary validation layer for all write routes
- centralize request/response contracts for critical domains first:
  auth, sales, products, employees, billing, admin

### 7. URL generation is inconsistent and partly broken in multi-origin setups

**Evidence**

- `backend/routes/auth.js:487` uses `process.env.CORS_ORIGIN` directly as a full frontend URL
- `backend/routes/auth.js:654` does the same for signup emails
- `backend/routes/billing.js:144` correctly uses the first split origin
- `backend/routes/support.js:54` hardcodes `https://sanopos.com/admin`
- `backend/services/alerting.js:4` hardcodes the same admin URL

If `CORS_ORIGIN` contains multiple comma-separated origins, some generated links will be malformed.

**Recommendation**

- introduce one backend URL builder
- separate CORS allowlist configuration from frontend canonical URL configuration

### 8. Worker status telemetry overstates visibility

**Evidence**

- worker status objects include `queueDepth`
- search across backend shows `queueDepth` is initialized but never meaningfully updated

**Impact**

- the admin dashboard implies queue-depth visibility that is not actually present

**Recommendation**

- either compute real queue depth or remove the field from operational claims/UI

### 9. Slug validation is inconsistent between admin creation and provisioning

**Evidence**

- `backend/routes/admin.js:202-203` allows hyphens
- `backend/tenant-provisioner-pg.js:145-146` rejects hyphens and allows underscores

**Impact**

- admin tenant creation can accept input that provisioning rejects
- likely manifests as avoidable runtime errors during tenant creation

**Recommendation**

- choose one canonical slug format and enforce it everywhere

---

## Code Organization And Hygiene

### Current state

- The backend is feature-rich but concentrated in a few oversized files.
- The runtime path is now Postgres-first, but legacy SQLite files still occupy a lot of repo surface area.

### Verified legacy/tracked SQLite-era artifacts

Tracked legacy files include:

- `backend/db.js`
- `backend/master-db.js`
- `backend/tenant-db-manager.js`
- `backend/tenant-db-proxy.js`
- `backend/tenant-provisioner.js`
- `backend/schema.sql`
- `backend/run_migrations.js`
- `backend/migrate.js`
- `backend/seed-admin.js`
- `backend/reset-production.js`
- `backend/test_output.txt`
- **73** tracked numbered `migrate*.js` SQLite migration files

The SQLite `.db` files themselves are ignored correctly now, but the tracked legacy code still materially hides the current architecture.

### Assessment

This is not "fake code", because the repo still carries a SQLite fallback path. But it is now a large amount of **legacy implementation baggage** relative to the intended Postgres backend.

### Recommendation

- Move legacy SQLite code into a clearly named archival folder or remove it if support is officially over.
- Remove tracked debug artifacts like `backend/test_output.txt`.
- Rename or quarantine `backend/reset-production.js` so it cannot be mistaken for a current operational tool.

---

## Architecture Scorecard

| Category | Score | Notes |
|---|---:|---|
| Core architecture | 8/10 | Strong Postgres multi-tenant foundation |
| Auth and permissions | 8/10 | Good session model, revocation, impersonation, gating |
| Transaction integrity | 8/10 | Sales path is thoughtful and production-oriented |
| Operational reliability | 5/10 | Backup gap, duplicated health route, worker concentration |
| Security hygiene | 6/10 | Good basics, but unsafe dynamic SQL remains in admin surface |
| Code organization | 5/10 | Real modularity, but several oversized files remain |
| Validation/contracts | 4/10 | Inconsistent, route-local, no shared schema layer |
| Repo hygiene | 4/10 | Legacy SQLite footprint is still large and tracked |
| Observability | 7/10 | Request IDs/logging good; worker telemetry only partial |
| Scalability readiness | 6/10 | Strong data model, weaker background-job isolation |

**Overall backend score:** **6.6/10**

That score is dragged down by operational and hygiene concerns more than by architectural weakness. The underlying backend is stronger than the raw number suggests.

---

## Recommended Priority Order

### Tier 1: Immediate operational fixes

1. Fix admin backup so it includes tenant schemas.
2. Remove duplicate `/api/health` registration and redesign readiness semantics.
3. Stop double-scheduling dead-tenant cleanup.
4. Fix the admin `tenant_slug` interpolation risk.
5. Unify slug validation rules.

### Tier 2: Hardening

1. Introduce centralized request validation.
2. Centralize frontend/admin URL generation.
3. Make worker status metrics truthful.
4. Split `admin.js` and possibly `index.js`.

### Tier 3: Cleanup and maintainability

1. Officially deprecate or archive SQLite-era code if no longer supported.
2. Separate tenant schema DDL from public schema DDL.
3. Move background jobs out of the API process into dedicated workers.

---

## Final Verdict

This backend is **not a mess**. It has real engineering depth and a serious multi-tenant foundation.

But it has reached the point where **operational correctness now matters more than adding one more feature quickly**. The codebase can absolutely continue on this foundation, but the next smart move is a backend hardening/refactor cycle focused on:

- backups and recoverability
- worker separation
- validation and contract discipline
- cleanup of legacy SQLite-era baggage
- reducing hidden inconsistencies between provisioning, migrations, and admin operations

If those are addressed, this backend becomes much easier to trust at scale.
