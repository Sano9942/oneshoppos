const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 28: receipt_templates table");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS receipt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      header_text TEXT DEFAULT '',
      footer_text TEXT DEFAULT '',
      show_barcode INTEGER DEFAULT 0,
      show_logo INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    (err) => {
      if (err) {
        console.error("receipt_templates:", err.message);
      } else {
        console.log("receipt_templates table ready.");
        // Seed a default template
        db.run(
          `INSERT OR IGNORE INTO receipt_templates (name, header_text, footer_text, show_barcode, show_logo, is_active)
           VALUES ('Default', 'OneShopPOS', 'Thank you for your purchase!', 0, 0, 1)`,
          (err2) => {
            if (err2) console.error("Seed default template:", err2.message);
            else console.log("Default template seeded.");
            db.close(() => console.log("Migration 28 complete."));
          },
        );
      }
    },
  );
});
