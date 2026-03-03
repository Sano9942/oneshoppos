const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const db = new sqlite3.Database("./oneshop.db");

db.serialize(() => {
  db.all(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    [],
    (err, rows) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      const schema = rows.map((r) => r.sql).join(";\n\n") + ";";
      fs.writeFileSync("schema.sql", schema, "utf8");
      console.log("Schema dumped to schema.sql");
      db.close();
    },
  );
});
