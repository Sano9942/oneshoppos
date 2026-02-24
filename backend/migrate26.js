const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migrate26.js — Phase 1 column additions...");

const migrations = [
  // Products: reorder levels + unit of measure
  "ALTER TABLE products ADD COLUMN min_qty INTEGER DEFAULT 0",
  "ALTER TABLE products ADD COLUMN max_qty INTEGER DEFAULT 0",
  "ALTER TABLE products ADD COLUMN unit TEXT DEFAULT 'pcs'",

  // Purchase Orders: due date
  "ALTER TABLE purchase_orders ADD COLUMN due_date TEXT",

  // Customers: CNIC, occupation, credit balance
  "ALTER TABLE customers ADD COLUMN cnic TEXT",
  "ALTER TABLE customers ADD COLUMN occupation TEXT",
  "ALTER TABLE customers ADD COLUMN balance REAL DEFAULT 0",

  // Sales: order notes + loyalty points tracking
  "ALTER TABLE sales ADD COLUMN notes TEXT",
  "ALTER TABLE sales ADD COLUMN points_earned INTEGER DEFAULT 0",
  "ALTER TABLE sales ADD COLUMN points_redeemed INTEGER DEFAULT 0",
];

db.serialize(() => {
  let pending = migrations.length;
  migrations.forEach((sql) => {
    db.run(sql, (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error(`  ❌ Failed: ${sql}\n     ${err.message}`);
      } else if (!err) {
        console.log(`  ✅ Added: ${sql.split("ADD COLUMN")[1]?.trim()}`);
      } else {
        console.log(
          `  ⚠️  Already exists (skipped): ${sql.split("ADD COLUMN")[1]?.trim()}`,
        );
      }
      if (--pending === 0) {
        db.close(() => console.log("migrate26.js complete."));
      }
    });
  });
});
