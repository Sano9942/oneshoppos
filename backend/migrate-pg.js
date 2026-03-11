#!/usr/bin/env node
/**
 * migrate-pg.js — Postgres schema migration runner.
 *
 * Replaces the SQLite-specific run_migrations.js for Postgres deployments.
 * Reads schema_version table to determine current version, then applies
 * any unapplied migrations in order.
 *
 * Usage:
 *   node backend/migrate-pg.js              # runs against DATABASE_URL
 *   DATABASE_URL=... node backend/migrate-pg.js
 *
 * Version 1 = initial schema from schema-pg.sql (idempotent — all CREATE IF NOT EXISTS).
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_SQL_PATH = path.join(__dirname, "schema-pg.sql");

/**
 * Ordered list of migrations. Each entry:
 *   { version: number, description: string, up: async (client) => void }
 *
 * Version 1 applies the full schema-pg.sql — safe to re-run because every
 * statement uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: "Initial schema from schema-pg.sql",
    up: async (client) => {
      const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
      await client.query(sql);
    },
  },
  // Future migrations go here:
  // {
  //   version: 2,
  //   description: "Add foo column to bar table",
  //   up: async (client) => {
  //     await client.query("ALTER TABLE bar ADD COLUMN IF NOT EXISTS foo TEXT");
  //   },
  // },
];

async function migrate(db) {
  // Ensure schema_version table exists (bootstrap)
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get current version
  const { rows } = await db.query(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
  );
  const currentVersion = rows[0]?.version || 0;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    console.log(`[migrate-pg] Schema is up to date (version ${currentVersion}).`);
    return currentVersion;
  }

  console.log(
    `[migrate-pg] Current version: ${currentVersion}, applying ${pending.length} migration(s)...`
  );

  for (const m of pending) {
    console.log(`[migrate-pg]   v${m.version}: ${m.description}`);
    await db.transaction(async (client) => {
      await m.up(client);
      await client.query(
        "INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [m.version]
      );
    });
    console.log(`[migrate-pg]   v${m.version}: applied`);
  }

  const finalVersion = pending[pending.length - 1].version;
  console.log(`[migrate-pg] Migration complete. Schema version: ${finalVersion}`);
  return finalVersion;
}

// CLI entry point
if (require.main === module) {
  const db = require("./db-pg");
  migrate(db)
    .then(() => db.end())
    .catch((err) => {
      console.error("[migrate-pg] FATAL:", err.message);
      process.exit(1);
    });
}

module.exports = { migrate, MIGRATIONS };
