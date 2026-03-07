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
    // Add loyalty_points to customers
    db.run(
      `ALTER TABLE customers ADD COLUMN loyalty_points INTEGER DEFAULT 0`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error(
            "Error adding loyalty_points to customers:",
            err.message,
          );
        } else {
          console.log(
            "loyalty_points column added/verified on customers table.",
          );
        }
      },
    );

    // Add points_earned and points_redeemed to sales
    db.run(
      `ALTER TABLE sales ADD COLUMN points_earned INTEGER DEFAULT 0`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error("Error adding points_earned to sales:", err.message);
        } else {
          console.log("points_earned column added/verified on sales table.");
        }
      },
    );

    db.run(
      `ALTER TABLE sales ADD COLUMN points_redeemed INTEGER DEFAULT 0`,
      function (err) {
        if (err && !err.message.includes("duplicate column")) {
          console.error("Error adding points_redeemed to sales:", err.message);
        } else {
          console.log("points_redeemed column added/verified on sales table.");
        }
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
