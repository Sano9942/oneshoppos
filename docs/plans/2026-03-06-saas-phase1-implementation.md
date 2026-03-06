# SaaS Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the master tenant registry database, tenant DB connection manager, and provisioner CLI — the purely-additive foundation for multi-tenant SaaS.

**Architecture:** 4 new files in `backend/`. `schema-full.js` dumps the live `oneshop.db` schema. `master-db.js` opens `master.db` (the tenant registry). `tenant-db-manager.js` is an in-memory connection pool. `tenant-provisioner.js` is a CLI that creates a new tenant directory + DB + seed data. Nothing existing is modified.

**Tech Stack:** Node.js, `sqlite3` npm package (already installed), `fs`, `path`, `process` (all built-in Node modules — no new dependencies needed)

---

## Task 1: Add `.gitignore` entries

**Files:**
- Modify: `.gitignore` (project root)

**Step 1: Open `.gitignore` and append**

Add these two lines at the bottom:
```
backend/master.db
backend/tenants/
```

**Step 2: Verify**

```bash
grep -E "master.db|tenants" .gitignore
```
Expected: both lines appear.

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore master.db and tenants/ directory"
```

---

## Task 2: Build `schema-full.js`

**Files:**
- Create: `backend/schema-full.js`

**What it does:** Reads the live `backend/oneshop.db` and exports its full schema (all `CREATE TABLE` + `CREATE INDEX` statements) as a single SQL string. This is used by the provisioner to stamp out identical fresh DBs for new tenants.

**Step 1: Create the file**

```javascript
// backend/schema-full.js
// Extracts the full schema from the live oneshop.db.
// Returns a SQL string ready to be exec'd against a fresh SQLite DB.

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function extractSchema() {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(__dirname, 'oneshop.db');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`Cannot open oneshop.db: ${err.message}`));
    });

    db.all(
      `SELECT sql FROM sqlite_master
       WHERE type IN ('table', 'index')
         AND sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type DESC, name ASC`,
      [],
      (err, rows) => {
        db.close();
        if (err) return reject(err);
        const sql = rows.map(r => r.sql + ';').join('\n\n');
        resolve(sql);
      }
    );
  });
}

module.exports = { extractSchema };
```

**Step 2: Smoke test manually**

```bash
cd d:/newprojects/oneshoppos/backend
node -e "require('./schema-full').extractSchema().then(s => { console.log('Lines:', s.split('\n').length); console.log('Tables found:', (s.match(/CREATE TABLE/g)||[]).length); console.log('Indexes found:', (s.match(/CREATE INDEX/gi)||[]).length); }).catch(console.error)"
```

Expected output (approximate):
```
Lines: 700+
Tables found: 80+
Indexes found: 30+
```

**Step 3: Commit**

```bash
git add backend/schema-full.js
git commit -m "feat: schema-full.js — extracts live oneshop.db schema for tenant provisioning"
```

---

## Task 3: Build `master-db.js`

**Files:**
- Create: `backend/master-db.js`

**What it does:** Opens (and if needed creates) `backend/master.db`. Creates the 4 master tables if they don't exist. Exports `masterDb` — the open sqlite3.Database handle.

**Step 1: Create the file**

```javascript
// backend/master-db.js
// Opens master.db (the tenant registry) and initializes its schema.
// Exports: masterDb — the open sqlite3.Database handle.

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const MASTER_DB_PATH = path.join(__dirname, 'master.db');

const masterDb = new sqlite3.Database(MASTER_DB_PATH, (err) => {
  if (err) {
    console.error('[master-db] Failed to open master.db:', err.message);
    process.exit(1);
  }
  console.log('[master-db] Opened master.db at', MASTER_DB_PATH);
});

const MASTER_SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

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
`;

// Initialize schema — runs once on first open, idempotent thereafter.
function initMasterDb() {
  return new Promise((resolve, reject) => {
    masterDb.exec(MASTER_SCHEMA, (err) => {
      if (err) return reject(new Error(`[master-db] Schema init failed: ${err.message}`));
      console.log('[master-db] Schema initialized.');
      resolve();
    });
  });
}

module.exports = { masterDb, initMasterDb, MASTER_DB_PATH };
```

**Step 2: Smoke test manually**

```bash
cd d:/newprojects/oneshoppos/backend
node -e "
const { masterDb, initMasterDb } = require('./master-db');
initMasterDb().then(() => {
  masterDb.all(\"SELECT name FROM sqlite_master WHERE type='table'\", [], (err, rows) => {
    console.log('Tables:', rows.map(r => r.name));
    masterDb.close();
  });
}).catch(console.error);
"
```

Expected:
```
[master-db] Opened master.db at ...
[master-db] Schema initialized.
Tables: [ 'tenants', 'super_admins', 'tenant_audit_log', 'schema_migrations' ]
```

Also verify `backend/master.db` file was created:
```bash
ls -la backend/master.db
```

**Step 3: Commit**

```bash
git add backend/master-db.js
git commit -m "feat: master-db.js — opens master.db and initializes tenant registry schema"
```

---

## Task 4: Build `tenant-db-manager.js`

**Files:**
- Create: `backend/tenant-db-manager.js`

**What it does:** Manages an in-memory cache of open SQLite connections, one per tenant. For Phase 1 it is not wired into Express — it just exists and is importable. Phase 3 wires it in.

**Step 1: Create the file**

```javascript
// backend/tenant-db-manager.js
// In-memory connection pool for tenant SQLite databases.
// Each tenant gets one persistent open connection.
// Not wired into Express yet — that happens in Phase 3.

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { masterDb } = require('./master-db');

// Map<tenantId (number), sqlite3.Database>
const pool = new Map();

/**
 * Returns the open db handle for a tenant.
 * Opens + caches a new connection if one doesn't exist.
 * Rejects if the tenant is not found in master.db or the DB file is missing.
 */
function getDb(tenantId) {
  return new Promise((resolve, reject) => {
    if (pool.has(tenantId)) return resolve(pool.get(tenantId));

    masterDb.get('SELECT * FROM tenants WHERE id = ?', [tenantId], (err, tenant) => {
      if (err) return reject(err);
      if (!tenant) return reject(new Error(`Tenant ${tenantId} not found in master.db`));
      if (tenant.status !== 'active') return reject(new Error(`Tenant ${tenantId} is ${tenant.status}`));

      const dbPath = path.join(__dirname, tenant.db_path);
      if (!fs.existsSync(dbPath)) {
        return reject(new Error(`Tenant DB file not found: ${dbPath}`));
      }

      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) return reject(new Error(`Cannot open tenant DB: ${err.message}`));

        db.serialize(() => {
          db.run('PRAGMA foreign_keys = ON');
          db.run('PRAGMA journal_mode = WAL', () => {
            pool.set(tenantId, db);
            resolve(db);
          });
        });
      });
    });
  });
}

/**
 * Closes the connection for a tenant and removes it from the pool.
 */
function closeDb(tenantId) {
  return new Promise((resolve, reject) => {
    const db = pool.get(tenantId);
    if (!db) return resolve();
    db.close((err) => {
      if (err) return reject(err);
      pool.delete(tenantId);
      resolve();
    });
  });
}

/**
 * Closes all open connections. Call on process exit.
 */
function closeAll() {
  const promises = Array.from(pool.keys()).map(closeDb);
  return Promise.all(promises);
}

/**
 * Verifies a tenant's DB is readable and WAL mode is active.
 * Returns { ok: true } or throws.
 */
function healthCheck(tenantId) {
  return getDb(tenantId).then((db) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT 1 AS alive', [], (err, row) => {
        if (err) return reject(new Error(`Health check failed for tenant ${tenantId}: ${err.message}`));
        if (!row) return reject(new Error(`Health check returned no row for tenant ${tenantId}`));
        resolve({ ok: true, tenantId });
      });
    });
  });
}

// Graceful shutdown
process.on('exit', () => closeAll());

module.exports = { getDb, closeDb, closeAll, healthCheck };
```

**Step 2: No runnable test yet** — `getDb` requires a provisioned tenant in master.db. Tested end-to-end in Task 5 after provisioner creates a real tenant.

**Step 3: Commit**

```bash
git add backend/tenant-db-manager.js
git commit -m "feat: tenant-db-manager.js — connection pool for tenant SQLite DBs"
```

---

## Task 5: Build `tenant-provisioner.js`

**Files:**
- Create: `backend/tenant-provisioner.js`

**What it does:** CLI script that creates a fully seeded tenant. Takes `--slug`, `--name`, `--timezone`, `--pin` args. Creates the directory structure, initializes the DB, seeds all required data, registers in master.db, and writes an audit log entry.

**Step 1: Check what permissions look like in the live DB** (needed for seed)

```bash
cd d:/newprojects/oneshoppos/backend
node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./oneshop.db', sqlite3.OPEN_READONLY);
db.all('SELECT DISTINCT permission FROM role_permissions LIMIT 30', [], (e, rows) => {
  console.log(rows.map(r => r.permission));
  db.close();
});
"
```

Note the permission strings — copy them into the `ALL_PERMISSIONS` array in Step 2.

**Step 2: Create the file**

```javascript
// backend/tenant-provisioner.js
// CLI: creates a new tenant with directory, DB, schema, seed data, and master.db entry.
//
// Usage:
//   node backend/tenant-provisioner.js --slug aces-hardware --name "Aces Hardware" --timezone "Asia/Karachi" --pin 1234

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { extractSchema } = require('./schema-full');
const { masterDb, initMasterDb } = require('./master-db');

const TENANTS_DIR = path.join(__dirname, 'tenants');
const SCHEMA_VERSION = 64;

// --- Arg parsing ---
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    slug: get('--slug'),
    name: get('--name'),
    timezone: get('--timezone') || 'UTC',
    pin: get('--pin'),
    ownerEmail: get('--email') || 'admin@example.com',
  };
}

function validateSlug(slug) {
  if (!slug) throw new Error('--slug is required');
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
    throw new Error('--slug must be 3-40 chars, lowercase letters, numbers, and hyphens only');
  }
}

// --- Master DB helpers ---
function slugExists(slug) {
  return new Promise((resolve, reject) => {
    masterDb.get('SELECT id FROM tenants WHERE slug = ?', [slug], (err, row) => {
      if (err) return reject(err);
      resolve(!!row);
    });
  });
}

function insertTenant({ slug, name, ownerEmail, timezone, dbPath }) {
  return new Promise((resolve, reject) => {
    masterDb.run(
      `INSERT INTO tenants (slug, name, owner_email, status, plan, db_path, timezone)
       VALUES (?, ?, ?, 'active', 'free', ?, ?)`,
      [slug, name, ownerEmail, dbPath, timezone],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function insertAuditLog(tenantId, slug, timezone) {
  return new Promise((resolve, reject) => {
    masterDb.run(
      `INSERT INTO tenant_audit_log (tenant_id, action, details, actor)
       VALUES (?, 'created', ?, 'system')`,
      [tenantId, JSON.stringify({ slug, timezone, provisioned_at: new Date().toISOString() })],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// --- Tenant DB helpers ---
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });
}

async function seedTenantDb(db, { name, timezone, pin }) {
  // All permissions — matches the live app's role_permissions table
  const ALL_PERMISSIONS = [
    'pos_access', 'inventory_access', 'reports_access', 'settings_access',
    'employee_management', 'role_management', 'product_management',
    'customer_management', 'supplier_management', 'purchase_orders_access',
    'promotions_access', 'shopify_access', 'attendance_access',
    'approvals_access', 'accounting_access', 'hr_access', 'crm_access',
    'all_access',
  ];

  // 1. Outlet
  const outletId = await dbRun(db,
    `INSERT INTO outlets (name, address) VALUES (?, '')`, [name]
  );

  // 2. Admin role
  const roleId = await dbRun(db,
    `INSERT INTO roles (name, description) VALUES ('Admin', 'Full access admin role')`
  );

  // 3. Role permissions
  for (const perm of ALL_PERMISSIONS) {
    await dbRun(db,
      `INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)`,
      [roleId, perm]
    );
  }

  // 4. Admin employee
  const employeeId = await dbRun(db,
    `INSERT INTO employees (name, pin, role_id, is_active) VALUES ('Admin', ?, ?, 1)`,
    [pin, roleId]
  );

  // 5. Employee-outlet link
  await dbRun(db,
    `INSERT OR IGNORE INTO employee_outlets (employee_id, outlet_id) VALUES (?, ?)`,
    [employeeId, outletId]
  );

  // 6. Company profile
  await dbRun(db,
    `INSERT OR IGNORE INTO company_profile (id, name, timezone) VALUES (1, ?, ?)`,
    [name, timezone]
  );

  // 7. Default tax
  await dbRun(db,
    `INSERT INTO taxes (name, rate) VALUES ('Default Tax', 0)`
  );

  return { outletId, roleId, employeeId };
}

// --- Main ---
async function main() {
  const args = parseArgs();

  // Validate inputs
  validateSlug(args.slug);
  if (!args.name) throw new Error('--name is required');
  if (!args.pin) throw new Error('--pin is required');
  if (!/^\d{4,8}$/.test(args.pin)) throw new Error('--pin must be 4-8 digits');

  await initMasterDb();

  if (await slugExists(args.slug)) {
    throw new Error(`Tenant with slug "${args.slug}" already exists in master.db`);
  }

  const tenantDir = path.join(TENANTS_DIR, `t_${args.slug}`);
  const dbPath = path.join(tenantDir, 'data.db');
  const relDbPath = `tenants/t_${args.slug}/data.db`;

  console.log(`\nProvisioning tenant: ${args.slug}`);
  console.log(`  Name:     ${args.name}`);
  console.log(`  Timezone: ${args.timezone}`);
  console.log(`  Dir:      ${tenantDir}\n`);

  // Step 1: Create directory structure
  console.log('[1/5] Creating directory structure...');
  try {
    for (const subdir of ['uploads/products', 'uploads/company', 'backups', 'exports/reports']) {
      fs.mkdirSync(path.join(tenantDir, subdir), { recursive: true });
    }
  } catch (err) {
    throw new Error(`Directory creation failed: ${err.message}`);
  }

  // Step 2: Initialize tenant DB with full schema
  console.log('[2/5] Initializing tenant database...');
  let tenantDb;
  try {
    const schema = await extractSchema();
    tenantDb = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) return reject(err);
        db.exec(schema, (err) => {
          if (err) return reject(new Error(`Schema exec failed: ${err.message}`));
          resolve(db);
        });
      });
    });
  } catch (err) {
    fs.rmSync(tenantDir, { recursive: true, force: true });
    throw new Error(`DB initialization failed: ${err.message}`);
  }

  // Step 3: Seed data
  console.log('[3/5] Seeding tenant data...');
  let seedResult;
  try {
    seedResult = await seedTenantDb(tenantDb, {
      name: args.name,
      timezone: args.timezone,
      pin: args.pin,
    });
  } catch (err) {
    tenantDb.close();
    fs.rmSync(tenantDir, { recursive: true, force: true });
    throw new Error(`Seed failed: ${err.message}`);
  }

  // Record schema version in tenant DB
  await dbRun(tenantDb,
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER NOT NULL PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`
  );
  await dbRun(tenantDb,
    `INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)`, [SCHEMA_VERSION]
  );
  tenantDb.close();

  // Step 4: Register in master.db
  console.log('[4/5] Registering tenant in master.db...');
  let tenantId;
  try {
    tenantId = await insertTenant({
      slug: args.slug,
      name: args.name,
      ownerEmail: args.ownerEmail,
      timezone: args.timezone,
      dbPath: relDbPath,
    });
  } catch (err) {
    fs.rmSync(tenantDir, { recursive: true, force: true });
    throw new Error(`master.db registration failed: ${err.message}`);
  }

  // Step 5: Audit log
  console.log('[5/5] Writing audit log...');
  await insertAuditLog(tenantId, args.slug, args.timezone);

  masterDb.close();

  console.log('\n✅ Tenant provisioned successfully!');
  console.log(`   tenant_id:   ${tenantId}`);
  console.log(`   slug:        ${args.slug}`);
  console.log(`   db_path:     ${relDbPath}`);
  console.log(`   employee_id: ${seedResult.employeeId} (PIN: ${args.pin})`);
  console.log(`   outlet_id:   ${seedResult.outletId}`);
}

main().catch((err) => {
  console.error('\n❌ Provisioning failed:', err.message);
  process.exit(1);
});
```

**Step 3: Run the provisioner — create a test tenant**

```bash
cd d:/newprojects/oneshoppos
node backend/tenant-provisioner.js --slug test-store --name "Test Store" --timezone "Asia/Karachi" --pin 9999
```

Expected output:
```
Provisioning tenant: test-store
  Name:     Test Store
  Timezone: Asia/Karachi
  Dir:      .../backend/tenants/t_test-store

[1/5] Creating directory structure...
[2/5] Initializing tenant database...
[3/5] Seeding tenant data...
[4/5] Registering tenant in master.db...
[5/5] Writing audit log...

✅ Tenant provisioned successfully!
   tenant_id:   1
   slug:        test-store
   db_path:     tenants/t_test-store/data.db
   employee_id: 1 (PIN: 9999)
   outlet_id:   1
```

**Step 4: Verify the result**

```bash
# Verify directory structure
ls backend/tenants/t_test-store/

# Verify tenant DB table count
cd d:/newprojects/oneshoppos/backend
node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tenants/t_test-store/data.db', sqlite3.OPEN_READONLY);
db.all(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\", [], (e, rows) => {
  console.log('Table count:', rows.length);
  db.close();
});
"

# Verify seed data
node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tenants/t_test-store/data.db', sqlite3.OPEN_READONLY);
db.get('SELECT * FROM employees WHERE id = 1', [], (e, r) => { console.log('Employee:', r); });
db.get('SELECT * FROM outlets WHERE id = 1', [], (e, r) => { console.log('Outlet:', r); });
db.get('SELECT * FROM company_profile WHERE id = 1', [], (e, r) => { console.log('Profile:', r); });
db.get('SELECT version FROM schema_migrations', [], (e, r) => { console.log('Schema version:', r); db.close(); });
"

# Verify master.db
node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./master.db', sqlite3.OPEN_READONLY);
db.all('SELECT * FROM tenants', [], (e, rows) => { console.log('Tenants:', rows); });
db.all('SELECT * FROM tenant_audit_log', [], (e, rows) => { console.log('Audit log:', rows); db.close(); });
"
```

Expected: Table count >= 80, employee with PIN 9999 exists, schema_migrations version = 64, master.db has 1 tenant row + 1 audit log row.

**Step 5: Test tenant-db-manager end-to-end**

```bash
cd d:/newprojects/oneshoppos/backend
node -e "
const { getDb, healthCheck, closeAll } = require('./tenant-db-manager');

async function test() {
  console.log('Testing getDb(1)...');
  const db = await getDb(1);
  console.log('Got db handle:', !!db);

  console.log('Testing healthCheck(1)...');
  const result = await healthCheck(1);
  console.log('Health check:', result);

  await closeAll();
  console.log('Done.');
}

test().catch(console.error);
"
```

Expected:
```
[master-db] Opened master.db at ...
[master-db] Schema initialized.
Testing getDb(1)...
Got db handle: true
Testing healthCheck(1)...
Health check: { ok: true, tenantId: 1 }
Done.
```

**Step 6: Commit**

```bash
git add backend/tenant-provisioner.js
git commit -m "feat: tenant-provisioner.js — CLI to provision new tenants with seed data"
```

---

## Task 6: Write integration tests for Phase 1

**Files:**
- Create: `backend/tests/integration/saas-phase1.test.js`

**What to test:**
1. `extractSchema()` returns a string with 80+ CREATE TABLE statements
2. `initMasterDb()` creates all 4 master tables
3. Provisioner creates tenant directory with all subdirs
4. Provisioned tenant DB has 80+ tables
5. Seed data is correct (employee with given PIN, outlet, company_profile, schema_migrations version)
6. master.db tenant row has correct slug/timezone/status
7. Audit log has a 'created' entry
8. `getDb(tenantId)` returns a live db handle
9. `healthCheck(tenantId)` returns `{ ok: true }`
10. `getDb(999999)` rejects for nonexistent tenant
11. Running provisioner twice with same slug exits with code 1

**Step 1: Create the test file**

Note: Uses `spawnSync` (not `execSync`) to avoid shell injection — provisioner args are static strings.

```javascript
// backend/tests/integration/saas-phase1.test.js
// Integration tests for SaaS Phase 1: schema extraction, master DB, provisioner, db manager.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const sqlite3 = require('sqlite3').verbose();

const BACKEND_DIR = path.join(__dirname, '../..');
const MASTER_DB_PATH = path.join(BACKEND_DIR, 'master.db');

// --- Helpers ---

function dbQuery(dbPath, sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.all(sql, params, (err, rows) => {
      db.close();
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function runProvisioner(args) {
  // args is a plain array of strings — no shell interpolation
  const result = spawnSync('node', [path.join(BACKEND_DIR, 'tenant-provisioner.js'), ...args], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
  });
  return result;
}

// --- Tests ---

describe('schema-full.js', () => {
  test('extractSchema returns a string with 80+ CREATE TABLE statements', async () => {
    const { extractSchema } = require('../../schema-full');
    const sql = await extractSchema();
    expect(typeof sql).toBe('string');
    const tableCount = (sql.match(/CREATE TABLE/gi) || []).length;
    expect(tableCount).toBeGreaterThanOrEqual(80);
  });
});

describe('master-db.js', () => {
  test('initMasterDb creates all 4 master tables', async () => {
    const { masterDb, initMasterDb } = require('../../master-db');
    await initMasterDb();

    const rows = await new Promise((resolve, reject) => {
      masterDb.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        [],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    const tableNames = rows.map((r) => r.name);
    expect(tableNames).toContain('tenants');
    expect(tableNames).toContain('super_admins');
    expect(tableNames).toContain('tenant_audit_log');
    expect(tableNames).toContain('schema_migrations');
  });
});

describe('tenant-provisioner.js', () => {
  const testSlug = `test-prov-${Date.now()}`;
  const tenantDir = path.join(BACKEND_DIR, 'tenants', `t_${testSlug}`);
  const tenantDbPath = path.join(tenantDir, 'data.db');

  beforeAll(() => {
    const result = runProvisioner([
      '--slug', testSlug,
      '--name', 'Test Prov',
      '--timezone', 'UTC',
      '--pin', '1234',
    ]);
    if (result.status !== 0) {
      throw new Error(`Provisioner failed: ${result.stderr}`);
    }
  });

  afterAll(() => {
    if (fs.existsSync(tenantDir)) {
      fs.rmSync(tenantDir, { recursive: true, force: true });
    }
    const db = new sqlite3.Database(MASTER_DB_PATH);
    db.run('DELETE FROM tenant_audit_log WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = ?)', [testSlug]);
    db.run('DELETE FROM tenants WHERE slug = ?', [testSlug], () => db.close());
  });

  test('creates tenant directory with required subdirs', () => {
    expect(fs.existsSync(tenantDir)).toBe(true);
    expect(fs.existsSync(path.join(tenantDir, 'uploads/products'))).toBe(true);
    expect(fs.existsSync(path.join(tenantDir, 'uploads/company'))).toBe(true);
    expect(fs.existsSync(path.join(tenantDir, 'backups'))).toBe(true);
    expect(fs.existsSync(path.join(tenantDir, 'exports/reports'))).toBe(true);
  });

  test('tenant DB has 80+ tables', async () => {
    const rows = await dbQuery(
      tenantDbPath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    expect(rows.length).toBeGreaterThanOrEqual(80);
  });

  test('seed: employee exists with correct PIN', async () => {
    const rows = await dbQuery(tenantDbPath, 'SELECT * FROM employees WHERE pin = ?', ['1234']);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Admin');
  });

  test('seed: outlet exists with correct name', async () => {
    const rows = await dbQuery(tenantDbPath, "SELECT * FROM outlets WHERE name = 'Test Prov'");
    expect(rows.length).toBe(1);
  });

  test('seed: company_profile has correct name and timezone', async () => {
    const rows = await dbQuery(tenantDbPath, 'SELECT * FROM company_profile WHERE id = 1');
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Test Prov');
    expect(rows[0].timezone).toBe('UTC');
  });

  test('seed: schema_migrations version = 64', async () => {
    const rows = await dbQuery(tenantDbPath, 'SELECT version FROM schema_migrations');
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe(64);
  });

  test('master.db: tenant row has correct slug, timezone, and status', async () => {
    const rows = await dbQuery(MASTER_DB_PATH, 'SELECT * FROM tenants WHERE slug = ?', [testSlug]);
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe(testSlug);
    expect(rows[0].timezone).toBe('UTC');
    expect(rows[0].status).toBe('active');
  });

  test('master.db: audit log has created entry', async () => {
    const tenantRows = await dbQuery(MASTER_DB_PATH, 'SELECT id FROM tenants WHERE slug = ?', [testSlug]);
    const tenantId = tenantRows[0].id;
    const logRows = await dbQuery(
      MASTER_DB_PATH,
      "SELECT * FROM tenant_audit_log WHERE tenant_id = ? AND action = 'created'",
      [tenantId]
    );
    expect(logRows.length).toBe(1);
    expect(logRows[0].actor).toBe('system');
  });

  test('fails with exit code 1 when slug already exists', () => {
    const result = runProvisioner([
      '--slug', testSlug,
      '--name', 'Duplicate',
      '--timezone', 'UTC',
      '--pin', '1234',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/already exists/i);
  });
});

describe('tenant-db-manager.js', () => {
  let firstTenantId;

  beforeAll(async () => {
    const rows = await dbQuery(MASTER_DB_PATH, 'SELECT id FROM tenants ORDER BY id LIMIT 1');
    firstTenantId = rows.length > 0 ? rows[0].id : null;
  });

  afterEach(async () => {
    const { closeAll } = require('../../tenant-db-manager');
    await closeAll();
  });

  test('getDb returns a live db handle for provisioned tenant', async () => {
    if (!firstTenantId) return;
    const { getDb } = require('../../tenant-db-manager');
    const db = await getDb(firstTenantId);
    expect(db).toBeTruthy();
  });

  test('healthCheck returns ok for provisioned tenant', async () => {
    if (!firstTenantId) return;
    const { healthCheck } = require('../../tenant-db-manager');
    const result = await healthCheck(firstTenantId);
    expect(result.ok).toBe(true);
  });

  test('getDb rejects for nonexistent tenant id', async () => {
    const { getDb } = require('../../tenant-db-manager');
    await expect(getDb(999999)).rejects.toThrow('not found');
  });
});
```

**Step 2: Run Phase 1 tests**

```bash
cd d:/newprojects/oneshoppos/backend
npx jest tests/integration/saas-phase1.test.js --no-coverage --runInBand
```

Expected: All 11 tests pass.

**Step 3: Run full test suite to confirm nothing broken**

```bash
cd d:/newprojects/oneshoppos/backend
npx jest --testPathPattern="tests/integration" --no-coverage 2>&1 | tail -5
```

Expected: same pass/fail counts as before (257/259), no new failures.

**Step 4: Commit**

```bash
git add backend/tests/integration/saas-phase1.test.js
git commit -m "test: saas-phase1 — schema extraction, master DB, provisioner, db manager"
```

---

## Final Verification

```bash
# Provision a second tenant to confirm it works repeatedly
cd d:/newprojects/oneshoppos
node backend/tenant-provisioner.js --slug demo-shop --name "Demo Shop" --timezone "America/New_York" --pin 5678

# Verify two tenants in master.db
cd backend && node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./master.db', sqlite3.OPEN_READONLY);
db.all('SELECT id, slug, timezone, status FROM tenants', [], (e, rows) => {
  console.log('Tenants:', rows);
  db.close();
});
"

# Confirm original oneshop.db is completely untouched
node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./oneshop.db', sqlite3.OPEN_READONLY);
db.get('SELECT COUNT(*) as c FROM employees', [], (e, r) => {
  console.log('Original DB employees:', r.c, '(unchanged)');
  db.close();
});
"
```

---

## Summary

| Task | Files | Status |
|------|-------|--------|
| 1 | `.gitignore` | 2 lines added |
| 2 | `backend/schema-full.js` | New file |
| 3 | `backend/master-db.js` | New file |
| 4 | `backend/tenant-db-manager.js` | New file |
| 5 | `backend/tenant-provisioner.js` | New file |
| 6 | `backend/tests/integration/saas-phase1.test.js` | New test (11 cases) |

**Zero existing files modified. App continues to run exactly as before.**
