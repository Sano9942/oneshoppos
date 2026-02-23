const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
    process.exit(1);
  }
  console.log("Connected to the SQLite database.");

  db.serialize(() => {
    // Create customers table
    db.run(
      `CREATE TABLE IF NOT EXISTS customers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            mobile     TEXT,
            email      TEXT,
            address    TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
      function (err) {
        if (err) console.error("Error creating customers table:", err.message);
        else console.log("customers table created/verified.");
      },
    );

    // Add customer_id to sales table
    db.run(
      `ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES customers(id)`,
      function (err) {
        if (err && !err.message.includes("duplicate column"))
          console.error("Error adding customer_id:", err.message);
        else console.log("customer_id column added/verified on sales table.");
      },
    );
  });

  setTimeout(() => {
    db.close((err) => {
      if (err) console.error(err.message);
      console.log("Migration complete. Closing connection.");
    });
  }, 500);
});
