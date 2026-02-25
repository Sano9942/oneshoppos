const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const db = new sqlite3.Database("oneshop.db");
const outputDir = path.resolve(__dirname, "archive", "legacy");
const outputPath = path.resolve(outputDir, "readable_schema.txt");

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

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, out);
    console.log(`Schema dumped to ${outputPath}`);
    db.close();
  },
);
