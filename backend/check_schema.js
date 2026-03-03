const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.resolve(__dirname, "oneshop.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.all("PRAGMA table_info(products)", (err, rows) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log("--- products table info ---");
    rows.forEach((row) =>
      console.log(
        `${row.name}: ${row.type}, NOT NULL: ${row.notnull}, PK: ${row.pk}`,
      ),
    );
  });

  db.all(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='products'",
    (err, rows) => {
      if (err) {
        console.error(err);
        return;
      }
      console.log("--- products indexes ---");
      rows.forEach((row) => console.log(`${row.name}: ${row.sql}`));
      db.close();
    },
  );
});
