/**
 * backend/cleanup-public-schema.js — Drop stale single-tenant tables from public schema.
 *
 * Run ONCE after switching to MT mode. Keeps only master tables:
 *   tenants, super_admins, tenant_audit_log, schema_migrations, tenant_refresh_tokens
 *
 * Usage:
 *   node backend/cleanup-public-schema.js [--dry-run]
 */
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const db = require("./db-pg");

const MASTER_TABLES = new Set([
  "tenants",
  "super_admins",
  "tenant_audit_log",
  "schema_migrations",
  "tenant_refresh_tokens",
]);

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );

  const toDrop = rows
    .map(r => r.tablename)
    .filter(t => !MASTER_TABLES.has(t));

  if (toDrop.length === 0) {
    console.log("No tables to drop — public schema is clean.");
    await db.end();
    return;
  }

  console.log(`\nTables to drop from public schema (${toDrop.length}):`);
  toDrop.forEach(t => console.log(`  - ${t}`));

  if (dryRun) {
    console.log("\n[DRY RUN] No tables dropped.");
    await db.end();
    return;
  }

  // Drop all at once with CASCADE (handles FK deps)
  const dropSql = `DROP TABLE IF EXISTS ${toDrop.map(t => `public."${t}"`).join(", ")} CASCADE`;
  console.log(`\nExecuting: ${dropSql.slice(0, 200)}...`);
  await db.query(dropSql);

  console.log(`\nDropped ${toDrop.length} tables from public schema.`);

  // Also drop any sequences left behind
  const { rows: seqs } = await db.query(
    `SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`
  );
  const seqsToDrop = seqs
    .map(s => s.sequencename)
    .filter(s => !s.startsWith("tenants_") && !s.startsWith("super_admins_") &&
                 !s.startsWith("tenant_audit_log_") && !s.startsWith("schema_migrations_") &&
                 !s.startsWith("tenant_refresh_tokens_"));

  if (seqsToDrop.length > 0) {
    const seqSql = `DROP SEQUENCE IF EXISTS ${seqsToDrop.map(s => `public."${s}"`).join(", ")} CASCADE`;
    await db.query(seqSql);
    console.log(`Dropped ${seqsToDrop.length} orphan sequences.`);
  }

  await db.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
