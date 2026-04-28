/**
 * pg-migration-v82-products-sku-unique — Phase 3.12 fix F10.
 *
 * Migration v82 adds a partial UNIQUE INDEX on products(sku) WHERE sku IS NOT NULL.
 * - Multiple NULLs allowed (matches livetest1 production state)
 * - Direct INSERT of dup non-NULL SKU rejected at DB level
 * - Idempotent (re-run is a no-op via pg_indexes check)
 * - On legacy tenant with pre-existing dup non-NULL SKUs, skips index creation
 *   with a structured warning and lets the migration succeed.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { MIGRATIONS } = require("../../migrate-pg");

const v82 = MIGRATIONS.find((m) => m.version === 82);

let app, db, deps, cleanup, schemaName;

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;
  schemaName = result.schemaName;
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function getClient() {
  return db.getClient();
}

async function indexExists() {
  const { rows } = await db.query(`
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname  = 'products_sku_unique'
  `);
  return rows.length > 0;
}

async function dropIndexIfPresent() {
  await db.query(`DROP INDEX IF EXISTS products_sku_unique`);
}

describe("Migration v82 — products.sku partial UNIQUE", () => {
  it("creates the partial unique index on a clean schema", async () => {
    await dropIndexIfPresent();
    expect(await indexExists()).toBe(false);

    const client = await getClient();
    await v82.up(client);

    expect(await indexExists()).toBe(true);
  });

  it("is idempotent — running twice does not error", async () => {
    const client = await getClient();
    await v82.up(client); // already created above; should no-op
    await v82.up(client); // and again
    expect(await indexExists()).toBe(true);
  });

  it("allows multiple products with NULL sku", async () => {
    expect(await indexExists()).toBe(true);
    const r1 = await db.query(
      "INSERT INTO products (name, price) VALUES ('Null Sku A', 10) RETURNING id, sku"
    );
    const r2 = await db.query(
      "INSERT INTO products (name, price) VALUES ('Null Sku B', 20) RETURNING id, sku"
    );
    expect(r1.rows[0].sku).toBeNull();
    expect(r2.rows[0].sku).toBeNull();
  });

  it("rejects direct INSERT of duplicate non-NULL SKU", async () => {
    expect(await indexExists()).toBe(true);
    await db.query(
      "INSERT INTO products (name, sku, price) VALUES ('Original', 'V82-UNIQUE-A', 100)"
    );
    let dupError = null;
    try {
      await db.query(
        "INSERT INTO products (name, sku, price) VALUES ('Duplicate', 'V82-UNIQUE-A', 200)"
      );
    } catch (err) {
      dupError = err;
    }
    expect(dupError).not.toBeNull();
    // Postgres unique violation code = 23505
    expect(dupError.code).toBe("23505");
  });

  it("on a schema with pre-existing dup non-NULL SKUs, skips index and does not fail", async () => {
    // Drop the index first so we can simulate a legacy tenant
    await dropIndexIfPresent();
    expect(await indexExists()).toBe(false);

    // Insert two rows with the same SKU (would violate the unique index)
    await db.query(
      "INSERT INTO products (name, sku, price) VALUES ('Legacy Dup A', 'V82-LEGACY-DUP', 1)"
    );
    await db.query(
      "INSERT INTO products (name, sku, price) VALUES ('Legacy Dup B', 'V82-LEGACY-DUP', 2)"
    );

    // Migration should not throw
    const client = await getClient();
    await expect(v82.up(client)).resolves.not.toThrow();

    // Index should NOT have been created (because dups exist)
    expect(await indexExists()).toBe(false);
  });

  it("does nothing in a schema without a products table (public-schema-style)", async () => {
    // Build a tiny new schema without products
    const tmpSchema = `test_v82_no_products_${Date.now()}`;
    const c = await db.getClient();
    try {
      await c.query(`CREATE SCHEMA ${tmpSchema}`);
      await c.query(`SET search_path TO ${tmpSchema}`);
      // No products table created
      await expect(v82.up(c)).resolves.not.toThrow();
    } finally {
      await c.query(`SET search_path TO public`);
      await c.query(`DROP SCHEMA ${tmpSchema} CASCADE`);
    }
  });
});
