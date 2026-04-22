/**
 * 2-G.10 — Commissions finish: tiered + per-item attribution.
 *
 * Covers:
 *  A. fixed_per_item plan, all items have staff_id=NULL →
 *     one earning row attributed to the sale's cashier.
 *  B. fixed_per_item plan, items staff_id=[2,2,3] →
 *     two earning rows: employee 2 gets 2×rate, employee 3 gets 1×rate.
 *  C. tiered plan with tiers at ≥500→5% and ≥1000→8%, sale=1200 →
 *     one earning row at 8% = 96.
 *  D. tip rows (earning_type='tip', sale_id NULL) are NOT touched by recalc.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../routes/commissions")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  // phase2_commissions is not in the default test flag set — seed ON.
  await db.query(
    "INSERT INTO feature_flags (key, enabled) VALUES ($1, true) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
    ["phase2_commissions"],
  );
  // Cache busts after 60s; create fresh cache by invalidating.
  const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");
  invalidateFeatureFlagCache();
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function seedPlan(name, type, rules) {
  const { rows: [plan] } = await db.query(
    `INSERT INTO commission_plans (name, description, type) VALUES ($1, '', $2) RETURNING *`,
    [name, type],
  );
  for (const r of rules) {
    await db.query(
      `INSERT INTO commission_plan_rules (plan_id, scope_type, scope_id, rate, min_threshold, max_cap, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [plan.id, r.scope_type || "all", r.scope_id || null, r.rate, r.min_threshold || 0, r.max_cap || null, r.priority || 0],
    );
  }
  return plan;
}

async function seedSale({ employee_id = 1, outlet_id = 1, total = 0, invoice }) {
  const { rows: [s] } = await db.query(
    `INSERT INTO sales (employee_id, outlet_id, total_amount, payment_method, invoice_number, discount_amount)
     VALUES ($1,$2,$3,'Cash',$4,0) RETURNING *`,
    [employee_id, outlet_id, total, invoice],
  );
  return s;
}

async function seedItem(sale_id, { product_id = 1, quantity, price, staff_id = null }) {
  await db.query(
    `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, staff_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [sale_id, product_id, quantity, price, staff_id],
  );
}

describe("POST /api/commissions/calculate — 2-G.10 per-employee + tiered", () => {
  test("Case A: fixed_per_item, no staff_id → 1 row for cashier", async () => {
    const plan = await seedPlan("A-flat", "fixed_per_item", [{ rate: 10 }]);
    await db.query("UPDATE employees SET commission_plan_id = $1 WHERE id = 1", [plan.id]);

    const sale = await seedSale({ employee_id: 1, total: 300, invoice: "A-0001" });
    await seedItem(sale.id, { product_id: 1, quantity: 3, price: 100 });

    const res = await req.post("/api/commissions/calculate").send({ sale_id: sale.id });
    expect(res.status).toBe(200);
    expect(res.body.earnings).toHaveLength(1);
    expect(res.body.earnings[0].employee_id).toBe(1);
    expect(Number(res.body.earnings[0].commission_amount)).toBe(30); // 3 × 10
  });

  test("Case B: fixed_per_item, staff_id [2,2,3] → 2 rows", async () => {
    const plan = await seedPlan("B-flat", "fixed_per_item", [{ rate: 5 }]);
    // Both employees 2 and 3 share the same plan
    await db.query("UPDATE employees SET commission_plan_id = $1 WHERE id IN (2,3)", [plan.id]);

    const sale = await seedSale({ employee_id: 1, total: 300, invoice: "B-0001" });
    await seedItem(sale.id, { product_id: 1, quantity: 1, price: 100, staff_id: 2 });
    await seedItem(sale.id, { product_id: 2, quantity: 1, price: 100, staff_id: 2 });
    await seedItem(sale.id, { product_id: 3, quantity: 1, price: 100, staff_id: 3 });

    const res = await req.post("/api/commissions/calculate").send({ sale_id: sale.id });
    expect(res.status).toBe(200);
    expect(res.body.earnings).toHaveLength(2);

    const byEmp = Object.fromEntries(
      res.body.earnings.map((e) => [e.employee_id, Number(e.commission_amount)]),
    );
    expect(byEmp[2]).toBe(10); // 2 items × 5
    expect(byEmp[3]).toBe(5); // 1 item × 5
  });

  test("Case C: tiered plan, sale=1200 → 8% of 1200 = 96", async () => {
    const plan = await seedPlan("C-tier", "tiered", [
      { rate: 5, min_threshold: 500 },
      { rate: 8, min_threshold: 1000 },
    ]);
    await db.query("UPDATE employees SET commission_plan_id = $1 WHERE id = 1", [plan.id]);
    // clear other employee plans so only employee 1 attributes
    await db.query("UPDATE employees SET commission_plan_id = NULL WHERE id IN (2,3)");

    const sale = await seedSale({ employee_id: 1, total: 1200, invoice: "C-0001" });
    await seedItem(sale.id, { product_id: 1, quantity: 1, price: 1200 });

    const res = await req.post("/api/commissions/calculate").send({ sale_id: sale.id });
    expect(res.status).toBe(200);
    expect(res.body.earnings).toHaveLength(1);
    expect(Number(res.body.earnings[0].commission_amount)).toBe(96);
  });

  test("Case D: tip earnings (earning_type='tip', sale_id NULL) untouched by recalc", async () => {
    const plan = await seedPlan("D-flat", "fixed_per_item", [{ rate: 1 }]);
    await db.query("UPDATE employees SET commission_plan_id = $1 WHERE id = 1", [plan.id]);

    // Seed a tip row
    await db.query(
      `INSERT INTO commission_earnings
         (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount, earning_type)
       VALUES (1, NULL, NULL, NULL, 0, 50, 'tip')`,
    );
    const { rows: tipBefore } = await db.query(
      "SELECT * FROM commission_earnings WHERE earning_type = 'tip'",
    );
    expect(tipBefore.length).toBe(1);

    const sale = await seedSale({ employee_id: 1, total: 100, invoice: "D-0001" });
    await seedItem(sale.id, { product_id: 1, quantity: 1, price: 100 });

    const res = await req.post("/api/commissions/calculate").send({ sale_id: sale.id });
    expect(res.status).toBe(200);

    const { rows: tipAfter } = await db.query(
      "SELECT * FROM commission_earnings WHERE earning_type = 'tip'",
    );
    expect(tipAfter.length).toBe(1);
    expect(Number(tipAfter[0].commission_amount)).toBe(50);
  });

  test("returns 404 on voided or missing sale", async () => {
    const res = await req.post("/api/commissions/calculate").send({ sale_id: 999999 });
    expect(res.status).toBe(404);
  });
});
