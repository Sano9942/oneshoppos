const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 20000, hookTimeout: 60000 });

/**
 * pg-phase21a-split.test.js — Phase 2.1 Batch A1 split-bill extensions.
 *
 * Covers the new `by_amount` / `evenly` split types, the `merge` endpoint,
 * and validation guards. Extends the existing `by_item` split coverage from
 * pg-batch13-restaurant.test.js without duplicating the happy-path JSON
 * shape assertions.
 */

describe("Phase 2.1 A1 — Split-bill extensions (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    require("../../routes/restaurant")(app, deps);

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_kds', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
  }, 30000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  // Create a check with known total for split-by-amount math.
  async function seedCheckWithItems(items) {
    const { rows: [order] } = await db.query(
      `INSERT INTO draft_orders (outlet_id, created_by, order_context, status)
       VALUES (1, 1, 'dine_in', 'open') RETURNING *`
    );
    for (const it of items) {
      await db.query(
        `INSERT INTO draft_order_items
           (draft_order_id, product_id, product_name, quantity, price, effective_tax_rate)
         VALUES ($1, $2, $3, $4, $5, 0)`,
        [order.id, it.product_id, it.product_name, it.quantity || 1, it.price]
      );
    }
    // Trigger total recalc via the service helper
    const svc = require("../../services/restaurant-checks");
    await db.transaction(async (client) => {
      await svc.recalcCheckTotals(client, order.id);
    });
    const { rows: [refreshed] } = await db.query("SELECT * FROM draft_orders WHERE id = $1", [order.id]);
    return refreshed;
  }

  describe("split_type = by_amount", () => {
    it("splits 900 total into 3 parts of 300 each", async () => {
      const source = await seedCheckWithItems([
        { product_id: 1, product_name: "Item A", price: 900 },
      ]);
      expect(Number(source.total)).toBe(900);

      const res = await request(app)
        .post(`/api/restaurant/checks/${source.id}/split`)
        .set("x-employee-id", "1")
        .send({ split_type: "by_amount", parts: 3 });

      expect(res.status).toBe(200);
      expect(res.body.new_checks).toHaveLength(3);
      const totals = res.body.new_checks.map((c) => Number(c.total)).sort();
      expect(totals).toEqual([300, 300, 300]);
      for (const c of res.body.new_checks) {
        expect(c.split_parent_id).toBe(source.id);
        expect(c.split_strategy).toBe("by_amount");
      }
    });

    it("pennies modulo go to the last child (1000 / 3 → 333.33/333.33/333.34)", async () => {
      const source = await seedCheckWithItems([
        { product_id: 1, product_name: "Item", price: 1000 },
      ]);
      const res = await request(app)
        .post(`/api/restaurant/checks/${source.id}/split`)
        .set("x-employee-id", "1")
        .send({ split_type: "by_amount", parts: 3 });

      expect(res.status).toBe(200);
      const totals = res.body.new_checks.map((c) => Number(c.total));
      // First two should be 333.33, last should absorb the 0.01 rounding remainder
      const sum = totals.reduce((a, b) => a + Math.round(b * 100), 0);
      expect(sum).toBe(100000); // 1000 * 100 cents
      const max = Math.max(...totals);
      const min = Math.min(...totals);
      expect(max - min).toBeCloseTo(0.01, 2);
    });

    it("adjustments (e.g. 10% gratuity) are distributed proportionally", async () => {
      const source = await seedCheckWithItems([
        { product_id: 1, product_name: "Item", price: 900 },
      ]);
      await db.query(
        `INSERT INTO restaurant_check_adjustments
           (draft_order_id, adjustment_type, label, amount, is_percentage, percentage_value)
         VALUES ($1, 'gratuity', '10% tip', 90, true, 10)`,
        [source.id]
      );

      const res = await request(app)
        .post(`/api/restaurant/checks/${source.id}/split`)
        .set("x-employee-id", "1")
        .send({ split_type: "by_amount", parts: 3 });

      expect(res.status).toBe(200);
      const childIds = res.body.new_checks.map((c) => c.id);
      const { rows } = await db.query(
        `SELECT draft_order_id, amount FROM restaurant_check_adjustments
         WHERE draft_order_id = ANY($1) ORDER BY draft_order_id`,
        [childIds]
      );
      // 3 children × 1 adjustment each
      expect(rows).toHaveLength(3);
      const adjSum = rows.reduce((s, r) => s + Number(r.amount), 0);
      expect(adjSum).toBeCloseTo(90, 2);
    });

    it("rejects parts = 0 (or missing) via schema validation", async () => {
      const source = await seedCheckWithItems([
        { product_id: 1, product_name: "Item", price: 100 },
      ]);
      const res = await request(app)
        .post(`/api/restaurant/checks/${source.id}/split`)
        .set("x-employee-id", "1")
        .send({ split_type: "by_amount" }); // no parts

      expect(res.status).toBe(400);
    });
  });

  describe("split_type = evenly", () => {
    it("stamps strategy = 'evenly' and splits the total N ways", async () => {
      const source = await seedCheckWithItems([
        { product_id: 1, product_name: "Item", price: 400 },
      ]);
      const res = await request(app)
        .post(`/api/restaurant/checks/${source.id}/split`)
        .set("x-employee-id", "1")
        .send({ split_type: "evenly", parts: 4 });

      expect(res.status).toBe(200);
      expect(res.body.new_checks).toHaveLength(4);
      for (const c of res.body.new_checks) {
        expect(c.split_strategy).toBe("evenly");
        expect(Number(c.total)).toBe(100);
      }
    });
  });

  describe("POST /api/restaurant/checks/merge", () => {
    it("accepts 'merged' as a valid status (CHECK constraint widened by v51)", async () => {
      const { rows: [row] } = await db.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, status)
         VALUES (1, 1, 'dine_in', 'merged') RETURNING status`
      );
      expect(row.status).toBe("merged");
    });

    it("moves items from sources into target, closes sources as 'merged'", async () => {
      const a = await seedCheckWithItems([
        { product_id: 1, product_name: "A-Item", price: 50 },
      ]);
      const b = await seedCheckWithItems([
        { product_id: 2, product_name: "B-Item", price: 75 },
      ]);
      const c = await seedCheckWithItems([
        { product_id: 3, product_name: "C-Item", price: 100 },
      ]);

      const res = await request(app)
        .post(`/api/restaurant/checks/merge`)
        .set("x-employee-id", "1")
        .send({ target_id: a.id, source_ids: [b.id, c.id] });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(a.id);
      expect(Number(res.body.total)).toBe(50 + 75 + 100);

      // Sources are marked merged and have no items
      const { rows: bStatus } = await db.query("SELECT status FROM draft_orders WHERE id = $1", [b.id]);
      expect(bStatus[0].status).toBe("merged");
      const { rows: cStatus } = await db.query("SELECT status FROM draft_orders WHERE id = $1", [c.id]);
      expect(cStatus[0].status).toBe("merged");

      const { rows: itemRows } = await db.query(
        "SELECT draft_order_id FROM draft_order_items WHERE draft_order_id = ANY($1)",
        [[b.id, c.id]]
      );
      expect(itemRows).toHaveLength(0);
    });

    it("rejects merge where target is in source_ids list (400)", async () => {
      const a = await seedCheckWithItems([{ product_id: 1, product_name: "A", price: 10 }]);
      const res = await request(app)
        .post(`/api/restaurant/checks/merge`)
        .set("x-employee-id", "1")
        .send({ target_id: a.id, source_ids: [a.id] });
      expect(res.status).toBe(400);
    });

    it("rejects empty source_ids via schema validation", async () => {
      const a = await seedCheckWithItems([{ product_id: 1, product_name: "A", price: 10 }]);
      const res = await request(app)
        .post(`/api/restaurant/checks/merge`)
        .set("x-employee-id", "1")
        .send({ target_id: a.id, source_ids: [] });
      expect(res.status).toBe(400);
    });
  });

  describe("by_item split still stamps parent + strategy", () => {
    it("each child check has split_parent_id = source and strategy = 'by_item'", async () => {
      const source = await seedCheckWithItems([
        { product_id: 1, product_name: "Widget A", price: 100 },
        { product_id: 2, product_name: "Widget B", price: 200 },
      ]);
      const { rows: items } = await db.query(
        "SELECT id FROM draft_order_items WHERE draft_order_id = $1 ORDER BY id",
        [source.id]
      );

      const res = await request(app)
        .post(`/api/restaurant/checks/${source.id}/split`)
        .set("x-employee-id", "1")
        .send({
          split_type: "by_item",
          item_assignments: [
            { item_id: items[0].id, target_check_index: 0 },
            { item_id: items[1].id, target_check_index: 1 },
          ],
        });

      expect(res.status).toBe(200);
      for (const child of res.body.new_checks) {
        expect(child.split_parent_id).toBe(source.id);
        expect(child.split_strategy).toBe("by_item");
      }
    });
  });
});
