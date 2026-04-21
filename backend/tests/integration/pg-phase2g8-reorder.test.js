/**
 * pg-phase2g8-reorder.test.js — Integration tests for the Reorder API.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { runAbcWorkerForDb } = require("../../workers/abc-worker-boss");

describe("2-G.8 Reorder API", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    // Inject req.employee (the test helper only sets req.employeePerms).
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
    await db.query("DELETE FROM purchase_order_items");
    await db.query("DELETE FROM purchase_orders");
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

  it("returns empty suggestions when no ABC data exists (no worker run)", async () => {
    const res = await request(app).get("/api/inventory-intelligence/reorder").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });

  it("suggests reorder qty for a product below threshold", async () => {
    // Product 3: stock 20 at outlet 1. Seed 600 units sold over last 30 days
    // → velocity = 20/day. threshold = 20 × (7 + 3) = 200. Suggested = 180.
    //
    // Note: the migration set suppliers.default_lead_time_days DEFAULT 7, so
    // every pre-existing supplier row picked up 7. To exercise the "tenant"
    // fallback here we null out the supplier default first.
    await db.query(`UPDATE suppliers SET default_lead_time_days = NULL`);

    for (let i = 0; i < 30; i++) {
      await seedSale({ product_id: 3, qty: 20, price: 500, cost: 300, daysAgo: i });
    }
    await runAbcWorkerForDb({ db, windowDays: 90 });

    const res = await request(app).get("/api/inventory-intelligence/reorder").set(auth);
    expect(res.status).toBe(200);
    const p3 = res.body.suggestions.find((s) => s.product_id === 3);
    expect(p3).toBeTruthy();
    expect(p3.suggested_qty).toBeGreaterThan(0);
    expect(p3.current_stock).toBe(20);
    expect(p3.velocity).toBeCloseTo(20, 0);
    expect(p3.lead_time_days).toBe(7);
    expect(p3.lead_time_source).toBe("tenant");

    // Restore defaults for other tests that rely on supplier lead times.
    await db.query(`UPDATE suppliers SET default_lead_time_days = 7`);
  });

  it("uses product lead_time_days_override when set", async () => {
    await db.query(
      `UPDATE products SET lead_time_days_override = 21 WHERE id = 3`
    );
    for (let i = 0; i < 30; i++) {
      await seedSale({ product_id: 3, qty: 20, price: 500, cost: 300, daysAgo: i });
    }
    await runAbcWorkerForDb({ db, windowDays: 90 });

    const res = await request(app).get("/api/inventory-intelligence/reorder").set(auth);
    const p3 = res.body.suggestions.find((s) => s.product_id === 3);
    expect(p3.lead_time_days).toBe(21);
    expect(p3.lead_time_source).toBe("override");

    // Restore so later tests aren't polluted
    await db.query(`UPDATE products SET lead_time_days_override = NULL WHERE id = 3`);
  });

  it("falls back to supplier.default_lead_time_days when no product override", async () => {
    await db.query(
      `UPDATE suppliers SET default_lead_time_days = 14 WHERE id = 2`
    );
    // Product 3 has supplier_id 2 per the seed fixtures.
    for (let i = 0; i < 30; i++) {
      await seedSale({ product_id: 3, qty: 20, price: 500, cost: 300, daysAgo: i });
    }
    await runAbcWorkerForDb({ db, windowDays: 90 });

    const res = await request(app).get("/api/inventory-intelligence/reorder").set(auth);
    const p3 = res.body.suggestions.find((s) => s.product_id === 3);
    expect(p3.lead_time_days).toBe(14);
    expect(p3.lead_time_source).toBe("supplier");

    await db.query(`UPDATE suppliers SET default_lead_time_days = NULL WHERE id = 2`);
  });

  it("POST /reorder/create-po creates a Draft PO with the selected items", async () => {
    for (let i = 0; i < 30; i++) {
      await seedSale({ product_id: 3, qty: 20, price: 500, cost: 300, daysAgo: i });
    }
    await runAbcWorkerForDb({ db, windowDays: 90 });

    const res = await request(app)
      .post("/api/inventory-intelligence/reorder/create-po")
      .set(auth)
      .send({
        supplier_id: 1,
        outlet_id: 1,
        items: [{ product_id: 3, qty: 50, cost_price: 300 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.po_id).toBeGreaterThan(0);

    const { rows } = await db.query(
      `SELECT po.supplier_id, po.status, poi.product_id, poi.quantity
         FROM purchase_orders po
         JOIN purchase_order_items poi ON poi.po_id = po.id
        WHERE po.id = $1`,
      [res.body.po_id]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("Draft");
    expect(rows[0].product_id).toBe(3);
    expect(Number(rows[0].quantity)).toBe(50);
  });

  it("returns 503 when phase2g_inventory_intelligence feature flag is off", async () => {
    await db.query(
      `UPDATE feature_flags SET enabled = false WHERE key = 'phase2g_inventory_intelligence'`
    );
    const res = await request(app).get("/api/inventory-intelligence/reorder").set(auth);
    expect(res.status).toBe(503);
    await db.query(
      `UPDATE feature_flags SET enabled = true WHERE key = 'phase2g_inventory_intelligence'`
    );
  });

  it("returns 403 when employee lacks manage_inventory", async () => {
    // Cashier (id=3) does not have manage_inventory per seed.
    const res = await request(app)
      .get("/api/inventory-intelligence/reorder")
      .set({ "x-employee-id": "3" });
    expect(res.status).toBe(403);
  });
});
