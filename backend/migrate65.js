/**
 * migrate65.js — Add email_config table
 *
 * Stores SMTP credentials for sending email receipts.
 * Single row (id=1) seeded so Settings UI always has a row to read/update.
 */
const path = require("path");
const Database = require("sqlite3").Database;

const DB_PATH = path.join(__dirname, "oneshop.db");
const db = new Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS email_config (
      id          INTEGER PRIMARY KEY,
      smtp_host   TEXT    DEFAULT 'smtp.gmail.com',
      smtp_port   INTEGER DEFAULT 587,
      smtp_user   TEXT,
      smtp_pass   TEXT,
      from_name   TEXT    DEFAULT 'OneShopPOS',
      enabled     INTEGER DEFAULT 0
    )
  `, (err) => {
    if (err) console.error("migrate65: create email_config:", err.message);
    else console.log("migrate65: email_config table ready.");
  });

  db.run(
    "INSERT OR IGNORE INTO email_config (id) VALUES (1)",
    (err) => {
      if (err) console.error("migrate65: seed row:", err.message);
      else console.log("migrate65: default email_config row seeded.");
    }
  );
});

db.close((err) => {
  if (err) console.error("migrate65: close:", err.message);
  else console.log("migrate65: done.");
});
