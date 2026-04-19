// One-off cleanup: drop orphaned test_* schemas left behind by Vitest runs.
// Runs each DROP as its own transaction with a fresh connection so a hang
// on one schema doesn't freeze the whole job.
require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  });

  const { rows } = await pool.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'test_%' ORDER BY schema_name"
  );
  console.log(`found ${rows.length} test_* schemas`);

  let dropped = 0;
  let failed = 0;
  for (const { schema_name } of rows) {
    const start = Date.now();
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema_name} CASCADE`);
      dropped++;
      console.log(`ok ${schema_name} (${Date.now() - start}ms)`);
    } catch (err) {
      failed++;
      console.log(`fail ${schema_name} (${Date.now() - start}ms): ${err.message}`);
    }
  }
  console.log(`done: dropped=${dropped} failed=${failed}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
