/**
 * migrate64.js — Add printer_config table
 *
 * Stores thermal printer connection settings (USB or TCP/WiFi),
 * paper width (chars per line), and cash drawer preference.
 * A single row (id=1) is seeded so the Settings UI always has
 * something to display even before the admin configures it.
 */
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const DB_PATH = path.join(__dirname, "sanopos.db");
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS printer_config (
      id               INTEGER PRIMARY KEY,
      connection_type  TEXT    DEFAULT 'network',
      host             TEXT    DEFAULT '192.168.1.100',
      port             INTEGER DEFAULT 9100,
      usb_vendor_id    TEXT,
      usb_product_id   TEXT,
      paper_width      INTEGER DEFAULT 48,
      cash_drawer      INTEGER DEFAULT 1,
      is_active        INTEGER DEFAULT 1
    )
  `, (err) => {
    if (err) console.error("migrate64: create printer_config:", err.message);
    else console.log("migrate64: printer_config table ready.");
  });

  db.run(
    "INSERT OR IGNORE INTO printer_config (id) VALUES (1)",
    (err) => {
      if (err) console.error("migrate64: seed row:", err.message);
      else console.log("migrate64: default printer_config row seeded.");
    }
  );
});

db.close((err) => {
  if (err) console.error("migrate64: close error:", err.message);
  else console.log("migrate64: complete.");
});
