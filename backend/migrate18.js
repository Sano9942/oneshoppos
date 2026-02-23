const db = require("./db");

db.serialize(() => {
  db.run(`ALTER TABLE sales ADD COLUMN discount_amount REAL DEFAULT 0`, (err) => {
    if (err && !err.message.includes("duplicate column"))
      console.error("discount_amount:", err.message);
    else console.log("discount_amount column ready.");
  });

  db.run(`ALTER TABLE sales ADD COLUMN discount_type TEXT DEFAULT 'fixed'`, (err) => {
    if (err && !err.message.includes("duplicate column"))
      console.error("discount_type:", err.message);
    else console.log("discount_type column ready.");
    db.close();
  });
});
