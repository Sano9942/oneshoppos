const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 47: Add barcode to product_variants");

function runSafe(sql, okMessage) {
  db.run(sql, (err) => {
    if (
      err &&
      (String(err.message || "").includes("duplicate column") ||
        String(err.message || "").includes("duplicate column name"))
    ) {
      // Ignored
    } else if (err) {
      console.error("Migration 47 error:", err.message);
    } else if (okMessage) {
      console.log(okMessage);
    }
  });
}

db.serialize(() => {
  runSafe(
    "ALTER TABLE product_variants ADD COLUMN barcode TEXT",
    "product_variants.barcode ready",
  );

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON product_variants(barcode)",
    (err) => {
      if (err) {
        console.error("Migration 47 error:", err.message);
      } else {
        console.log("Migration 47 complete.");
      }
      db.close();
    },
  );
});
