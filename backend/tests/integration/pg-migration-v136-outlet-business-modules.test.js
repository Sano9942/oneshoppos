/**
 * pg-migration-v136-outlet-business-modules — Business Modules v2, D1a (PLAN-V2 Step 7).
 *
 * Migration v136 is the per-outlet module activation DATA MODEL (schema only,
 * no behavior — the resolution logic lands in Step 8). It:
 *   (a) adds tenant_business_modules.default_outlet_enabled BOOLEAN NOT NULL
 *       DEFAULT TRUE — the value new/unlisted outlets inherit; a module with no
 *       row at all behaves as default_outlet_enabled = TRUE (legal-sparse).
 *   (b) creates outlet_business_modules (outlet_id → outlets ON DELETE CASCADE,
 *       module_key, enabled, updated_by, updated_at, PK (outlet_id, module_key))
 *       for explicit per-outlet overrides.
 *
 * This file proves BOTH provisioning paths carry the shapes:
 *   - fresh install (schema-pg.sql), via the createTestApp schema, and
 *   - upgrade (v136.up on a simulated pre-v136 tenant schema),
 * plus idempotency and the frozen PK / FK-cascade / default semantics.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { MIGRATIONS } = require("../../migrate-pg");

const v136 = MIGRATIONS.find((m) => m.version === 136);

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

async function tableExists(name) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

async function columnDef(table, column) {
  const { rows } = await db.query(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2`,
    [table, column]
  );
  return rows[0] || null;
}

describe("Migration v136 — per-outlet module data model (D1a)", () => {
  it("fresh-install path: schema-pg.sql already carries both shapes", async () => {
    // createTestApp builds the schema from schema-pg.sql — proves the DDL
    // additions are in the fresh-install source of truth, not just the migration.
    expect(await tableExists("outlet_business_modules")).toBe(true);

    const col = await columnDef("tenant_business_modules", "default_outlet_enabled");
    expect(col).not.toBeNull();
    expect(col.data_type).toBe("boolean");
    expect(col.is_nullable).toBe("NO");
    expect(col.column_default).toMatch(/true/);
  });

  it("upgrade path: v136 adds both shapes to a pre-v136 tenant schema that lacks them", async () => {
    // Simulate a pre-v136 tenant: it has the v131 table + outlets, but not the
    // v136 additions.
    await db.query(`DROP TABLE IF EXISTS outlet_business_modules`);
    await db.query(
      `ALTER TABLE tenant_business_modules DROP COLUMN IF EXISTS default_outlet_enabled`
    );
    expect(await tableExists("outlet_business_modules")).toBe(false);
    expect(await columnDef("tenant_business_modules", "default_outlet_enabled")).toBeNull();

    const client = await db.getClient();
    await v136.up(client);

    expect(await tableExists("outlet_business_modules")).toBe(true);
    const col = await columnDef("tenant_business_modules", "default_outlet_enabled");
    expect(col).not.toBeNull();
    expect(col.data_type).toBe("boolean");
    expect(col.is_nullable).toBe("NO");
    expect(col.column_default).toMatch(/true/);
  });

  it("is idempotent — running twice more does not error and preserves both shapes", async () => {
    const client = await db.getClient();
    await v136.up(client); // no-op via IF NOT EXISTS
    await v136.up(client); // and again
    expect(await tableExists("outlet_business_modules")).toBe(true);
    expect(
      await columnDef("tenant_business_modules", "default_outlet_enabled")
    ).not.toBeNull();
  });

  it("outlet_business_modules columns match the frozen shape", async () => {
    const expected = {
      outlet_id: { data_type: "integer", is_nullable: "NO" },
      module_key: { data_type: "text", is_nullable: "NO" },
      enabled: { data_type: "boolean", is_nullable: "NO" },
      updated_by: { data_type: "text", is_nullable: "YES" },
      updated_at: { data_type: "timestamp with time zone", is_nullable: "YES" },
    };
    for (const [name, want] of Object.entries(expected)) {
      const col = await columnDef("outlet_business_modules", name);
      expect(col, name).not.toBeNull();
      expect(col.data_type, name).toBe(want.data_type);
      expect(col.is_nullable, name).toBe(want.is_nullable);
    }
  });

  it("enforces PK (outlet_id, module_key) and FK cascade on outlet delete", async () => {
    // Fresh outlet so deleting it can't disturb the seeded id=1,2 fixtures.
    const {
      rows: [outlet],
    } = await db.query(`INSERT INTO outlets (name) VALUES ('D1a Test Outlet') RETURNING id`);

    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
       VALUES ($1, 'loyalty', false)`,
      [outlet.id]
    );

    // PK: a second row for the same (outlet_id, module_key) is rejected.
    let dup = null;
    try {
      await db.query(
        `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
         VALUES ($1, 'loyalty', true)`,
        [outlet.id]
      );
    } catch (err) {
      dup = err;
    }
    expect(dup).not.toBeNull();
    expect(dup.code).toBe("23505"); // unique_violation

    // Different module_key for the same outlet is fine (composite PK).
    await db.query(
      `INSERT INTO outlet_business_modules (outlet_id, module_key, enabled)
       VALUES ($1, 'gift_cards', true)`,
      [outlet.id]
    );

    // FK ON DELETE CASCADE: removing the outlet clears its override rows.
    await db.query(`DELETE FROM outlets WHERE id = $1`, [outlet.id]);
    const { rows } = await db.query(
      `SELECT 1 FROM outlet_business_modules WHERE outlet_id = $1`,
      [outlet.id]
    );
    expect(rows.length).toBe(0);
  });

  it("default_outlet_enabled defaults TRUE on a sparse anchor insert (inherit rule)", async () => {
    await db.query(
      `INSERT INTO tenant_business_modules (module_key, enabled) VALUES ('d1a_probe', true)
       ON CONFLICT (module_key) DO NOTHING`
    );
    const { rows } = await db.query(
      `SELECT default_outlet_enabled FROM tenant_business_modules WHERE module_key = 'd1a_probe'`
    );
    expect(rows[0].default_outlet_enabled).toBe(true);
  });
});
