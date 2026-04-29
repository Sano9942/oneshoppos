require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const r = await p.query(
      `SELECT id, state, started_on, completed_on,
              data->>'to' AS to_email, data->>'from' AS from_addr,
              data->>'subject' AS subject, data->>'type' AS type,
              output
         FROM pgboss.job
        WHERE id = '79d2a5d2-f572-4216-aad3-fae2e106b7c6'`
    );
    console.log(JSON.stringify(r.rows[0], null, 2));
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
