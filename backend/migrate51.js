const db = require("./db");

const inserts = [
  ["ui_redesign_categories", 0, "Enable redesigned Categories module"],
  ["ui_redesign_brands", 0, "Enable redesigned Brands module"],
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
