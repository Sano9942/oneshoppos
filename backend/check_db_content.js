const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

db.all("SELECT COUNT(*) as count FROM products", [], (err, rows) => {
  if (err) console.error(err);
  console.log("Total products:", rows[0].count);

  db.all(
    "SELECT id, barcode, sku, name FROM products LIMIT 10",
    [],
    (err, rows) => {
      if (err) console.error(err);
      console.log("Sample products:");
      rows.forEach((r) => {
        console.log(
          `ID: ${r.id}, Barcode: "${r.barcode}" (${typeof r.barcode}), SKU: "${r.sku}" (${typeof r.sku}), Name: "${r.name}"`,
        );
      });
      db.close();
    },
  );
});
