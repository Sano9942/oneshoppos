const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "sanopos.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error connecting to DB:", err.message);
    return;
  }
  console.log("Connected to the SQLite database.");
});

db.serialize(() => {
  db.run(
    "ALTER TABLE sale_items ADD COLUMN variant_id INTEGER REFERENCES product_variants(id)",
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Error adding variant_id to sale_items:", err.message);
      } else {
        console.log("Added variant_id to sale_items or it already exists.");
      }
    },
  );

  // Let's also add it to cartItems parsing if needed, but DB level it's fine.
});
