/**
 * ots-dashboard-sale-purchase.test.js — One Toy Store pilot G5 (PHASE-F-PLAN "Reports the owner uses").
 *
 * The dashboard server already worked out a 7-day sale vs purchase series
 * ("Query 13", `salePurchaseComparison`) that no screen showed. Owner,
 * 2026-10-19, for the new dashboard card:
 *   - last 7 days (today + the 6 before, shop days), one row per day;
 *   - Sale = money taken, like "Month sale" (voided bills out, refunds NOT
 *     taken off);
 *   - Purchase = toys received on supplier bills × cost, like "Month
 *     purchase" (an undone bill deletes its goods-received note, so it drops
 *     out; toys sent back to a supplier are NOT taken off);
 *   - finance roles only (a Cashier's copy carries no purchase figure, and
 *     the screen hides the card).
 * These tests pin the series the card is built on.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const CASHIER = 3; // seeded with view_sales_reports only
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
let branch, toyId;
let grnNo = 0;

const ago = (d) => `NOW() - interval '${d} days'`;
const dayStr = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10); // test shop is on UTC

async function sale(amount, { at = "NOW()", outlet, voided = false, returnCredit = 0 } = {}) {
  const s = await one(
    `INSERT INTO sales (total_amount, payment_method, outlet_id, voided, timestamp)
     VALUES ($1, 'Cash', $2, $3, ${at}) RETURNING id`, [amount, outlet, voided]);
  if (returnCredit) {
    await db.query(
      "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES ($1, 'Return Credit', $2), ($1, 'Cash', $3)",
      [s.id, returnCredit, amount - returnCredit]);
  }
  return s.id;
}

async function received(qty, cost, { at = "NOW()", outlet }) {
  grnNo += 1;
  const g = await one(
    `INSERT INTO goods_received_notes (grn_number, outlet_id, received_at) VALUES ($1, $2, ${at}) RETURNING id`,
    [`G5-${grnNo}`, outlet]);
  await db.query("INSERT INTO grn_items (grn_id, product_id, qty_received, cost_price) VALUES ($1, $2, $3, $4)",
    [g.id, toyId, qty, cost]);
}

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  branch = (await one("INSERT INTO outlets (name) VALUES ('G5 branch') RETURNING id")).id;
  toyId = (await one("INSERT INTO products (name, price, cost_price, gst, tax_id) VALUES ('G5 toy', 100, 50, 0, NULL) RETURNING id")).id;

  // Today: 1,000 + 500 (a 200 exchange credit comes off, like Month sale), a voided 9,999.
  await sale(1000, { outlet: branch });
  const refunded = await sale(500, { outlet: branch, returnCredit: 200 });
  await sale(9999, { outlet: branch, voided: true });
  // A cash refund today is NOT taken off the day's sale.
  await db.query(
    "INSERT INTO returns (original_sale_id, outlet_id, total_refund, refund_method) VALUES ($1, $2, 300, 'Cash')",
    [refunded, branch]);
  await sale(700, { at: ago(2), outlet: branch });
  await sale(400, { at: ago(6), outlet: branch });
  await sale(8888, { at: ago(7), outlet: branch }); // outside the 7 days

  await received(10, 50, { outlet: branch });            // today 500
  await received(4, 250, { at: ago(3), outlet: branch }); // 3 days ago 1,000
  await received(100, 50, { at: ago(8), outlet: branch }); // outside
  await sale(5555, { outlet: 1 });                        // other branch
  await received(1, 7777, { outlet: 1 });
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const dash = async (emp, q) => {
  const res = await makeRequest(app, emp).get(`/api/reports/dashboard?${q}`);
  expect(res.status).toBe(200);
  return res.body;
};

describe("G5 — daily sale vs purchase, last 7 days", () => {
  it("has one row per day, oldest first, ending today", async () => {
    const rows = (await dash(ADMIN_ID, `outlet_id=${branch}`)).salePurchaseComparison;
    expect(rows.map((r) => r.day)).toEqual([6, 5, 4, 3, 2, 1, 0].map(dayStr));
  });

  it("sale = money taken (voided out, exchange credit off, refunds not off); purchase = bills × cost", async () => {
    const rows = (await dash(ADMIN_ID, `outlet_id=${branch}`)).salePurchaseComparison;
    const by = Object.fromEntries(rows.map((r) => [r.day, [Number(r.sales_total), Number(r.purchase_total)]]));
    expect(by[dayStr(0)]).toEqual([1300, 500]);
    expect(by[dayStr(2)]).toEqual([700, 0]);
    expect(by[dayStr(3)]).toEqual([0, 1000]);
    expect(by[dayStr(6)]).toEqual([400, 0]);
    expect(by[dayStr(1)]).toEqual([0, 0]);
  });

  it("follows the branch", async () => {
    const rows = (await dash(ADMIN_ID, `outlet_id=${branch}`)).salePurchaseComparison;
    expect(rows.every((r) => Number(r.sales_total) < 5555 && Number(r.purchase_total) < 7777)).toBe(true);
  });

  it("the 7 days' sale matches today's sales figure on the last row", async () => {
    const d = await dash(ADMIN_ID, `outlet_id=${branch}`);
    expect(Number(d.salePurchaseComparison.at(-1).sales_total)).toBe(Number(d.totalRevenueToday));
  });

  it("a Cashier (sales reports only) gets no purchase figure", async () => {
    // No branch: the test app's outlet-assignment check has no DB handle for
    // a non-admin asking for a branch (harness gap, not the live server).
    const rows = (await dash(CASHIER, "")).salePurchaseComparison;
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.purchase_total === undefined)).toBe(true);
  });
});
