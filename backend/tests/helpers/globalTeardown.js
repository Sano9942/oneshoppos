/**
 * Jest global teardown — drops any orphaned test_* schemas that
 * per-file afterAll cleanup missed (crash, timeout, Ctrl+C).
 *
 * Wired via jest.config.js → globalTeardown.
 */
const { Pool } = require("pg");

module.exports = async function globalTeardown() {
  if (!process.env.DATABASE_URL) return;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  try {
    const { rows } = await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'test_%'`
    );

    for (const row of rows) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS ${row.schema_name} CASCADE`);
      } catch (err) {
        console.warn(`globalTeardown: failed to drop ${row.schema_name}:`, err.message);
      }
    }

    if (rows.length > 0) {
      console.log(`globalTeardown: cleaned up ${rows.length} orphaned test schema(s)`);
    }
  } catch (err) {
    console.warn("globalTeardown: schema cleanup error:", err.message);
  } finally {
    await pool.end();
  }
};
