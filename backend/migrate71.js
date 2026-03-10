// migrate71.js — Add idempotency_key to sales table to prevent duplicate sales from network retries
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error("Failed to open DB:", err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(
    `ALTER TABLE sales ADD COLUMN idempotency_key TEXT`,
    function (err) {
      if (err && !err.message.includes("duplicate column")) {
        console.error("[migrate71] Error adding column:", err.message);
        return db.close((closeErr) => {
          if (closeErr) console.error("[migrate71] Close error:", closeErr.message);
        });
      }
      if (err) {
        console.log("[migrate71] Column already exists — skipping ALTER.");
      } else {
        console.log("[migrate71] Added idempotency_key column to sales.");
      }

      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key ON sales(idempotency_key) WHERE idempotency_key IS NOT NULL`,
        function (idxErr) {
          if (idxErr) {
            console.error("[migrate71] Error creating index:", idxErr.message);
          } else {
            console.log("[migrate71] Done — unique index on sales.idempotency_key created.");
          }
          db.close((closeErr) => {
            if (closeErr) console.error("[migrate71] Close error:", closeErr.message);
          });
        }
      );
    }
  );
});
