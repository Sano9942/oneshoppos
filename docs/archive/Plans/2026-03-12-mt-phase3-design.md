# MT Phase 3 — Hardening Design

**Date:** 2026-03-12
**Branch:** `feature/mt-phase3-hardening`
**Scope:** 3 items from MT readiness checklist (#13, #14, #15)

---

## Item #15: Feature Flag Cache Per-Tenant

**Problem:** Two global caches in `index.js` cause cross-tenant data leakage in MT mode:
1. `_contextEnforced` (boolean) — shared across all tenants
2. `getFeatureFlagsMap()` — no caching at all, hits DB every request

**Fix:**

1. Replace `_contextEnforced` global with `_contextFlagCache = new Map()` keyed by tenantId, with 30s TTL (matching existing `CONTEXT_FLAG_CACHE_MS`).
2. Add `_featureFlagCache = new Map()` with 60s TTL for `getFeatureFlagsMap()`.
3. Guard boot IIFE with `if (!IS_MULTI_TENANT)` (same pattern as Phase 1 fixes).
4. Invalidate cache on `PUT /api/feature-flags/:key` in `registerAllRoutes.js`.

**Files:**
- `backend/index.js` (~20 lines changed)
- `backend/routes/registerAllRoutes.js` (~3 lines changed)

---

## Item #13: Tenant Isolation Testing

**Problem:** No automated tests verify that tenant A cannot access tenant B's data through the API.

**Fix:** New test file `backend/tests/integration/pg-tenant-isolation.test.js` (~150-200 lines).

**Test categories:**
1. **Schema isolation via API** — provision 2 tenants, create products in tenant A, verify tenant B sees zero products
2. **JWT boundary enforcement** — tenant A's JWT rejected when accessing tenant B's routes
3. **Plan limits per-tenant** — tenant A on Starter plan (max_products=50) enforced independently of tenant B on Growth plan
4. **Concurrent request safety** — parallel requests from tenant A and tenant B via AsyncLocalStorage don't leak context

**Uses:** `createTestApp-pg.js` helper for test app setup.

---

## Item #14: Backup/Restore Per-Tenant

**Problem:** `barcode-expenses.js` backup/restore routes return stub "not yet implemented" for Postgres.

**Fix:** Use `pg_dump`/`pg_restore` for schema-based backup/restore.

**Backup:** `pg_dump --schema=tenant_<slug> --format=custom --no-owner` → stream to HTTP response as `.dump` file download.

**Restore:** Upload `.dump` file → `pg_restore --schema=tenant_<slug> --clean --no-owner` → replaces all data in that tenant's schema.

**Files:**
- New: `backend/utils/backup-pg.js` (~80 lines) — `backupTenantSchema(slug)` returns readable stream, `restoreTenantSchema(slug, filePath)` runs pg_restore
- Modify: `backend/routes/barcode-expenses.js` (~60 lines) — replace stub routes with actual pg_dump/pg_restore calls
- Max file size: 50MB
- Single-tenant mode: uses `public` schema

---

## Deferred

- **#10 Subdomain/slug routing** — Store Code login sufficient for internal POS. See ROADMAP.md "Future: Subdomain Routing" section.
