const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
    process.exit(1);
  }
  console.log("Connected to the SQLite database.");

  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS inventory_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id),
            from_outlet_id INTEGER NOT NULL REFERENCES outlets(id),
            to_outlet_id INTEGER NOT NULL REFERENCES outlets(id),
            quantity INTEGER NOT NULL,
            employee_id INTEGER REFERENCES employees(id),
            note TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
      function (err) {
        if (err) {
          console.error(
            "Error creating inventory_transfers table:",
            err.message,
          );
        } else {
          console.log("inventory_transfers table created/verified.");
        }
      },
    );
  });

  db.close((err) => {
    if (err) console.error(err.message);
    console.log("Closing connection...");
  });
});
