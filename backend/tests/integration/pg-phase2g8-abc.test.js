/**
 * pg-phase2g8-abc.test.js — Integration test for abc-worker-boss.js
 *
 * Seeds sales + grn data, runs the worker against an isolated test schema,
 * and asserts ABC ranks / days_since_last_sale / ON CONFLICT idempotency.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const { createTestApp } = require("../helpers/createTestApp-pg");
const { runAbcWorkerForDb } = require("../../workers/abc-worker-boss");

describe("abc-worker-boss — per-product nightly rollup", () => {
  let db, cleanup;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestApp());
    // Ensure the phase2g_inventory_intelligence flag is ON so worker runs
    // (worker no-ops per-tenant when flag is off).
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase2g_inventory_intelligence', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60000);

  beforeEach(async () => {
    // Wipe state between tests so ranks don't leak across cases.
    await db.query("DELETE FROM product_abc_class");
    await db.query("DELETE FROM sale_items");
    await db.query("DELETE FROM sales");
    await db.query("DELETE FROM grn_items");
    await db.query("DELETE FROM goods_received_notes");
  });

  async function seedSale({ product_id, qty, price, cost, daysAgo }) {
    const { rows } = await db.query(
      `INSERT INTO sales (total_amount, payment_method, timestamp, outlet_id, employee_id)
       VALUES ($1, 'cash', NOW() - ($2 * INTERVAL '1 day'), 1, 1) RETURNING id`,
      [qty * price, daysAgo]
    );
    const saleId = rows[0].id;
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale)
       VALUES ($1, $2, $3, $4, $5)`,
      [saleId, product_id, qty, price, cost]
    );
  }

  async function seedGrn({ product_id, qty, daysAgo }) {
    const { rows } = await db.query(
      `INSERT INTO goods_received_notes (grn_number, outlet_id, received_at)
       VALUES ($1, 1, NOW() - ($2 * INTERVAL '1 day')) RETURNING id`,
      [`TEST-GRN-${product_id}-${daysAgo}-${Math.random().toString(36).slice(2, 8)}`, daysAgo]
    );
    await db.query(
      `INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received)
       VALUES ($1, $2, $3, $3)`,
      [rows[0].id, product_id, qty]
    );
  }

  it("classifies 5 seeded products into A/B/C by Pareto", async () => {
    // createTestApp seeds products 1..5 with cost_price set. Simulate a
    // revenue distribution where product 1 = ~80%, products 2-3 = ~15%,
    // products 4-5 = ~5%.
    await seedSale({ product_id: 1, qty: 80, price: 100, cost: 50, daysAgo: 10 });
    await seedSale({ product_id: 2, qty: 8, price: 100, cost: 50, daysAgo: 10 });
    await seedSale({ product_id: 3, qty: 7, price: 100, cost: 50, daysAgo: 10 });
    await seedSale({ product_id: 4, qty: 3, price: 100, cost: 50, daysAgo: 10 });
    await seedSale({ product_id: 5, qty: 2, price: 100, cost: 50, daysAgo: 10 });

    await runAbcWorkerForDb({ db, windowDays: 90 });

    const { rows } = await db.query(
      `SELECT product_id, rank FROM product_abc_class ORDER BY product_id`
    );
    expect(rows.length).toBe(5);
    const byId = Object.fromEntries(rows.map((r) => [r.product_id, r.rank]));
    // Product 1 is the dominant one — always A.
    expect(byId[1]).toBe("A");
    // C rank should cover the two lowest-revenue products.
    expect(byId[5]).toBe("C");
  });

  it("sets days_since_last_sale for products with stale sales", async () => {
    // Old sale 100 days ago — outside default 90d window for revenue, but
    // last_sale_at tracker should still pick up the product for dead-stock
    // detection in a later run. Use a sale within window so the row is
    // written, but days_since_last_sale reflects actual gap.
    await seedSale({ product_id: 1, qty: 5, price: 100, cost: 50, daysAgo: 80 });
    await runAbcWorkerForDb({ db, windowDays: 90 });

    const { rows } = await db.query(
      `SELECT product_id, days_since_last_sale FROM product_abc_class WHERE product_id = 1`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].days_since_last_sale).toBeGreaterThanOrEqual(79);
    expect(rows[0].days_since_last_sale).toBeLessThanOrEqual(81);
  });

  it("handles tenant with zero sales cleanly (no rows written)", async () => {
    await runAbcWorkerForDb({ db, windowDays: 90 });
    const { rows } = await db.query(`SELECT COUNT(*)::int AS c FROM product_abc_class`);
    expect(rows[0].c).toBe(0);
  });

  it("re-running the worker does not duplicate rows (ON CONFLICT upsert)", async () => {
    await seedSale({ product_id: 1, qty: 10, price: 100, cost: 50, daysAgo: 5 });
    await seedSale({ product_id: 2, qty: 5, price: 100, cost: 50, daysAgo: 5 });

    await runAbcWorkerForDb({ db, windowDays: 90 });
    const { rows: firstRun } = await db.query(
      `SELECT COUNT(*)::int AS c FROM product_abc_class`
    );

    await runAbcWorkerForDb({ db, windowDays: 90 });
    const { rows: secondRun } = await db.query(
      `SELECT COUNT(*)::int AS c FROM product_abc_class`
    );

    expect(firstRun[0].c).toBe(2);
    expect(secondRun[0].c).toBe(2);
  });

  it("skips tenant when phase2g_inventory_intelligence feature flag is off", async () => {
    await db.query(
      `UPDATE feature_flags SET enabled = false WHERE key = 'phase2g_inventory_intelligence'`
    );
    await seedSale({ product_id: 1, qty: 10, price: 100, cost: 50, daysAgo: 5 });

    await runAbcWorkerForDb({ db, windowDays: 90 });

    const { rows } = await db.query(`SELECT COUNT(*)::int AS c FROM product_abc_class`);
    expect(rows[0].c).toBe(0);

    // Restore for other tests
    await db.query(
      `UPDATE feature_flags SET enabled = true WHERE key = 'phase2g_inventory_intelligence'`
    );
  });

  it("computes sell_through_rate using units_received from GRN data", async () => {
    await seedSale({ product_id: 1, qty: 40, price: 100, cost: 50, daysAgo: 5 });
    await seedGrn({ product_id: 1, qty: 100, daysAgo: 10 });

    await runAbcWorkerForDb({ db, windowDays: 90 });

    const { rows } = await db.query(
      `SELECT units_sold, units_received, sell_through_rate
         FROM product_abc_class WHERE product_id = 1`
    );
    expect(Number(rows[0].units_sold)).toBe(40);
    expect(Number(rows[0].units_received)).toBe(100);
    expect(Number(rows[0].sell_through_rate)).toBeCloseTo(0.4, 3);
  });
});
