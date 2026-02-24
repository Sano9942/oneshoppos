const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 36: shift denomination capture + variance reason codes");

db.serialize(() => {
  // Store denomination counts for each closed shift
  db.run(
    `CREATE TABLE IF NOT EXISTS shift_denominations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
      denomination REAL NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      subtotal REAL GENERATED ALWAYS AS (denomination * count) STORED
    )`,
    (err) => {
      if (err) console.error("Error creating shift_denominations:", err.message);
      else console.log("shift_denominations table ready.");
    }
  );

  // Add variance_reason and variance_approved_by columns to cash_shifts
  db.run("ALTER TABLE cash_shifts ADD COLUMN variance_reason TEXT", (err) => {
    if (err && !err.message.includes("duplicate")) console.error("variance_reason:", err.message);
    else console.log("variance_reason column ready.");
  });

  db.run("ALTER TABLE cash_shifts ADD COLUMN variance_approved_by TEXT", (err) => {
    if (err && !err.message.includes("duplicate")) console.error("variance_approved_by:", err.message);
    else console.log("variance_approved_by column ready.");
  });

  setTimeout(() => {
    db.close(() => console.log("Migration 36 complete."));
  }, 500);
});
