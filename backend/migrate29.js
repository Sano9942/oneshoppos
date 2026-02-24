const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 29: approval workflow tables + transfer status column");

db.serialize(() => {
  // Add status column to inventory_transfers (for approval workflow)
  db.run(
    `ALTER TABLE inventory_transfers ADD COLUMN status TEXT DEFAULT 'completed'`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("Error adding status to inventory_transfers:", err.message);
      } else {
        console.log("status column added/verified on inventory_transfers.");
      }
    }
  );

  // Add note column to inventory_transfers if not present
  db.run(
    `ALTER TABLE inventory_transfers ADD COLUMN note TEXT`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("Error adding note to inventory_transfers:", err.message);
      }
    }
  );

  // Approval requests table
  db.run(
    `CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_type TEXT NOT NULL,
      reference_id INTEGER NOT NULL,
      reference_type TEXT NOT NULL,
      requested_by TEXT,
      status TEXT DEFAULT 'pending_approval',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating approval_requests:", err.message);
      else console.log("approval_requests table ready.");
    }
  );

  // Approval actions (audit trail per decision)
  db.run(
    `CREATE TABLE IF NOT EXISTS approval_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_request_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      action_by TEXT,
      reason TEXT,
      actioned_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating approval_actions:", err.message);
      else console.log("approval_actions table ready.");
    }
  );

  setTimeout(() => {
    db.close(() => console.log("Migration 29 complete."));
  }, 500);
});
