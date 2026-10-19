/**
 * ots-dashboard-supplier.test.js — One Toy Store pilot G3 (PHASE-F-PLAN "Reports the owner uses").
 *
 * iPOS's dashboard shows sales contribution by supplier; SanoPOS only had it
 * in Reports. Owner, 2026-10-19:
 *   - last 30 days (today + the 29 before, shop time), like the category card;
 *   - top 10 suppliers, then one "Others" line, then "No supplier" if any;
 *     each % a share of ALL sales in the period, so the lines add up to 100;
 *   - amount = item price rung up, less toys returned in the period
 *     (return_items.refund_price is per unit), voided bills left out;
 *   - follows the dashboard's branch.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);
const product = {};
let otherOutlet;

async function sale(productId, price, { daysAgo = 0, voided = false, outlet = 1, qty = 1 } = {}) {
  const s = await one(
    `INSERT INTO sales (total_amount, payment_method, outlet_id, voided, timestamp)
     VALUES ($1, 'Cash', $2, $3, NOW() - ($4 || ' days')::interval) RETURNING id`,
    [price * qty, outlet, voided, String(daysAgo)]);
  await db.query(
    "INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES ($1, $2, $3, $4)",
    [s.id, productId, qty, price]);
  return s.id;
}

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("TRUNCATE sales, returns RESTART IDENTITY CASCADE");
  otherOutlet = (await one("INSERT INTO outlets (name) VALUES ('G3 other branch') RETURNING id")).id;

  // S01..S12 sell 1,200 down to 100 (one toy each).
  for (let i = 1; i <= 12; i++) {
    const name = `S${String(i).padStart(2, "0")}`;
    const sup = (await one("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [name])).id;
    product[name] = (await one(
      "INSERT INTO products (name, price, cost_price, supplier_id) VALUES ($1, $2, 1, $3) RETURNING id",
      [`${name} toy`, 1300 - i * 100, sup])).id;
    await sale(product[name], 1300 - i * 100);
  }
  product.none = (await one("INSERT INTO products (name, price, cost_price) VALUES ('Loose toy', 500, 1) RETURNING id")).id;
  await sale(product.none, 500, { daysAgo: 29 }); // first day of the 30 still counts

  // S01 loses a 250 return today → 950.
  const s01 = await sale(product.S01, 250, { daysAgo: 40 }); // sold long ago: not in the period
  const r = await one(
    `INSERT INTO returns (original_sale_id, outlet_id, total_refund, refund_method)
     VALUES ($1, 1, 250, 'Cash') RETURNING id`, [s01]);
  await db.query(
    "INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES ($1, $2, 1, 250)",
    [r.id, product.S01]);

  // Left out: a voided bill, a bill 31 days ago, another branch's bill.
  await sale(product.S12, 5000, { voided: true });
  await sale(product.S12, 5000, { daysAgo: 31 });
  await sale(product.S12, 5000, { outlet: otherOutlet });
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const dashboard = async (q = "outlet_id=1") => {
  const res = await admin().get(`/api/reports/dashboard?${q}`);
  expect(res.status).toBe(200);
  return res.body;
};
const lines = (sc) => sc.rows.map((r) => [r.supplier, Number(r.revenue)]);

describe("G3 — sales by supplier on the dashboard", () => {
  it("top 10, then Others, then No supplier, less returns, voids and old bills left out", async () => {
    const { supplierContribution: sc } = await dashboard();
    expect(lines(sc)).toEqual([
      ["S02", 1100], ["S03", 1000], ["S01", 950], ["S04", 900], ["S05", 800],
      ["S06", 700], ["S07", 600], ["S08", 500], ["S09", 400], ["S10", 300],
      ["Others", 300], // S11 200 + S12 100
      ["No supplier", 500],
    ]);
    expect(Number(sc.total)).toBe(8050);
  });

  it("each % is a share of all sales, so they add up to 100", async () => {
    const { supplierContribution: sc } = await dashboard();
    expect(Number(sc.rows[0].contribution_pct)).toBe(13.66); // 1,100 / 8,050
    const sum = sc.rows.reduce((t, r) => t + Number(r.contribution_pct), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.1);
  });

  it("follows the dashboard's branch", async () => {
    const { supplierContribution: sc } = await dashboard(`outlet_id=${otherOutlet}`);
    expect(lines(sc)).toEqual([["S12", 5000]]);
    expect(Number(sc.rows[0].contribution_pct)).toBe(100);
  });

  it("no Others line when there are 10 suppliers or fewer", async () => {
    const { supplierContribution: sc } = await dashboard(`outlet_id=${otherOutlet}`);
    expect(sc.rows.some((r) => r.supplier === "Others")).toBe(false);
  });
});
