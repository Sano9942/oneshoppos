const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Connect to SQLite database (this creates the file if it doesn't exist)
const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
  } else {
    console.log("Connected to the SQLite database.");

    // Initialize Tables
    db.serialize(() => {
      // Products Table
      db.run(`CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                barcode TEXT UNIQUE,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                cost_price REAL DEFAULT 0.0,
                gst REAL,
                stock INTEGER NOT NULL DEFAULT 0
            )`);

      // Sales Table (Receipts)
      db.run(`CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total_amount REAL NOT NULL,
                payment_method TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

      // Sale Items Table (Line Items)
      db.run(`CREATE TABLE IF NOT EXISTS sale_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER,
                product_id INTEGER,
                quantity INTEGER NOT NULL,
                price_at_sale REAL NOT NULL,
                cost_price_at_sale REAL DEFAULT 0.0,
                FOREIGN KEY(sale_id) REFERENCES sales(id),
                FOREIGN KEY(product_id) REFERENCES products(id)
            )`);

      // Enable Foreign Keys
      db.run(`PRAGMA foreign_keys = ON;`);
    });
  }
});

module.exports = db;
