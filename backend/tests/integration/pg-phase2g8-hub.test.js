/**
 * pg-phase2g8-hub.test.js — Integration tests for ABC listing +
 * dashboard-cards endpoints and the stock-aging extension (Task 7).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { runAbcWorkerForDb } = require("../../workers/abc-worker-boss");

describe("2-G.8 ABC listing + dashboard-cards", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase2g_inventory_intelligence', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    require("../../routes/inventory-intelligence")(app, deps);
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60000);

  beforeEach(async () => {
    await db.query("DELETE FROM product_abc_class");
    await db.query("DELETE FROM sale_items");
    await db.query("DELETE FROM sales");
  });

  async function seedSale({ product_id, qty, price, cost, daysAgo }) {
    const { rows } = await db.query(
      `INSERT INTO sales (total_amount, payment_method, timestamp, outlet_id, employee_id)
       VALUES ($1, 'cash', NOW() - ($2 * INTERVAL '1 day'), 1, 1) RETURNING id`,
      [qty * price, daysAgo]
    );
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale)
       VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, product_id, qty, price, cost]
    );
  }

  const auth = { "x-employee-id": "1" };

  describe("GET /api/inventory-intelligence/abc", () => {
    it("returns empty list when no ABC data", async () => {
      const res = await request(app).get("/api/inventory-intelligence/abc").set(auth);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it("lists products with rank + revenue %, sorted desc by revenue_contribution_pct", async () => {
      await seedSale({ product_id: 1, qty: 80, price: 100, cost: 50, daysAgo: 5 });
      await seedSale({ product_id: 2, qty: 10, price: 100, cost: 50, daysAgo: 5 });
      await seedSale({ product_id: 3, qty: 2, price: 100, cost: 50, daysAgo: 5 });
      await runAbcWorkerForDb({ db, windowDays: 90 });

      const res = await request(app).get("/api/inventory-intelligence/abc").set(auth);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(3);
      expect(res.body.items[0].product_id).toBe(1);
      expect(res.body.items[0].rank).toBe("A");
    });

    it("filters by rank", async () => {
      await seedSale({ product_id: 1, qty: 80, price: 100, cost: 50, daysAgo: 5 });
      await seedSale({ product_id: 2, qty: 10, price: 100, cost: 50, daysAgo: 5 });
      await seedSale({ product_id: 3, qty: 2, price: 100, cost: 50, daysAgo: 5 });
      await runAbcWorkerForDb({ db, windowDays: 90 });

      const res = await request(app)
        .get("/api/inventory-intelligence/abc?rank=A")
        .set(auth);
      expect(res.body.items.every((r) => r.rank === "A")).toBe(true);
    });

    it("filters dead_stock_only=true to products with days_since_last_sale ≥ 90", async () => {
      // Sale within window (still in revenue aggregation) but last_sale_at 85 days ago.
      await seedSale({ product_id: 1, qty: 10, price: 100, cost: 50, daysAgo: 85 });
      await runAbcWorkerForDb({ db, windowDays: 90 });

      const res = await request(app)
        .get("/api/inventory-intelligence/abc?dead_stock_only=true")
        .set(auth);
      expect(res.body.items.length).toBe(0);

      // Now set days_since_last_sale ≥ 90 directly to simulate stale product.
      await db.query(
        `UPDATE product_abc_class SET days_since_last_sale = 120 WHERE product_id = 1`
      );
      const res2 = await request(app)
        .get("/api/inventory-intelligence/abc?dead_stock_only=true")
        .set(auth);
      expect(res2.body.items.length).toBe(1);
      expect(res2.body.items[0].product_id).toBe(1);
    });
  });

  describe("GET /api/inventory-intelligence/dashboard-cards", () => {
    it("returns the 4-card shape even with no data", async () => {
      const res = await request(app)
        .get("/api/inventory-intelligence/dashboard-cards")
        .set(auth);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("reorder_count");
      expect(res.body).toHaveProperty("next_cycle_count");
      expect(res.body).toHaveProperty("dead_stock_count");
      expect(res.body).toHaveProperty("stock_value_at_risk");
      expect(res.body.reorder_count).toBe(0);
      expect(res.body.dead_stock_count).toBe(0);
    });

    it("counts dead stock + sums stock_value_at_risk using cost_price × current outlet_stock", async () => {
      await seedSale({ product_id: 1, qty: 10, price: 100, cost: 50, daysAgo: 5 });
      await runAbcWorkerForDb({ db, windowDays: 90 });

      // Product 1: cost_price 60, stock 50 at outlet 1 + 10 at outlet 2 = 60 units.
      // Force dead-stock flag (≥ 90 days since last sale).
      await db.query(
        `UPDATE product_abc_class SET days_since_last_sale = 120 WHERE product_id = 1`
      );

      const res = await request(app)
        .get("/api/inventory-intelligence/dashboard-cards")
        .set(auth);
      expect(res.body.dead_stock_count).toBe(1);
      // 60 units × 60 cost = 3600
      expect(Number(res.body.stock_value_at_risk)).toBeCloseTo(3600, 0);
    });
  });

  it("503 when feature flag off for ABC endpoint", async () => {
    await db.query(
      `UPDATE feature_flags SET enabled = false WHERE key = 'phase2g_inventory_intelligence'`
    );
    const res = await request(app).get("/api/inventory-intelligence/abc").set(auth);
    expect(res.status).toBe(503);
    await db.query(
      `UPDATE feature_flags SET enabled = true WHERE key = 'phase2g_inventory_intelligence'`
    );
  });
});
