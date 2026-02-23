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
    // Add outlet_id to sales table for outlet attribution
    db.run(
      `ALTER TABLE sales ADD COLUMN outlet_id INTEGER REFERENCES outlets(id)`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error("Error adding outlet_id:", err.message);
        } else {
          console.log("outlet_id column added/verified on sales table.");
        }
      },
    );

    // Add employee_id to sales table for cashier attribution
    db.run(
      `ALTER TABLE sales ADD COLUMN employee_id INTEGER REFERENCES employees(id)`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error("Error adding employee_id:", err.message);
        } else {
          console.log("employee_id column added/verified on sales table.");
        }
      },
    );

    // Add voided flag and void_reason to allow sale voids
    db.run(
      `ALTER TABLE sales ADD COLUMN voided INTEGER DEFAULT 0`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error("Error adding voided:", err.message);
        } else {
          console.log("voided column added/verified on sales table.");
        }
      },
    );

    db.run(`ALTER TABLE sales ADD COLUMN void_reason TEXT`, function (err) {
      if (err && !err.message.includes("duplicate column")) {
        console.error("Error adding void_reason:", err.message);
      } else {
        console.log("void_reason column added/verified on sales table.");
      }
    });
  });

  setTimeout(() => {
    db.close((err) => {
      if (err) console.error(err.message);
      console.log("Migration complete. Closing connection.");
    });
  }, 500);
});
