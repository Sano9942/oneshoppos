const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 31: customer_wallet_ledger table");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS customer_wallet_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      type TEXT NOT NULL CHECK(type IN ('credit','debit')),
      amount REAL NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating customer_wallet_ledger:", err.message);
      else console.log("customer_wallet_ledger table ready.");
    }
  );

  setTimeout(() => {
    db.close(() => console.log("Migration 31 complete."));
  }, 500);
});
