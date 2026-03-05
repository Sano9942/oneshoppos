/**
 * shift-report-attribution.test.js
 * Verifies shift reports use shift_id (not time-window) to scope sales/returns.
 */
const { createTestApp, closeDb, dbGet, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;
const ADMIN_PIN = "2580";

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => { await closeDb(db); });

async function openFreshShift(outletId = 1) {
  await dbRun(db,
    "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE outlet_id = ? AND status = 'open'",
    [outletId]);
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/shifts/open")
    .send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: 100 });
  expect(res.status).toBe(200);
  return res.body.shift_id;
}

async function ensureClockedIn(outletId = 1) {
  await dbRun(db,
    `UPDATE attendance_sessions SET session_end = datetime('now','localtime'), duration_hours = 0
     WHERE employee_id = ? AND session_end IS NULL`,
    [ADMIN_ID]);
  const res = await makeRequest(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  if (res.status === 400 && /already clocked.?in/i.test(res.body?.error || res.body?.message || "")) return;
  if (res.status !== 200) throw new Error(`Clock-in failed: ${res.status} ${JSON.stringify(res.body)}`);
}

async function makeSale(outletId = 1) {
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/sales")
    .send({
      cartItems: [{ id: 1, quantity: 1, price: 50, cost_price: 30 }],
      paymentMethod: "Cash",
      outlet_id: outletId,
      employee_id: ADMIN_ID,
    });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

async function makeReturn(saleId, outletId = 1) {
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/returns")
    .send({
      original_sale_id: saleId,
      outlet_id: outletId,
      employee_id: ADMIN_ID,
      total_refund: 50,
      refund_method: "Cash",
      reason: "test",
      items: [{ product_id: 1, quantity: 1, refund_price: 50 }],
    });
  expect(res.status).toBe(200);
  return res.body.id;
}

describe("shift-sales report uses shift_id", () => {
  it("returns sale for correct shift, not for a different shift", async () => {
    const shift1 = await openFreshShift(1);
    await ensureClockedIn(1);
    const saleId = await makeSale(1);

    // close shift1, open shift2
    await dbRun(db,
      "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE id = ?",
      [shift1]);
    const shift2 = await openFreshShift(1);

    const resShift1 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-sales?session_id=${shift1}`);
    expect(resShift1.status).toBe(200);
    expect(resShift1.body.sales.map((s) => s.id)).toContain(saleId);

    const resShift2 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-sales?session_id=${shift2}`);
    expect(resShift2.status).toBe(200);
    expect(resShift2.body.sales.map((s) => s.id)).not.toContain(saleId);
  });
});

describe("shift-summary report uses shift_id", () => {
  it("total_sales reflects only the sales in the queried shift", async () => {
    const shift1 = await openFreshShift(1);
    await ensureClockedIn(1);
    await makeSale(1);

    await dbRun(db,
      "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE id = ?",
      [shift1]);
    const shift2 = await openFreshShift(1);
    await ensureClockedIn(1);

    const res1 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-summary?session_id=${shift1}`);
    expect(res1.status).toBe(200);
    expect(Number(res1.body.summary.total_sales)).toBeGreaterThan(0);
    expect(Number(res1.body.summary.order_count)).toBe(1);

    const res2 = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/shift-summary?session_id=${shift2}`);
    expect(res2.status).toBe(200);
    expect(Number(res2.body.summary.total_sales)).toBe(0);
    expect(Number(res2.body.summary.order_count)).toBe(0);
  });
});

describe("cash-audit report uses shift_id", () => {
  it("return in shift1 does not appear in shift2 cash audit", async () => {
    const shift1 = await openFreshShift(1);
    await ensureClockedIn(1);
    const saleId = await makeSale(1);
    const returnId = await makeReturn(saleId, 1);

    await dbRun(db,
      "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE id = ?",
      [shift1]);
    const shift2 = await openFreshShift(1);

    const res = await makeRequest(app, ADMIN_ID)
      .get(`/api/reports/cash-audit?session_id=${shift2}`);
    expect(res.status).toBe(200);
    const refIds = res.body.audit.map((a) => a.ref_id);
    expect(refIds).not.toContain(returnId);
  });
});
