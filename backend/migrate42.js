const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 42: Shopify connector settings");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS shopify_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      api_version TEXT DEFAULT '2025-10',
      webhook_secret TEXT,
      default_location_id TEXT,
      is_active INTEGER DEFAULT 1,
      last_sync_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
  );

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_shopify_connections_active ON shopify_connections(is_active)",
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS shopify_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      run_type TEXT NOT NULL,
      started_at TEXT DEFAULT (datetime('now','localtime')),
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      processed_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      notes TEXT
    )`,
    (err) => {
      if (err) {
        console.error("Migration 42 error:", err.message);
      } else {
        console.log("Migration 42 complete.");
      }
      db.close();
    },
  );
});
