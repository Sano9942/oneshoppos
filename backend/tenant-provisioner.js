// backend/tenant-provisioner.js
// CLI: creates a new tenant with directory, DB, schema, seed data, and master.db entry.
//
// Usage:
//   node backend/tenant-provisioner.js --slug aces-hardware --name "Aces Hardware" --timezone "Asia/Karachi" --pin 1234

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { extractSchema } = require('./schema-full');
const { getMasterDb, closeMasterDb, initMasterDb } = require('./master-db');

const TENANTS_DIR = path.join(__dirname, 'tenants');
const SCHEMA_VERSION = 66;
const BCRYPT_ROUNDS = 10;

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
    getMasterDb().get('SELECT id FROM tenants WHERE slug = ?', [slug], (err, row) => {
      if (err) return reject(err);
      resolve(!!row);
    });
  });
}

/**
 * Inserts tenant row + audit log inside a single transaction.
 * If either fails, the transaction is rolled back — no orphaned rows.
 */
function registerTenantWithAudit({ slug, name, ownerEmail, timezone, dbPath }) {
  const db = getMasterDb();
  return new Promise((resolve, reject) => {
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) return reject(new Error(`BEGIN failed: ${err.message}`));

      db.run(
        `INSERT INTO tenants (slug, name, owner_email, status, plan, db_path, timezone)
         VALUES (?, ?, ?, 'active', 'free', ?, ?)`,
        [slug, name, ownerEmail, dbPath, timezone],
        function (err) {
          if (err) {
            return db.run('ROLLBACK', () => reject(new Error(`Tenant insert failed: ${err.message}`)));
          }
          const tenantId = this.lastID;

          db.run(
            `INSERT INTO tenant_audit_log (tenant_id, action, details, actor)
             VALUES (?, 'created', ?, 'system')`,
            [tenantId, JSON.stringify({ slug, timezone, provisioned_at: new Date().toISOString() })],
            (err) => {
              if (err) {
                return db.run('ROLLBACK', () => reject(new Error(`Audit log failed: ${err.message}`)));
              }
              db.run('COMMIT', (err) => {
                if (err) {
                  return db.run('ROLLBACK', () => reject(new Error(`COMMIT failed: ${err.message}`)));
                }
                resolve(tenantId);
              });
            }
          );
        }
      );
    });
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
  // All permissions -- sourced from the live app's role_permissions table
  const ALL_PERMISSIONS = [
    "all_access",
    "manage_customers",
    "manage_employees",
    "manage_inventory",
    "manage_orders",
    "pos_discount",
    "pos_park",
    "pos_void",
    "view_reports",
    "void_sales"
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

  // 4. Admin employee (with bcrypt-hashed PIN for mt-login)
  // Check if pin_hash column exists (depends on whether sanopos.db has migrate66 applied)
  const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);
  const hasPinHash = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(employees)", (err, cols) => {
      if (err) return reject(err);
      resolve(cols.some((c) => c.name === "pin_hash"));
    });
  });
  const employeeId = hasPinHash
    ? await dbRun(db,
        `INSERT INTO employees (name, pin_code, pin_hash, role_id) VALUES ('Admin', ?, ?, ?)`,
        [pin, pinHash, roleId])
    : await dbRun(db,
        `INSERT INTO employees (name, pin_code, role_id) VALUES ('Admin', ?, ?)`,
        [pin, roleId]);

  // 5. Employee-outlet link
  await dbRun(db,
    `INSERT OR IGNORE INTO employee_outlets (employee_id, outlet_id) VALUES (?, ?)`,
    [employeeId, outletId]
  );

  // 6. Company profile
  await dbRun(db,
    `INSERT OR IGNORE INTO company_profile (id, company_name, timezone) VALUES (1, ?, ?)`,
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
        db.exec(schema, (err2) => {
          if (err2) return reject(new Error(`Schema exec failed: ${err2.message}`));
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

    // Record schema version (inside Step 3 guard — failure triggers same cleanup)
    await dbRun(tenantDb,
      `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER NOT NULL PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`
    );
    await dbRun(tenantDb,
      `INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)`, [SCHEMA_VERSION]
    );
  } catch (err) {
    await new Promise((resolve) => tenantDb.close((e) => {
      if (e) console.error('[provisioner] tenantDb close error:', e.message);
      resolve();
    }));
    fs.rmSync(tenantDir, { recursive: true, force: true });
    throw new Error(`Seed failed: ${err.message}`);
  }

  await new Promise((resolve) => tenantDb.close((e) => {
    if (e) console.error('[provisioner] tenantDb close error:', e.message);
    resolve();
  }));

  // Step 4: Register in master.db + audit log (single transaction)
  console.log('[4/5] Registering tenant in master.db...');
  let tenantId;
  try {
    tenantId = await registerTenantWithAudit({
      slug: args.slug,
      name: args.name,
      ownerEmail: args.ownerEmail,
      timezone: args.timezone,
      dbPath: relDbPath,
    });
  } catch (err) {
    fs.rmSync(tenantDir, { recursive: true, force: true });
    await closeMasterDb();
    throw new Error(`master.db registration failed: ${err.message}`);
  }

  console.log('[5/5] Audit log written.');
  await closeMasterDb();

  console.log('\n\u2705 Tenant provisioned successfully!');
  console.log(`   tenant_id:   ${tenantId}`);
  console.log(`   slug:        ${args.slug}`);
  console.log(`   db_path:     ${relDbPath}`);
  console.log(`   employee_id: ${seedResult.employeeId} (PIN: ${args.pin})`);
  console.log(`   outlet_id:   ${seedResult.outletId}`);
}

main().catch((err) => {
  console.error('\n\u274C Provisioning failed:', err.message);
  process.exit(1);
});
