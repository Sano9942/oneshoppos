const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

const tables = ["products", "product_variants", "product_media"];

function inspectTable(tableName) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
      if (err) reject(err);
      else resolve({ tableName, rows });
    });
  });
}

Promise.all(tables.map(inspectTable))
  .then((results) => {
    results.forEach((res) => {
      console.log(`--- Table: ${res.tableName} ---`);
      console.log(JSON.stringify(res.rows, null, 2));
    });
    db.close();
  })
  .catch((err) => {
    console.error(err);
    db.close();
  });
