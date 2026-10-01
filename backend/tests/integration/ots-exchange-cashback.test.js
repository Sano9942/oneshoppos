/**
 * ots-exchange-cashback.test.js — One Toy Store pilot D56.
 *
 * 2026-10-01 INV-00082: Water Game Large 590 (cash, INV-00081) exchanged for
 * Water Game 269D4 390; the customer got Rs 200 cash back. The return was
 * saved as 'Return Credit' 590 and the new bill as 390 − a 590 "discount" =
 * 0, so the 200 never came off the drawer, the 590 counted as a discount, and
 * the pair netted to 0 sales instead of 390.
 *
 * New shape (frontend exchangeMath.js): the new bill is saved at its real
 * price, paid by "Return Credit" up to the return value (+ money for any
 * extra), marked `exchange_full_price`; the return keeps its full value and
 * records `credit_applied` (the part spent on the new items) and the real
 * method of the rest. Drawer = refunds of method Cash minus credit_applied.
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
const LARGE = 4; // returned
const SMALL = 5; // taken in exchange

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

const payments = async (saleId) =>
  (await all("SELECT payment_method, amount FROM sale_payments WHERE sale_id = $1 ORDER BY id", [saleId]))
    .map((p) => ({ method: p.payment_method, amount: num(p.amount) }));

async function buyLarge(price = 590, method = "Cash") {
  const res = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: [{ id: LARGE, quantity: 1, price }],
    payments: [{ method, amount: price }],
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

// What the screen sends now: sale first (full price), then the return.
async function exchange({ originalSaleId, refund, newPrice, discount = 0, payBy = "Cash", payAmount, backBy = "Cash" }) {
  const balance = newPrice - refund;
  const credit = Math.min(refund, newPrice);
  const salePayments = [{ method: "Return Credit", amount: credit }];
  const due = balance > 0 ? balance - discount : 0;
  if (due > 0) salePayments.push({ method: payBy, amount: payAmount ?? due });
  const sale = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
    cartItems: [{ id: SMALL, quantity: 1, price: newPrice }],
    payments: salePayments,
    discount_amount: discount,
    discount_type: "fixed",
    exchange_full_price: true,
    notes: `Exchange for #${originalSaleId}`,
  });
  expect(sale.status).toBe(200);
  const ret = await admin().post("/api/returns").send({
    original_sale_id: originalSaleId, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
    total_refund: refund,
    refund_method: balance < 0 ? backBy : "Return Credit",
    credit_applied: credit,
    items: [{ product_id: LARGE, quantity: 1, refund_price: refund }],
  });
  expect(ret.status).toBe(200);
  return { saleId: sale.body.saleId, returnId: ret.body.returnId ?? ret.body.id };
}

async function dashboardRow(shiftId) {
  const res = await admin().get("/api/reports/dashboard");
  expect(res.status).toBe(200);
  return (res.body.cashPosition?.by_outlet || []).find((r) => r.shift_id === shiftId);
}

describe("D56 — exchange where the shop gives money back", () => {
  let shiftId, saleId;

  it("INV-00082's case: 590 back, 390 out, 200 cash back → bill 390, no discount", async () => {
    shiftId = await openTill(1000);
    const original = await buyLarge(590, "Cash");
    ({ saleId } = await exchange({ originalSaleId: original, refund: 590, newPrice: 390, backBy: "Cash" }));

    const sale = await one("SELECT subtotal, discount_amount, total_amount FROM sales WHERE id = $1", [saleId]);
    expect(num(sale.subtotal)).toBe(390);
    expect(num(sale.discount_amount)).toBe(0);
    expect(num(sale.total_amount)).toBe(390);
    expect(await payments(saleId)).toEqual([{ method: "Return Credit", amount: 390 }]);

    const ret = await one("SELECT total_refund, refund_method, credit_applied FROM returns ORDER BY id DESC LIMIT 1");
    expect(num(ret.total_refund)).toBe(590);
    expect(ret.refund_method).toBe("Cash");
    expect(num(ret.credit_applied)).toBe(390);
  });

  it("the dashboard's Cash in drawer takes off only the 200: 1,000 + 590 − 200 = 1,390", async () => {
    const row = await dashboardRow(shiftId);
    expect(num(row.cash_out)).toBe(200);
    expect(num(row.expected_cash)).toBe(1390);
  });

  it("Cash Audit shows the return as −200", async () => {
    const res = await admin().get(`/api/reports/cash-audit?session_id=${shiftId}`);
    expect(res.status).toBe(200);
    const back = res.body.audit.filter((r) => r.type === "Return");
    expect(back.map((r) => num(r.amount))).toEqual([-200]);
  });

  it("Close Shift expects 1,390", async () => {
    const close = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 1390 });
    expect(close.status).toBe(200);
    expect(num(close.body.expected_cash)).toBe(1390);
    expect(num(close.body.variance)).toBe(0);
  });

  it("money back by JazzCash doesn't touch the drawer: 1,000 + 590 = 1,590", async () => {
    const id = await openTill(1000);
    const original = await buyLarge(590, "Cash");
    await exchange({ originalSaleId: original, refund: 590, newPrice: 390, backBy: "Online - JazzCash" });
    const ret = await one("SELECT refund_method, credit_applied FROM returns ORDER BY id DESC LIMIT 1");
    expect(ret.refund_method).toBe("Online - JazzCash");
    expect(num(ret.credit_applied)).toBe(390);
    expect(num((await dashboardRow(id)).expected_cash)).toBe(1590);
  });
});

describe("D56 — exchange where the customer pays more", () => {
  it("590 back, 1,000 out, Cash 410 → bill 1,000 at full price, drawer + 410", async () => {
    const shiftId = await openTill(1000);
    const original = await buyLarge(590, "Card");
    const { saleId } = await exchange({ originalSaleId: original, refund: 590, newPrice: 1000, payBy: "Cash" });

    const sale = await one("SELECT discount_amount, total_amount FROM sales WHERE id = $1", [saleId]);
    expect(num(sale.discount_amount)).toBe(0);
    expect(num(sale.total_amount)).toBe(1000);
    expect(await payments(saleId)).toEqual([
      { method: "Return Credit", amount: 590 },
      { method: "Cash", amount: 410 },
    ]);
    const ret = await one("SELECT refund_method, credit_applied FROM returns ORDER BY id DESC LIMIT 1");
    expect(ret.refund_method).toBe("Return Credit");
    expect(num(ret.credit_applied)).toBe(590);
    expect(num((await dashboardRow(shiftId)).expected_cash)).toBe(1410);
  });

  it("a discount on the balance is the only discount saved: 590 back, 1,000 out, 60 off → Cash 350", async () => {
    await openTill(1000);
    const original = await buyLarge(590, "Card");
    const { saleId } = await exchange({ originalSaleId: original, refund: 590, newPrice: 1000, discount: 60, payBy: "Cash" });
    const sale = await one("SELECT discount_amount, total_amount FROM sales WHERE id = $1", [saleId]);
    expect(num(sale.discount_amount)).toBe(60);
    expect(num(sale.total_amount)).toBe(940);
    expect(await payments(saleId)).toEqual([
      { method: "Return Credit", amount: 590 },
      { method: "Cash", amount: 350 },
    ]);
  });

  it("cash handed over above the balance has its change taken off (500 for 410 → Cash 410)", async () => {
    await openTill(1000);
    const original = await buyLarge(590, "Card");
    const { saleId } = await exchange({ originalSaleId: original, refund: 590, newPrice: 1000, payBy: "Cash", payAmount: 500 });
    expect(await payments(saleId)).toEqual([
      { method: "Return Credit", amount: 590 },
      { method: "Cash", amount: 410 },
    ]);
  });
});

describe("D56 — credit_applied is checked", () => {
  it("more credit than the return is worth → 400", async () => {
    await openTill(1000);
    const original = await buyLarge(590, "Cash");
    const res = await admin().post("/api/returns").send({
      original_sale_id: original, outlet_id: 1, employee_id: ADMIN_ID,
      total_refund: 590, refund_method: "Cash", credit_applied: 700,
      items: [{ product_id: LARGE, quantity: 1, refund_price: 590 }],
    });
    expect(res.status).toBe(400);
  });

  it("a plain cash refund (no credit_applied) still comes off the drawer in full", async () => {
    const shiftId = await openTill(1000);
    const original = await buyLarge(590, "Cash");
    const res = await admin().post("/api/returns").send({
      original_sale_id: original, outlet_id: 1, employee_id: ADMIN_ID,
      total_refund: 590, refund_method: "Cash",
      items: [{ product_id: LARGE, quantity: 1, refund_price: 590 }],
    });
    expect(res.status).toBe(200);
    expect(num((await dashboardRow(shiftId)).expected_cash)).toBe(1000);
  });
});
