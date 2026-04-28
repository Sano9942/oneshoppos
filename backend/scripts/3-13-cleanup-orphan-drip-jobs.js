// One-off: delete pg-boss email jobs that reference deleted tenant 94 (live_test_1).
// These are 48h-delayed drip emails scheduled before the tenant was deleted.
// Without cleanup they'd fire tomorrow and email broken-link drip messages
// to the operator's inbox.
//
// Logged in phase3-findings-WIP.md as M25: tenant deletion should also purge
// pg-boss jobs that reference it.
//
// Usage: railway run --service oneshoppos node backend/scripts/3-13-cleanup-orphan-drip-jobs.js

const db = require("../db-pg");

(async () => {
  // Show what will be deleted
  const { rows: before } = await db.query(`
    SELECT id, data->>'type' AS email_type, data->>'tenantId' AS tenant_id,
           data->>'to' AS to_email, start_after, state
      FROM pgboss.job
     WHERE name = 'email'
       AND state = 'created'
       AND data->>'tenantId' = '94'
  `);
  console.log("Jobs to delete:", JSON.stringify(before, null, 2));

  const { rowCount } = await db.query(`
    DELETE FROM pgboss.job
     WHERE name = 'email'
       AND state = 'created'
       AND data->>'tenantId' = '94'
  `);
  console.log(`Deleted ${rowCount} orphan drip job(s).`);
  process.exit(0);
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
