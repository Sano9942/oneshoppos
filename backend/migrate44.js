const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 44: Web order stock policy state");

function runSafe(sql, okMessage) {
  db.run(sql, (err) => {
    if (err && !String(err.message || "").includes("duplicate column")) {
      console.error("Migration 44 error:", err.message);
    } else if (okMessage) {
      console.log(okMessage);
    }
  });
}

db.serialize(() => {
  runSafe(
    "ALTER TABLE web_orders ADD COLUMN stock_applied INTEGER DEFAULT 0",
    "web_orders.stock_applied ready",
  );
  runSafe(
    "ALTER TABLE web_orders ADD COLUMN stock_applied_at TEXT",
    "web_orders.stock_applied_at ready",
  );
  runSafe(
    "ALTER TABLE web_orders ADD COLUMN stock_policy_note TEXT",
    "web_orders.stock_policy_note ready",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_web_orders_stock_applied ON web_orders(stock_applied)",
    (err) => {
      if (err) {
        console.error("Migration 44 error:", err.message);
      } else {
        console.log("Migration 44 complete.");
      }
      db.close();
    },
  );
});
