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
      `CREATE TABLE IF NOT EXISTS cash_shifts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            outlet_id       INTEGER NOT NULL REFERENCES outlets(id),
            employee_id     INTEGER REFERENCES employees(id),
            opening_float   REAL NOT NULL DEFAULT 0,
            closing_cash    REAL,
            expected_cash   REAL,
            variance        REAL,
            status          TEXT NOT NULL DEFAULT 'open',
            opened_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            closed_at       DATETIME,
            notes           TEXT
        )`,
      function (err) {
        if (err) {
          console.error("Error creating cash_shifts table:", err.message);
        } else {
          console.log("cash_shifts table created/verified.");
        }
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
