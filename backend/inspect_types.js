const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

console.log("--- TABLE: products ---");
db.all("PRAGMA table_info(products)", [], (err, rows) => {
  if (err) console.error(err);
  rows.forEach((r) => console.log(`${r.name}: ${r.type}`));

  console.log("\n--- TABLE: product_variants ---");
  db.all("PRAGMA table_info(product_variants)", [], (err, rows) => {
    if (err) console.error(err);
    rows.forEach((r) => console.log(`${r.name}: ${r.type}`));
    db.close();
  });
});
