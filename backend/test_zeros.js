const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.resolve(__dirname, "oneshop.db"));

db.all("SELECT id, barcode, sku, name FROM products", [], (err, rows) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log(`Checking ${rows.length} products...`);
  rows.forEach((row) => {
    if (row.barcode && row.barcode.startsWith("0")) {
      console.log(
        `[FOUND] ID: ${row.id}, Barcode: "${row.barcode}", Name: "${row.name}"`,
      );
    }
    if (row.sku && row.sku.startsWith("0")) {
      console.log(
        `[FOUND] ID: ${row.id}, SKU: "${row.sku}", Name: "${row.name}"`,
      );
    }
  });

  const numericMatches = rows.filter(
    (r) => r.barcode && /^\d+$/.test(r.barcode),
  );
  console.log(`Total numeric barcodes: ${numericMatches.length}`);

  db.close();
});
