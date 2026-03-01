/**
 * inventory.test.js — Integration tests for /api/transfers and /api/adjustments
 *
 * Tests stock transfers between outlets and stock adjustments (positive/negative).
 */

const { createTestApp, closeDb, dbAll, dbGet, dbRun } = require("../helpers/createTestApp");
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

describe("POST /api/transfers — Stock Transfers", () => {
  it("transfer subtracts source and adds destination outlet_stock", async () => {
    const srcBefore = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");
    const dstBefore = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 2");

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/transfers")
      .send({
        product_id: 1,
        from_outlet_id: 1,
        to_outlet_id: 2,
        quantity: 5,
        employee_id: MANAGER_ID,
        note: "Rebalancing stock",
      });

    expect(res.status).toBe(200);

    const srcAfter = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");
    const dstAfter = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 2");

    expect(srcAfter.quantity).toBe(srcBefore.quantity - 5);
    expect(dstAfter.quantity).toBe(dstBefore.quantity + 5);
  });

  it("transfer with insufficient source stock returns 400", async () => {
    const stock = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/transfers")
      .send({
        product_id: 1,
        from_outlet_id: 1,
        to_outlet_id: 2,
        quantity: stock.quantity + 100,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  it("transfer same outlet returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/transfers")
      .send({
        product_id: 1,
        from_outlet_id: 1,
        to_outlet_id: 1,
        quantity: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different/i);
  });

  it("transfer qty <= 0 returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/transfers")
      .send({
        product_id: 1,
        from_outlet_id: 1,
        to_outlet_id: 2,
        quantity: 0,
      });

    expect(res.status).toBe(400);
    // quantity=0 is falsy, so !quantity is true → hits the "required" check before the > 0 check
    expect(res.body.error).toMatch(/required|greater than zero/i);
  });

  it("transfer to outlet with no existing stock creates new outlet_stock row (upsert)", async () => {
    // Product 3 only has stock at outlet 1, not outlet 2
    const dstBefore = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 2");
    expect(dstBefore).toBeUndefined(); // no row yet

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/transfers")
      .send({
        product_id: 3,
        from_outlet_id: 1,
        to_outlet_id: 2,
        quantity: 2,
      });

    expect(res.status).toBe(200);

    const dstAfter = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 2");
    expect(dstAfter.quantity).toBe(2);
  });

  it("cashier without manage_inventory is blocked", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post("/api/transfers")
      .send({
        product_id: 1,
        from_outlet_id: 1,
        to_outlet_id: 2,
        quantity: 1,
      });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/transfers — List", () => {
  it("returns list of transfers", async () => {
    const res = await makeRequest(app).get("/api/transfers");
    expect(res.status).toBe(200);
    expect(res.body.transfers).toBeDefined();
    expect(Array.isArray(res.body.transfers)).toBe(true);
    expect(res.body.transfers.length).toBeGreaterThan(0);
  });
});

describe("POST /api/adjustments — Stock Adjustments", () => {
  it("positive adjustment increases outlet_stock", async () => {
    const before = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/adjustments")
      .send({
        product_id: 1,
        outlet_id: 1,
        employee_id: MANAGER_ID,
        quantity_change: 10,
        reason: "Stock count correction",
      });

    expect(res.status).toBe(200);

    const after = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");
    expect(after.quantity).toBe(before.quantity + 10);
  });

  it("negative adjustment decreases outlet_stock", async () => {
    const before = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1");

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/adjustments")
      .send({
        product_id: 2,
        outlet_id: 1,
        employee_id: MANAGER_ID,
        quantity_change: -5,
        reason: "Damaged goods",
      });

    expect(res.status).toBe(200);

    const after = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1");
    expect(after.quantity).toBe(before.quantity - 5);
  });

  it("adjustment for product not in outlet creates new outlet_stock row (upsert)", async () => {
    // Product 4 has no stock at outlet 2
    const before = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 2");
    expect(before).toBeUndefined();

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/adjustments")
      .send({
        product_id: 4,
        outlet_id: 2,
        employee_id: MANAGER_ID,
        quantity_change: 15,
        reason: "Initial stock setup",
      });

    expect(res.status).toBe(200);

    const after = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 2");
    expect(after.quantity).toBe(15);
  });

  it("adjustment without reason returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/adjustments")
      .send({
        product_id: 1,
        outlet_id: 1,
        quantity_change: 5,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("negative adjustment that would create negative stock still succeeds (no guard)", async () => {
    // Similar to B2 — adjustments also have no negative-stock guard
    const before = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1");

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/adjustments")
      .send({
        product_id: 5,
        outlet_id: 1,
        employee_id: MANAGER_ID,
        quantity_change: -(before.quantity + 50),
        reason: "Testing negative stock behavior",
      });

    // No guard — succeeds
    expect(res.status).toBe(200);

    const after = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1");
    expect(after.quantity).toBe(-50);
  });
});

describe("GET /api/adjustments — List", () => {
  it("returns list of adjustments", async () => {
    const res = await makeRequest(app).get("/api/adjustments");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
