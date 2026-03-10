const db = require("../../db-pg");
const fs = require("fs");
const path = require("path");

const TEST_SCHEMA = "test_schema_" + Date.now();

describe("schema-pg.sql", () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    const client = await db.getClient();
    try {
      await client.query(`SET search_path = '${TEST_SCHEMA}'`);
      const sql = fs.readFileSync(path.join(__dirname, "../../schema-pg.sql"), "utf8");
      await client.query(sql);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await db.end();
  });

  it("creates all core tables", async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
      [TEST_SCHEMA]
    );
    const tables = rows.map((r) => r.table_name);
    // Spot-check essential tables
    expect(tables).toContain("categories");
    expect(tables).toContain("products");
    expect(tables).toContain("sales");
    expect(tables).toContain("sale_items");
    expect(tables).toContain("employees");
    expect(tables).toContain("customers");
    expect(tables).toContain("outlets");
    expect(tables).toContain("cash_shifts");
    expect(tables).toContain("roles");
    expect(tables).toContain("role_permissions");
    expect(tables).toContain("company_profile");
    expect(tables).toContain("printer_config");
    expect(tables).toContain("email_config");
    expect(tables).toContain("revoked_tokens");
    expect(tables.length).toBeGreaterThanOrEqual(40);
  });

  it("can insert and query a product", async () => {
    const client = await db.getClient();
    try {
      await client.query(`SET search_path = '${TEST_SCHEMA}'`);
      // Need a category and tax first
      await client.query(
        "INSERT INTO categories (name) VALUES ('General')"
      );
      await client.query(
        "INSERT INTO taxes (name, rate) VALUES ('Default', 0)"
      );
      await client.query(
        `INSERT INTO products (barcode, name, price, stock, category_id, tax_id)
         VALUES ('123456', 'Test Product', 10.00, 100, 1, 1)`
      );
      const { rows } = await client.query("SELECT * FROM products WHERE barcode = '123456'");
      expect(rows[0].name).toBe("Test Product");
      expect(Number(rows[0].price)).toBe(10);
    } finally {
      client.release();
    }
  });
});
