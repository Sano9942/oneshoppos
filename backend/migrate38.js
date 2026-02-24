const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 38: unique invoice number index");

db.serialize(() => {
  db.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoice_number ON sales(invoice_number) WHERE invoice_number IS NOT NULL",
    (err) => {
      if (err) console.error("uq_sales_invoice_number:", err.message);
      else console.log("uq_sales_invoice_number ready.");
    }
  );

  setTimeout(() => {
    db.close(() => console.log("Migration 38 complete."));
  }, 300);
});
