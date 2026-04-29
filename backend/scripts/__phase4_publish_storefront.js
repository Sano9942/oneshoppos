// Phase 4 — publish 2 livetest1 products to storefront for end-to-end browse test.
// Run: railway run --service oneshoppos node backend/scripts/__phase4_publish_storefront.js
// This is reversible: delete from channel_publications WHERE channel_id = (storefront).

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const SCHEMA = "tenant_livetest1";
  // Publishing Test Coffee (id=8) and Snack Bar (id=11) — both have stock + tax rates
  const PRODUCT_IDS = [8, 11];
  try {
    const sf = await pool.query(
      `SELECT id FROM ${SCHEMA}.sales_channels WHERE code='storefront'`
    );
    const channelId = sf.rows[0].id;
    console.log("storefront channel id:", channelId);

    for (const pid of PRODUCT_IDS) {
      await pool.query(
        `INSERT INTO ${SCHEMA}.channel_publications (channel_id, product_id, is_published, published_at)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (channel_id, product_id, COALESCE(variant_id, 0))
         DO UPDATE SET is_published = true, published_at = NOW()`,
        [channelId, pid]
      );
      console.log(`  published product id=${pid}`);
    }

    const cp = await pool.query(
      `SELECT cp.product_id, p.name, p.price, cp.is_published
         FROM ${SCHEMA}.channel_publications cp
         JOIN ${SCHEMA}.products p ON p.id = cp.product_id
        WHERE cp.channel_id = $1
        ORDER BY p.id`,
      [channelId]
    );
    console.log("\nNow published to storefront:");
    console.table(cp.rows);
  } catch (err) {
    console.error("ERR", err);
  } finally {
    await pool.end();
  }
})();
