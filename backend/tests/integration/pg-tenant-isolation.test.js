/**
 * pg-tenant-isolation.test.js — Verifies cross-tenant data isolation at the API level.
 *
 * Provisions two isolated test schemas (simulating two tenants), makes API calls
 * against each, and asserts that data from one tenant never leaks to another.
 *
 * Uses createTestApp from createTestApp-pg.js for each tenant — same wiring as all
 * other pg integration tests but run twice in parallel.
 */
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

/**
 * Wire routes needed for isolation tests onto an app created by createTestApp.
 * createTestApp only wires middleware — routes must be registered per test file.
 */
function wireRoutes(app, deps) {
  require("../../routes/taxes")(app, deps);
  require("../../routes/categories")(app, deps);
  require("../../routes/customers")(app, deps);
  require("../../routes/employees")(app, deps);
  require("../../routes/roles")(app, deps);
  require("../../routes/shifts")(app, deps);
  require("../../routes/suppliers")(app, deps);
  require("../../routes/products")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/attendance")(app, deps);
}

describe("Tenant Isolation", () => {
  let tenantA, tenantB;

  beforeAll(async () => {
    // Provision two independent tenants (separate schemas, separate Express apps)
    [tenantA, tenantB] = await Promise.all([
      createTestApp(),
      createTestApp(),
    ]);
    // Wire routes onto each tenant's app
    wireRoutes(tenantA.app, tenantA.deps);
    wireRoutes(tenantB.app, tenantB.deps);
  }, 30000);

  afterAll(async () => {
    // cleanup() drops schema + releases client — do NOT call pool.end()
    await tenantA.cleanup();
    await tenantB.cleanup();
  });

  // ─── API-level isolation tests ────────────────────────────────────────────

  it("products created in tenant A are invisible to tenant B", async () => {
    // Create a product in tenant A
    const createRes = await request(tenantA.app)
      .post("/api/products")
      .set("x-employee-id", "1")
      .send({
        name: "Tenant A Exclusive Widget",
        price: 99.99,
        stock: 10,
        cost_price: 50,
        category_id: 1,
      });
    expect(createRes.status).toBe(200);

    // Tenant A sees it
    const listA = await request(tenantA.app)
      .get("/api/products")
      .set("x-employee-id", "1");
    expect(listA.status).toBe(200);
    const namesA = (listA.body.products || listA.body).map((p) => p.name);
    expect(namesA).toContain("Tenant A Exclusive Widget");

    // Tenant B does NOT see it
    const listB = await request(tenantB.app)
      .get("/api/products")
      .set("x-employee-id", "1");
    expect(listB.status).toBe(200);
    const namesB = (listB.body.products || listB.body).map((p) => p.name);
    expect(namesB).not.toContain("Tenant A Exclusive Widget");
  });

  it("categories created in tenant B are invisible to tenant A", async () => {
    const catRes = await request(tenantB.app)
      .post("/api/categories")
      .set("x-employee-id", "1")
      .send({ name: "Tenant B Electronics" });
    expect(catRes.status).toBe(200);

    const listA = await request(tenantA.app)
      .get("/api/categories")
      .set("x-employee-id", "1");
    expect(listA.status).toBe(200);
    const names = (listA.body.categories || listA.body).map((c) => c.name);
    expect(names).not.toContain("Tenant B Electronics");

    // Tenant B sees its own
    const listB = await request(tenantB.app)
      .get("/api/categories")
      .set("x-employee-id", "1");
    const namesB = (listB.body.categories || listB.body).map((c) => c.name);
    expect(namesB).toContain("Tenant B Electronics");
  });

  it("customers created in tenant A are invisible to tenant B", async () => {
    const custRes = await request(tenantA.app)
      .post("/api/customers")
      .set("x-employee-id", "1")
      .send({ name: "Alice from A", mobile: "111-0001" });
    expect(custRes.status).toBe(200);

    const listB = await request(tenantB.app)
      .get("/api/customers")
      .set("x-employee-id", "1");
    expect(listB.status).toBe(200);
    const names = (listB.body.customers || listB.body).map((c) => c.name);
    expect(names).not.toContain("Alice from A");
  });

  it("suppliers inserted directly in tenant A DB are invisible to tenant B", async () => {
    // Direct DB insert — bypasses API, tests raw schema isolation
    await tenantA.db.query(
      "INSERT INTO suppliers (name, contact_person) VALUES ($1, $2)",
      ["Supplier Only In A", "Contact A"]
    );

    // Tenant B query — must not see it
    const { rows } = await tenantB.db.query(
      "SELECT * FROM suppliers WHERE name = $1", ["Supplier Only In A"]
    );
    expect(rows.length).toBe(0);

    // Tenant A query — must see it
    const { rows: rowsA } = await tenantA.db.query(
      "SELECT * FROM suppliers WHERE name = $1", ["Supplier Only In A"]
    );
    expect(rowsA.length).toBe(1);
  });

  it("sales in tenant A are isolated from tenant B (full sale lifecycle)", async () => {
    // Open shift in tenant A
    const shiftRes = await request(tenantA.app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ employee_id: 1, outlet_id: 1, opening_float: 1000 });
    expect(shiftRes.status).toBe(200);

    // Clock in employee for tenant A (required for sale)
    await tenantA.db.query(
      `INSERT INTO attendance_sessions (employee_id, session_start, outlet_id)
       VALUES (1, NOW(), 1)`
    );
    await tenantA.db.query(
      `INSERT INTO employee_attendance (employee_id, check_in, outlet_id)
       VALUES (1, NOW(), 1)`
    );

    // Create a sale in tenant A
    const saleRes = await request(tenantA.app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1, cost_price: 60 }],
        payments: [{ method: "cash", amount: 100 }],
        outlet_id: 1,
      });
    expect([200, 201]).toContain(saleRes.status);

    // Tenant A has 1 sale
    const { rows: salesA } = await tenantA.db.query("SELECT COUNT(*)::int AS cnt FROM sales");
    expect(salesA[0].cnt).toBe(1);

    // Tenant B has 0 sales — complete isolation
    const { rows: salesB } = await tenantB.db.query("SELECT COUNT(*)::int AS cnt FROM sales");
    expect(salesB[0].cnt).toBe(0);
  });

  // ─── Concurrent request safety (AsyncLocalStorage) ───────────────────────

  it("concurrent requests to different tenants do not leak data via AsyncLocalStorage", async () => {
    // Fire parallel product creation to both tenants simultaneously
    const [resA, resB] = await Promise.all([
      request(tenantA.app)
        .post("/api/products")
        .set("x-employee-id", "1")
        .send({ name: "Concurrent A Only", price: 10, stock: 5, cost_price: 5, category_id: 1 }),
      request(tenantB.app)
        .post("/api/products")
        .set("x-employee-id", "1")
        .send({ name: "Concurrent B Only", price: 20, stock: 5, cost_price: 10, category_id: 1 }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Verify A's product is only in A
    const { rows: aProducts } = await tenantA.db.query(
      "SELECT name FROM products WHERE name LIKE 'Concurrent%'"
    );
    expect(aProducts.map((r) => r.name)).toContain("Concurrent A Only");
    expect(aProducts.map((r) => r.name)).not.toContain("Concurrent B Only");

    // Verify B's product is only in B
    const { rows: bProducts } = await tenantB.db.query(
      "SELECT name FROM products WHERE name LIKE 'Concurrent%'"
    );
    expect(bProducts.map((r) => r.name)).toContain("Concurrent B Only");
    expect(bProducts.map((r) => r.name)).not.toContain("Concurrent A Only");
  });

  // ─── Seed data isolation ─────────────────────────────────────────────────

  it("seed data is independent — each tenant has its own base products", async () => {
    // Both tenants were seeded with the same 5 products, but they're separate copies
    const { rows: aCount } = await tenantA.db.query("SELECT COUNT(*)::int AS cnt FROM products");
    const { rows: bCount } = await tenantB.db.query("SELECT COUNT(*)::int AS cnt FROM products");

    // Tenant A has 5 seed + products created in earlier tests
    expect(aCount[0].cnt).toBeGreaterThanOrEqual(5);
    // Tenant B has 5 seed + products created in earlier tests
    expect(bCount[0].cnt).toBeGreaterThanOrEqual(5);
  });
});
