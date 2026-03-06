/**
 * backend/tenant-migrate.js — Multi-tenant migration runner.
 *
 * Reads migration files from backend/migrations/, checks each tenant's
 * schema_migrations table, and applies unapplied migrations in order.
 *
 * CLI usage:
 *   node backend/tenant-migrate.js                    # migrate all active tenants
 *   node backend/tenant-migrate.js --tenant demo-shop # migrate one tenant
 *   node backend/tenant-migrate.js --dry-run          # show what would run
 *
 * Programmatic usage (from admin routes):
 *   const { runMigrationsOnTenant } = require("./tenant-migrate");
 *   const result = await runMigrationsOnTenant(tenantRow);
 */
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// ── Helpers ───────────────────────────────────────────────────────────────

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.run("PRAGMA foreign_keys = ON", (err) => {
        if (err) return reject(err);
        db.run("PRAGMA journal_mode = WAL", (err) => {
          if (err) return reject(err);
          resolve(db);
        });
      });
    });
  });
}

function closeDb(db) {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) console.error("[tenant-migrate] close error:", err.message);
      resolve();
    });
  });
}

// ── Load migration files ──────────────────────────────────────────────────

function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".js"))
    .map((f) => {
      const mod = require(path.join(MIGRATIONS_DIR, f));
      if (!mod.version || !mod.up) {
        console.warn(`[tenant-migrate] Skipping ${f}: missing version or up()`);
        return null;
      }
      return { file: f, version: mod.version, description: mod.description || f, up: mod.up };
    })
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

// ── Run migrations on a single tenant ─────────────────────────────────────

/**
 * @param {{ id: number, slug: string, db_path: string }} tenant — row from master.db tenants table
 * @param {{ dryRun?: boolean }} options
 * @returns {{ applied: number[], skipped: number[], errors: string[] }}
 */
async function runMigrationsOnTenant(tenant, options = {}) {
  const migrations = loadMigrations();
  if (migrations.length === 0) {
    return { applied: [], skipped: [], errors: [], message: "No migration files found" };
  }

  const dbPath = path.join(__dirname, tenant.db_path);
  if (!fs.existsSync(dbPath)) {
    return { applied: [], skipped: [], errors: [`DB file not found: ${tenant.db_path}`] };
  }

  const db = await openDb(dbPath);
  const applied = [];
  const skipped = [];
  const errors = [];

  try {
    // Ensure schema_migrations table exists
    await dbRun(db,
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER NOT NULL PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))"
    );

    // Get already-applied versions
    const rows = await dbAll(db, "SELECT version FROM schema_migrations");
    const appliedSet = new Set(rows.map((r) => r.version));

    for (const migration of migrations) {
      if (appliedSet.has(migration.version)) {
        skipped.push(migration.version);
        continue;
      }

      if (options.dryRun) {
        applied.push(migration.version);
        continue;
      }

      try {
        await dbRun(db, "BEGIN TRANSACTION");
        await migration.up(db, { run: dbRun.bind(null, db), all: dbAll.bind(null, db), get: dbGet.bind(null, db) });
        await dbRun(db, "INSERT INTO schema_migrations (version) VALUES (?)", [migration.version]);
        await dbRun(db, "COMMIT");
        applied.push(migration.version);
        console.log(`  [${tenant.slug}] Applied v${migration.version}: ${migration.description}`);
      } catch (err) {
        try { await dbRun(db, "ROLLBACK"); } catch {}
        const msg = `v${migration.version} failed: ${err.message}`;
        errors.push(msg);
        console.error(`  [${tenant.slug}] ${msg}`);
        break; // Stop on first failure for this tenant
      }
    }
  } finally {
    await closeDb(db);
  }

  return { applied, skipped, errors };
}

// ── CLI entry point ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const tenantSlug = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : null;
  const dryRun = args.includes("--dry-run");

  const { getMasterDb, initMasterDb, closeMasterDb } = require("./master-db");
  await initMasterDb();

  const masterDb = getMasterDb();

  const tenants = await new Promise((resolve, reject) => {
    const sql = tenantSlug
      ? "SELECT id, slug, db_path FROM tenants WHERE slug = ? AND status = 'active'"
      : "SELECT id, slug, db_path FROM tenants WHERE status = 'active'";
    const params = tenantSlug ? [tenantSlug] : [];
    masterDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

  if (tenants.length === 0) {
    console.log(tenantSlug ? `No active tenant found with slug "${tenantSlug}"` : "No active tenants found");
    await closeMasterDb();
    return;
  }

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Migrating ${tenants.length} tenant(s)...\n`);

  for (const tenant of tenants) {
    console.log(`Tenant: ${tenant.slug}`);
    const result = await runMigrationsOnTenant(tenant, { dryRun });

    if (result.applied.length === 0 && result.errors.length === 0) {
      console.log("  Already up to date.\n");
    } else {
      if (result.applied.length > 0) {
        console.log(`  ${dryRun ? "Would apply" : "Applied"}: ${result.applied.join(", ")}`);
      }
      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.join("; ")}`);
      }
      console.log();
    }
  }

  await closeMasterDb();
  console.log("Done.");
}

// Export for programmatic use AND run as CLI
module.exports = { runMigrationsOnTenant, loadMigrations };

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
}
