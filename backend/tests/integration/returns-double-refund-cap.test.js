/**
 * returns-double-refund-cap.test.js — F1 regression coverage (Apr 28 2026)
 *
 * Closes a data-integrity hole found during the Phase 3.2 walkthrough:
 *
 *   POST /api/returns capped requested qty against `SUM(sale_items.quantity)`
 *   only — it did NOT subtract `SUM(prior return_items.quantity)` for the same
 *   `original_sale_id`. So a sale of 2 units already partially refunded by 1
 *   could still have a second return for 2 accepted (`2 <= 2`), producing a
 *   double-refund + phantom restock of 1 unit.
 *
 *   The fix subtracts prior returned qty from the per-(product, variant) cap.
 *   These tests fail-closed against the buggy version and pass after the fix.
 *
 * Pattern: pg-batch (vitest, isolated test schema, on-demand route registration).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("F1 — Returns over-refund cap (subtract prior returns)", () => {
  let app, db, cleanup;
  let saleId;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    cleanup = ctx.cleanup;

    require("../../routes/sales")(app, ctx.deps);
    require("../../routes/returns")(app, ctx.deps);
    require("../../routes/shifts")(app, ctx.deps);

    const req = makeRequest(app, ADMIN_ID);

    // Open a shift on outlet 1
    const shiftRes = await req
      .post("/api/shifts/open")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    expect([200, 201]).toContain(shiftRes.status);

    // Seed an active attendance_session so POST /api/sales clears its
    // attendance gate. We stamp session_start at noon of "today" in Postgres
    // session-TZ — using the same JS-computed date string the route compares
    // against — so we can't be tripped up by a Postgres TZ ahead of UTC
    // (e.g. Asia/Karachi flipping the date a few hours before UTC does).
    const todayJs = new Date().toISOString().slice(0, 10); // route's $2
    await db.query(
      `INSERT INTO attendance_sessions (employee_id, outlet_id, session_start, session_type)
       VALUES ($1, 1, ($2 || ' 12:00:00')::timestamp, 'work')`,
      [ADMIN_ID, todayJs],
    );

    // Sell 2 units of product 1 (price 100 from seed) — sets up the canonical
    // partial-refund scenario for all 4 cases below.
    const saleRes = await req.post("/api/sales").send({
      cartItems: [{ id: 1, quantity: 2, price: 100, cost_price: 60 }],
      paymentMethod: "Cash",
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);
    saleId = saleRes.body.saleId;
    expect(saleId).toBeTruthy();
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("accepts the first return — 1 of 2 units, 1 remaining", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        reason: "first partial refund",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });
    expect(res.status).toBe(200);
  });

  it("REJECTS a follow-up return that asks for 2 units when only 1 is left", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 200,
        refund_method: "Cash",
        reason: "attempting to over-refund",
        items: [{ product_id: 1, quantity: 2, refund_price: 100 }],
      });
    expect(res.status).toBe(400);
    // The error message must mention what's wrong — "remaining", "already
    // refunded", or "exceeds remaining" are all acceptable shapes. Avoid
    // pinning to exact wording so we can iterate on copy without breaking
    // the test.
    expect(String(res.body.error || "")).toMatch(
      /remaining|already refunded|already returned|exceeds/i,
    );
  });

  it("accepts a follow-up return for the actual remaining 1 unit", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        reason: "second partial — fills the sale",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });
    expect(res.status).toBe(200);
  });

  it("REJECTS any return after the sale is fully refunded", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        reason: "trying once more after full refund",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });
    expect(res.status).toBe(400);
  });
});
