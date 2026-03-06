const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Connect to SQLite database (this creates the file if it doesn't exist)
const dbPath = path.resolve(__dirname, "sanopos.db");
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
          name TEXT NOT NULL,
          description TEXT,
          parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1
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
                tax_id INTEGER REFERENCES taxes(id),
                supplier_id INTEGER REFERENCES suppliers(id)
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

      // Outlet Stock Table (Multi-Location Inventory)
      db.run(`CREATE TABLE IF NOT EXISTS outlet_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            outlet_id INTEGER NOT NULL REFERENCES outlets(id),
            quantity INTEGER NOT NULL DEFAULT 0,
            UNIQUE(product_id, outlet_id)
        )`);

      // Outlets Table
      db.run(`CREATE TABLE IF NOT EXISTS outlets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                address TEXT,
                phone TEXT
            )`);

      // Stock Adjustments Table
      db.run(`CREATE TABLE IF NOT EXISTS stock_adjustments (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               product_id INTEGER NOT NULL REFERENCES products(id),
               outlet_id INTEGER NOT NULL REFERENCES outlets(id),
               employee_id INTEGER REFERENCES employees(id),
               quantity_change INTEGER NOT NULL,
               reason TEXT NOT NULL,
               timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
           )`);

      // Employees Table
      db.run(`CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'Cashier',
                pin_code TEXT UNIQUE NOT NULL
            )`);

      // Brands Table
      db.run(`CREATE TABLE IF NOT EXISTS brands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT
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
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`,
        (err) => {
          if (err && !String(err.message || "").includes("no such column")) {
            console.error("idx_categories_parent_id:", err.message);
          }
        },
      );
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_parent_name_unique
         ON categories(COALESCE(parent_id, -1), lower(name))`,
        (err) => {
          if (err && !String(err.message || "").includes("no such column")) {
            console.error("idx_categories_parent_name_unique:", err.message);
          }
        },
      );
      db.run(
        `ALTER TABLE shift_denominations
         ADD COLUMN stage TEXT NOT NULL DEFAULT 'closing'`,
        (err) => {
          if (err && !String(err.message || "").includes("duplicate column name")) {
            console.error("shift_denominations.stage:", err.message);
          }
        },
      );
    });
  }
});

module.exports = db;
