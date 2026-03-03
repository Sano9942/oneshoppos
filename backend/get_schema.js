const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("oneshop.db");
db.get(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='products'",
  (err, row) => {
    if (err) console.error(err);
    else console.log(row.sql);
    db.close();
  },
);
