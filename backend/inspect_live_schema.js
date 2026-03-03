const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.resolve(__dirname, "oneshop.db"));

db.all("PRAGMA table_info(products)", [], (err, rows) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("--- TABLE: products ---");
  rows.forEach((r) => {
    console.log(
      `${r.name}: ${r.type} ${r.notnull ? "NOT NULL" : ""} ${r.pk ? "PK" : ""}`,
    );
  });

  db.all("PRAGMA table_info(product_variants)", [], (err2, rows2) => {
    console.log("\n--- TABLE: product_variants ---");
    rows2.forEach((r) => {
      console.log(
        `${r.name}: ${r.type} ${r.notnull ? "NOT NULL" : ""} ${r.pk ? "PK" : ""}`,
      );
    });
    db.close();
  });
});
