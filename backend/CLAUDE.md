# Backend — Claude Guide

## DO NOT READ These Files

### Stale Directories (skip)
- `backups/`, `archive/legacy/`, `tenants/`, `exports/`, `uploads_test/`, `uploads_tmp/`

> **Note:** All SQLite infrastructure files (db.js, master-db.js, tenant-db-manager.js, etc.), 74 SQLite migration files (migrate1.js–migrate74.js), and one-off scripts (cleanup-public-schema.js, reset-production.js) were deleted in the Phase 5 audit cleanup (commit `3227600`). The codebase is Postgres-only. Schema source of truth: `schema-pg.sql`.

## Where to Look Instead

| Need | Read This |
|------|-----------|
| Database connection / queries | `db-pg.js` |
| Full table schema (DDL) | `schema-pg.sql` |
| Postgres migrations | `migrate-pg.js` |
| Multi-tenant DB routing | `tenant-db-proxy-pg.js` + `tenant-db-manager-pg.js` |
| Master tenant registry | `master-db-pg.js` |
| Tenant provisioning | `tenant-provisioner-pg.js` |
| Super-admin seeding | `seed-admin-pg.js` |
| JWT auth utilities | `jwt-auth.js` |
| Plan limit enforcement | `middleware/plan-limits.js` |
| Server entry + middleware | `index.js` |
| Route registration | `routes/registerAllRoutes.js` (orchestrator only — no route logic here) |
| Route logic for a domain | `routes/<domain>.js` (e.g., `routes/sales.js`, `routes/products.js`) |
| Super-admin + infra monitoring | `routes/admin/` (8 modules: auth, tenants, monitoring, billing, operations, compliance, messaging, system) — infra, tax rates, FBR health, activity/security logs, revenue stats, worker status, orphaned schemas, tenant notes, announcements, broadcast log, support ticket replies, backup trigger |
| Report endpoints | `routes/reports/` (11 files, modular) |
| Shopify integration | `routes/shopify/` (9 files) + `shopify/` (3 files) |
| Tier4 features | `routes/tier4/` (7 files) |
| Timezone utilities | `utils/tz.js` |
| Receipt email builder | `utils/receiptEmail.js` |
| Postgres backup/restore | `utils/backup-pg.js` |
| Category tree logic | `category-tree.js` — includes `resolveInheritedField()` for tax/HS inheritance |
| Printer service | `services/printer.js` |
| Structured logging | `services/logger.js` (Pino) |
| Alert system | `services/alerting.js` (error spikes, DB pressure) |
| Request ID middleware | `middleware/request-id.js` (UUID + Pino per-request) |
| Alert emails | `utils/alertEmail.js` (Resend-based) |
| Support tickets | `routes/support.js` |
| Billing routes | `routes/billing.js` — status, pricing, checkout, payment history, upgrade requests |
| Payment gateway | `services/payment-gateway.js` — adapter (xPay impl, extensible to Stripe/JazzCash) |
| Payment webhooks | `routes/webhooks.js` — mounted before tenant middleware, no auth |
| Subscription enforcement | `middleware/plan-limits.js` — `requireActiveSubscription` + `requirePlanLimit` |
| Dead tenant cleanup | `jobs/cleanup-dead-tenants.js` (removes tenants with no setup after 7 days, inline via `CLEANUP_WORKER_ENABLED=1`) |
| FBR Digital Invoicing | `services/fbr.js` (API client + payload builders), `routes/fbr.js` (config/dashboard/retry), `routes/tax-lookup.js` (HS code search) |
| FBR background worker | `workers/fbr-worker.js` (legacy inline), `workers/fbr-worker-boss.js` (pg-boss backed) |
| pg-boss job queue | `services/boss.js` — shared pg-boss instance factory |
| Upload validation | `middleware/upload-validation.js` — centralized MIME + extension whitelist |
| Rate limiting | `middleware/rate-limit.js` — global, auth endpoint, webhook limiters |
| JWT auth + tenant resolution | `middleware/tenant-auth.js` — loadTenantAndPerms, resolveTenant, loadCompanyProfile, resolveContext |
| Permissions | `middleware/permissions.js` — requirePerm, requireAnyPerm, PERMISSION_RULES |
| Feature flags | `middleware/feature-flags.js` — requireFeature, flag cache, notification helpers |
| Input validation | `middleware/validate.js` + `schemas/` — Zod schemas for auth, billing, employees, products, sales, returns, customers, purchase-orders, inventory, admin |
| Worker startup | `boot/workers.js` — all worker init (email, FBR, cleanup, Shopify, scheduled tasks) |
| Shopify crypto | `shopify/crypto.js` — secret encrypt/decrypt + event logging |
| Tax rate seed data | `scripts/seed-tax-rates.js` (one-time, ~96 HS codes with Urdu descriptions) |

## Efficiency Rules

- **Read only the specific route file needed** — never read the whole `routes/` directory. If adding a sales feature, read `routes/sales.js` only
- **Grep schema-pg.sql** — it's ~600 lines. Grep for the specific table name (`CREATE TABLE orders`) instead of reading the whole file
- **Don't read registerAllRoutes.js** — route mounting is documented in the root CLAUDE.md. Skip it for all domain-level tasks
- **Don't read index.js** — middleware order is documented in root CLAUDE.md. Only read it if the task is explicitly about server boot or middleware config
- **One reference route** — when adding a new route file, read ONE similar existing route as a pattern reference, not multiple
- **Grep before read** — use Grep to find the exact function/query/column before opening any file

## Database is Postgres

- All queries use `await db.query(sql, [params])` with `$1, $2` placeholders
- Results: `{ rows, rowCount }` — access data via `rows[0]`, `rows`, `rowCount`
- Transactions: `await db.transaction(async (client) => { ... })`
- Raw pool access: `db.pool`, dedicated client: `await db.getClient()`
- Booleans: use `true`/`false` (not `1`/`0`)
- Case-insensitive search: use `ILIKE` (not `LIKE`)
- Date extraction: use `col::date` (not `date(col)`)
- String aggregation: use `string_agg()` (not `GROUP_CONCAT`)
- JSON aggregation: use `json_agg(json_build_object(...))` (not `json_group_array`)
- ROUND requires numeric cast: `ROUND(expr::numeric, 2)`
- All non-aggregated SELECT columns MUST appear in GROUP BY

## Test Suites

### Postgres Integration Tests (449 tests — primary) + 125 unit tests
- Location: `tests/integration/pg-batch*.test.js` (12 files: pg-batch1–12 + tenant isolation)
- Unit tests: `tests/unit/` (125 tests — utils.test.js, services.test.js, middleware.test.js, tz.test.js)
- Unit test runner: `vitest` with `@vitest/coverage-v8` (see `vitest.config.js`)
- Factory: `tests/helpers/createTestApp-pg.js` (isolated schema per test)
- Schema: `tests/helpers/seedSchema-pg.js`
- Run: `npx jest tests/integration/pg-batch1-crud.test.js` (requires `DATABASE_URL`)

### Live E2E Tests (~120 tests — full stack against production)
- Location: `frontend/tests/live/` (20 Playwright specs, 00–19)
- Config: `frontend/playwright.config.live.js`
- Target: `https://sanopos.com` (tenant `packagesmall`)
- Run: `cd frontend && npx playwright test tests/live/NN-name.spec.js --config=playwright.config.live.js`
- Covers: shift→sale→return→gift card→shift close, inventory, purchasing, GRN, customers, loyalty, CRM, HR, attendance, kiosk, approvals, notifications, reports, accounting, audit log

### Onboarding E2E Tests (45 tests — full signup→sale for all 3 plans)
- Location: `frontend/tests/live/` (specs 21–23)
- Config: `frontend/playwright.config.onboarding.js` (no globalSetup)
- Run: `cd frontend && npx playwright test tests/live/2N-onboard-*.spec.js --config=playwright.config.onboarding.js`
- Creates real tenants from scratch — delete from `/admin` after each run
- **Key gotcha**: clock-in uses `/api/attendance/pin-checkin?tenant=${slug}` (NOT `/clock-in`) — writes `attendance_sessions` which POS checkout validates

### Legacy (do not use)
- SQLite tests (`tests/integration/*.test.js`) — do not modify or run unless explicitly asked

## Common Gotchas

### Timezone architecture
- All business-critical timestamps (`sales`, `returns`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`) stored as **UTC** via `CURRENT_TIMESTAMP`
- `attendance_sessions` and `employee_attendance` store **local time** — intentional, do NOT change their write paths
- `utils/tz.js` provides `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` — converts local `YYYY-MM-DD` to UTC boundary strings
- `req.company.timezone` (IANA string) set by `loadCompanyProfile` middleware — use it in all date filter queries
- **CRITICAL**: `session_start` and `check_in` are already local — use `date(col)` with NO modifier. `date(col,'localtime')` double-converts and breaks UTC+ timezones

### Auth on GET routes (Apr 1 2026)
- **ALL data-returning GET endpoints now require auth** — `requirePerm` or `requireAnyPerm` on every GET across sales, returns, customers, products, POs, GRN, inventory, employees
- Permission mapping: sales/returns/customers → `view_reports`, products → `view_reports`+`manage_inventory`, POs/GRN → `manage_orders`+`view_reports`, transfers/adjustments → `manage_inventory`+`view_reports`, employees → `all_access`
- When adding new GET routes, **always add auth middleware** — no unprotected data endpoints

### Stock check — FOR UPDATE (Apr 1 2026)
- `POST /api/sales` stock validation runs INSIDE `db.transaction()` with `SELECT ... FOR UPDATE` row locks
- Prevents TOCTOU race condition (two concurrent sales overselling)
- If stock insufficient, throws with `statusCode: 400` — caught by outer try/catch
- Void handler restores both `outlet_stock` AND `product_variants.stock`

### Sales table schema
- The sale timestamp column is named `timestamp`, NOT `created_at` — using `created_at` silently returns undefined

### reports_accuracy.test.js
- Uses Jest syntax (`describe`, `beforeEach`, `afterEach`) — run with `npx jest`

### PO credit limit
- `POST /api/purchase-orders` warns (but allows) when credit supplier exceeds `credit_limit` — response includes `{ warning: "..." }`
- `running_balance` counts only invoiced/received POs, not draft POs

### Postgres-Specific Gotchas
- **Boolean columns are strict**: `is_active`, `is_primary`, `is_default`, `voided`, `show_barcode`, `show_logo` — MUST use `= true`/`= false`, never `= 1`/`= 0`
- **NUMERIC returns strings**: Always wrap with `Number()` before arithmetic (e.g. gift card `remaining_value`)
- **Reserved words**: `read` → `is_read` (in notifications table)
- **HAVING clause**: Postgres does not allow column aliases in HAVING — must repeat the full expression
- **FK constraints on bulk delete**: Must explicitly delete from referencing tables before deleting from parent tables

### Infrastructure Monitoring Endpoint
- `GET /api/admin/infra` — gated by `requireAllowedIp` + `requireSuperAdmin`
- Queries: `pg_stat_activity` (connections), `pg_database_size` (DB size), `pg_statio_user_tables` (cache hit ratio), `pg_stat_user_tables` (dead tuples/vacuum), schema sizes, active slow queries (>1s)
- Optional: `pg_stat_statements` (historical slow queries) — try/catch, skipped if extension unavailable

### Boot Guard (index.js)
- `index.js` is now Postgres-only (~230-line orchestrator). SQLite fallback removed.
- `require("dotenv").config(...)` must remain line 1 so `DATABASE_URL` is set before any require

### Worker Heartbeat Pattern
- Email, FBR, and cleanup workers expose `global.__emailWorkerStatus`, `__fbrWorkerStatus`, `__cleanupWorkerStatus`
- Each object: `{ lastPollAt, processedToday, queueDepth }`
- `queueDepth` is now a real `SELECT COUNT(*)` from the queue table — no longer always 0
- `GET /api/admin/worker-status` reads these globals to determine running/stopped state
- Workers are pg-boss backed — jobs survive server crashes and don't block the HTTP event loop

## Production Environment

- **Database**: Supabase Postgres (production is Postgres-only)
- **Mode**: `MULTI_TENANT=1` on Railway, `VITE_MULTI_TENANT=1` on Vercel
- **Boot**: `index.js` line 5 loads `db-pg` (Postgres)
- **Frontend**: Vercel at `sanopos.com` (custom domain; `sanopos.vercel.app` fallback still active)
- **Backend**: Railway at `api.sanopos.com` (custom domain; `oneshoppos-production.up.railway.app` fallback still active)
- **Railway env vars**: `MULTI_TENANT=1`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN=https://sanopos.com,https://www.sanopos.com,https://sanopos.vercel.app`, `TZ=Asia/Karachi`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL=SanoPOS <noreply@sanopos.com>`, `SENTRY_DSN`, `ALERT_EMAIL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `FBR_WORKER_ENABLED=1`, `EMAIL_WORKER_ENABLED=1`, `CLEANUP_WORKER_ENABLED=1`
- **Payment gateway env vars** (optional, set when xPay account ready): `PAYMENT_GATEWAY=xpay`, `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET`. Without these, system uses manual admin payments only.
- **Railway gotchas**: `PORT` env var is overridden by Railway (binds to 8080); this is fine
- To seed super-admin: `railway run node backend/seed-admin-pg.js --email <email> --password <password> --name <name>`
- To provision tenant: use super-admin dashboard at `/admin` or `railway run node backend/tenant-provisioner-pg.js --slug <slug> --name <name> --pin <pin>`
