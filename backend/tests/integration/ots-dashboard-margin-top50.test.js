/**
 * ots-dashboard-margin-top50.test.js — One Toy Store pilot G4 (PHASE-F-PLAN "Reports the owner uses").
 *
 * iPOS's dashboard shows gross margin % (today and month) and the top 50
 * items of the last 30 days; SanoPOS showed only the month's margin amount
 * and a top 5. Owner, 2026-10-19:
 *   - margin % = gross profit ÷ sale (not ÷ cost), on the same base as the
 *     month gross margin: sales ex tax, less bill discounts, less returns;
 *   - top 50 by sale amount (item price rung up less returns, like G3) over
 *     today + the 29 days before, each with units and margin %;
 *   - margin figures need the finance-reports permission (a Cashier sees
 *     the top 50 without margins);
 *   - everything follows the dashboard's branch.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const CASHIER = 3; // seeded with view_sales_reports only
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
let topOutlet;

async function toy(name, price, cost) {
  return (await one(
    "INSERT INTO products (name, price, cost_price, gst, tax_id) VALUES ($1, $2, $3, 0, NULL) RETURNING id",
    [name, price, cost])).id;
}

async function sale(lines, { at = "NOW()", discount = 0, outlet = 1, voided = false } = {}) {
  const gross = lines.reduce((t, l) => t + l.qty * l.price, 0);
  const s = await one(
    `INSERT INTO sales (total_amount, discount_amount, payment_method, outlet_id, voided, timestamp)
     VALUES ($1, $2, 'Cash', $3, $4, ${at}) RETURNING id`,
    [gross - discount, discount, outlet, voided]);
  for (const l of lines) {
    await db.query(
      "INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale) VALUES ($1, $2, $3, $4, $5)",
      [s.id, l.id, l.qty, l.price, l.cost]);
  }
  return s.id;
}

async function giveBack(saleId, productId, qty, price, { outlet = 1 } = {}) {
  const r = await one(
    `INSERT INTO returns (original_sale_id, outlet_id, total_refund, refund_method)
     VALUES ($1, $2, $3, 'Cash') RETURNING id`, [saleId, outlet, qty * price]);
  await db.query(
    "INSERT INTO return_items (return_id, product_id, quantity, refund_price, restock_flag) VALUES ($1, $2, $3, $4, true)",
    [r.id, productId, qty, price]);
}

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("TRUNCATE sales, returns RESTART IDENTITY CASCADE");

  // Branch 1 — today: A ×2 (1,000, cost 600) less a 200 bill discount; B ×1 (500, cost 400), then B returned.
  const A = await toy("Toy A", 1000, 600);
  const B = await toy("Toy B", 500, 400);
  const C = await toy("Toy C", 1000, 900);
  await sale([{ id: A, qty: 2, price: 1000, cost: 600 }], { discount: 200 });
  const bBill = await sale([{ id: B, qty: 1, price: 500, cost: 400 }]);
  await giveBack(bBill, B, 1, 500);
  // Earlier this month (1 hour after it started; the test app's shop is on UTC): C ×1.
  await sale([{ id: C, qty: 1, price: 1000, cost: 900 }], {
    at: "(date_trunc('month', NOW() AT TIME ZONE 'UTC') + interval '1 hour') AT TIME ZONE 'UTC'",
  });

  // Another branch for the top 50: P1..P55, price i×100, cost half.
  topOutlet = (await one("INSERT INTO outlets (name) VALUES ('G4 top branch') RETURNING id")).id;
  const P = {};
  for (let i = 1; i <= 55; i++) P[i] = await toy(`P${String(i).padStart(2, "0")}`, i * 100, i * 50);
  const ago = (d) => `NOW() - interval '${d} days'`;
  for (let i = 1; i <= 55; i++) {
    await sale([{ id: P[i], qty: i === 54 ? 2 : 1, price: i * 100, cost: i * 50 }], { at: ago(3), outlet: topOutlet });
  }
  const p55 = (await one("SELECT sale_id FROM sale_items WHERE product_id = $1", [P[55]])).sale_id;
  await giveBack(p55, P[55], 1, 5500, { outlet: topOutlet }); // fully returned: drops out
  await sale([{ id: P[1], qty: 1, price: 99999, cost: 1 }], { at: ago(3), outlet: topOutlet, voided: true });
  await sale([{ id: P[2], qty: 1, price: 99999, cost: 1 }], { at: ago(31), outlet: topOutlet });
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const dash = async (emp, q) => {
  const res = await makeRequest(app, emp).get(`/api/reports/dashboard?${q}`);
  expect(res.status).toBe(200);
  return res.body;
};

describe("G4 — gross margin %", () => {
  it("today = gross profit ÷ (sales − discount − returns), ex tax", async () => {
    const d = await dash(ADMIN_ID, "outlet_id=1");
    // Items 2,500, cost 1,600, discount 200, B's return gives back 100 profit
    // and 500 of sale → profit 600 on 1,800.
    expect(Number(d.todayGrossProfit)).toBe(600);
    expect(Number(d.todayMarginPct)).toBe(33.33);
  });

  it("month adds the earlier bill: 700 on 2,800", async () => {
    const d = await dash(ADMIN_ID, "outlet_id=1");
    expect(Number(d.monthGrossMargin)).toBe(700);
    expect(Number(d.monthMarginPct)).toBe(25);
  });

  it("is null when nothing was sold", async () => {
    const empty = (await one("INSERT INTO outlets (name) VALUES ('G4 empty branch') RETURNING id")).id;
    const d = await dash(ADMIN_ID, `outlet_id=${empty}`);
    expect(d.todayMarginPct).toBeNull();
    expect(d.monthMarginPct).toBeNull();
  });

  it("a Cashier (sales reports only) gets no margin figures", async () => {
    // No branch: the test app's outlet-assignment check has no DB handle for
    // a non-admin asking for a branch (harness gap, not the live server).
    const d = await dash(CASHIER, "");
    expect(d.todayMarginPct).toBeUndefined();
    expect(d.monthMarginPct).toBeUndefined();
  });
});

describe("G4 — top 50 items, last 30 days", () => {
  it("50 toys by sale amount, with units and margin %", async () => {
    const d = await dash(ADMIN_ID, `outlet_id=${topOutlet}`);
    const top = d.topItems30d;
    expect(top).toHaveLength(50);
    expect(top[0]).toMatchObject({ name: "P54", units: 2, amount: 10800, margin_pct: 50 });
    expect(top[1]).toMatchObject({ name: "P53", units: 1, amount: 5300 });
    expect(top[49]).toMatchObject({ name: "P05", amount: 500 });
    expect(top.some((r) => r.name === "P55")).toBe(false); // returned
    expect(top[0].product_id).toBeTruthy();
  });

  it("voided bills and bills older than 30 days are left out", async () => {
    const d = await dash(ADMIN_ID, `outlet_id=${topOutlet}`);
    expect(d.topItems30d.every((r) => r.amount < 99999)).toBe(true);
  });

  it("follows the branch", async () => {
    const d = await dash(ADMIN_ID, "outlet_id=1");
    expect(d.topItems30d.map((r) => r.name)).toEqual(expect.arrayContaining(["Toy A"]));
    expect(d.topItems30d.some((r) => r.name.startsWith("P"))).toBe(false);
  });

  it("a Cashier sees the list without margins", async () => {
    const d = await dash(CASHIER, "");
    expect(d.topItems30d).toHaveLength(50);
    expect(d.topItems30d[0].margin_pct).toBeUndefined();
  });
});
