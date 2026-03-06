// backend/master-db.js
// Opens master.db (the tenant registry) lazily on first use and initializes its schema.
// Exports: getMasterDb() — returns the open sqlite3.Database handle (opens on first call).

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const MASTER_DB_PATH = path.join(__dirname, 'master.db');

let _db = null;

/**
 * Returns the master.db handle, opening it lazily on first call.
 * Subsequent calls return the same cached handle.
 */
function getMasterDb() {
  if (_db) return _db;
  _db = new sqlite3.Database(MASTER_DB_PATH, (err) => {
    if (err) {
      _db = null;
      console.error('[master-db] Failed to open master.db:', err.message);
      process.exit(1);
    }
    console.log('[master-db] Opened master.db at', MASTER_DB_PATH);
  });
  return _db;
}

/**
 * Closes the master.db handle if open. Returns a Promise.
 */
function closeMasterDb() {
  return new Promise((resolve) => {
    if (!_db) return resolve();
    _db.close((err) => {
      if (err) console.error('[master-db] close error:', err.message);
      _db = null;
      resolve();
    });
  });
}

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

CREATE TABLE IF NOT EXISTS tenant_refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  employee_id INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
`;

// Initialize schema — runs once on first open, idempotent thereafter.
function initMasterDb() {
  const db = getMasterDb();
  return new Promise((resolve, reject) => {
    db.exec(MASTER_SCHEMA, (err) => {
      if (err) return reject(new Error(`[master-db] Schema init failed: ${err.message}`));
      console.log('[master-db] Schema initialized.');
      resolve();
    });
  });
}

module.exports = { getMasterDb, closeMasterDb, initMasterDb, MASTER_DB_PATH };
