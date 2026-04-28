const db = require("../../db-pg");

describe("master-db-pg", () => {
  let masterDb;

  beforeAll(async () => {
    masterDb = require("../../master-db-pg");
    await masterDb.init(db);
  });

  afterAll(async () => {
    // Clean up test data (audit log first due to FK)
    await db.query(
      "DELETE FROM tenant_audit_log WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'test_%')"
    );
    await db.query("DELETE FROM tenants WHERE slug LIKE 'test_%'");
    await db.end();
  });

  it("creates master tables in public schema", async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('tenants', 'super_admins', 'tenant_audit_log', 'schema_migrations', 'tenant_refresh_tokens')
       ORDER BY table_name`
    );
    expect(rows.length).toBe(5);
  });

  it("inserts and queries a tenant", async () => {
    const slug = "test_" + Date.now();
    await masterDb.createTenant({
      slug,
      name: "Test Store",
      ownerEmail: "test@example.com",
      timezone: "UTC",
    });
    const tenant = await masterDb.getTenantBySlug(slug);
    expect(tenant.name).toBe("Test Store");
    expect(tenant.status).toBe("active");
  });

  it("provisions a new tenant schema with seed data", async () => {
    const provisioner = require("../../tenant-provisioner-pg");
    const slug = "test_prov_" + Date.now();
    const result = await provisioner.provision(db, {
      slug,
      name: "Provisioned Store",
      ownerEmail: "owner@example.com",
      timezone: "Asia/Karachi",
      pin: "1234",
    });
    expect(result.tenantId).toBeGreaterThan(0);
    expect(result.employeeId).toBeGreaterThan(0);

    // Verify schema exists with data
    const { rows } = await db.query(
      `SELECT company_name FROM tenant_${slug}.company_profile WHERE id = 1`
    );
    expect(rows[0].company_name).toBe("Provisioned Store");

    // schema_version must be pre-seeded with every migration so the next
    // migrateAllTenants() boot doesn't replay v1..vN against a schema that
    // already has every column. Skipping this seed is what trapped the test
    // tenant `livetest1` at v68 in production (Apr 2026).
    const { MIGRATIONS } = require("../../migrate-pg");
    const { rows: versionRows } = await db.query(
      `SELECT version FROM tenant_${slug}.schema_version ORDER BY version`
    );
    expect(versionRows.length).toBe(MIGRATIONS.length);
    expect(versionRows[versionRows.length - 1].version).toBe(
      MIGRATIONS[MIGRATIONS.length - 1].version
    );

    // Cleanup
    await db.query(`DROP SCHEMA IF EXISTS tenant_${slug} CASCADE`);
    await db.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [result.tenantId]);
    await db.query("DELETE FROM tenants WHERE slug = $1", [slug]);
  });
});
