const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("--- Checking shopify_sync_runs ---");
db.all(
  "SELECT * FROM shopify_sync_runs WHERE direction = 'inbound' ORDER BY started_at DESC LIMIT 5;",
  [],
  (err, rows) => {
    if (err) {
      console.error(err);
    } else {
      console.log(JSON.stringify(rows, null, 2));
    }

    console.log("\n--- Checking external_sync_events (Inbound) ---");
    db.all(
      "SELECT id, entity_type, idempotency_key, status, error_message, created_at FROM external_sync_events WHERE direction = 'inbound' ORDER BY created_at DESC LIMIT 5;",
      [],
      (err2, rows2) => {
        if (err2) {
          console.error(err2);
        } else {
          console.log(JSON.stringify(rows2, null, 2));
        }

        console.log("\n--- Checking external_sync_events (Outbound) ---");
        db.all(
          "SELECT id, entity_type, status, error_message, created_at FROM external_sync_events WHERE direction = 'outbound' ORDER BY created_at DESC LIMIT 5;",
          [],
          (err3, rows3) => {
            if (err3) {
              console.error(err3);
            } else {
              console.log(JSON.stringify(rows3, null, 2));
            }
            db.close();
          },
        );
      },
    );
  },
);
