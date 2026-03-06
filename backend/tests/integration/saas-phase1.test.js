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
      db.close((closeErr) => {
        if (closeErr) console.error('dbQuery close error:', closeErr.message);
      });
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function runProvisioner(args) {
  return spawnSync('node', [path.join(BACKEND_DIR, 'tenant-provisioner.js'), ...args], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
  });
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
    const { getMasterDb, initMasterDb } = require('../../master-db');
    await initMasterDb();

    const rows = await new Promise((resolve, reject) => {
      getMasterDb().all(
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
  // Use a unique slug per test run to avoid conflicts with existing tenants
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
      throw new Error(`Provisioner failed in beforeAll: ${result.stderr}`);
    }
  });

  afterAll(() => {
    if (fs.existsSync(tenantDir)) {
      fs.rmSync(tenantDir, { recursive: true, force: true });
    }
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(MASTER_DB_PATH);
      db.run(
        'DELETE FROM tenant_audit_log WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = ?)',
        [testSlug],
        (err) => {
          if (err) return reject(err);
          db.run('DELETE FROM tenants WHERE slug = ?', [testSlug], (err2) => {
            if (err2) return reject(err2);
            db.close((e) => {
              if (e) console.error('afterAll close error:', e.message);
              resolve();
            });
          });
        }
      );
    });
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

  test('seed: employee exists with correct PIN (pin_code column)', async () => {
    const rows = await dbQuery(tenantDbPath, 'SELECT * FROM employees WHERE pin_code = ?', ['1234']);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Admin');
  });

  test('seed: outlet exists with correct name', async () => {
    const rows = await dbQuery(tenantDbPath, 'SELECT * FROM outlets WHERE name = ?', ['Test Prov']);
    expect(rows.length).toBe(1);
  });

  test('seed: company_profile has correct company_name and timezone', async () => {
    const rows = await dbQuery(tenantDbPath, 'SELECT * FROM company_profile WHERE id = 1');
    expect(rows.length).toBe(1);
    expect(rows[0].company_name).toBe('Test Prov');
    expect(rows[0].timezone).toBe('UTC');
  });

  test('seed: schema_migrations version = 65', async () => {
    const rows = await dbQuery(tenantDbPath, 'SELECT version FROM schema_migrations');
    expect(rows.length).toBe(1);
    expect(rows[0].version).toBe(65);
  });

  test('master.db: tenant row has correct slug, timezone, and status', async () => {
    const rows = await dbQuery(MASTER_DB_PATH, 'SELECT * FROM tenants WHERE slug = ?', [testSlug]);
    expect(rows.length).toBe(1);
    expect(rows[0].slug).toBe(testSlug);
    expect(rows[0].timezone).toBe('UTC');
    expect(rows[0].status).toBe('active');
  });

  test('master.db: audit log has created entry for this tenant', async () => {
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
    const rows = await dbQuery(MASTER_DB_PATH, 'SELECT id FROM tenants WHERE status = ? ORDER BY id LIMIT 1', ['active']);
    firstTenantId = rows.length > 0 ? rows[0].id : null;
  });

  afterEach(async () => {
    const { closeAll } = require('../../tenant-db-manager');
    await closeAll();
  });

  test('getDb returns a live db handle for provisioned tenant', async () => {
    if (!firstTenantId) throw new Error('No active tenants in master.db — cannot test getDb');
    const { getDb, closeAll } = require('../../tenant-db-manager');
    const db = await getDb(firstTenantId);
    expect(db).toBeTruthy();
    await closeAll();
  });

  test('healthCheck returns ok for provisioned tenant', async () => {
    if (!firstTenantId) throw new Error('No active tenants in master.db — cannot test healthCheck');
    const { healthCheck, closeAll } = require('../../tenant-db-manager');
    const result = await healthCheck(firstTenantId);
    expect(result.ok).toBe(true);
    expect(result.tenantId).toBe(firstTenantId);
    await closeAll();
  });

  test('getDb rejects for nonexistent tenant id', async () => {
    const { getDb, closeAll } = require('../../tenant-db-manager');
    await expect(getDb(999999)).rejects.toThrow(/not found/i);
    await closeAll();
  });
});
