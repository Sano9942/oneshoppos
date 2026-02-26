const db = require("./db");

const inserts = [
  ["ui_redesign_suppliers", 0, "Enable redesigned Suppliers module"],
  ["ui_redesign_purchase_orders", 0, "Enable redesigned Purchase Orders module"],
  ["ui_redesign_supplier_payables", 0, "Enable redesigned Supplier Payables module"],
  ["ui_redesign_promotions", 0, "Enable redesigned Promotions module"],
  ["ui_redesign_expenses", 0, "Enable redesigned Expenses module"],
];

db.serialize(() => {
  inserts.forEach(([key, enabled, description]) => {
    db.run(
      `INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at)
       VALUES (?, ?, ?, datetime('now','localtime'))`,
      [key, enabled, description],
      (err) => {
        if (err) console.error(`feature flag ${key}:`, err.message);
      },
    );
  });
});

setTimeout(() => db.close(), 200);
