require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const { rows } = await p.query(`
      SELECT j.id,
             (j.data->>'tenantId')::int AS tenant_id,
             t.slug AS tenant_slug,
             t.name AS tenant_name,
             j.data->>'type' AS email_type,
             j.data->>'to'   AS to_email,
             j.data->>'from' AS from_address,
             j.data->>'subject' AS subject,
             j.start_after AS send_at,
             CASE WHEN j.state = 'completed' THEN j.completed_on ELSE NULL END AS sent_at,
             CASE WHEN j.state IN ('failed', 'cancelled') THEN j.output->>'message' ELSE NULL END AS error,
             (j.retry_count + 1) AS attempts,
             (j.retry_limit + 1) AS max_attempts,
             j.created_on AS created_at,
             j.state AS pgboss_state
        FROM pgboss.job j
        LEFT JOIN tenants t ON t.id = (j.data->>'tenantId')::int
       WHERE j.name = 'email'
       ORDER BY j.created_on DESC
       LIMIT 20
    `);
    console.log(`\n=== ${rows.length} email jobs (pg-boss) ===`);
    console.table(rows);

    const { rows: counts } = await p.query(`
      SELECT
        COUNT(*) FILTER (WHERE state IN ('created','retry','active')) AS pending,
        COUNT(*) FILTER (WHERE state = 'completed') AS sent,
        COUNT(*) FILTER (WHERE state IN ('failed','cancelled')) AS failed
      FROM pgboss.job WHERE name = 'email'
    `);
    console.log("\n=== counts ===");
    console.table(counts);
  } catch (e) {
    console.error("ERR", e);
  } finally {
    await p.end();
  }
})();
