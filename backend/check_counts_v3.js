const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("oneshop.db");

db.all(
  "SELECT resolution_status, COUNT(*) as count FROM inventory_reconciliation GROUP BY resolution_status",
  [],
  (err, rows) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(JSON.stringify(rows));
    db.close();
  },
);
