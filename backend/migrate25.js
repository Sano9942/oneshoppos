const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    process.exit(1);
  }
  console.log("Connected to the SQLite database.");

  db.serialize(() => {
    // Action History
    db.run(
      `CREATE TABLE IF NOT EXISTS action_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name   TEXT,
            action_type TEXT NOT NULL,
            description TEXT NOT NULL,
            timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
      function (err) {
        if (err)
          console.error("Error creating action_history table:", err.message);
        else console.log("action_history table created/verified.");
      },
    );

    // Supplier Returns (RMA)
    db.run(
      `CREATE TABLE IF NOT EXISTS supplier_returns (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id      INTEGER REFERENCES suppliers(id),
            employee_id      INTEGER REFERENCES employees(id),
            outlet_id        INTEGER REFERENCES outlets(id),
            return_date      DATETIME DEFAULT CURRENT_TIMESTAMP,
            status           TEXT DEFAULT 'Pending',
            reason           TEXT,
            total_value      REAL DEFAULT 0,
            reference_number TEXT
        )`,
      function (err) {
        if (err)
          console.error("Error creating supplier_returns table:", err.message);
        else console.log("supplier_returns table created/verified.");
      },
    );

    // Supplier Return Items
    db.run(
      `CREATE TABLE IF NOT EXISTS supplier_return_items (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_return_id INTEGER REFERENCES supplier_returns(id),
            product_id        INTEGER REFERENCES products(id),
            variant_id        INTEGER REFERENCES product_variants(id),
            quantity          INTEGER NOT NULL,
            unit_price        REAL,
            reason            TEXT
        )`,
      function (err) {
        if (err)
          console.error(
            "Error creating supplier_return_items table:",
            err.message,
          );
        else console.log("supplier_return_items table created/verified.");
      },
    );
  });

  setTimeout(() => {
    db.close((err) => {
      if (err) console.error(err.message);
      console.log("Migration complete.");
    });
  }, 1000);
});
