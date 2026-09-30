/**
 * ots-exchange-discount.test.js — One Toy Store pilot F1 / D48.
 *
 * Sends exactly what the POS Return / Exchange screen sends
 * (frontend/src/pages/redesign/pos/exchangeMath.js): the return value rides in
 * discount_amount AND as a "Return Credit" payment; a discount on the balance
 * is added to discount_amount and taken off what the customer pays.
 *
 * Day 1 (INV-2026-00004): 950 back, 990 out, Rs 40 waived in iPOS; SanoPOS
 * booked Card 40 that was never taken.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);

// Products 4 and 5 carry no tax, so totals are plain arithmetic.
const PONY = 4; // returned
const CLAY = 5; // taken in exchange

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
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

const stock = async (id) => num((await one("SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = 1", [id])).quantity);
const payments = async (saleId) =>
  (await all("SELECT payment_method, amount FROM sale_payments WHERE sale_id = $1 ORDER BY id", [saleId]))
    .map((p) => ({ method: p.payment_method, amount: num(p.amount) }));

async function buyPony() {
  const res = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: [{ id: PONY, quantity: 1, price: 950 }],
    payments: [{ method: "Card", amount: 950 }],
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

// The screen: POST the exchange sale first, then the return.
async function exchange({ originalSaleId, clayPrice, discount, settleMethod }) {
  const refund = 950;
  const balance = clayPrice - refund;
  const due = balance - discount;
  const salePayments = [{ method: "Return Credit", amount: refund }];
  if (due > 0) salePayments.push({ method: settleMethod, amount: due });
  const sale = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
    cartItems: [{ id: CLAY, quantity: 1, price: clayPrice }],
    payments: salePayments,
    discount_amount: refund + discount,
    discount_type: "fixed",
    notes: `Exchange for #${originalSaleId}` + (discount > 0 ? `; discount Rs ${discount}` : ""),
  });
  expect(sale.status).toBe(200);
  const ret = await admin().post("/api/returns").send({
    original_sale_id: originalSaleId, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
    total_refund: refund, refund_method: "Return Credit",
    items: [{ product_id: PONY, quantity: 1, refund_price: refund }],
  });
  expect(ret.status).toBe(200);
  return sale.body.saleId;
}

describe("F1 — discount on an exchange balance", () => {
  it("day 1's case: 950 back, 990 out, 40 waived → total 0, no Card line, stock both ways", async () => {
    await openTill(1000);
    const original = await buyPony();
    const ponyBefore = await stock(PONY);
    const clayBefore = await stock(CLAY);

    const saleId = await exchange({ originalSaleId: original, clayPrice: 990, discount: 40, settleMethod: "Card" });

    const sale = await one("SELECT subtotal, discount_amount, total_amount, notes FROM sales WHERE id = $1", [saleId]);
    expect(num(sale.subtotal)).toBe(990);
    expect(num(sale.total_amount)).toBe(0);
    expect(num(sale.discount_amount)).toBe(990);
    expect(sale.notes).toMatch(/discount Rs 40/);
    expect(await payments(saleId)).toEqual([{ method: "Return Credit", amount: 950 }]);
    expect(await stock(PONY)).toBe(ponyBefore + 1);
    expect(await stock(CLAY)).toBe(clayBefore - 1);
  });

  it("a cash-settled exchange keeps its cash line, and the drawer expects it", async () => {
    const shiftId = await openTill(1000);
    const original = await buyPony(); // card, so the drawer only moves by the exchange

    const saleId = await exchange({ originalSaleId: original, clayPrice: 990, discount: 0, settleMethod: "Cash" });

    expect(num((await one("SELECT total_amount FROM sales WHERE id = $1", [saleId])).total_amount)).toBe(40);
    expect(await payments(saleId)).toEqual([
      { method: "Return Credit", amount: 950 },
      { method: "Cash", amount: 40 },
    ]);
    const close = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 1040 });
    expect(close.status).toBe(200);
    expect(num(close.body.expected_cash)).toBe(1040);
  });

  it("part waived, rest paid in cash: 950 back, 1100 out, 50 off → Cash 100", async () => {
    await openTill(1000);
    const original = await buyPony();
    const saleId = await exchange({ originalSaleId: original, clayPrice: 1100, discount: 50, settleMethod: "Cash" });
    expect(num((await one("SELECT total_amount FROM sales WHERE id = $1", [saleId])).total_amount)).toBe(100);
    expect(await payments(saleId)).toEqual([
      { method: "Return Credit", amount: 950 },
      { method: "Cash", amount: 100 },
    ]);
  });

  it("an ordinary cash sale still has its change taken off (Rs 3,000 on 2,800 → Cash 2,800)", async () => {
    await openTill(1000);
    const res = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID,
      cartItems: [{ id: CLAY, quantity: 1, price: 2800 }],
      payments: [{ method: "Cash", amount: 3000 }],
    });
    expect(res.status).toBe(200);
    expect(await payments(res.body.saleId)).toEqual([{ method: "Cash", amount: 2800 }]);
  });
});
