/**
 * pg-ws1c-returns-money.test.js — WS1c returns money-path hardening
 *
 * Covers three fixes in routes/returns.js (all from core-research 01-CORE-SPINE):
 *   H5 — refund AMOUNT caps on create: per-line refund_price <= sold price,
 *        and total_refund <= remaining refundable value.
 *   H6 — store_credit refund method actually credits customers.balance +
 *        writes a customer_wallet_ledger row (was a decorative no-op).
 *   M2 — remaining-qty check moved inside the tx under a FOR UPDATE lock so
 *        concurrent returns can't both pass and over-refund.
 *
 * Harness note (M2): createTestApp-pg shares ONE pool client across the whole
 * app, so two POST /api/returns can't run on truly separate connections. We
 * therefore assert the invariant the lock guarantees — cumulative returned qty
 * never exceeds sold qty — rather than racing two live connections. The
 * sequential over-refund rejection is additionally covered by
 * returns-double-refund-cap.test.js.
 *
 * Pattern: pg-batch (vitest, isolated schema, on-demand route registration).
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("WS1c — Returns money-path hardening", () => {
  let app, db, cleanup;

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

    // Active attendance session so POST /api/sales clears its attendance gate.
    const todayJs = new Date().toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO attendance_sessions (employee_id, outlet_id, session_start, session_type)
       VALUES ($1, 1, ($2 || ' 12:00:00')::timestamp, 'work')`,
      [ADMIN_ID, todayJs],
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  async function sell(cartItems) {
    const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems,
      paymentMethod: "Cash",
      outlet_id: 1,
      employee_id: ADMIN_ID,
      customer_id: 1,
    });
    expect(res.status).toBe(200);
    return res.body.saleId;
  }

  // ── M2 — double-refund / cumulative refund cap ─────────────────────────────
  // The in-tx FOR UPDATE lock is the concurrency mechanism; the single shared
  // test connection can't drive two isolated connections, so we assert the
  // invariant the lock guarantees: two returns for the same sold unit can
  // never make cumulative refunded qty exceed sold qty.
  it("M2 — a second return for an already-refunded unit is rejected and the invariant holds", async () => {
    const saleId = await sell([{ id: 1, quantity: 1, price: 100, cost_price: 60 }]);

    const body = {
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    };

    const r1 = await makeRequest(app, ADMIN_ID)
      .post("/api/returns")
      .send({ ...body, reason: "attempt A" });
    expect(r1.status).toBe(200);

    const r2 = await makeRequest(app, ADMIN_ID)
      .post("/api/returns")
      .send({ ...body, reason: "attempt B" });
    expect(r2.status).toBe(400);
    expect(String(r2.body.error || "")).toMatch(/remaining|refunded|exceeds/i);

    const { rows } = await db.query(
      `SELECT COALESCE(SUM(ri.quantity), 0)::int AS refunded
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
        WHERE r.original_sale_id = $1`,
      [saleId],
    );
    expect(rows[0].refunded).toBeLessThanOrEqual(1);
  });

  // ── H5 — refund amount caps ────────────────────────────────────────────────
  it("H5 — rejects a per-line refund_price above the sold price", async () => {
    const saleId = await sell([{ id: 1, quantity: 1, price: 100, cost_price: 60 }]);

    const res = await makeRequest(app, ADMIN_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      total_refund: 10000,
      refund_method: "Cash",
      reason: "over-refund by price",
      items: [{ product_id: 1, quantity: 1, refund_price: 10000 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toMatch(/exceeds|sold price/i);

    // Nothing persisted.
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM returns WHERE original_sale_id = $1",
      [saleId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("H5 — rejects total_refund above the returned lines' sold value", async () => {
    const saleId = await sell([{ id: 1, quantity: 1, price: 100, cost_price: 60 }]);

    const res = await makeRequest(app, ADMIN_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      total_refund: 5000, // header inflated even though line price is honest
      refund_method: "Cash",
      reason: "over-refund by total",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toMatch(/exceeds|maximum refundable/i);
  });

  it("H5 — accepts an honest refund at the sold price", async () => {
    const saleId = await sell([{ id: 1, quantity: 1, price: 100, cost_price: 60 }]);

    const res = await makeRequest(app, ADMIN_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      total_refund: 100,
      refund_method: "Cash",
      reason: "honest refund",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(res.status).toBe(200);
  });

  // ── H6 — store_credit actually credits the wallet ──────────────────────────
  it("H6 — store_credit return raises the wallet balance by exactly the refund + writes a ledger row", async () => {
    const saleId = await sell([{ id: 1, quantity: 2, price: 100, cost_price: 60 }]);

    const before = await db.query("SELECT balance::numeric AS bal FROM customers WHERE id = 1");
    const startBal = Number(before.rows[0].bal);

    const res = await makeRequest(app, ADMIN_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      customer_id: 1,
      total_refund: 200,
      refund_method: "store_credit",
      reason: "store credit refund",
      items: [{ product_id: 1, quantity: 2, refund_price: 100 }],
    });
    expect(res.status).toBe(200);
    const returnId = res.body.id;

    const after = await db.query("SELECT balance::numeric AS bal FROM customers WHERE id = 1");
    expect(Number(after.rows[0].bal)).toBeCloseTo(startBal + 200, 2);

    const { rows: ledger } = await db.query(
      `SELECT type, amount::numeric AS amount, reference_type, reference_id
         FROM customer_wallet_ledger
        WHERE customer_id = 1 AND reference_type = 'return' AND reference_id = $1`,
      [returnId],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("credit");
    expect(Number(ledger[0].amount)).toBeCloseTo(200, 2);
  });

  it("H6 — store_credit refund without a customer is rejected", async () => {
    const saleId = await sell([{ id: 1, quantity: 1, price: 100, cost_price: 60 }]);

    const res = await makeRequest(app, ADMIN_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: 1,
      employee_id: ADMIN_ID,
      // no customer_id
      total_refund: 100,
      refund_method: "store_credit",
      reason: "store credit without customer",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toMatch(/customer/i);

    // The whole tx rolled back — no return row persisted.
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM returns WHERE original_sale_id = $1",
      [saleId],
    );
    expect(rows[0].n).toBe(0);
  });
});
