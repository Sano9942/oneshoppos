# SanoPOS Backend — File Audit

*Last audited: March 15 2026. Production is on Supabase Postgres, MULTI_TENANT=1.*

---

## Summary

Production runs on **PostgreSQL (Supabase)** with multi-tenant mode live. The backend has a dual-path design — `index.js` conditionally loads `db-pg` (Postgres) or `db` (SQLite) based on `DATABASE_URL`. The SQLite path is an insurance policy for rollback but is never executed in production.

The biggest cleanup opportunity is **74 SQLite migration files + 10 legacy SQLite infrastructure files** that are no longer executed in production.

---

## ACTIVE / NECESSARY (keep — used by running app)

### Core Entry Points
| File | Purpose |
|------|---------|
| `index.js` | Main Express server, boot guard, middleware chain, port 5000 |
| `start.sh` | Production startup: runs `migrate-pg.js` if `DATABASE_URL` set, else `run_migrations.js` |
| `package.json` | Dependencies: pg, express, nodemailer, bcryptjs, cookie-parser, etc. |
| `.env` | Local env vars (gitignored) |
| `.env.example` | Template for required env vars |
| `.env.shopify.example` | Shopify-specific env var template |
| `Dockerfile` | Multi-stage Node.js image |
| `railway.toml` | Railway config (Railway UI is source of truth) |
| `.gitignore` | Excludes .env, *.db, backups/, exports/, uploads/ |
| `.dockerignore` | Docker image build exclusions |

### Postgres Database Layer
| File | Purpose |
|------|---------|
| `db-pg.js` | pg.Pool wrapper — exports `query()`, `transaction()`, `getPool()` |
| `master-db-pg.js` | Postgres master DB (tenant registry) — `init()`, `getTenantBySlug()`, `query()` |
| `tenant-db-manager-pg.js` | Per-request tenant DB pool manager — `getDb(tenantId)`, `closeDb()`, `closeAll()` |
| `tenant-db-proxy-pg.js` | AsyncLocalStorage proxy for schema-switching tenant DB routing |
| `tenant-provisioner-pg.js` | CLI provisioner for new tenants (Postgres schema-based) |
| `schema-pg.sql` | Full Postgres DDL — all tables, indexes, constraints, seed company_profile row |
| `migrate-pg.js` | Version-tracked Postgres migration runner (reads `schema_version` table) |
| `seed-admin-pg.js` | CLI super-admin seeder for Postgres |

### Authentication & Middleware
| File | Purpose |
|------|---------|
| `jwt-auth.js` | JWT utilities — signAccessToken, signRefreshToken, verifyAccessToken, hashToken |
| `middleware/plan-limits.js` | Enforces tenant plan caps (max_employees, max_products, max_outlets) |

### Category, Upload, Config
| File | Purpose |
|------|---------|
| `category-tree.js` | Category tree helpers — descendants, leaf validation, enrichment |
| `tenant-multer.js` | Tenant-aware multer storage factories for file uploads |
| `vitest.config.js` | Vitest runner config for unit tests |

### Routes (all active, do not remove)
| Location | Contents |
|----------|---------|
| `routes/registerAllRoutes.js` | Orchestrator loading all 30+ route modules, wires tenant middleware |
| `routes/admin.js` | Super-admin API (13 endpoints: login, tenant CRUD, migrations, stats) |
| `routes/auth.js` | Auth routes (login, mt-login, refresh, kiosk-login, update-context) |
| `routes/*.js` (25+ files) | All domain routes: sales, returns, inventory, products, customers, etc. |
| `routes/reports/` (11 files) | Modular report endpoints (dashboard, sales, inventory, analytics, etc.) |
| `routes/shopify/` (9 files) | Shopify integration (config, health, sync, orders, webhooks, import, etc.) |
| `routes/tier4/` (7 files) | Tier4 routes (notifications, hr, crm, accounting, company-profile, etc.) |

### Services & Utilities
| File | Purpose |
|------|---------|
| `services/printer.js` | ESC/POS thermal printer service (USB, TCP, paper-width, cash drawer) |
| `utils/receiptEmail.js` | Server-side HTML receipt email builder for nodemailer |
| `utils/digestEmail.js` | End-of-day HTML email digest builder |
| `utils/backup-pg.js` | Postgres backup/restore via pg_dump/pg_restore |
| `utils/tz.js` | Timezone utilities (toUtcStart, toUtcEnd for SaaS date filters) |
| `utils/r2.js` | R2/S3-compatible file operations (optional Cloudflare integration) |

### Shopify Integration
| File | Purpose |
|------|---------|
| `shopify/client.js` | Shopify GraphQL API client (products, orders, inventory, locations) |
| `shopify/utils.js` | Webhook HMAC verification, retry logic, Postgres-only helpers |
| `shopify/order-service.js` | Order upsert + stock application policies (async/await Postgres) |

### Setup & Seeding
| File | Purpose |
|------|---------|
| `routes/setup.js` | Setup wizard API (/api/setup/status + /api/setup/complete), token-gated |
| `seed-60days.js` | Generates 60-90 days of realistic data — useful for demos/dev; not core |

### Test Infrastructure (keep for CI)
| Location | Contents |
|----------|---------|
| `tests/integration/*.test.js` | 55+ test files (395 SQLite tests, 340 Postgres tests) |
| `tests/helpers/createTestApp-pg.js` | Postgres test app factory (isolated schema per test) |
| `tests/helpers/createTestApp.js` | SQLite test app factory |
| `tests/helpers/seedData.js` | Seed data generator |
| `tests/helpers/seedSchema.js` | SQLite schema definition for tests |
| `tests/helpers/seedSchema-pg.js` | Postgres schema seeder (runs schema-pg.sql into test schema) |
| `tests/helpers/request.js` | HTTP request helper for tests |

---

## LEGACY / STALE (SQLite era — safe to delete if rolling back to SQLite is no longer needed)

> **Note:** These files are NOT executed in production. Production uses the Postgres equivalents above. They exist as a rollback safety net from the SQLite → Postgres migration (Mar 12 2026). If you are confident you will never roll back, these can all be deleted.

### 74 SQLite Migration Files
`migrate1.js` through `migrate74.js` — all 74 files define SQLite schema DDL via `db.run()`. Production runs `migrate-pg.js` instead. These are only executed by `run_migrations.js` when `DATABASE_URL` is not set.

**Safe to delete as a batch** — they are not imported by any Postgres-path code.

### SQLite Infrastructure Files
| File | Postgres Replacement | Notes |
|------|---------------------|-------|
| `db.js` | `db-pg.js` | SQLite wrapper — only loaded if DATABASE_URL not set |
| `run_migrations.js` | `migrate-pg.js` | Legacy SQLite sequential migration runner |
| `migrate.js` | N/A | Very old pre-system migration, never used |
| `master-db.js` | `master-db-pg.js` | SQLite master tenant registry |
| `tenant-db-manager.js` | `tenant-db-manager-pg.js` | SQLite per-file pool manager |
| `tenant-db-proxy.js` | `tenant-db-proxy-pg.js` | SQLite AsyncLocalStorage proxy |
| `tenant-provisioner.js` | `tenant-provisioner-pg.js` | SQLite CLI provisioner |
| `tenant-migrate.js` | `migrate-pg.js` | SQLite MT migration runner (reads migrations/ folder) |
| `schema-full.js` | `schema-pg.sql` | Extracts SQLite schema via sqlite_master |
| `seed-admin.js` | `seed-admin-pg.js` | SQLite super-admin seeder |

### One-Off Scripts (already run)
| File | Notes |
|------|-------|
| `cleanup-public-schema.js` | Dropped 89 stale single-tenant tables from public schema — **already run Mar 13 2026** |
| `seed_e2e.js` | One-off test data helper, not imported by production code |

---

## STALE DATA & DIRECTORIES

| Item | Status | Action |
|------|--------|--------|
| `backups/` | Pre-Postgres SQLite backups from before Mar 12 2026 | Safe to delete — Postgres is source of truth |
| `archive/legacy/` | Old SQLite schema dumps | Safe to delete |
| `tenants/` | Empty SQLite tenant directory (unused in Postgres MT mode) | Safe to delete |
| `exports/` | Empty directory (gitignored, auto-recreated on export) | Can delete; will be recreated |
| `uploads_test/` | Empty test uploads directory | Can delete |
| `uploads_tmp/` | Empty temporary upload staging directory | Can delete |
| `_endpoint_list.txt` | Manually maintained endpoint list, frequently out of date | Redundant with actual route files |
| `sanopos.db` | Local SQLite DB (dev artifact, not committed) | Safe to delete locally |
| `sanopos.db-shm` | SQLite shared memory (dev artifact) | Safe to delete locally |
| `sanopos.db-wal` | SQLite write-ahead log (dev artifact) | Safe to delete locally |
| `master.db` | Local SQLite master tenant registry (dev artifact) | Safe to delete locally |

---

## CLEANUP PLAN (when ready)

### Phase 1 — Zero Risk (delete now)
- `cleanup-public-schema.js` — already run
- `seed_e2e.js` — one-off dev helper
- `archive/legacy/` — old schema dumps
- `backups/` — pre-Postgres SQLite backups
- `tenants/` — empty SQLite tenant dir
- `exports/`, `uploads_test/`, `uploads_tmp/` — empty dirs
- `_endpoint_list.txt` — redundant doc

### Phase 2 — SQLite Rollback Insurance (delete when committed to Postgres-only)
- All 74 `migrate*.js` files (`migrate1.js` through `migrate74.js`)
- `migrate.js` (pre-system)
- `run_migrations.js`
- `db.js`
- `master-db.js`
- `tenant-db-manager.js`
- `tenant-db-proxy.js`
- `tenant-provisioner.js`
- `tenant-migrate.js`
- `schema-full.js`
- `seed-admin.js`

**Total Phase 2 deletions: ~85 files**

### Phase 3 — Local Dev Artifacts (delete if present on disk)
- `sanopos.db`, `sanopos.db-shm`, `sanopos.db-wal`
- `master.db`

---

---

## SECURITY & HARDENING FINDINGS (Mar 15 2026)

Full backend code review performed. **Zero critical vulnerabilities found.** All routes use parameterized queries, all protected routes have proper auth middleware, no sensitive data leaks. The items below are hardening improvements.

### HIGH Priority

| # | Issue | File | Impact | Fix |
|---|-------|------|--------|-----|
| 1 | **No graceful shutdown handler** | `index.js` | In-flight requests killed on Railway deploy (SIGTERM) | Add `process.on('SIGTERM')` to close HTTP server + DB pool |
| 2 | **Missing DB indexes on FK columns** | `schema-pg.sql` | Slow reports/joins on `sales.customer_id`, `sales.shift_id`, `sales.outlet_id`, `sale_items.sale_id` | Add 4 `CREATE INDEX` statements |
| 3 | **No rate limit on `/api/auth/refresh`** | `routes/auth.js` | Refresh + update-context endpoints can be brute-forced | Add rate limiter middleware to both routes |
| 4 | **JWT secrets not validated at boot** | `index.js` | Missing secrets cause runtime 500s instead of fast-fail | If `MULTI_TENANT=1` and secrets missing → `process.exit(1)` |

### MEDIUM Priority

| # | Issue | File | Impact | Fix |
|---|-------|------|--------|-----|
| 5 | **Dynamic schema names in admin stats** | `routes/admin.js` | `tenant_${slug}` interpolated into SQL (safe by slug validation but fragile) | Use `SET search_path` or quote identifiers |
| 6 | **Silent error swallowing** in cache refresh | `index.js` ~line 515 | Company profile cache errors silently discarded | Log errors in `.catch()` |
| 7 | **Background workers lack retry** | `index.js` ~line 1186 | MT workers silently stop on failure | Add error logging + backoff |
| 8 | **Contradictory schema constraint** | `schema-pg.sql` | `idempotency_key NOT NULL` but index has `WHERE idempotency_key IS NOT NULL` | Remove redundant WHERE clause |

### LOW Priority (Input Validation Gaps)

| # | Issue | File |
|---|-------|------|
| 9 | Date params `from`/`to` not format-validated | `routes/tier4/accounting.js` |
| 10 | `days` param in leave requests allows negative values | `routes/tier4/hr.js` |
| 11 | `expected_value` in CRM allows negative values | `routes/tier4/crm.js` |
| 12 | NaN edge case in Shopify `limit` param | `routes/shopify/mappings.js` |

### Confirmed Secure (no action needed)

- **SQL injection**: Zero vulnerabilities — all 25+ route files use `$1, $2` parameterized queries
- **Authorization**: Every protected route has `requirePerm`/`requireAnyPerm` middleware
- **DELETE routes**: All properly gated with appropriate permission checks
- **Sensitive data**: No passwords, tokens, or secrets returned in any API response
- **CORS**: Specific origin configured (not wildcard), credentials enabled

---

## Production State Reference (Mar 15 2026)

| Item | Value |
|------|-------|
| Active DB | Supabase Postgres (ap-southeast-1) |
| Active Mode | MULTI_TENANT=1 |
| Boot Guard | index.js line 5 — loads `db-pg` (Postgres) |
| Migration System | `migrate-pg.js` |
| Tests | 340/340 Postgres integration tests passing |
| First Tenant | packagesmall (Packages Mall) |
| Security Status | Zero critical vulnerabilities, 4 HIGH hardening items, 4 MEDIUM items |
