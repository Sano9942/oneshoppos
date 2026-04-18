/**
 * pg-sale-seat-persistence.test.js — Phase 2-R Wave A / 2-R.8
 *
 * Verifies that sale_items.seat_number persists when a restaurant
 * dine-in check with per-seat items is closed through POST /api/sales.
 * Retail sales pass seat_number=null and remain unchanged.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 20000, hookTimeout: 60000 });

describe("Phase 2-R.8 — sale_items.seat_number persistence", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/sales")(app, deps);

    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    await request(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });
  }, 90000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("persists seat_number on each sale_items row when cartItems carry seats", async () => {
    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [
          { id: 1, name: "Burger", price: 100, quantity: 1, cost_price: 60, seat_number: 1 },
          { id: 2, name: "Fries",  price: 200, quantity: 1, cost_price: 120, seat_number: 2 },
        ],
        payments: [{ method: "cash", amount: 300 }],
        idempotency_key: "seat-test-" + Date.now(),
      });

    expect(res.status).toBe(200);
    expect(res.body.saleId).toBeGreaterThan(0);

    const { rows } = await db.query(
      "SELECT product_id, seat_number FROM sale_items WHERE sale_id = $1 ORDER BY product_id",
      [res.body.saleId]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].product_id).toBe(1);
    expect(rows[0].seat_number).toBe(1);
    expect(rows[1].product_id).toBe(2);
    expect(rows[1].seat_number).toBe(2);
  });

  it("retail sale without seat_number leaves column NULL (backward compat)", async () => {
    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [{ id: 3, name: "Retail Item", price: 500, quantity: 1, cost_price: 300 }],
        payments: [{ method: "cash", amount: 500 }],
        idempotency_key: "retail-seat-" + Date.now(),
      });

    expect(res.status).toBe(200);
    const { rows } = await db.query(
      "SELECT seat_number FROM sale_items WHERE sale_id = $1",
      [res.body.saleId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].seat_number).toBeNull();
  });
});
