const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 32: supplier_invoices + supplier_payments");

db.serialize(() => {
  // Supplier invoices — one created per GRN receive
  db.run(
    `CREATE TABLE IF NOT EXISTS supplier_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      po_id INTEGER REFERENCES purchase_orders(id),
      grn_id INTEGER REFERENCES goods_received_notes(id),
      invoice_number TEXT,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid')),
      due_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    (err) => {
      if (err) console.error("Error creating supplier_invoices:", err.message);
      else console.log("supplier_invoices table ready.");
    }
  );

  // Supplier payments — recorded against an invoice
  db.run(
    `CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(id),
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'Cash',
      reference TEXT,
      paid_by TEXT,
      paid_at TEXT DEFAULT (datetime('now','localtime')),
      notes TEXT
    )`,
    (err) => {
      if (err) console.error("Error creating supplier_payments:", err.message);
      else console.log("supplier_payments table ready.");
    }
  );

  setTimeout(() => {
    db.close(() => console.log("Migration 32 complete."));
  }, 500);
});
