/**
 * shift-linkage.test.js — shift_id is written to sales and returns at creation time
 *
 * Verifies that sales and returns store the active shift ID directly,
 * enabling exact shift attribution without time-window matching.
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

afterAll(async () => {
  await closeDb(db);
});

async function openFreshShift(outletId = 1) {
  // Close any existing open shift first
  await dbRun(db, "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE outlet_id = ? AND status = 'open'", [outletId]);

  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/shifts/open")
    .send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: 100 });
  expect(res.status).toBe(200);
  return res.body.shift_id;
}

async function ensureClockedIn(outletId = 1) {
  await dbRun(
    db,
    `UPDATE attendance_sessions SET session_end = datetime('now','localtime'), duration_hours = 0
     WHERE employee_id = ? AND session_end IS NULL`,
    [ADMIN_ID],
  );
  const res = await makeRequest(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  if (![200, 400].includes(res.status)) throw new Error(`Clock-in failed: ${res.status}`);
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

// ────────────────────────────────────────────────────────────────────────────
// SALES
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/sales — shift_id linkage", () => {
  it("sale row has shift_id matching the open shift at checkout", async () => {
    const shiftId = await openFreshShift(1);
    await ensureClockedIn(1);

    const saleId = await makeSale(1);

    const row = await dbGet(db, "SELECT shift_id FROM sales WHERE id = ?", [saleId]);
    expect(row.shift_id).toBe(shiftId);
  });

  it("sales from two different shifts have different shift_ids", async () => {
    const shift1 = await openFreshShift(1);
    await ensureClockedIn(1);
    const sale1 = await makeSale(1);

    // Close shift1, open shift2
    await dbRun(db, "UPDATE cash_shifts SET status = 'closed', closed_at = datetime('now') WHERE id = ?", [shift1]);
    const shift2 = await openFreshShift(1);
    await ensureClockedIn(1);
    const sale2 = await makeSale(1);

    const row1 = await dbGet(db, "SELECT shift_id FROM sales WHERE id = ?", [sale1]);
    const row2 = await dbGet(db, "SELECT shift_id FROM sales WHERE id = ?", [sale2]);

    expect(row1.shift_id).toBe(shift1);
    expect(row2.shift_id).toBe(shift2);
    expect(row1.shift_id).not.toBe(row2.shift_id);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// RETURNS
// ────────────────────────────────────────────────────────────────────────────

describe("POST /api/returns — shift_id linkage", () => {
  it("return row has shift_id matching the open shift at return time", async () => {
    const shiftId = await openFreshShift(1);
    await ensureClockedIn(1);
    const saleId = await makeSale(1);

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 50,
        refund_method: "Cash",
        reason: "test return",
        items: [{ product_id: 1, quantity: 1, refund_price: 50 }],
      });
    expect(res.status).toBe(200);

    const row = await dbGet(db, "SELECT shift_id FROM returns WHERE id = ?", [res.body.id]);
    expect(row.shift_id).toBe(shiftId);
  });
});
