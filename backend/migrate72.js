// migrate72.js — Add setup_complete + setup_token to company_profile
// setup_complete = 0 means first-run setup wizard is required.
// For existing deployments with employees, default to 1 (already configured).
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error("Failed to open DB:", err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(
    `ALTER TABLE company_profile ADD COLUMN setup_complete INTEGER DEFAULT 0`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("[migrate72] ALTER setup_complete error:", err.message);
      } else {
        console.log("[migrate72] setup_complete column ready.");
      }
    }
  );

  db.run(
    `ALTER TABLE company_profile ADD COLUMN setup_token TEXT`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("[migrate72] ALTER setup_token error:", err.message);
      } else {
        console.log("[migrate72] setup_token column ready.");
      }
    }
  );

  // Mark existing deployments as already set up (employees exist → skip wizard)
  db.run(
    `UPDATE company_profile SET setup_complete = 1
     WHERE id = 1 AND (SELECT COUNT(*) FROM employees) > 0`,
    function (err) {
      if (err) {
        console.error("[migrate72] UPDATE setup_complete error:", err.message);
      } else {
        console.log(`[migrate72] Done — setup_complete set for ${this.changes} existing deployment(s).`);
      }
      db.close((closeErr) => {
        if (closeErr) console.error("[migrate72] Close error:", closeErr.message);
      });
    }
  );
});
