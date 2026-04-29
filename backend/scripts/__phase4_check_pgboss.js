require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const cols = await p.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='pgboss' AND table_name='job' ORDER BY ordinal_position`);
    console.log("pgboss.job columns:", cols.rows.map(r=>r.column_name).join(", "));

    const jobs = await p.query(
      `SELECT id, name, state, data->>'to' AS to_email, data->>'type' AS type, data->>'subject' AS subject
         FROM pgboss.job
        WHERE name = 'email' AND data->>'to' = 'oneshop349@hotmail.com'
        ORDER BY id DESC LIMIT 10`
    );
    console.log("\npgboss.job rows for oneshop349@hotmail.com:");
    console.table(jobs.rows);

    // Also dump all recent email jobs
    const recent = await p.query(
      `SELECT id, name, state, data->>'to' AS to_email, data->>'type' AS type
         FROM pgboss.job
        WHERE name = 'email'
        ORDER BY id DESC LIMIT 5`
    );
    console.log("\nLast 5 email jobs (any recipient):");
    console.table(recent.rows);
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
