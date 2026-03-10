const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Postgres test app", () => {
  let app, db, cleanup;

  beforeAll(async () => {
    ({ app, db, cleanup } = await createTestApp());
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("creates test app and queries brands", async () => {
    await db.query("INSERT INTO brands (name) VALUES ($1)", ["TestBrand2"]);
    const { rows } = await db.query("SELECT * FROM brands ORDER BY name");
    // seedData inserts 1 brand ("TestBrand"), we added 1 more
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.name)).toContain("TestBrand2");
  });

  it("seed data includes employees with permissions", async () => {
    const { rows } = await db.query("SELECT id, name, role_id FROM employees ORDER BY id");
    expect(rows.length).toBe(3);
    expect(rows[0].name).toBe("Hassan");

    const { rows: perms } = await db.query(
      "SELECT permission FROM role_permissions WHERE role_id = $1", [1]
    );
    expect(perms.map((r) => r.permission)).toContain("all_access");
  });

  it("seed data includes products with outlet stock", async () => {
    const { rows } = await db.query("SELECT id, name FROM products ORDER BY id");
    expect(rows.length).toBe(5);

    const { rows: stock } = await db.query(
      "SELECT product_id, quantity FROM outlet_stock WHERE outlet_id = 1 ORDER BY product_id"
    );
    expect(stock.length).toBe(5);
    expect(Number(stock[0].quantity)).toBe(50);
  });

  it("seed data includes feature flags", async () => {
    const { rows } = await db.query("SELECT key, enabled FROM feature_flags ORDER BY key");
    expect(rows.length).toBeGreaterThan(10);
  });

  it("transaction helper commits on success", async () => {
    const result = await db.transaction(async (client) => {
      await client.query("INSERT INTO brands (name) VALUES ($1)", ["TxBrand"]);
      const { rows } = await client.query("SELECT name FROM brands WHERE name = $1", ["TxBrand"]);
      return rows[0];
    });
    expect(result.name).toBe("TxBrand");
  });

  it("transaction helper rolls back on error", async () => {
    try {
      await db.transaction(async (client) => {
        await client.query("INSERT INTO brands (name) VALUES ($1)", ["RollbackBrand"]);
        throw new Error("deliberate");
      });
    } catch (err) {
      expect(err.message).toBe("deliberate");
    }
    const { rows } = await db.query("SELECT * FROM brands WHERE name = $1", ["RollbackBrand"]);
    expect(rows.length).toBe(0);
  });
});
