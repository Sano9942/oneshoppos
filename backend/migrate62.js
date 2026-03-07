/**
 * migrate62.js — Supplier credit terms
 *
 * Adds three columns to suppliers:
 *   payment_terms   TEXT  — 'cash' | 'credit' (default 'cash')
 *   credit_days     INT   — number of days before invoice is due (0, 30, 45, 60, 90...)
 *   credit_limit    REAL  — maximum outstanding amount allowed (0 = no limit)
 *
 * Also adds running_balance view helper: supplier_balance (virtual, computed per query).
 */
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const DB_PATH = path.join(__dirname, "sanopos.db");
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  // Add payment_terms — 'cash' or 'credit'
  db.run(
    `ALTER TABLE suppliers ADD COLUMN payment_terms TEXT NOT NULL DEFAULT 'cash'`,
    (err) => {
      if (err && !err.message.includes("duplicate column"))
        console.error("migrate62 payment_terms:", err.message);
      else console.log("migrate62: payment_terms added to suppliers");
    },
  );

  // Add credit_days — how many days until payment is due
  db.run(
    `ALTER TABLE suppliers ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0`,
    (err) => {
      if (err && !err.message.includes("duplicate column"))
        console.error("migrate62 credit_days:", err.message);
      else console.log("migrate62: credit_days added to suppliers");
    },
  );

  // Add credit_limit — max outstanding (0 = unlimited)
  db.run(
    `ALTER TABLE suppliers ADD COLUMN credit_limit REAL NOT NULL DEFAULT 0`,
    (err) => {
      if (err && !err.message.includes("duplicate column"))
        console.error("migrate62 credit_limit:", err.message);
      else console.log("migrate62: credit_limit added to suppliers");
    },
  );

  console.log("migrate62: supplier credit terms — done");
});

setTimeout(() => db.close(), 500);
