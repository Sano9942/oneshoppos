// Phase 4 — inspect storefront publication state on livetest1
// Run: railway run --service oneshoppos node backend/scripts/__phase4_storefront_inspect.js

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const SCHEMA = "tenant_livetest1";
  try {
    const ch = await pool.query(
      `SELECT id, code, name, is_active FROM ${SCHEMA}.sales_channels ORDER BY id`
    );
    console.log("\nSales channels:");
    console.table(ch.rows);

    const cp = await pool.query(
      `SELECT cp.channel_id, sc.code AS channel_code, COUNT(*)::int AS row_count,
              SUM(CASE WHEN cp.is_published THEN 1 ELSE 0 END)::int AS published_count
         FROM ${SCHEMA}.channel_publications cp
         JOIN ${SCHEMA}.sales_channels sc ON sc.id = cp.channel_id
        GROUP BY cp.channel_id, sc.code
        ORDER BY cp.channel_id`
    );
    console.log("\nchannel_publications by channel:");
    console.table(cp.rows);

    const list = await pool.query(
      `SELECT p.id, p.name, p.price,
              cp.is_published, cp.published_at
         FROM ${SCHEMA}.products p
         LEFT JOIN ${SCHEMA}.channel_publications cp
                ON cp.product_id = p.id
               AND cp.channel_id = (SELECT id FROM ${SCHEMA}.sales_channels WHERE code='storefront')
        ORDER BY p.id`
    );
    console.log("\nProducts × storefront-channel publication:");
    console.table(list.rows);

    const cfg = await pool.query(
      `SELECT company_name, logo_url, currency_symbol FROM ${SCHEMA}.company_profile LIMIT 1`
    );
    console.log("\ncompany_profile:");
    console.table(cfg.rows);

    const tenants = await pool.query(
      `SELECT id, slug, status, plan FROM public.tenants WHERE slug='livetest1'`
    );
    console.log("\npublic.tenants row:");
    console.table(tenants.rows);
  } catch (err) {
    console.error("ERR", err);
  } finally {
    await pool.end();
  }
})();
