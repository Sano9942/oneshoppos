# Full PostgreSQL + Multi-Tenant Rewrite — Design Document

**Date:** 2026-03-11
**Branch:** `feature/postgres-migration`
**Restore point:** `git tag v1.0-sqlite-working`

## Decision

Replace SQLite with PostgreSQL (hosted on Supabase free tier).
Multi-tenant isolation via schema-per-tenant (`CREATE SCHEMA tenant_slug`).
Full rewrite of DB layer — no compatibility wrapper.

## Scope Summary

Based on a comprehensive codebase audit:

| Category | Occurrences | Files |
|----------|-------------|-------|
| `?` → `$1,$2` placeholders | ~800 | 50+ |
| `this.lastID` → `RETURNING id` | 73 | 45 |
| `this.changes` → `result.rowCount` | 75 | 46 |
| `datetime('now')` → `NOW()` | 34 | 27 |
| `datetime('now','localtime')` → `NOW() AT TIME ZONE $tz` | 166 | 22 |
| `date(col)` → `col::date` | 100+ | 15+ |
| `strftime()` → `TO_CHAR()`/`EXTRACT()` | 13 | 6 |
| `julianday()` → `EXTRACT(DAY FROM ...)` | 2 | 2 |
| `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING` | 49 | 31 |
| `LIKE` → `ILIKE` | 626 | 40+ |
| `json_group_array()` → `json_agg()` | ~3 | 1 |
| `PRAGMA table_info()` → `information_schema` | 4 | 3 |
| `db.serialize()` → `transaction()` | 123 | 50+ |
| `db.each()` → `query()` + loop | 3 | 2 |
| `stmt.run()/finalize()` → parameterized query | 6 | 4 |
| Backup/restore (`fs.copyFileSync`) → `pg_dump` | 2 | 1 |
| **Total** | **~2,400** | **~100** |

## Architecture

### Hosting

- **Supabase free tier** — one project, one PostgreSQL database
- `public` schema = master DB (tenant registry, super_admins, audit log)
- `tenant_<slug>` schemas = per-tenant data (sales, products, employees, etc.)
- Railway backend connects via `DATABASE_URL` env var (SSL, connection pooling)

### Connection Layer

**`backend/db-pg.js`** — shared `pg.Pool` connected via `DATABASE_URL`:
```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

module.exports = {
  query: (sql, params) => pool.query(sql, params),
  getClient: () => pool.connect(),
  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
  end: () => pool.end(),
};
```

**`backend/tenant-db-pg.js`** — replaces `tenant-db-manager.js` + `tenant-db-proxy.js`:
- Uses AsyncLocalStorage (same pattern as current `tenant-db-proxy.js`)
- Instead of opening a SQLite file, sets `SET search_path = 'tenant_<slug>'` on a pooled client
- Single shared pool — Supabase handles connection limits
- `resolveTenant` middleware wraps request in ALS context with tenant slug

**`backend/master-db-pg.js`** — replaces `master-db.js`:
- Queries run against `public` schema (default search_path)
- Same tables: `tenants`, `super_admins`, `tenant_audit_log`, `schema_migrations`, `tenant_refresh_tokens`
- No lazy init needed — pool is always connected

### Schema

**`backend/schema-pg.sql`** — single definitive Postgres DDL, replacing all 74 migrations.

Key type mappings:
| SQLite | PostgreSQL |
|--------|-----------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `TEXT` (timestamps) | `TIMESTAMPTZ` |
| `TEXT` (dates) | `DATE` |
| `REAL` (money) | `NUMERIC(12,2)` |
| `INTEGER` (booleans) | `BOOLEAN` |
| `TEXT` (JSON) | `JSONB` |
| `datetime('now')` defaults | `DEFAULT NOW()` |
| `datetime('now','localtime')` defaults | `DEFAULT NOW()` (store UTC, convert at read time) |

### Route File Conversion Pattern

Every route handler: callbacks → async/await.

**Before (SQLite):**
```js
router.post("/", (req, res) => {
  db.run("INSERT INTO sales (amount) VALUES (?)", [amount], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});
```

**After (Postgres):**
```js
router.post("/", async (req, res) => {
  try {
    const { rows: [row] } = await db.query(
      "INSERT INTO sales (amount) VALUES ($1) RETURNING id", [amount]
    );
    res.json({ id: row.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Transaction pattern:**
```js
// Before: db.serialize(() => { db.run("BEGIN")... })
// After:
await db.transaction(async (client) => {
  const { rows: [sale] } = await client.query("INSERT INTO sales ... RETURNING id", [...]);
  await client.query("INSERT INTO sale_items ...", [sale.id, ...]);
  return sale;
});
```

### SQL Dialect Conversion Reference

| SQLite | PostgreSQL | Notes |
|--------|-----------|-------|
| `datetime('now')` | `NOW()` | UTC |
| `datetime('now','localtime')` | `NOW()` | Store UTC everywhere, convert at read |
| `date(col)` | `col::date` | Extract date part |
| `date(col,'localtime')` | `(col AT TIME ZONE tz)::date` | Using req.company.timezone |
| `strftime('%Y-%m', col)` | `TO_CHAR(col, 'YYYY-MM')` | |
| `strftime('%w', col)` | `EXTRACT(DOW FROM col)` | 0=Sunday in both |
| `strftime('%H', col)` | `EXTRACT(HOUR FROM col)` | |
| `julianday('now') - julianday(col)` | `EXTRACT(DAY FROM NOW() - col)` | Recency in days |
| `INSERT OR IGNORE INTO t` | `INSERT INTO t ... ON CONFLICT DO NOTHING` | |
| `INSERT OR REPLACE INTO t` | `INSERT INTO t ... ON CONFLICT DO UPDATE SET ...` | Must name conflict target |
| `LIKE '%term%'` | `ILIKE '%term%'` | Case-insensitive search |
| `?` placeholders | `$1, $2, $3` | Numbered parameters |
| `this.lastID` | `RETURNING id` → `rows[0].id` | |
| `this.changes` | `result.rowCount` | |
| `PRAGMA foreign_keys = ON` | (always on in Postgres) | Remove |
| `PRAGMA journal_mode = WAL` | (always WAL in Postgres) | Remove |
| `PRAGMA table_info(t)` | `SELECT * FROM information_schema.columns WHERE table_name = $1` | |
| `sqlite_master` | `information_schema.tables` | |
| `json_group_array(col)` | `json_agg(col)` | |
| `db.serialize(fn)` | `transaction(fn)` or just `await` | |
| `db.each(sql, cb)` | `query(sql)` + `for...of` | |
| `stmt.run()` / `stmt.finalize()` | `client.query(sql, params)` | |

### Timezone Strategy

**Decision: store everything as UTC.**

Current architecture has two timestamp types:
- UTC columns (sales, returns, cash_shifts, transfers, adjustments) — already UTC
- LOCAL columns (attendance, expenses, GRN, parked_sales) — currently `datetime('now','localtime')`

**Migration plan:**
- All columns become `TIMESTAMPTZ` with `DEFAULT NOW()` (UTC)
- Read-time conversion uses `col AT TIME ZONE req.company.timezone`
- `backend/utils/tz.js` stays — `toUtcStart/toUtcEnd` still useful for date range queries
- Frontend formatters (`fmtUtcDateTime`, `fmtLocalDateTime`) continue working — backend sends UTC, frontend converts

**This eliminates the dual UTC/LOCAL timestamp system** that has caused 3 production bugs so far.

### Backup/Restore

**Replace** `fs.copyFileSync()` in `barcode-expenses.js`:
- Backup: `pg_dump --schema=tenant_slug --format=custom -f backup.dump $DATABASE_URL`
- Restore: `pg_restore --schema=tenant_slug --clean backup.dump`
- Multi-tenant backup: iterate tenants, dump each schema
- File served as download (same API contract)

### Tenant Provisioning

**Replace** `tenant-provisioner.js`:
```sql
CREATE SCHEMA IF NOT EXISTS tenant_<slug>;
SET search_path = 'tenant_<slug>';
-- Run schema-pg.sql
-- Run seed data (outlet, role, admin employee, company_profile, tax)
-- Insert into public.tenants (slug, name, ...)
```
No filesystem operations — no tenant directories, no SQLite files.

### Test Infrastructure

**Strategy: real Postgres test database**

- Local dev: Docker Postgres via `docker-compose.yml` or Supabase local CLI
- `createTestApp.js` → connects to test Postgres, creates unique schema per test suite (`test_<uuid>`)
- `seedSchema.js` → runs `schema-pg.sql` against test schema
- `afterAll` → `DROP SCHEMA test_<uuid> CASCADE`
- CI: GitHub Actions Postgres service container (free, ~3s startup)
- All test assertions rewritten: callbacks → async/await

### What Does NOT Change

- **Frontend** — zero changes (same REST API)
- **API contracts** — same endpoints, same request/response shapes
- **Business logic** — same validation, permissions, flows
- **JWT auth** — `jwt-auth.js` has no DB calls
- **Shopify client** — `shopify/client.js` has no DB calls
- **Printer service** — `services/printer.js` has no DB calls
- **Receipt utilities** — `utils/receiptEmail.js`, `utils/digestEmail.js` have no DB calls

### Files to Delete After Migration

- `backend/db.js` (replaced by `db-pg.js`)
- `backend/master-db.js` (replaced by `master-db-pg.js`)
- `backend/tenant-db-manager.js` (replaced by `tenant-db-pg.js`)
- `backend/tenant-db-proxy.js` (replaced by `tenant-db-pg.js`)
- `backend/schema-full.js` (replaced by `schema-pg.sql`)
- `backend/migrate.js` through `backend/migrate74.js` (all 74 files)
- `backend/run_migrations.js` (replaced by `migrate-pg.js`)
- `backend/tenant-migrate.js` (replaced by `migrate-pg.js`)
- `backend/start.sh` symlink logic (no DB files to symlink)
- `backend/sanopos.db` (SQLite file)
- `backend/master.db` (SQLite file)

### Files to Create

- `backend/db-pg.js` — connection pool + query/transaction helpers
- `backend/master-db-pg.js` — master DB (public schema) access
- `backend/tenant-db-pg.js` — schema-per-tenant proxy via AsyncLocalStorage
- `backend/schema-pg.sql` — complete Postgres DDL (43+ tables)
- `backend/migrate-pg.js` — future migration runner (version-tracked)
- `backend/tenant-provisioner-pg.js` — schema-based provisioning
- `backend/tests/helpers/createTestApp-pg.js` — test DB setup
- `backend/tests/helpers/seedSchema-pg.js` — test schema seeder
- `docker-compose.yml` — local Postgres for development

## Execution Order

| Phase | What | Files | Depends on |
|-------|------|-------|------------|
| 1 | DB layer + schema | 4 new files + schema-pg.sql | Nothing |
| 2+3 | Route conversion (SQL + async) | 41+ route files, done per-file | Phase 1 |
| 4 | Special cases (backup, schema extraction) | 3 files | Phase 1 |
| 5 | Tests | 40+ test files | Phases 2+3 |
| 6 | Deployment + cleanup | env vars, package.json, delete old files | All above |

Phases 2+3 are done together per-file — convert one route file completely (SQL dialect + async/await), verify, move to next.

## Risk Mitigation

- `v1.0-sqlite-working` tag = instant rollback to working SQLite
- `main` branch untouched throughout migration
- Each route file conversion is independently testable
- Supabase free tier = zero cost during development
- Local Docker Postgres = no cloud dependency for dev/test
