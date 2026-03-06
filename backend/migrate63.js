/**
 * migrate63.js — Add shift_id to sales and returns
 *
 * Problem: sales and returns have no direct link to the shift they occurred in.
 * Shift-linked reports rely on time-window matching (outlet_id + timestamp range),
 * which breaks for open shifts, boundary sales, and overlapping windows.
 *
 * Fix: add a nullable shift_id FK to both tables. Backfill historical rows using
 * the same time-window logic. New sales/returns will have shift_id written at
 * creation time (see routes/sales.js and routes/returns.js).
 */

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const DB_PATH = path.join(__dirname, "oneshop.db");

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  // 1. Add shift_id to sales (nullable — historical rows will be backfilled)
  db.run(
    "ALTER TABLE sales ADD COLUMN shift_id INTEGER REFERENCES cash_shifts(id)",
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("migrate63: sales.shift_id:", err.message);
      } else {
        console.log("migrate63: sales.shift_id column ready.");
      }
    },
  );

  // 2. Add shift_id to returns (nullable — historical rows will be backfilled)
  db.run(
    "ALTER TABLE returns ADD COLUMN shift_id INTEGER REFERENCES cash_shifts(id)",
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("migrate63: returns.shift_id:", err.message);
      } else {
        console.log("migrate63: returns.shift_id column ready.");
      }
    },
  );

  // 3. Backfill sales — match each unlinked sale to the most recent shift whose
  //    window contains the sale timestamp at the same outlet.
  db.run(
    `UPDATE sales
     SET shift_id = (
       SELECT cs.id
       FROM cash_shifts cs
       WHERE cs.outlet_id = sales.outlet_id
         AND sales.timestamp >= cs.opened_at
         AND sales.timestamp <= COALESCE(cs.closed_at, datetime('now'))
       ORDER BY cs.opened_at DESC
       LIMIT 1
     )
     WHERE shift_id IS NULL`,
    (err) => {
      if (err) console.error("migrate63: sales backfill:", err.message);
      else console.log("migrate63: sales shift_id backfill done.");
    },
  );

  // 4. Backfill returns — same logic
  db.run(
    `UPDATE returns
     SET shift_id = (
       SELECT cs.id
       FROM cash_shifts cs
       WHERE cs.outlet_id = returns.outlet_id
         AND returns.timestamp >= cs.opened_at
         AND returns.timestamp <= COALESCE(cs.closed_at, datetime('now'))
       ORDER BY cs.opened_at DESC
       LIMIT 1
     )
     WHERE shift_id IS NULL`,
    (err) => {
      if (err) console.error("migrate63: returns backfill:", err.message);
      else console.log("migrate63: returns shift_id backfill done.");
    },
  );

  // 5. Indexes for fast shift-based lookups
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_sales_shift_id ON sales(shift_id)",
    (err) => { if (err) console.error("migrate63: sales index:", err.message); },
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_returns_shift_id ON returns(shift_id)",
    (err) => { if (err) console.error("migrate63: returns index:", err.message); },
  );
});

db.close((err) => {
  if (err) console.error("migrate63: close error:", err.message);
  else console.log("migrate63: complete.");
});
