const path = require("path");
const Database = require("sqlite3").verbose().Database;

const DB_PATH = path.resolve(__dirname, "sanopos.db");
const db = new Database(DB_PATH);

const columns = [
  { table: "products",  col: "deleted_at" },
  { table: "customers", col: "deleted_at" },
  { table: "employees", col: "deleted_at" },
];

const indexes = [
  "CREATE INDEX IF NOT EXISTS idx_products_deleted_at  ON products(deleted_at)",
  "CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at)",
  "CREATE INDEX IF NOT EXISTS idx_employees_deleted_at ON employees(deleted_at)",
];

let pending = columns.length;

function done() {
  pending--;
  if (pending > 0) return;

  // All columns done — now create indexes
  let iPending = indexes.length;
  for (const sql of indexes) {
    db.run(sql, (err) => {
      if (err) console.error("Index error:", err.message);
      iPending--;
      if (iPending === 0) {
        console.log("migrate73: soft-delete columns + indexes applied.");
        db.close((err) => {
          if (err) console.error("Close error:", err.message);
        });
      }
    });
  }
}

for (const { table, col } of columns) {
  db.run(
    `ALTER TABLE ${table} ADD COLUMN ${col} DATETIME DEFAULT NULL`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error(`Error adding ${col} to ${table}:`, err.message);
      } else if (!err) {
        console.log(`Added ${col} to ${table}`);
      } else {
        console.log(`${table}.${col} already exists — skipping`);
      }
      done();
    }
  );
}
