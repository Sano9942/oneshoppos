const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 34: barcode_templates + barcode_print_jobs");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS barcode_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      width_mm REAL NOT NULL DEFAULT 50,
      height_mm REAL NOT NULL DEFAULT 30,
      show_name INTEGER NOT NULL DEFAULT 1,
      show_price INTEGER NOT NULL DEFAULT 1,
      show_barcode INTEGER NOT NULL DEFAULT 1,
      show_sku INTEGER NOT NULL DEFAULT 0,
      show_brand INTEGER NOT NULL DEFAULT 0,
      font_size INTEGER NOT NULL DEFAULT 10,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating barcode_templates:", err.message);
      else console.log("barcode_templates table ready.");
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS barcode_print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER REFERENCES barcode_templates(id),
      product_id INTEGER REFERENCES products(id),
      product_name TEXT,
      barcode TEXT,
      price REAL,
      copies INTEGER NOT NULL DEFAULT 1,
      printed_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating barcode_print_jobs:", err.message);
      else console.log("barcode_print_jobs table ready.");
    }
  );

  // Insert a default template
  db.run(
    `INSERT OR IGNORE INTO barcode_templates (id, name, width_mm, height_mm, show_name, show_price, show_barcode, is_default)
     VALUES (1, 'Standard Label (50x30mm)', 50, 30, 1, 1, 1, 1)`,
    (err) => {
      if (err) console.error("Error inserting default template:", err.message);
      else console.log("Default barcode template inserted.");
    }
  );

  setTimeout(() => {
    db.close(() => console.log("Migration 34 complete."));
  }, 500);
});
