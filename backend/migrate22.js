const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 22: Attribute Sets and Product Variants");

db.serialize(() => {
  // 1. Create Attribute Sets Table
  db.run(`
    CREATE TABLE IF NOT EXISTS attribute_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    )
  `);

  // 2. Create Attributes Table (e.g. Size, Color belonging to a set)
  db.run(`
    CREATE TABLE IF NOT EXISTS attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      attribute_set_id INTEGER NOT NULL REFERENCES attribute_sets(id) ON DELETE CASCADE
    )
  `);

  // 3. Create Attribute Options Table (e.g. Small, Medium, Red, Blue)
  db.run(`
    CREATE TABLE IF NOT EXISTS attribute_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
      value TEXT NOT NULL
    )
  `);

  // 4. Create Product Variants Table (The actual SKUs generated)
  db.run(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku TEXT UNIQUE NOT NULL,
      price REAL,
      cost_price REAL,
      stock INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Create Variant Option Values Mapping (Linking a variant to specific option values)
  db.run(`
    CREATE TABLE IF NOT EXISTS variant_option_values (
      variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
      attribute_option_id INTEGER NOT NULL REFERENCES attribute_options(id) ON DELETE CASCADE,
      PRIMARY KEY (variant_id, attribute_id)
    )
  `);

  // 6. Add columns to products table to denote it can have variants
  db.run(
    `ALTER TABLE products ADD COLUMN has_variants BOOLEAN DEFAULT 0`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("Error adding has_variants:", err.message);
      }
    },
  );

  db.run(
    `ALTER TABLE products ADD COLUMN attribute_set_id INTEGER REFERENCES attribute_sets(id)`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("Error adding attribute_set_id:", err.message);
      } else {
        console.log("Migration 22 completed successfully.");
      }
      db.close();
    },
  );
});
