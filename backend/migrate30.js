const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 30: parked_sales + parked_sale_items tables");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS parked_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER REFERENCES employees(id),
      outlet_id INTEGER REFERENCES outlets(id),
      customer_id INTEGER REFERENCES customers(id),
      label TEXT,
      notes TEXT,
      parked_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating parked_sales:", err.message);
      else console.log("parked_sales table ready.");
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS parked_sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parked_sale_id INTEGER NOT NULL REFERENCES parked_sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      product_name TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      effective_tax_rate REAL DEFAULT 0
    )`,
    (err) => {
      if (err) console.error("Error creating parked_sale_items:", err.message);
      else console.log("parked_sale_items table ready.");
    }
  );

  setTimeout(() => {
    db.close(() => console.log("Migration 30 complete."));
  }, 500);
});
