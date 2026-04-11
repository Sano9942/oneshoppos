require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const SCHEMA_NAME = "tenant_m1_test";
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, "..", "schema-pg.sql"), "utf8");

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.log(`[1/4] Drop+recreate ${SCHEMA_NAME}...`);
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA_NAME}`);

    console.log(`[2/4] SET search_path = ${SCHEMA_NAME}`);
    await client.query(`SET search_path = '${SCHEMA_NAME}'`);

    console.log(`[3/4] Apply schema-pg.sql (${SCHEMA_SQL.length} bytes)...`);
    await client.query(SCHEMA_SQL);

    const tables = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [SCHEMA_NAME]
    );
    console.log(`[OK] schema applied cleanly. ${tables.rows[0].n} tables created.`);

    console.log(`[4/4] Drop ${SCHEMA_NAME}`);
    await client.query(`SET search_path = 'public'`);
    await client.query(`DROP SCHEMA ${SCHEMA_NAME} CASCADE`);
    console.log("DONE");
  } catch (err) {
    console.error("[FAIL]", err.message);
    try { await client.query(`SET search_path = 'public'`); await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA_NAME} CASCADE`); } catch {}
    process.exit(1);
  } finally {
    await client.end();
  }
})();
