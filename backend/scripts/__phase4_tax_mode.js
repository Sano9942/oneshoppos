require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const r = await p.query("SELECT column_name FROM information_schema.columns WHERE table_schema='tenant_livetest1' AND table_name='company_profile' AND column_name IN ('tax_mode','is_gst_registered','ntn','strn') ORDER BY column_name");
    console.log("tax-related cols:", r.rows.map(r=>r.column_name));
    const v = await p.query("SELECT tax_mode FROM tenant_livetest1.company_profile LIMIT 1");
    console.log("tax_mode value:", v.rows);
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e) { console.error("ERR", e.message); }
  finally { await p.end(); }
})();
