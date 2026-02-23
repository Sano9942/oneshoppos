const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 20: returns and return_items tables");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_sale_id INTEGER,
      outlet_id INTEGER NOT NULL REFERENCES outlets(id),
      employee_id INTEGER REFERENCES employees(id),
      customer_id INTEGER REFERENCES customers(id),
      total_refund REAL NOT NULL,
      refund_method TEXT NOT NULL,
      reason TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(
    `
    CREATE TABLE IF NOT EXISTS return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES returns(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      refund_price REAL NOT NULL
    )
  `,
    (err) => {
      if (err) {
        console.error("Migration 20 failed:", err.message);
      } else {
        console.log("Migration 20 completed successfully.");
      }
      db.close();
    },
  );
});
