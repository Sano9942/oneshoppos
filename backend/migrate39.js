const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 39: feature flags");

const FLAGS = [
  ["backup_restore", 1, "Enable backup and restore endpoints"],
  ["e_invoicing_export", 1, "Enable sales invoice export endpoint"],
  ["supplier_payables", 1, "Enable supplier payables flows"],
  ["approvals", 1, "Enable approvals workflow endpoints"],
];

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("feature_flags table:", err.message);
      else console.log("feature_flags table ready.");
    }
  );

  const stmt = db.prepare(
    `INSERT INTO feature_flags (key, enabled, description)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       description = excluded.description`
  );
  FLAGS.forEach((row) => stmt.run(row));
  stmt.finalize();

  setTimeout(() => {
    db.close(() => console.log("Migration 39 complete."));
  }, 300);
});
