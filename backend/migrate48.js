const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 48: Add sku to products table");

function runSafe(sql, okMessage) {
  db.run(sql, (err) => {
    if (
      err &&
      (String(err.message || "").includes("duplicate column") ||
        String(err.message || "").includes("duplicate column name"))
    ) {
      // Ignored
    } else if (err) {
      console.error("Migration 48 error:", err.message);
    } else if (okMessage) {
      console.log(okMessage);
    }
  });
}

db.serialize(() => {
  runSafe("ALTER TABLE products ADD COLUMN sku TEXT", "products.sku ready");

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)",
    (err) => {
      if (err) {
        console.error("Migration 48 error:", err.message);
      } else {
        console.log("Migration 48 complete.");
      }
      db.close();
    },
  );
});
