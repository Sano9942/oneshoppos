/**
 * health.test.js — Infrastructure smoke test.
 * Verifies the test harness (createTestApp, seedSchema, seedData) works correctly.
 */

const { createTestApp, closeDb, dbAll, dbGet } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

describe("Test Infrastructure", () => {
  it("health endpoint returns ok", async () => {
    const res = await makeRequest(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe("reachable");
  });

  it("seed data created outlets", async () => {
    const outlets = await dbAll(db, "SELECT * FROM outlets ORDER BY id");
    expect(outlets).toHaveLength(2);
    expect(outlets[0].name).toBe("Main Store");
    expect(outlets[1].name).toBe("Branch Store");
  });

  it("seed data created employees with roles", async () => {
    const employees = await dbAll(db, "SELECT * FROM employees ORDER BY id");
    expect(employees).toHaveLength(3);
    expect(employees[0].role).toBe("Administrator");
    expect(employees[1].role).toBe("Manager");
    expect(employees[2].role).toBe("Cashier");
  });

  it("seed data created products with outlet stock", async () => {
    const products = await dbAll(db, "SELECT * FROM products ORDER BY id");
    expect(products).toHaveLength(5);

    const stock = await dbAll(db, "SELECT * FROM outlet_stock WHERE outlet_id = 1 ORDER BY product_id");
    expect(stock).toHaveLength(5);
    expect(stock[0].quantity).toBe(50); // Widget A
  });

  it("seed data created customer with wallet", async () => {
    const customer = await dbGet(db, "SELECT * FROM customers WHERE id = 1");
    expect(customer.name).toBe("Test Customer");
    expect(customer.balance).toBe(500);
    expect(customer.loyalty_points).toBe(100);
  });

  it("seed data created feature flags", async () => {
    const flags = await dbAll(db, "SELECT * FROM feature_flags");
    expect(flags.length).toBeGreaterThan(0);
    const supplierPayables = flags.find((f) => f.key === "supplier_payables");
    expect(supplierPayables.enabled).toBe(1);
  });

  it("admin can access protected routes", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/products");
    expect(res.status).toBe(200);
  });

  it("anonymous request to GET /api/products works (no perm required for GET)", async () => {
    const res = await makeRequest(app).get("/api/products");
    expect(res.status).toBe(200);
  });

  it("cashier is blocked from POST /api/products (requires manage_inventory)", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post("/api/products")
      .send({ name: "Test", price: 10, barcode: "TEST-BLOCK" });
    expect(res.status).toBe(403);
  });
});
