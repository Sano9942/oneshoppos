const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
    return;
  }
  console.log("Connected to the SQLite database.");

  db.serialize(() => {
    // Add supplier_id to products if it doesn't exist
    db.all("PRAGMA table_info(products)", (err, rows) => {
      if (err) {
        console.error("Error checking products table schema:", err.message);
        return;
      }

      const hasSupplierId = rows.some((r) => r.name === "supplier_id");
      if (!hasSupplierId) {
        db.run(
          "ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)",
          (err) => {
            if (err)
              console.error(
                "Error adding supplier_id to products:",
                err.message,
              );
            else console.log("Added supplier_id column to products table.");
          },
        );
      } else {
        console.log("products table already has supplier_id column.");
      }
    });

    console.log("Migration complete (closing in background).");
  });
});
