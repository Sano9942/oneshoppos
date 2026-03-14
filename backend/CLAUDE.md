# Backend — Claude Guide

## DO NOT READ These Files

The following files are **legacy SQLite code** — never executed in production (Postgres-only since Mar 12 2026). Do NOT read, modify, or reference them unless explicitly asked about SQLite rollback.

### SQLite Infrastructure (10 files — skip all)
- `db.js` → use `db-pg.js` instead
- `master-db.js` → use `master-db-pg.js` instead
- `tenant-db-manager.js` → use `tenant-db-manager-pg.js` instead
- `tenant-db-proxy.js` → use `tenant-db-proxy-pg.js` instead
- `tenant-provisioner.js` → use `tenant-provisioner-pg.js` instead
- `tenant-migrate.js` → use `migrate-pg.js` instead
- `schema-full.js` → use `schema-pg.sql` instead
- `seed-admin.js` → use `seed-admin-pg.js` instead
- `run_migrations.js` → use `migrate-pg.js` instead
- `migrate.js` → obsolete pre-system migration

### 74 SQLite Migration Files (skip all)
- `migrate1.js` through `migrate74.js` — SQLite DDL, never run in production
- For schema reference, read `schema-pg.sql` (single source of truth)

### One-Off Scripts (already executed, skip)
- `cleanup-public-schema.js` — already run Mar 13 2026
- `seed_e2e.js` — one-off test data helper

### Stale Directories (skip)
- `backups/`, `archive/legacy/`, `tenants/`, `exports/`, `uploads_test/`, `uploads_tmp/`

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
| Report endpoints | `routes/reports/` (11 files, modular) |
| Shopify integration | `routes/shopify/` (9 files) + `shopify/` (3 files) |
| Tier4 features | `routes/tier4/` (7 files) |
| Timezone utilities | `utils/tz.js` |
| Receipt email builder | `utils/receiptEmail.js` |
| Postgres backup/restore | `utils/backup-pg.js` |
| Category tree logic | `category-tree.js` |
| Printer service | `services/printer.js` |

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

### Postgres Integration Tests (340 tests — primary)
- Location: `tests/integration/pg-batch*.test.js` (8 files)
- Factory: `tests/helpers/createTestApp-pg.js` (isolated schema per test)
- Schema: `tests/helpers/seedSchema-pg.js`
- Run: `npx jest tests/integration/pg-batch1-crud.test.js` (requires `DATABASE_URL`)

### Live E2E Tests (~120 tests — full stack against production)
- Location: `frontend/tests/live/` (20 Playwright specs, 00–19)
- Config: `frontend/playwright.config.live.js`
- Target: `https://sanopos.vercel.app` (tenant `packagesmall`)
- Run: `cd frontend && npx playwright test tests/live/NN-name.spec.js --config=playwright.config.live.js`
- Covers: shift→sale→return→gift card→shift close, inventory, purchasing, GRN, customers, loyalty, CRM, HR, attendance, kiosk, approvals, notifications, reports, accounting, audit log

### Legacy (do not use)
- SQLite tests (`tests/integration/*.test.js`) — do not modify or run unless explicitly asked

## Common Gotchas

### Timezone architecture
- All business-critical timestamps (`sales`, `returns`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`) stored as **UTC** via `CURRENT_TIMESTAMP`
- `attendance_sessions` and `employee_attendance` store **local time** — intentional, do NOT change their write paths
- `utils/tz.js` provides `toUtcStart(dateStr, tz)` / `toUtcEnd(dateStr, tz)` — converts local `YYYY-MM-DD` to UTC boundary strings
- `req.company.timezone` (IANA string) set by `loadCompanyProfile` middleware — use it in all date filter queries
- **CRITICAL**: `session_start` and `check_in` are already local — use `date(col)` with NO modifier. `date(col,'localtime')` double-converts and breaks UTC+ timezones

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

### Boot Guard (index.js line 2)
- `require("dotenv").config(...)` loads `.env` BEFORE the conditional import on line 5
- `const db = process.env.DATABASE_URL ? require("./db-pg") : require("./db")` — Postgres or SQLite based on env
- Railway has `DATABASE_URL` → runs Postgres. Local dev without `.env` → falls back to SQLite

## Production Environment

- **Database**: Supabase Postgres (production is Postgres-only)
- **Mode**: `MULTI_TENANT=1` on Railway, `VITE_MULTI_TENANT=1` on Vercel
- **Boot**: `index.js` line 5 loads `db-pg` (Postgres)
- **Frontend**: Vercel at `sanopos.vercel.app`
- **Backend**: Railway at `oneshoppos-production.up.railway.app`
- **Railway env vars**: `MULTI_TENANT=1`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN=https://sanopos.vercel.app`, `TZ=Asia/Karachi`
- **Railway gotchas**: `PORT` env var is overridden by Railway (binds to 8080); this is fine
- To seed super-admin: `railway run node backend/seed-admin-pg.js --email <email> --password <password> --name <name>`
- To provision tenant: use super-admin dashboard at `/admin` or `railway run node backend/tenant-provisioner-pg.js --slug <slug> --name <name> --pin <pin>`
