const db = require("./db");

db.serialize(() => {
  // Suppliers Table
  db.run(`CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact_person TEXT,
        phone TEXT,
        email TEXT,
        address TEXT
    )`);

  // Purchase Orders Table
  db.run(`CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        status TEXT DEFAULT 'Draft',
        total_cost REAL DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    )`);

  // Purchase Order Items Table
  db.run(`CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        po_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        cost_price REAL NOT NULL,
        FOREIGN KEY(po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`, (err) => {
        if (err) {
            console.error("Migration Error:", err);
        } else {
            console.log("Migration 3 (Suppliers & Purchase Orders) completed successfully.");
            db.close();
        }
    });
});
