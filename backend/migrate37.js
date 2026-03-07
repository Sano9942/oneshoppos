const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 37: backup_log + invoice_sequences + invoice_number on sales");

db.serialize(() => {
  // Track backup/restore events
  db.run(
    `CREATE TABLE IF NOT EXISTS backup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,        -- 'backup' | 'restore'
      filename TEXT,
      size_bytes INTEGER,
      performed_by TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating backup_log:", err.message);
      else console.log("backup_log table ready.");
    }
  );

  // One row per year — holds the last used sequence counter
  db.run(
    `CREATE TABLE IF NOT EXISTS invoice_sequences (
      year INTEGER PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    )`,
    (err) => {
      if (err) console.error("Error creating invoice_sequences:", err.message);
      else console.log("invoice_sequences table ready.");
    }
  );

  // Add invoice_number column to sales
  db.run("ALTER TABLE sales ADD COLUMN invoice_number TEXT", (err) => {
    if (err && !err.message.includes("duplicate")) console.error("invoice_number:", err.message);
    else console.log("sales.invoice_number column ready.");
  });

  // Index for fast lookup
  db.run("CREATE INDEX IF NOT EXISTS idx_sales_invoice_number ON sales(invoice_number)", (err) => {
    if (err) console.error("idx_sales_invoice_number:", err.message);
    else console.log("idx_sales_invoice_number ready.");
  });

  setTimeout(() => {
    db.close(() => console.log("Migration 37 complete."));
  }, 500);
});
