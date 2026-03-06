# SaaS Phase 1 Design — Master DB & Tenant Management Layer

**Date:** 2026-03-06
**Status:** Approved
**Scope:** Phase 1 only — purely additive, zero existing files modified

---

## Context

OneShopPOS is being converted from a single-tenant local app to a cloud-hosted multi-tenant SaaS. Phase 1 lays the foundation: a master tenant registry database, a connection pool manager for tenant DBs, and a provisioner CLI to create new tenants.

**Key constraint:** Phase 1 touches nothing existing. `backend/oneshop.db`, all route files, `backend/index.js`, and all frontend files are untouched. The app continues to run exactly as today.

---

## Files Created (4 new files, nothing modified)

| File | Purpose |
|------|---------|
| `backend/schema-full.js` | Captures live `oneshop.db` schema via SQLite `.schema`; exports as a string; used by provisioner to initialize fresh tenant DBs |
| `backend/master-db.js` | Opens/initializes `backend/master.db`; creates all master schema tables; exports `masterDb` |
| `backend/tenant-db-manager.js` | In-memory connection cache (`Map<tenantId, db>`); manages open SQLite handles for all tenants |
| `backend/tenant-provisioner.js` | CLI script — creates a new tenant's directory, DB, schema, seed data, and master registry entry |

---

## Schema: `master.db`

```sql
CREATE TABLE IF NOT EXISTS tenants (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  owner_email            TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active',
  plan                   TEXT NOT NULL DEFAULT 'free',
  db_path                TEXT NOT NULL,
  timezone               TEXT NOT NULL DEFAULT 'UTC',
  max_employees          INTEGER DEFAULT 3,
  max_outlets            INTEGER DEFAULT 1,
  max_products           INTEGER DEFAULT 500,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at          TEXT,
  created_at             TEXT DEFAULT (datetime('now')),
  updated_at             TEXT DEFAULT (datetime('now')),
  suspended_at           TEXT,
  deleted_at             TEXT
);

CREATE TABLE IF NOT EXISTS super_admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  action     TEXT NOT NULL,
  details    TEXT,
  actor      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER NOT NULL PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
```

`master.db` is stored at `backend/master.db` and added to `.gitignore`.

---

## `schema-full.js`

- Uses `sqlite3` to open `backend/oneshop.db` in read-only mode
- Queries `sqlite_master` for all `CREATE TABLE` and `CREATE INDEX` statements
- Exports the result as a single SQL string
- This is the authoritative schema for all new tenant DBs — guaranteed to match exactly what's running

---

## `tenant-db-manager.js`

```
getDb(tenantId)       → looks up tenant in master.db, opens connection if not cached, returns db handle
closeDb(tenantId)     → closes connection and removes from Map
closeAll()            → closes all open connections (called on process.exit)
healthCheck(tenantId) → verifies DB file exists + runs SELECT 1 + confirms WAL mode active
```

Each connection is opened with:
- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`

For Phase 1, this module is importable but not wired into Express — that happens in Phase 3.

---

## `tenant-provisioner.js` — CLI

### Invocation
```bash
node backend/tenant-provisioner.js \
  --slug aces-hardware \
  --name "Aces Hardware" \
  --timezone "Asia/Karachi" \
  --pin 1234
```

### Steps
1. **Validate** slug: URL-safe chars only (`[a-z0-9-]`), 3–40 chars, not already in `master.db`
2. **Create directory structure:**
   ```
   backend/tenants/t_aces-hardware/
     data.db
     uploads/products/
     uploads/company/
     backups/
     exports/reports/
   ```
3. **Initialize DB** at `data.db` — run full schema from `schema-full.js`
4. **Seed data:**
   - 1 outlet — name from `--name`
   - 1 admin role — all permissions
   - 1 admin employee — PIN from `--pin`, role = admin
   - `company_profile` row — name from `--name`, timezone from `--timezone`
   - 1 default tax — name: "Default Tax", rate: 0%
5. **Register** in `master.db` `tenants` table — set `db_path` to relative path `tenants/t_<slug>/data.db`, initial `schema_migrations` version = 64
6. **Audit log** — write entry: `action: 'created'`, `actor: 'system'`, details JSON with slug + timezone
7. **Print** success summary: tenant_id, slug, db_path, seed employee id

### Error handling
- If any step fails, clean up: remove created directory, do not write master.db entry
- Print clear error message with which step failed

---

## `.gitignore` additions
```
backend/master.db
backend/tenants/
```

---

## Verification (after Phase 1 is built)

```bash
node backend/tenant-provisioner.js --slug test-store --name "Test Store" --timezone "Asia/Karachi" --pin 9999
```

- `backend/tenants/t_test-store/data.db` exists
- Open in SQLite browser — confirm 41+ tables, seed data present (outlet, employee, role, company_profile, tax)
- `schema_migrations` version = 64 in both tenant DB and master.db
- `master.db` `tenants` table has 1 row for `test-store`
- `tenant_audit_log` has 1 row: `action = 'created'`

---

## What Phase 1 Does NOT Do

- Does not modify `backend/index.js`
- Does not modify any route file
- Does not modify any frontend file
- Does not wire `tenant-db-manager` into Express (Phase 3)
- Does not implement JWT auth (Phase 2)
- Does not implement super-admin API (Phase 5)
