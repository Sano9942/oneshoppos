// Phase 4 — verify storefront quote vs P8 tax architecture
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const SCHEMA = "tenant_livetest1";
  try {
    const taxes = await pool.query(`SELECT id, name, rate FROM ${SCHEMA}.taxes ORDER BY id`);
    console.log("Taxes:"); console.table(taxes.rows);

    const products = await pool.query(
      `SELECT id, name, price, gst, tax_id, category_id FROM ${SCHEMA}.products WHERE id IN (8,11) ORDER BY id`
    );
    console.log("\nProducts (id 8 = Test Coffee, 11 = Snack Bar):"); console.table(products.rows);

    const cp = await pool.query(`SELECT key, value FROM ${SCHEMA}.company_profile_kv WHERE key IN ('tax_mode','default_tax_id') ORDER BY key`).catch(()=>({rows:[]}));
    console.log("\nCompany profile KV (tax_mode):"); console.table(cp.rows);
    const cprof = await pool.query(`SELECT tax_mode, is_gst_registered FROM ${SCHEMA}.company_profile LIMIT 1`).catch(()=>({rows:[{note:'columns not found'}]}));
    console.log("\nCompany profile cols:"); console.table(cprof.rows);
  } catch (err) { console.error("ERR", err.message); }
  finally { await pool.end(); }
})();
