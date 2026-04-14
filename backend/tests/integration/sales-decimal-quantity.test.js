/**
 * sales-decimal-quantity.test.js — M5 integration test
 *
 * Verifies:
 *   1. sale_items.quantity accepts decimal values (e.g. 1.25 kg)
 *   2. gross_weight + tare_weight persist through POST /api/sales
 *   3. Non-weighted sales remain unchanged (tare defaults to 0, gross null)
 *   4. Stock rounds UP on decimal deduction (1.25 kg → deducts 2)
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("M5 — Decimal quantity sales (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Dependency routes
    require("../../routes/taxes")(app, deps);
    require("../../routes/suppliers")(app, deps);
    require("../../routes/categories")(app, deps);
    require("../../routes/customers")(app, deps);
    require("../../routes/employees")(app, deps);
    require("../../routes/roles")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/products")(app, deps);

    // Shift + attendance preflight
    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: {} });
    await request(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("persists decimal quantity + gross/tare for weighted sale", async () => {
    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [{
          id: 1,
          name: "Beef — leg cut",
          price: 2000,
          quantity: 1.25,
          gross_weight: 1.30,
          tare_weight: 0.05,
          cost_price: 1500,
          tax: 0,
        }],
        payments: [{ method: "cash", amount: 2500 }],
        idempotency_key: "m5-weighted-" + Date.now(),
      });

    expect(res.status).toBe(200);
    expect(res.body.saleId).toBeGreaterThan(0);

    const { rows } = await db.query(
      "SELECT quantity, gross_weight, tare_weight FROM sale_items WHERE sale_id = $1",
      [res.body.saleId]
    );
    expect(rows).toHaveLength(1);
    // pg NUMERIC → string; wrap with Number() per backend/CLAUDE.md convention
    expect(Number(rows[0].quantity)).toBeCloseTo(1.25, 3);
    expect(Number(rows[0].gross_weight)).toBeCloseTo(1.30, 3);
    expect(Number(rows[0].tare_weight)).toBeCloseTo(0.05, 3);
  });

  it("non-weighted sale leaves tare=0 and gross null (backward compat)", async () => {
    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [{ id: 2, name: "Widget B", price: 100, quantity: 3, cost_price: 60, tax: 0 }],
        payments: [{ method: "cash", amount: 300 }],
        idempotency_key: "m5-nonweighted-" + Date.now(),
      });

    expect(res.status).toBe(200);

    const { rows } = await db.query(
      "SELECT quantity, gross_weight, tare_weight FROM sale_items WHERE sale_id = $1",
      [res.body.saleId]
    );
    expect(Number(rows[0].quantity)).toBe(3);
    expect(rows[0].gross_weight).toBeNull();
    expect(Number(rows[0].tare_weight)).toBe(0);
  });

  it("decimal quantity rounds UP on stock deduction (prevents overselling)", async () => {
    const { rows: [before] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
    );
    const stockBefore = Number(before.quantity);

    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [{
          id: 1, name: "Beef", price: 2000, quantity: 0.5,
          gross_weight: 0.5, tare_weight: 0, cost_price: 1500, tax: 0,
        }],
        payments: [{ method: "cash", amount: 1000 }],
        idempotency_key: "m5-stock-round-" + Date.now(),
      });
    expect(res.status).toBe(200);

    const { rows: [after] } = await db.query(
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
    );
    // 0.5 kg sold → deducts ceil(0.5) = 1 unit of integer stock
    expect(Number(after.quantity)).toBe(stockBefore - 1);
  });
});
