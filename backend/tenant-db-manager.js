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

        db.run('PRAGMA foreign_keys = ON', (err) => {
          if (err) return reject(new Error(`Cannot set foreign_keys pragma: ${err.message}`));
          db.run('PRAGMA journal_mode = WAL', (err) => {
            if (err) return reject(new Error(`Cannot set WAL mode: ${err.message}`));
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

// Synchronous best-effort close on hard exit
process.on('exit', () => {
  for (const [, db] of pool) {
    try { db.close(); } catch (_) {}
  }
});

// Graceful async shutdown on signals
async function shutdown() {
  await closeAll();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { getDb, closeDb, closeAll, healthCheck };
