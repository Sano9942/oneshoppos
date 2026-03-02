const db = require("./db");

db.serialize(() => {
  db.run(
    `ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("migrate57 parent_id:", err.message);
      }
    },
  );

  db.run(
    `ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("migrate57 sort_order:", err.message);
      }
    },
  );

  db.run(
    `ALTER TABLE categories ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`,
    (err) => {
      if (err && !err.message.includes("duplicate column")) {
        console.error("migrate57 is_active:", err.message);
      }
    },
  );

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`,
    (err) => {
      if (err) console.error("migrate57 idx_categories_parent_id:", err.message);
    },
  );
});
