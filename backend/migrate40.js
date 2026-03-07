const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath);

console.log("Running migration 40: query hotspot indexes");

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp)",
  "CREATE INDEX IF NOT EXISTS idx_sales_outlet_timestamp ON sales(outlet_id, timestamp)",
  "CREATE INDEX IF NOT EXISTS idx_sales_employee_timestamp ON sales(employee_id, timestamp)",
  "CREATE INDEX IF NOT EXISTS idx_sales_customer_timestamp ON sales(customer_id, timestamp)",
  "CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id)",
  "CREATE INDEX IF NOT EXISTS idx_sale_payments_sale_id ON sale_payments(sale_id)",
  "CREATE INDEX IF NOT EXISTS idx_approval_requests_status_created_at ON approval_requests(status, created_at)",
];

db.serialize(() => {
  INDEXES.forEach((sql) => {
    db.run(sql, (err) => {
      if (err) console.error("index error:", err.message, "|", sql);
    });
  });

  setTimeout(() => {
    db.close(() => console.log("Migration 40 complete."));
  }, 400);
});
