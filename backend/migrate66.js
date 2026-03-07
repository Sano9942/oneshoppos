/**
 * migrate66.js — Hash employee PINs with bcrypt
 *
 * Adds pin_hash column to employees table, hashes all existing plaintext
 * pin_code values. pin_code column kept for backward compat but no longer read.
 */
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "sanopos.db");
const db = new sqlite3.Database(DB_PATH);
const BCRYPT_ROUNDS = 10;

async function migrate() {
  // 1. Add pin_hash column
  await run("ALTER TABLE employees ADD COLUMN pin_hash TEXT");
  console.log("migrate66: added pin_hash column.");

  // 2. Read all employees with plaintext PINs
  const rows = await all("SELECT id, pin_code FROM employees WHERE pin_code IS NOT NULL");
  console.log(`migrate66: hashing ${rows.length} PINs...`);

  // 3. Hash each PIN and update
  for (const row of rows) {
    const hash = await bcrypt.hash(String(row.pin_code), BCRYPT_ROUNDS);
    await run("UPDATE employees SET pin_hash = ? WHERE id = ?", [hash, row.id]);
  }
  console.log("migrate66: all PINs hashed.");
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

migrate()
  .then(() => {
    db.close((err) => {
      if (err) console.error("migrate66: close error:", err.message);
      else console.log("migrate66: done.");
    });
  })
  .catch((err) => {
    console.error("migrate66: FAILED:", err.message);
    db.close(() => process.exit(1));
  });
