/**
 * backend/seed-admin-pg.js — CLI to create the first super-admin in public.super_admins (Postgres).
 *
 * Usage:
 *   node backend/seed-admin-pg.js --email admin@example.com --password secret123 --name "Super Admin"
 */
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const db = require("./db-pg");
const masterDbPg = require("./master-db-pg");

const BCRYPT_ROUNDS = 10;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    email: get("--email"),
    password: get("--password"),
    name: get("--name") || "Super Admin",
  };
}

async function main() {
  const args = parseArgs();
  if (!args.email || !args.password) {
    console.error("Usage: node seed-admin-pg.js --email <email> --password <password> [--name <name>]");
    process.exit(1);
  }
  if (args.password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  // Initialize master DB tables
  await masterDbPg.init(db);

  // Check if email already exists
  const { rows: [existing] } = await db.query(
    "SELECT id FROM super_admins WHERE email = $1",
    [args.email.toLowerCase().trim()]
  );

  if (existing) {
    console.log(`Super-admin with email "${args.email}" already exists (id=${existing.id}).`);
    await db.end();
    return;
  }

  const passwordHash = await bcrypt.hash(args.password, BCRYPT_ROUNDS);

  const { rows: [row] } = await db.query(
    "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id",
    [args.email.toLowerCase().trim(), passwordHash, args.name]
  );

  console.log(`Super-admin created: ${args.name} <${args.email}> (id=${row.id})`);
  await db.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
