/**
 * backend/seed-admin.js — CLI to create the first super-admin in master.db.
 *
 * Usage:
 *   node backend/seed-admin.js --email admin@example.com --password secret123 --name "Super Admin"
 */
const bcrypt = require("bcryptjs");
const { getMasterDb, initMasterDb, closeMasterDb } = require("./master-db");

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
    console.error("Usage: node seed-admin.js --email <email> --password <password> [--name <name>]");
    process.exit(1);
  }
  if (args.password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  await initMasterDb();
  const db = getMasterDb();

  // Check if email already exists
  const existing = await new Promise((resolve, reject) => {
    db.get("SELECT id FROM super_admins WHERE email = ?", [args.email.toLowerCase().trim()], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

  if (existing) {
    console.log(`Super-admin with email "${args.email}" already exists (id=${existing.id}).`);
    await closeMasterDb();
    return;
  }

  const passwordHash = await bcrypt.hash(args.password, BCRYPT_ROUNDS);

  await new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO super_admins (email, password_hash, name) VALUES (?, ?, ?)",
      [args.email.toLowerCase().trim(), passwordHash, args.name],
      function (err) {
        if (err) return reject(err);
        console.log(`Super-admin created: ${args.name} <${args.email}> (id=${this.lastID})`);
        resolve();
      }
    );
  });

  await closeMasterDb();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  try { await closeMasterDb(); } catch {}
  process.exit(1);
});
