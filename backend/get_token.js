const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./oneshop.db");

db.get("SELECT token FROM employees WHERE role_id = 1 LIMIT 1", (err, row) => {
  if (err) {
    console.error(err.message);
  } else if (row) {
    console.log(row.token);
  } else {
    console.log("No admin employee found.");
  }
  db.close();
});
