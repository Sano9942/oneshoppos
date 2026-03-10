const db = require("../../db-pg");
const fs = require("fs");
const path = require("path");

describe("tenant-db-pg schema isolation", () => {
  const SLUG_A = "test_tenant_a_" + Date.now();
  const SLUG_B = "test_tenant_b_" + Date.now();
  let tenantDb;

  beforeAll(async () => {
    tenantDb = require("../../tenant-db-pg");
    const schema = fs.readFileSync(path.join(__dirname, "../../schema-pg.sql"), "utf8");

    // Provision two test tenant schemas
    for (const slug of [SLUG_A, SLUG_B]) {
      await db.query(`CREATE SCHEMA IF NOT EXISTS tenant_${slug}`);
      const client = await db.getClient();
      try {
        await client.query(`SET search_path = 'tenant_${slug}'`);
        await client.query(schema);
      } finally {
        client.release();
      }
    }
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG_A} CASCADE`);
    await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG_B} CASCADE`);
    await db.end();
  });

  it("isolates data between tenant schemas via runWithTenant", async () => {
    // Insert into tenant A
    await tenantDb.runWithTenant(db, SLUG_A, async () => {
      const proxy = tenantDb.getProxy();
      await proxy.query(
        "INSERT INTO categories (name) VALUES ($1)", ["Tenant A Category"]
      );
    });

    // Insert into tenant B
    await tenantDb.runWithTenant(db, SLUG_B, async () => {
      const proxy = tenantDb.getProxy();
      await proxy.query(
        "INSERT INTO categories (name) VALUES ($1)", ["Tenant B Category"]
      );
    });

    // Verify isolation: tenant A should not see tenant B's data
    await tenantDb.runWithTenant(db, SLUG_A, async () => {
      const proxy = tenantDb.getProxy();
      const { rows } = await proxy.query("SELECT name FROM categories");
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("Tenant A Category");
    });
  });
});
