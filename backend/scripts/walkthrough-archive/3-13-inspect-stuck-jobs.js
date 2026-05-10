// Why are the 4 Apr-27 created-state email jobs not being picked up?
// Inspect their full state including expire_in, retry_limit, etc.

const db = require("../db-pg");

(async () => {
  const { rows: cols } = await db.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'pgboss' AND table_name = 'job'
     ORDER BY ordinal_position
  `);
  console.log("columns:", cols.map(c => c.column_name).join(", "));

  const { rows } = await db.query(`
    SELECT *
      FROM pgboss.job
     WHERE name = 'email' AND state = 'created'
     ORDER BY created_on
     LIMIT 1
  `);
  console.log(JSON.stringify(rows[0], null, 2));
  process.exit(0);
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
