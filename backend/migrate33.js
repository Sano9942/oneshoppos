const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 33: promotions table");

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('percent','fixed','threshold_percent','threshold_fixed','bxgy')),
      value REAL NOT NULL DEFAULT 0,
      min_order_amount REAL DEFAULT 0,
      buy_qty INTEGER DEFAULT 0,
      get_qty INTEGER DEFAULT 0,
      applies_to TEXT DEFAULT 'all',
      product_id INTEGER REFERENCES products(id),
      category_id INTEGER REFERENCES categories(id),
      active INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating promotions:", err.message);
      else console.log("promotions table ready.");
    }
  );

  setTimeout(() => {
    db.close(() => console.log("Migration 33 complete."));
  }, 500);
});
