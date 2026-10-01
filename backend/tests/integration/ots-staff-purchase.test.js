/**
 * ots-staff-purchase.test.js — One Toy Store pilot F3b part 2 (staff toys at the till).
 *
 * Owner, 2026-10-01 (PHASE-F-PLAN F3b Q3b.12–Q3b.15):
 *  - A staff member takes a toy at cost. The bill keeps the normal price and a
 *    "Staff" discount brings it down to cost (the same way in iPOS during the
 *    dual-run). The server works out the cost; the till never decides it.
 *  - Paid Cash (into the drawer), Online, or "Cut from salary" (no money: it
 *    goes onto the person's staff account and is cut at month end).
 *  - "Cut from salary" is never drawer cash, card or online, and is refused on
 *    a bill that isn't a staff purchase. A void or a return refunded "Cut from
 *    salary" takes it back off the account.
 *  - The staff discount is kept apart from customer discounts (dashboard).
 *  - The account page lists every staff toy, however it was paid.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const CUT = "Cut from salary";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);

// Products 4 and 5 carry no tax. Toy A: price 1,000, cost 640. Toy B: 500 / 310.
const TOY_A = 4;
const TOY_B = 5;
let RAMZAN; // a salaried staff member
let NO_COST; // a product with no cost price

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("UPDATE products SET price = 1000, cost_price = 640 WHERE id = $1", [TOY_A]);
  await db.query("UPDATE products SET price = 500, cost_price = 310 WHERE id = $1", [TOY_B]);
  await db.query("UPDATE outlet_stock SET quantity = 100 WHERE product_id IN ($1, $2)", [TOY_A, TOY_B]);
  await db.query("UPDATE products SET stock = 100 WHERE id IN ($1, $2)", [TOY_A, TOY_B]);
  await db.query("UPDATE employees SET monthly_salary = 0 WHERE id = $1", [ADMIN_ID]);
  await db.query("UPDATE employees SET monthly_salary = 0 WHERE id = $1", [MANAGER_ID]);
  RAMZAN = (await one(
    "INSERT INTO employees (name, role, role_id, monthly_salary) VALUES ('Ramzan', 'Staff', 3, 27500) RETURNING id",
  )).id;
  NO_COST = (await one(
    "INSERT INTO products (name, sku, price, cost_price, stock) VALUES ('No cost toy', 'NOCOST-1', 800, 0, 10) RETURNING id",
  )).id;
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

const cart = (lines) => lines.map(([id, quantity, price]) => ({ id, quantity, price }));
const staffSale = (lines, payments, extra = {}) =>
  admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: cart(lines), payments,
    staff_purchase_employee_id: RAMZAN,
    ...extra,
  });
const balance = async (id = RAMZAN) => num((await admin().get(`/api/staff-pay/accounts/${id}`)).body.balance);

describe("F3b part 2 — staff price (the till asks, the server decides)", () => {
  it("lists the salaried staff for the till's Staff button", async () => {
    const res = await admin().get("/api/staff-pay/staff-list");
    expect(res.status).toBe(200);
    expect(res.body.staff.map((s) => s.id)).toContain(RAMZAN);
    expect(res.body.staff.map((s) => s.id)).not.toContain(ADMIN_ID); // no monthly salary
  });

  it("quotes cost per line: 2 × toy A + 1 × toy B = 1,590 (staff discount 910 off 2,500)", async () => {
    const res = await admin().post("/api/staff-pay/staff-quote").send({
      employee_id: RAMZAN, items: cart([[TOY_A, 2, 1000], [TOY_B, 1, 500]]),
    });
    expect(res.status).toBe(200);
    expect(res.body.subtotal).toBe(2500);
    expect(res.body.total).toBe(1590);
    expect(res.body.staff_discount).toBe(910);
    expect(res.body.lines.map((l) => [l.id, l.cost])).toEqual([[TOY_A, 640], [TOY_B, 310]]);
  });

  it("refuses someone who isn't salaried staff, and a toy with no cost price", async () => {
    expect((await admin().post("/api/staff-pay/staff-quote").send({
      employee_id: ADMIN_ID, items: cart([[TOY_A, 1, 1000]]),
    })).status).toBe(400);
    const nc = await admin().post("/api/staff-pay/staff-quote").send({
      employee_id: RAMZAN, items: cart([[NO_COST, 1, 800]]),
    });
    expect(nc.status).toBe(400);
    expect(nc.body.error).toMatch(/cost/i);
  });
});

describe("F3b part 2 — a staff bill", () => {
  let shiftId, cutSale, cashSale;

  beforeAll(async () => {
    shiftId = await openTill(1000);
  });

  it("Cut from salary: total = cost, normal price kept, a 'staff' discount, no money", async () => {
    // The till's own discount fields are ignored: the server sets the staff discount.
    const res = await staffSale([[TOY_A, 2, 1000], [TOY_B, 1, 500]], [{ method: CUT, amount: 1590 }],
      { discount_amount: 0, discount_type: "fixed" });
    expect(res.status).toBe(200);
    cutSale = res.body.saleId;
    const s = await one("SELECT * FROM sales WHERE id = $1", [cutSale]);
    expect(num(s.total_amount)).toBe(1590);
    expect(num(s.discount_amount)).toBe(910);
    expect(s.discount_type).toBe("staff");
    expect(s.staff_employee_id).toBe(RAMZAN);
    expect(s.payment_method).toBe(CUT);
    const items = await all("SELECT product_id, quantity, price_at_sale FROM sale_items WHERE sale_id = $1 ORDER BY product_id", [cutSale]);
    expect(items.map((i) => [i.product_id, num(i.quantity), num(i.price_at_sale)])).toEqual([[TOY_A, 2, 1000], [TOY_B, 1, 500]]);
    const pays = await all("SELECT payment_method, amount FROM sale_payments WHERE sale_id = $1", [cutSale]);
    expect(pays.map((p) => [p.payment_method, num(p.amount)])).toEqual([[CUT, 1590]]);
  });

  it("goes onto the staff account", async () => {
    expect(await balance()).toBe(1590);
    const acc = (await admin().get(`/api/staff-pay/accounts/${RAMZAN}`)).body;
    const e = acc.entries.find((x) => x.kind === "staff_purchase");
    expect(e.amount).toBe(1590);
    expect(e.sale_id).toBe(cutSale);
  });

  it("Cash staff bill: into the drawer, not onto the account; paying less than cost is refused", async () => {
    const short = await staffSale([[TOY_B, 1, 500]], [{ method: "Cash", amount: 200 }]);
    expect(short.status).toBe(400);
    const res = await staffSale([[TOY_B, 1, 500]], [{ method: "Cash", amount: 500 }]); // 190 change
    expect(res.status).toBe(200);
    cashSale = res.body.saleId;
    const pays = await all("SELECT payment_method, amount FROM sale_payments WHERE sale_id = $1", [cashSale]);
    expect(pays.map((p) => [p.payment_method, num(p.amount)])).toEqual([["Cash", 310]]);
    expect(await balance()).toBe(1590);
  });

  it("refuses Card, a customer, points, or nobody picked; Cut from salary only on a staff bill", async () => {
    expect((await staffSale([[TOY_B, 1, 500]], [{ method: "Card", amount: 310 }])).status).toBe(400);
    expect((await staffSale([[TOY_B, 1, 500]], [{ method: CUT, amount: 310 }], { customer_id: 1 })).status).toBe(400);
    expect((await staffSale([[TOY_B, 1, 500]], [{ method: CUT, amount: 310 }], { points_redeemed: 10 })).status).toBe(400);
    expect((await staffSale([[TOY_B, 1, 500]], [{ method: CUT, amount: 310 }], { staff_purchase_employee_id: ADMIN_ID })).status).toBe(400);
    expect((await staffSale([[NO_COST, 1, 800]], [{ method: CUT, amount: 0 }])).status).toBe(400);
    const plain = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID, cartItems: cart([[TOY_B, 1, 500]]),
      payments: [{ method: CUT, amount: 500 }],
    });
    expect(plain.status).toBe(400);
    expect(await balance()).toBe(1590);
  });

  it("Online staff bill is allowed", async () => {
    const res = await staffSale([[TOY_B, 1, 500]], [{ method: "Online - JazzCash", amount: 310 }]);
    expect(res.status).toBe(200);
    expect(await balance()).toBe(1590);
  });

  it("the account page lists every staff toy with how it was paid", async () => {
    const acc = (await admin().get(`/api/staff-pay/accounts/${RAMZAN}`)).body;
    const rows = acc.purchases.map((p) => [p.sale_id, p.product_id, num(p.quantity), num(p.price), num(p.staff_discount), p.paid]);
    expect(rows).toEqual(expect.arrayContaining([
      [cutSale, TOY_A, 2, 1000, 720, CUT],
      [cutSale, TOY_B, 1, 500, 190, CUT],
      [cashSale, TOY_B, 1, 500, 190, "Cash"],
    ]));
    expect(acc.purchases).toHaveLength(4);
  });

  it("dashboard keeps the staff discount apart from customer discounts", async () => {
    // A normal customer bill with a 100 discount.
    const res = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID, cartItems: cart([[TOY_A, 1, 1000]]),
      payments: [{ method: "Cash", amount: 900 }], discount_amount: 100, discount_type: "fixed",
    });
    expect(res.status).toBe(200);
    const d = (await admin().get("/api/reports/dashboard")).body;
    const dash = d.discountsToday ? d : d.data || d;
    expect(dash.discountsToday.value).toBe(100);
    expect(dash.discountsToday.count).toBe(1);
    expect(dash.staffDiscountsToday.value).toBe(910 + 190 + 190);
    expect(dash.staffDiscountsToday.count).toBe(3);
  });

  it("Close Shift: the drawer expects float + cash only (Cut from salary and Online stay out)", async () => {
    // 1,000 float + 310 staff cash + 900 customer cash = 2,210.
    const close = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 2210 });
    expect(close.status).toBe(200);
    expect(num(close.body.expected_cash)).toBe(2210);
  });

  it("a return refunded 'Cut from salary' takes it off the account; a void takes the rest", async () => {
    await openTill(1000);
    const ret = await admin().post("/api/returns").send({
      original_sale_id: cutSale, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
      total_refund: 310, refund_method: CUT,
      items: [{ product_id: TOY_B, quantity: 1, refund_price: 310 }],
    });
    expect(ret.status).toBe(200);
    expect(await balance()).toBe(1280);
    const acc = (await admin().get(`/api/staff-pay/accounts/${RAMZAN}`)).body;
    expect(acc.entries.find((x) => x.kind === "staff_return").amount).toBe(-310);

    // A fresh cut bill, then voided: back off the account.
    const res = await staffSale([[TOY_A, 1, 1000]], [{ method: CUT, amount: 640 }]);
    expect(res.status).toBe(200);
    expect(await balance()).toBe(1920);
    const v = await admin().put(`/api/sales/${res.body.saleId}/void`).send({ void_reason: "rung by mistake" });
    expect(v.status).toBe(200);
    expect(await balance()).toBe(1280);
  });

  it("a 'Cut from salary' refund is refused on a bill that wasn't a staff purchase", async () => {
    const sale = await admin().post("/api/sales").send({
      outlet_id: 1, employee_id: ADMIN_ID, cartItems: cart([[TOY_B, 1, 500]]),
      payments: [{ method: "Cash", amount: 500 }],
    });
    const ret = await admin().post("/api/returns").send({
      original_sale_id: sale.body.saleId, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
      total_refund: 500, refund_method: CUT,
      items: [{ product_id: TOY_B, quantity: 1, refund_price: 500 }],
    });
    expect(ret.status).toBe(400);
  });
});
