const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 45: Reconciliation resolution fields");

function runSafe(sql, okMessage) {
  db.run(sql, (err) => {
    if (err && !String(err.message || "").includes("duplicate column")) {
      console.error("Migration 45 error:", err.message);
    } else if (okMessage) {
      console.log(okMessage);
    }
  });
}

db.serialize(() => {
  runSafe(
    "ALTER TABLE inventory_reconciliation ADD COLUMN resolution_status TEXT DEFAULT 'open'",
    "inventory_reconciliation.resolution_status ready",
  );
  runSafe(
    "ALTER TABLE inventory_reconciliation ADD COLUMN resolution_note TEXT",
    "inventory_reconciliation.resolution_note ready",
  );
  runSafe(
    "ALTER TABLE inventory_reconciliation ADD COLUMN resolved_by INTEGER",
    "inventory_reconciliation.resolved_by ready",
  );
  runSafe(
    "ALTER TABLE inventory_reconciliation ADD COLUMN resolved_at TEXT",
    "inventory_reconciliation.resolved_at ready",
  );

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_inventory_reconciliation_status ON inventory_reconciliation(status, resolution_status)",
    (err) => {
      if (err) {
        console.error("Migration 45 error:", err.message);
      } else {
        console.log("Migration 45 complete.");
      }
      db.close();
    },
  );
});
