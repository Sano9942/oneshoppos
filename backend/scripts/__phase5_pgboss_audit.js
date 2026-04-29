require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const summary = await p.query(`
      SELECT name,
             COUNT(*) FILTER (WHERE state IN ('created','retry','active')) AS pending,
             COUNT(*) FILTER (WHERE state = 'completed') AS completed,
             COUNT(*) FILTER (WHERE state = 'failed') AS failed,
             COUNT(*) FILTER (WHERE state = 'cancelled') AS cancelled,
             MAX(completed_on) AS last_completed,
             MAX(started_on) AS last_started,
             MAX(created_on) AS last_created
        FROM pgboss.job
       WHERE created_on > NOW() - INTERVAL '14 days'
       GROUP BY name
       ORDER BY name
    `);
    console.log("\n=== pg-boss job summary (last 14d) ===");
    console.table(summary.rows);

    const schedules = await p.query(`SELECT * FROM pgboss.schedule ORDER BY name`);
    console.log("\n=== pg-boss schedules (registered cron jobs) ===");
    console.table(schedules.rows);

    const recentFailed = await p.query(`
      SELECT id, name, state, created_on, started_on, completed_on, output->>'message' AS error_message
        FROM pgboss.job
       WHERE state = 'failed' AND created_on > NOW() - INTERVAL '14 days'
       ORDER BY created_on DESC
       LIMIT 10
    `);
    console.log("\n=== last 10 failed jobs ===");
    console.table(recentFailed.rows);
  } catch (e) {
    console.error("ERR", e);
  } finally {
    await p.end();
  }
})();
