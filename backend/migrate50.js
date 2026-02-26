const db = require("./db");

const inserts = [
  ["ui_redesign_customers", 0, "Enable redesigned Customers module"],
  ["ui_redesign_sales_history", 0, "Enable redesigned Sales History module"],
  ["ui_redesign_cash_management", 0, "Enable redesigned Cash Management module"],
  ["ui_redesign_returns", 0, "Enable redesigned Returns module"],
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
