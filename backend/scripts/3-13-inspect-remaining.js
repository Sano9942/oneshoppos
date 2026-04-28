const db = require("../db-pg");
(async () => {
  const { rows } = await db.query(`
    SELECT id, data->>'type' AS email_type, data->>'tenantId' AS tenant_id,
           data->>'to' AS to_email, start_after, created_on
      FROM pgboss.job WHERE name='email' AND state='created'
  `);
  console.log(JSON.stringify(rows, null, 2));
  // Also show what tenants exist
  const { rows: tenants } = await db.query(`SELECT id, slug, name, status FROM tenants ORDER BY id`);
  console.log("Active tenants:", JSON.stringify(tenants, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
