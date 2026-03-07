// migrate69.js — Add dashboard target/threshold columns to company_profile and outlets
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error("Failed to open DB:", err.message); process.exit(1); }
});

db.serialize(() => {
  const columns = [
    "ALTER TABLE company_profile ADD COLUMN monthly_sales_target REAL DEFAULT 0",
    "ALTER TABLE company_profile ADD COLUMN margin_threshold_pct REAL DEFAULT 20",
    "ALTER TABLE company_profile ADD COLUMN refund_threshold_pct REAL DEFAULT 5",
    "ALTER TABLE company_profile ADD COLUMN void_threshold_pct REAL DEFAULT 3",
    "ALTER TABLE outlets ADD COLUMN monthly_sales_target REAL DEFAULT 0",
  ];

  let done = 0;
  columns.forEach((sql) => {
    db.run(sql, (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("[migrate69] Error:", err.message);
      } else {
        console.log("[migrate69] OK:", sql.split(" ADD COLUMN ")[1]);
      }
      done++;
      if (done === columns.length) {
        console.log("[migrate69] Done — dashboard targets schema added.");
        db.close((err) => {
          if (err) console.error("[migrate69] Close error:", err.message);
        });
      }
    });
  });
});
