const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log(
  "Running migration 27: attribute_sets, attributes, attribute_options, product_variants, variant_option_values tables",
);

db.serialize(() => {
  // Attribute Sets (e.g. "Clothing", "Shoes")
  db.run(
    `
    CREATE TABLE IF NOT EXISTS attribute_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    )
  `,
    (err) => {
      if (err) console.error("attribute_sets:", err.message);
      else console.log("attribute_sets table ready.");
    },
  );

  // Attributes (e.g. "Size", "Color") — belong to an attribute set
  db.run(
    `
    CREATE TABLE IF NOT EXISTS attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      attribute_set_id INTEGER NOT NULL REFERENCES attribute_sets(id) ON DELETE CASCADE
    )
  `,
    (err) => {
      if (err) console.error("attributes:", err.message);
      else console.log("attributes table ready.");
    },
  );

  // Attribute Options (e.g. "Small", "Medium", "Red")
  db.run(
    `
    CREATE TABLE IF NOT EXISTS attribute_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attribute_id INTEGER NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
      value TEXT NOT NULL
    )
  `,
    (err) => {
      if (err) console.error("attribute_options:", err.message);
      else console.log("attribute_options table ready.");
    },
  );

  // Product Variants (e.g. Red/Small T-Shirt)
  db.run(
    `
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku TEXT,
      price REAL,
      cost_price REAL DEFAULT 0,
      stock INTEGER DEFAULT 0
    )
  `,
    (err) => {
      if (err) console.error("product_variants:", err.message);
      else console.log("product_variants table ready.");
    },
  );

  // Variant Option Values — links a variant to its specific attribute option choices
  db.run(
    `
    CREATE TABLE IF NOT EXISTS variant_option_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
      attribute_id INTEGER NOT NULL REFERENCES attributes(id),
      attribute_option_id INTEGER NOT NULL REFERENCES attribute_options(id)
    )
  `,
    (err) => {
      if (err) console.error("variant_option_values:", err.message);
      else console.log("variant_option_values table ready.");
      db.close(() => console.log("Migration 27 complete."));
    },
  );
});
