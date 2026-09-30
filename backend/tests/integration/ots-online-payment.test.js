/**
 * ots-online-payment.test.js — One Toy Store pilot F2 / D52.
 *
 * The till's Online button saves a payment as "Online - <choice>" (e.g.
 * "Online - JazzCash"). It must stay out of the drawer (Close Shift expected
 * cash) and out of Card, get its own line in every payment report, and a
 * refund on such a bill can go back as Online without touching the drawer.
 * The choices come from company_profile.online_payment_options (v146).
 *
 * Day 2 (INV-2026-00037, Rs 4,130): a JazzCash transfer had to be rung as Card.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const JAZZ = "Online - JazzCash";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const WIDE = "date_from=2000-01-01&date_to=2100-01-01";

// Products 4 and 5 carry no tax, so totals are plain arithmetic.
const ITEM = 4;

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

async function sell(price, payments) {
  const res = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: [{ id: ITEM, quantity: 1, price }],
    payments,
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

const lines = async (saleId) =>
  (await all("SELECT payment_method, amount, gateway_ref FROM sale_payments WHERE sale_id = $1 ORDER BY id", [saleId]))
    .map((p) => ({ method: p.payment_method, amount: num(p.amount), gateway_ref: p.gateway_ref }));

describe("F2 — Online payment choices (Company Profile)", () => {
  it("a new shop gets the owner's 7 choices in order", async () => {
    const res = await admin().get("/api/company-profile/online-payment-options");
    expect(res.status).toBe(200);
    expect(res.body.online_payment_options).toEqual(
      ["EasyPaisa", "JazzCash", "Allied", "Meezan", "MCB", "HBL", "Alfalah"],
    );
  });

  it("the administrator can change the list; it is cleaned and saved", async () => {
    const res = await admin().put("/api/company-profile/online-payment-options")
      .send({ online_payment_options: [" JazzCash ", "EasyPaisa", "jazzcash", "", "Bank  Alfalah"] });
    expect(res.status).toBe(200);
    expect(res.body.online_payment_options).toEqual(["JazzCash", "EasyPaisa", "Bank Alfalah"]);
    const again = await admin().get("/api/company-profile/online-payment-options");
    expect(again.body.online_payment_options).toEqual(["JazzCash", "EasyPaisa", "Bank Alfalah"]);
  });

  it("refuses an empty list or a non-list", async () => {
    expect((await admin().put("/api/company-profile/online-payment-options")
      .send({ online_payment_options: [] })).status).toBe(400);
    expect((await admin().put("/api/company-profile/online-payment-options")
      .send({ online_payment_options: "JazzCash" })).status).toBe(400);
    // Put the defaults back for the tests below.
    const reset = await admin().put("/api/company-profile/online-payment-options")
      .send({ online_payment_options: ["EasyPaisa", "JazzCash", "Allied", "Meezan", "MCB", "HBL", "Alfalah"] });
    expect(reset.status).toBe(200);
  });
});

describe("F2 — a bill paid Online", () => {
  let shiftId, onlineSale, splitSale;

  beforeAll(async () => {
    shiftId = await openTill(1000);
    await sell(500, [{ method: "Cash", amount: 500 }]);
    await sell(300, [{ method: "Card", amount: 300 }]);
    onlineSale = await sell(4130, [{ method: JAZZ, amount: 4130 }]);
    // Part cash (with change), part EasyPaisa.
    splitSale = await sell(2000, [
      { method: "Cash", amount: 1500 },
      { method: "Online - EasyPaisa", amount: 1000 },
    ]);
  });

  it("is saved under its own name, with no card-gateway reference", async () => {
    expect(await lines(onlineSale)).toEqual([{ method: JAZZ, amount: 4130, gateway_ref: null }]);
    expect((await one("SELECT payment_method FROM sales WHERE id = $1", [onlineSale])).payment_method).toBe(JAZZ);
  });

  it("change on a part-cash bill comes off the cash, not the Online line", async () => {
    expect((await lines(splitSale)).map(({ method, amount }) => ({ method, amount }))).toEqual([
      { method: "Cash", amount: 1000 },
      { method: "Online - EasyPaisa", amount: 1000 },
    ]);
  });

  it("the shift's payment summary shows Online lines apart from Cash and Card", async () => {
    const res = await admin().get(`/api/reports/payment-summary?session_id=${shiftId}`);
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.payments.map((p) => [p.payment_method, num(p.total)]));
    expect(by).toEqual({ Cash: 1500, Card: 300, [JAZZ]: 4130, "Online - EasyPaisa": 1000 });
  });

  it("the dashboard's Payment Methods and the sales summary show the Online lines", async () => {
    const dash = await admin().get("/api/reports/dashboard");
    expect(dash.status).toBe(200);
    const z = Object.fromEntries((dash.body.zReport || []).map((r) => [r.payment_method, num(r.total)]));
    expect(z[JAZZ]).toBe(4130);
    expect(z.Card).toBe(300);

    const sum = await admin().get(`/api/reports/sales-summary?${WIDE}`);
    expect(sum.status).toBe(200);
    const pm = Object.fromEntries(sum.body.payment_methods.map((p) => [p.method, p.total]));
    expect(pm[JAZZ]).toBe(4130);
    expect(pm["Online - EasyPaisa"]).toBe(1000);
    expect(pm.Card).toBe(300);
  });

  it("the monthly payment-method table has an Online column", async () => {
    const res = await admin().get(`/api/reports/monthly-mop-matrix?${WIDE}`);
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual(expect.arrayContaining([JAZZ, "Online - EasyPaisa"]));
  });

  it("a refund back to Online leaves the drawer alone; Close Shift expects float + cash only", async () => {
    const ret = await admin().post("/api/returns").send({
      original_sale_id: onlineSale, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
      total_refund: 4130, refund_method: JAZZ,
      items: [{ product_id: ITEM, quantity: 1, refund_price: 4130 }],
    });
    expect(ret.status).toBe(200);
    const saved = await one("SELECT refund_method FROM returns WHERE original_sale_id = $1", [onlineSale]);
    expect(saved.refund_method).toBe(JAZZ);

    // Float 1,000 + cash 500 + cash 1,000 (after 500 change) = 2,500.
    const close = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 2500 });
    expect(close.status).toBe(200);
    expect(num(close.body.expected_cash)).toBe(2500);
    expect(num(close.body.variance)).toBe(0);
  });
});
