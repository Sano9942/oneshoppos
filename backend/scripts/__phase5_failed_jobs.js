require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const failed = await p.query(`
      SELECT id, name, state, retry_count, retry_limit, retry_delay,
             data, output,
             created_on, started_on, completed_on
        FROM pgboss.job
       WHERE state = 'failed' AND created_on > NOW() - INTERVAL '14 days'
       ORDER BY created_on DESC
       LIMIT 20
    `);
    console.log("\n=== failed jobs full dump ===");
    for (const row of failed.rows) {
      console.log(`\n--- job ${row.id} (${row.name}) ---`);
      console.log("retry_count:", row.retry_count, "retry_limit:", row.retry_limit, "retry_delay:", row.retry_delay);
      console.log("created:", row.created_on, "started:", row.started_on, "completed:", row.completed_on);
      console.log("data:", JSON.stringify(row.data));
      console.log("output:", JSON.stringify(row.output));
    }

    // Inspect __pgboss__send-it which has been completing — see one for context
    const sendIt = await p.query(`
      SELECT id, name, data, output, created_on, started_on, completed_on
        FROM pgboss.job
       WHERE name = '__pgboss__send-it'
       ORDER BY created_on DESC LIMIT 1
    `);
    console.log("\n=== __pgboss__send-it sample ===");
    console.log(JSON.stringify(sendIt.rows[0], null, 2));
  } catch (e) {
    console.error("ERR", e);
  } finally {
    await p.end();
  }
})();
