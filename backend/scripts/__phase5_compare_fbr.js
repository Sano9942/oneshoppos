require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    // All fbr-invoice jobs in last 14d, status sample
    const allFbr = await p.query(`
      SELECT id, state, retry_count, retry_limit,
             data, output->>'message' AS error,
             created_on, started_on, completed_on,
             EXTRACT(EPOCH FROM (started_on - created_on)) AS time_to_start_seconds
        FROM pgboss.job
       WHERE name = 'fbr-invoice' AND created_on > NOW() - INTERVAL '14 days'
       ORDER BY created_on DESC
    `);
    console.log(`\n=== all ${allFbr.rows.length} fbr-invoice jobs ===`);
    console.table(allFbr.rows);
  } catch (e) {
    console.error("ERR", e);
  } finally {
    await p.end();
  }
})();
