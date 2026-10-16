/**
 * ots-dashboard-exchange.test.js — One Toy Store pilot D65.
 *
 * 2026-10-02 20:21: INV-2026-00122 (Card 7,500) partly exchanged: return #3
 * 4,180 (Return Credit, credit_applied 4,180) → INV-2026-00123 piano 5,180
 * paid Return Credit 4,180 + Cash 1,000. The Day report said 134,860 (= iPOS);
 * the dashboard said Revenue Today 139,040: it counted the 4,180 paid with the
 * returned toys as new sales, and showed the same 4,180 again as Refunds.
 *
 * Rule (owner 2026-10-16, same as the Day report): dashboard money figures
 * count only what was actually paid; "Return Credit" is not a payment.
 * Refunds = money handed back (total_refund − credit_applied), so an exchange
 * for another toy is 0 there. Profit was already right and stays.
 *
 * Every check compares the dashboard before and after, so other sales in the
 * test shop don't matter.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const num = (v) => (v === null || v === undefined ? v : Number(v));
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);

// Products 4 and 5 carry no tax, so totals are plain arithmetic.
const RETURNED = 4;
const TAKEN = 5;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  for (const s of await all("SELECT id FROM cash_shifts WHERE status = 'open'")) {
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [s.id]);
  }
  const res = await admin().post("/api/shifts/open").send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 1000 });
  expect(res.status).toBe(200);
  await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: "2580", outlet_id: 1 });
  await db.query("UPDATE products SET stock = stock + 100 WHERE id IN ($1, $2)", [RETURNED, TAKEN]);
  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, 100), ($2, 1, 100)
     ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + 100`,
    [RETURNED, TAKEN],
  );
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function sell(price, method) {
  const res = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: [{ id: RETURNED, quantity: 1, price }],
    payments: [{ method, amount: price }],
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

// The till's exchange: new bill at full price paid by Return Credit (+ money
// for the rest), then the return with credit_applied (frontend exchangeMath.js).
async function exchange({ originalSaleId, refund, newPrice, payBy = "Cash" }) {
  const credit = Math.min(refund, newPrice);
  const payments = [{ method: "Return Credit", amount: credit }];
  if (newPrice > refund) payments.push({ method: payBy, amount: newPrice - refund });
  const sale = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
    cartItems: [{ id: TAKEN, quantity: 1, price: newPrice }],
    payments,
    exchange_full_price: true,
    notes: `Exchange for #${originalSaleId}`,
  });
  expect(sale.status).toBe(200);
  const ret = await admin().post("/api/returns").send({
    original_sale_id: originalSaleId, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
    total_refund: refund,
    refund_method: "Return Credit",
    credit_applied: credit,
    items: [{ product_id: RETURNED, quantity: 1, refund_price: refund }],
  });
  expect(ret.status).toBe(200);
  return { saleId: sale.body.saleId, returnId: ret.body.returnId ?? ret.body.id };
}

async function refundCash(originalSaleId, amount) {
  const ret = await admin().post("/api/returns").send({
    original_sale_id: originalSaleId, outlet_id: 1, employee_id: ADMIN_ID, customer_id: null,
    total_refund: amount, refund_method: "Cash",
    items: [{ product_id: RETURNED, quantity: 1, refund_price: amount }],
  });
  expect(ret.status).toBe(200);
}

async function dash() {
  const res = await admin().get("/api/reports/dashboard");
  expect(res.status).toBe(200);
  return res.body;
}

const today = (b) => b.salesTrend?.[b.salesTrend.length - 1];
const sumBy = (rows, f) => (rows || []).reduce((s, r) => s + Number(r[f] || 0), 0);
const methodTotal = (b, m) => num((b.zReport || []).find((r) => r.payment_method === m)?.total ?? 0);
const staffTotal = (b) => sumBy(b.staffOfDay, "total");
const outletTotal = (b) => sumBy(b.salesByOutlet, "total");
const thisMonth = (b) => num((b.monthlyTrend || [])[(b.monthlyTrend || []).length - 1]?.total ?? 0);
const spcToday = (b) => num((b.salePurchaseComparison || [])[(b.salePurchaseComparison || []).length - 1]?.sales_total ?? 0);

describe("D65 — the dashboard counts only money actually paid", () => {
  let before, after;

  beforeAll(async () => {
    before = await dash();
    // 2 Oct: Card 7,500, then 4,180 of it exchanged for a 5,180 piano (+ Cash 1,000).
    const original = await sell(7500, "Card");
    await exchange({ originalSaleId: original, refund: 4180, newPrice: 5180 });
    after = await dash();
  });

  it("Revenue Today goes up by 7,500 + 1,000 = 8,500, not 12,680", () => {
    expect(num(after.totalRevenueToday) - num(before.totalRevenueToday)).toBe(8500);
  });

  it("the payment list has no Return Credit row; Card +7,500, Cash +1,000", () => {
    expect((after.zReport || []).some((r) => r.payment_method === "Return Credit")).toBe(false);
    expect(methodTotal(after, "Card") - methodTotal(before, "Card")).toBe(7500);
    expect(methodTotal(after, "Cash") - methodTotal(before, "Cash")).toBe(1000);
    expect((after.paymentContribution || []).some((r) => r.payment_method === "Return Credit")).toBe(false);
  });

  it("an exchange for another toy is not a refund: Refunds Today unchanged", () => {
    expect(num(after.refundsToday.value)).toBe(num(before.refundsToday.value));
    expect(num(after.refundsToday.count)).toBe(num(before.refundsToday.count));
  });

  it("the 7-day chart, hourly sales, month sales, sale-vs-purchase and monthly trend add 8,500", () => {
    expect(num(today(after).revenue) - num(today(before)?.revenue ?? 0)).toBe(8500);
    expect(sumBy(after.hourlySales, "total") - sumBy(before.hourlySales, "total")).toBe(8500);
    expect(num(after.monthSales) - num(before.monthSales)).toBe(8500);
    expect(thisMonth(after) - thisMonth(before)).toBe(8500);
    if (after.salePurchaseComparison) expect(spcToday(after) - spcToday(before)).toBe(8500);
  });

  it("staff of the day and sales by location add 8,500", () => {
    expect(staffTotal(after) - staffTotal(before)).toBe(8500);
    expect(outletTotal(after) - outletTotal(before)).toBe(8500);
  });

  it("money really handed back still counts as a refund: cash refund 590 → Refunds +590", async () => {
    const id = await sell(590, "Cash");
    const mid = await dash();
    await refundCash(id, 590);
    const end = await dash();
    expect(num(end.refundsToday.value) - num(mid.refundsToday.value)).toBe(590);
    expect(num(end.refundsToday.count) - num(mid.refundsToday.count)).toBe(1);
  });

  it("yesterday's figures follow the same rule", async () => {
    const y0 = await dash();
    const original = await sell(3000, "Card");
    const { saleId, returnId } = await exchange({ originalSaleId: original, refund: 2000, newPrice: 2500 });
    // Move this pair to yesterday, 2 minutes before this time (the yesterday window ends at
    // this time of day, cut to the second).
    await db.query("UPDATE sales SET timestamp = timestamp - INTERVAL '24 hours 2 minutes' WHERE id IN ($1, $2)", [original, saleId]);
    await db.query("UPDATE returns SET timestamp = timestamp - INTERVAL '24 hours 2 minutes' WHERE id = $1", [returnId]);
    const y1 = await dash();
    expect(num(y1.yesterdayRevenue) - num(y0.yesterdayRevenue)).toBe(3500);
    expect(num(y1.yesterdayRefunds)).toBe(num(y0.yesterdayRefunds));
  });
});
