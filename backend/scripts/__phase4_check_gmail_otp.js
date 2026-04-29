require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const r = await p.query(
      `SELECT id, state, started_on, completed_on,
              data->>'to' AS to_email, data->>'subject' AS subject, data->>'type' AS type
         FROM pgboss.job
        WHERE name='email' AND data->>'to' = 'oneshop349@gmail.com'
          AND data->>'type' = 'customer_portal_email_verify'
        ORDER BY id DESC LIMIT 3`
    );
    console.log("OTP email jobs for oneshop349@gmail.com:");
    console.table(r.rows);
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
