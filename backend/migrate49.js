const db = require("./db");

const inserts = [
  [
    "ui_redesign_enabled",
    1,
    "Enable Shopify-style redesign shell and module-level UI toggles",
  ],
  ["ui_redesign_inventory", 1, "Enable redesigned Inventory module"],
  ["ui_redesign_orders", 0, "Enable redesigned Orders module"],
  ["ui_redesign_pos", 0, "Enable redesigned POS module"],
  ["ui_redesign_reports", 0, "Enable redesigned Reports module"],
  ["ui_redesign_admin", 0, "Enable redesigned admin module surfaces"],
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
