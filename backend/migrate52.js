const db = require("./db");

const inserts = [
  ["ui_redesign_taxes", 0, "Enable redesigned Taxes module"],
  ["ui_redesign_attribute_sets", 0, "Enable redesigned Attribute Sets module"],
  ["ui_redesign_stock_adjustments", 0, "Enable redesigned Stock Adjustments module"],
  ["ui_redesign_transfers", 0, "Enable redesigned Transfers module"],
  ["ui_redesign_returned_stock", 0, "Enable redesigned Returned Stock module"],
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
