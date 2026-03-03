const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Replicate the logic from backend/routes/shopify/import.js
async function testImportLogic() {
  const db = new sqlite3.Database(":memory:");

  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(
        "CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT, sku TEXT, name TEXT, price REAL)",
      );
      resolve();
    });
  });

  // Mock Shopify variant data
  const mockVariants = [
    { barcode: "002590", sku: "SKU00123", price: "45.00" },
    { barcode: "01234", sku: "00987", price: "10.00" },
  ];

  console.log("Starting mock import...");

  for (const v of mockVariants) {
    // EXACT logic from import.js line 94-95
    const barcode = (v.barcode || "").trim() || null;
    const sku = (v.sku || "").trim() || null;
    const name = "Test Product " + barcode;

    console.log(
      `Processing: Barcode=${barcode} (type: ${typeof barcode}), SKU=${sku} (type: ${typeof sku})`,
    );

    await new Promise((resolve) => {
      db.run(
        "INSERT INTO products (barcode, sku, name, price) VALUES (?, ?, ?, ?)",
        [barcode, sku, name, parseFloat(v.price || 0)],
        function (err) {
          if (err) console.error(err);
          console.log(`Inserted ID: ${this.lastID}`);
          resolve();
        },
      );
    });
  }

  console.log("\nReading back from DB:");
  await new Promise((resolve) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
      rows.forEach((row) => {
        console.log(
          `ID: ${row.id}, Barcode: "${row.barcode}" (type: ${typeof row.barcode}), SKU: "${row.sku}" (type: ${typeof row.sku})`,
        );
      });
      resolve();
    });
  });

  db.close();
}

testImportLogic();
