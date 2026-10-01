/**
 * ots-day-report.test.js — One Toy Store pilot F4 (D51).
 *
 * The iPOS "Daily Sale Report" slip, from SanoPOS: GET /api/shifts/:id/day-report.
 * Per mode Sub Total / Dis Rs / Bill Total (Online gets its own row per app),
 * real discount only (an old pre-D56 exchange bill's return credit is not a
 * discount; staff toys at cost on their own line), bill count, returns, every
 * Paid out / Paid in, and the cash that should be in the till — the same
 * figure Close Shift expects. Printable while open (check copy) and after.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const ITEM = 4; // no tax: totals are plain arithmetic

let staffFood;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  staffFood = (await one("INSERT INTO expense_categories (name) VALUES ('Staff food') RETURNING id")).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function openTill(float) {
  for (const s of await all("SELECT id FROM cash_shifts WHERE status = 'open'")) {
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [s.id]);
  }
  const res = await admin().post("/api/shifts/open").send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: float });
  expect(res.status).toBe(200);
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: 1 });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
  return res.body.shift_id;
}

async function sell(price, payments, discount = 0) {
  const res = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: [{ id: ITEM, quantity: 1, price }],
    payments,
    discount_amount: discount,
    discount_type: "fixed",
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

const report = async (shiftId) => {
  const res = await admin().get(`/api/shifts/${shiftId}/day-report`);
  expect(res.status).toBe(200);
  return res.body;
};

describe("F4 — day report slip, the iPOS layout", () => {
  let shiftId, staffSale;

  beforeAll(async () => {
    shiftId = await openTill(1000);
    // Cash 1,100 less 100 discount.
    await sell(1100, [{ method: "Cash", amount: 1000 }], 100);
    // Card 2,000.
    await sell(2000, [{ method: "Card", amount: 2000 }]);
    // JazzCash 2,780 less 130 (INV-00078's shape).
    await sell(2780, [{ method: "Online - JazzCash", amount: 2650 }], 130);

    // A bill saved the pre-D56 way (INV-00082): items 390, the 590 return
    // credit stored as the discount, total 0, paid "Return Credit" 390.
    const old = await sell(390, [{ method: "Cash", amount: 390 }]);
    await db.query(
      "UPDATE sales SET discount_amount = 590, total_amount = 0, payment_method = 'Return Credit' WHERE id = $1", [old]);
    await db.query("UPDATE sale_payments SET payment_method = 'Return Credit' WHERE sale_id = $1", [old]);

    // A staff bill: toy 500 at cost 300, paid cash.
    staffSale = await sell(500, [{ method: "Cash", amount: 500 }]);
    await db.query(
      "UPDATE sales SET discount_amount = 200, discount_type = 'staff', total_amount = 300 WHERE id = $1", [staffSale]);
    await db.query("UPDATE sale_payments SET amount = 300 WHERE sale_id = $1", [staffSale]);

    // Cash 400, then returned for cash.
    const back = await sell(400, [{ method: "Cash", amount: 400 }]);
    const ret = await admin().post("/api/returns").send({
      original_sale_id: back, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
      total_refund: 400, refund_method: "Cash",
      items: [{ product_id: ITEM, quantity: 1, refund_price: 400 }],
    });
    expect(ret.status).toBe(200);

    const out = await admin().post("/api/till-payouts").send({
      shift_id: shiftId, kind: "shop_cost", amount: 200, category_id: staffFood, note: "Tea",
    });
    expect(out.status).toBe(201);
    const inn = await admin().post("/api/till-payins").send({ shift_id: shiftId, kind: "bank", amount: 300, account: "Alfalah" });
    expect(inn.status).toBe(201);
  });

  it("one row per mode: CASH, CREDIT CARD, ONLINE - JAZZCASH with Sub Total / Dis Rs / Bill Total", async () => {
    const r = await report(shiftId);
    expect(r.modes.map((m) => [m.label, m.bills, num(m.sub_total), num(m.discount), num(m.bill_total)])).toEqual([
      ["CASH", 3, 1800, 100, 1700],
      ["CREDIT CARD", 1, 2000, 0, 2000],
      ["ONLINE - JAZZCASH", 1, 2780, 130, 2650],
    ]);
  });

  it("totals: Sub Total 6,580, Discount Rs 230 (old exchange credit and staff left out), Total 6,350", async () => {
    const r = await report(shiftId);
    expect(num(r.sub_total)).toBe(6580);
    expect(num(r.discount)).toBe(230);
    expect(num(r.total)).toBe(6350);
    expect(r.bill_count).toBe(6);
    expect(r.staff).toEqual({ bills: 1, discount: 200 });
  });

  it("returns, paid outs and paid ins are listed one by one", async () => {
    const r = await report(shiftId);
    expect(r.returns).toEqual([{ method: "Cash", count: 1, exchanges: 0, paid_back: 400 }]);
    expect(r.paid_outs.map((p) => [p.label, p.detail, p.note, p.amount])).toEqual([["Shop cost", "Staff food", "Tea", 200]]);
    expect(r.paid_ins.map((p) => [p.label, p.detail, p.amount])).toEqual([["From bank", "Alfalah", 300]]);
  });

  it("while open it is a check copy: cash that should be in the till = 1,000 + 1,700 − 400 − 200 + 300 = 2,400", async () => {
    const r = await report(shiftId);
    expect(r.is_check_copy).toBe(true);
    expect(num(r.drawer.opening_float)).toBe(1000);
    expect(num(r.drawer.cash_sales)).toBe(1700);
    expect(num(r.drawer.cash_refunds)).toBe(400);
    expect(num(r.drawer.expected_cash)).toBe(2400);
    expect(r.drawer.counted_cash).toBeNull();
  });

  it("after Close Shift: same expected, counted + difference + note count, reprintable", async () => {
    const close = await admin().post(`/api/shifts/${shiftId}/close`).send({
      closing_cash: 2350,
      denominations: [{ denomination: 1000, count: 2 }, { denomination: 50, count: 7 }],
    });
    expect(close.status).toBe(200);
    expect(num(close.body.expected_cash)).toBe(2400);

    const r = await report(shiftId);
    expect(r.is_check_copy).toBe(false);
    expect(num(r.drawer.expected_cash)).toBe(2400);
    expect(num(r.drawer.counted_cash)).toBe(2350);
    expect(num(r.drawer.difference)).toBe(-50);
    expect(r.drawer.notes).toEqual([{ denomination: 1000, count: 2 }, { denomination: 50, count: 7 }]);
    expect(num(r.total)).toBe(6350);
  });

  it("a pre-D56 exchange return (method 'Return Credit', credit_applied 0) is an exchange with no money back", async () => {
    const id = await openTill(500);
    const sold = await sell(590, [{ method: "Cash", amount: 590 }]);
    const ret = await admin().post("/api/returns").send({
      original_sale_id: sold, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
      total_refund: 590, refund_method: "Return Credit",
      items: [{ product_id: ITEM, quantity: 1, refund_price: 590 }],
    });
    expect(ret.status).toBe(200);
    await db.query("UPDATE returns SET credit_applied = 0 WHERE id = (SELECT MAX(id) FROM returns)");
    const r = await report(id);
    expect(r.returns).toEqual([{ method: "Return Credit", count: 1, exchanges: 1, paid_back: 0 }]);
  });

  it("an unknown shift is a 404", async () => {
    const res = await admin().get("/api/shifts/999999/day-report");
    expect(res.status).toBe(404);
  });
});
