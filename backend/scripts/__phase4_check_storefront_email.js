require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const r = await p.query(
      `SELECT id, state, data->>'to' AS to_email, data->>'type' AS type, data->>'subject' AS subject
         FROM pgboss.job
        WHERE name='email' AND (data->>'type' ILIKE '%order%' OR data->>'type' ILIKE '%web_order%' OR data->>'type' ILIKE '%storefront%')
        ORDER BY id DESC LIMIT 10`
    );
    console.log("Order/storefront email jobs:");
    console.table(r.rows);
    if (r.rows.length === 0) console.log("(none — confirms M31)");
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
