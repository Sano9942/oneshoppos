// Inspect pg-boss "email" queue: count + last few jobs.
// Usage: railway run --service oneshoppos node backend/scripts/3-13-check-pgboss-jobs.js

const db = require("../db-pg");

(async () => {
  // Recent email jobs
  const { rows: recent } = await db.query(`
    SELECT id, name, state, created_on, started_on, completed_on,
           data->>'to' AS to_email, data->>'type' AS email_type,
           output::text AS output
      FROM pgboss.job
     WHERE name = 'email'
     ORDER BY created_on DESC
     LIMIT 5
  `);
  console.log(JSON.stringify({ recent_email_jobs: recent }, null, 2));

  // Count by state for the email queue
  const { rows: states } = await db.query(`
    SELECT state, COUNT(*)::int AS n
      FROM pgboss.job
     WHERE name = 'email'
     GROUP BY state
     ORDER BY state
  `);
  console.log(JSON.stringify({ states }, null, 2));

  process.exit(0);
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
