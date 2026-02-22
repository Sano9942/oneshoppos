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
      // Categories Table
      db.run(`CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT
      )`);

      // Taxes Table
      db.run(`CREATE TABLE IF NOT EXISTS taxes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          rate REAL NOT NULL,
          is_default BOOLEAN DEFAULT 0
      )`);
      
      // Products Table (Inventory)
      db.run(`CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                barcode TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                cost_price REAL DEFAULT 0.0,
                gst REAL DEFAULT 0.0,
                stock INTEGER NOT NULL,
                category_id INTEGER REFERENCES categories(id),
                tax_id INTEGER REFERENCES taxes(id)
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

      // Sale Payments Table (Split Tenders)
      db.run(`CREATE TABLE IF NOT EXISTS sale_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER,
                payment_method TEXT NOT NULL,
                amount REAL NOT NULL,
                FOREIGN KEY(sale_id) REFERENCES sales(id)
            )`);

      // Enable Foreign Keys
      db.run(`PRAGMA foreign_keys = ON;`);
    });
  }
});

module.exports = db;
