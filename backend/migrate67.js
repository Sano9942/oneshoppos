// migrate67.js — Add image_url column to products table
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sanopos.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error("Failed to open DB:", err.message); process.exit(1); }
});

db.serialize(() => {
  db.run(`ALTER TABLE products ADD COLUMN image_url TEXT`, (err) => {
    if (err && err.message.includes("duplicate column")) {
      console.log("[migrate67] image_url column already exists — skipping.");
    } else if (err) {
      console.error("[migrate67] Failed:", err.message);
    } else {
      console.log("[migrate67] Added image_url column to products.");
    }
  });
});

db.close((err) => {
  if (err) console.error("[migrate67] Close error:", err.message);
  else console.log("[migrate67] Done.");
});
