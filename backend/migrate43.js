const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 43: Shopify sync retry metadata");

function runSafe(sql, okMessage) {
  db.run(sql, (err) => {
    if (err && !String(err.message || "").includes("duplicate column")) {
      console.error("Migration 43 error:", err.message);
    } else if (okMessage) {
      console.log(okMessage);
    }
  });
}

db.serialize(() => {
  runSafe(
    "ALTER TABLE external_sync_events ADD COLUMN attempt_count INTEGER DEFAULT 0",
    "external_sync_events.attempt_count ready",
  );
  runSafe(
    "ALTER TABLE external_sync_events ADD COLUMN next_retry_at TEXT",
    "external_sync_events.next_retry_at ready",
  );
  runSafe(
    "ALTER TABLE external_sync_events ADD COLUMN last_attempt_at TEXT",
    "external_sync_events.last_attempt_at ready",
  );

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_external_sync_events_retry ON external_sync_events(status, next_retry_at)",
    (err) => {
      if (err) {
        console.error("Migration 43 error:", err.message);
      } else {
        console.log("Migration 43 complete.");
      }
      db.close();
    },
  );
});
