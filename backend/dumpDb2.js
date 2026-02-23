const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const db = new sqlite3.Database("oneshop.db");

db.all(
  "SELECT name, sql FROM sqlite_master WHERE type='table'",
  [],
  (err, rows) => {
    let out = "";
    rows.forEach((r) => {
      out += "TABLE: " + r.name + "\n";
      out += r.sql + "\n";
      out += "---\n";
    });

    fs.writeFileSync("readable_schema.txt", out);
    console.log("Schema dumped to readable_schema.txt");
    db.close();
  },
);
