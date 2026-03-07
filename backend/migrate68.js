// migrate68.js — Remove UNIQUE constraint on products.barcode (allow duplicate barcodes)
// SQLite does not support DROP CONSTRAINT, so we recreate the table without it.
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error("Failed to open DB:", err.message); process.exit(1); }
});

db.serialize(() => {
  db.run("PRAGMA foreign_keys = OFF");

  db.run(`
    CREATE TABLE IF NOT EXISTS products_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      cost_price REAL DEFAULT 0.0,
      gst REAL,
      category_id INTEGER REFERENCES categories(id),
      tax_id INTEGER REFERENCES taxes(id),
      brand_id INTEGER REFERENCES brands(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      has_variants BOOLEAN DEFAULT 0,
      attribute_set_id INTEGER REFERENCES attribute_sets(id),
      min_qty INTEGER DEFAULT 0,
      max_qty INTEGER DEFAULT 0,
      unit TEXT DEFAULT 'pcs',
      description_html TEXT,
      compare_at_price REAL DEFAULT 0,
      product_type TEXT,
      vendor TEXT,
      tags TEXT,
      status TEXT DEFAULT 'active',
      sku TEXT,
      image_url TEXT
    )
  `, (err) => {
    if (err) { console.error("[migrate68] CREATE products_new failed:", err.message); return; }
    console.log("[migrate68] Created products_new table.");
  });

  db.run(`INSERT INTO products_new SELECT * FROM products`, (err) => {
    if (err) { console.error("[migrate68] Copy data failed:", err.message); return; }
    console.log("[migrate68] Copied all rows.");
  });

  db.run(`DROP TABLE products`, (err) => {
    if (err) { console.error("[migrate68] DROP old table failed:", err.message); return; }
    console.log("[migrate68] Dropped old products table.");
  });

  db.run(`ALTER TABLE products_new RENAME TO products`, (err) => {
    if (err) { console.error("[migrate68] RENAME failed:", err.message); return; }
    console.log("[migrate68] Renamed products_new to products.");
  });

  db.run("PRAGMA foreign_keys = ON");
});

db.close((err) => {
  if (err) console.error("[migrate68] Close error:", err.message);
  else console.log("[migrate68] Done — barcode UNIQUE constraint removed.");
});
