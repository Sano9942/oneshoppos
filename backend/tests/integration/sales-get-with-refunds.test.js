/**
 * sales-get-with-refunds.test.js — F2 regression coverage (Apr 28 2026)
 *
 * GET /api/sales/:id used to return { sale, items, payments } with no
 * refund context. The Sales History detail panel and the POS Return /
 * Exchange modal both consume this endpoint to populate themselves —
 * and both displayed the original sold quantity even when prior returns
 * existed, giving cashiers a one-click path to over-refund (closed by
 * F1 on the backend, but the UX trap remained).
 *
 * F2 surfaces the refund context the UI needs:
 *   items[i].refunded_qty   — total qty already refunded for this line
 *   sale.refund_total       — sum of all refunds against this sale
 *
 * Pattern: pg-batch (vitest, isolated test schema, on-demand route registration).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("F2 — GET /api/sales/:id exposes refund context", () => {
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

    const shiftRes = await req
      .post("/api/shifts/open")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    expect([200, 201]).toContain(shiftRes.status);

    // Same TZ-safe attendance seed as the F1 regression test.
    const todayJs = new Date().toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO attendance_sessions (employee_id, outlet_id, session_start, session_type)
       VALUES ($1, 1, ($2 || ' 12:00:00')::timestamp, 'work')`,
      [ADMIN_ID, todayJs],
    );

    // Sell 2 of product 1 + 1 of product 2 (different prices so refund_total
    // math is non-trivial).
    const saleRes = await req.post("/api/sales").send({
      cartItems: [
        { id: 1, quantity: 2, price: 100, cost_price: 60 },
        { id: 2, quantity: 1, price: 200, cost_price: 120 },
      ],
      paymentMethod: "Cash",
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);
    saleId = saleRes.body.saleId;

    // Refund 1 unit of product 1 only (Rs 100). Product 2 stays untouched.
    const retRes = await req.post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      total_refund: 100,
      refund_method: "Cash",
      reason: "F2 fixture",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(retRes.status).toBe(200);
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("response includes a per-item refunded_qty", async () => {
    const res = await makeRequest(app, ADMIN_ID).get(`/api/sales/${saleId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);

    const item1 = res.body.items.find((i) => Number(i.product_id) === 1);
    const item2 = res.body.items.find((i) => Number(i.product_id) === 2);
    expect(item1).toBeTruthy();
    expect(item2).toBeTruthy();

    // 1 of 2 refunded for product 1
    expect(Number(item1.refunded_qty)).toBe(1);
    // 0 of 1 refunded for product 2
    expect(Number(item2.refunded_qty)).toBe(0);
  });

  it("response includes a top-level refund_total", async () => {
    const res = await makeRequest(app, ADMIN_ID).get(`/api/sales/${saleId}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.sale.refund_total)).toBe(100);
  });

  it("a sale with no returns reports refunded_qty=0 and refund_total=0", async () => {
    // Fresh sale, no return against it.
    const req = makeRequest(app, ADMIN_ID);
    const saleRes = await req.post("/api/sales").send({
      cartItems: [{ id: 3, quantity: 1, price: 500, cost_price: 300 }],
      paymentMethod: "Cash",
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);
    const freshId = saleRes.body.saleId;

    const res = await req.get(`/api/sales/${freshId}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.sale.refund_total)).toBe(0);
    expect(res.body.items.every((i) => Number(i.refunded_qty) === 0)).toBe(true);
  });
});
