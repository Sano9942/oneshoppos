const db = require("./db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS goods_received_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      grn_number    TEXT UNIQUE NOT NULL,
      po_id         INTEGER REFERENCES purchase_orders(id),
      outlet_id     INTEGER REFERENCES outlets(id),
      received_by   INTEGER REFERENCES employees(id),
      received_at   DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      notes         TEXT
    )
  `, (err) => {
    if (err) console.error("goods_received_notes:", err.message);
    else console.log("goods_received_notes table ready.");
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS grn_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      grn_id       INTEGER NOT NULL REFERENCES goods_received_notes(id),
      product_id   INTEGER NOT NULL REFERENCES products(id),
      qty_ordered  INTEGER NOT NULL DEFAULT 0,
      qty_received INTEGER NOT NULL DEFAULT 0,
      cost_price   REAL NOT NULL DEFAULT 0
    )
  `, (err) => {
    if (err) console.error("grn_items:", err.message);
    else console.log("grn_items table ready.");
    db.close();
  });
});
