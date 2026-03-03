const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(":memory:");

db.serialize(() => {
  // Setup minimal schema
  db.run(
    "CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT UNIQUE, sku TEXT, name TEXT)",
  );

  const testBarcode = "000123";
  const testSku = "00SKU";
  const testName = "Test Product";

  console.log(`[TEST] Inserting Barcode: "${testBarcode}", SKU: "${testSku}"`);

  db.run(
    "INSERT INTO products (barcode, sku, name) VALUES (?, ?, ?)",
    [testBarcode, testSku, testName],
    function (err) {
      if (err) {
        console.error("Insert failed:", err.message);
        return;
      }
      console.log("[TEST] Insert successful. Row ID:", this.lastID);

      // Test 1: Exact lookup
      db.get(
        "SELECT * FROM products WHERE barcode = ?",
        [testBarcode],
        (err, row) => {
          if (err) console.error(err);
          console.log(
            "[TEST] Lookup by string '000123':",
            row ? `FOUND (Barcode="${row.barcode}")` : "NOT FOUND",
          );
        },
      );

      // Test 2: Search by '123' (should NOT find it)
      db.get(
        "SELECT * FROM products WHERE barcode = ?",
        ["123"],
        (err, row) => {
          if (err) console.error(err);
          console.log(
            "[TEST] Lookup by string '123':",
            row ? `FOUND (Barcode="${row.barcode}")` : "NOT FOUND",
          );
        },
      );

      // Test 3: Display check
      db.all("SELECT * FROM products", (err, rows) => {
        rows.forEach((r) => {
          console.log(
            `[DATA] ID: ${r.id}, Barcode: "${r.barcode}" (Type: ${typeof r.barcode}), SKU: "${r.sku}"`,
          );
        });
      });
    },
  );
});
