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
