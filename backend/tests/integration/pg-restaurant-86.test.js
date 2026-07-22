/**
 * pg-restaurant-86.test.js — Phase 2-R Wave A / 2-R.1
 *
 * Covers the 86'd items (menu availability) flow:
 *   1. Marking a product sold-out hides it from the public QR menu
 *   2. Public item-add refuses sold-out products with 422
 *   3. Clearing sold-out brings the product back
 */

// Force single-tenant for this test: public-tenant-context reads
// MULTI_TENANT at module-load and we don't want the master-db slug lookup
// path in an isolated schema test. Must happen BEFORE requires below.
delete process.env.MULTI_TENANT;

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 20000, hookTimeout: 90000 });

describe("Phase 2-R.1 — 86'd items (availability)", () => {
  let app, db, deps, cleanup, schemaName;

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    // Feature-flags init so requireFeature() lookups hit the test schema.
    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    // Inject req.employee for audit logging.
    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    require("../../routes/restaurant/availability")(app, deps);
    require("../../routes/public-restaurant")(app, deps);

    // Flip restaurant mode + 86 flag on.
    await db.query(`
      INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
      ON CONFLICT (mode) DO UPDATE SET enabled = true
    `);
    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_86', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
    featureFlags.invalidateFeatureFlagCache();
    featureFlags.invalidateModeCache();

    // Seed a draft_order + table + token so the public menu endpoint has
    // something to resolve (mirrors QR session seed in public-restaurant).
    // restaurant_tables needs a floor_plan_id → create a minimal plan.
    const { rows: [plan] } = await db.query(
      `INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'Test Plan') RETURNING id`
    );
    const { rows: [table] } = await db.query(
      `INSERT INTO restaurant_tables (floor_plan_id, label, capacity) VALUES ($1, 'T1', 4) RETURNING id`,
      [plan.id]
    );
    await db.query(
      `INSERT INTO draft_orders (outlet_id, created_by, table_id, order_context, status, source_token_id)
       VALUES (1, 1, $1, 'dine_in', 'open', 'test-token-86')`,
      [table.id]
    );
  });

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  it("POST /api/restaurant/products/:id/sold-out marks product 86'd", async () => {
    const res = await request(app)
      .post("/api/restaurant/products/1/sold-out")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ reason: "Out of beef patties" });
    expect(res.status).toBe(201);
    expect(res.body.is_sold_out).toBe(true);
    expect(res.body.sold_out_reason).toBe("Out of beef patties");
  });

  it("public menu omits sold-out products", async () => {
    const res = await request(app)
      .get("/api/public/restaurant/menu/test-token-86")
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(200);
    const ids = (res.body.items || []).map((i) => i.id);
    expect(ids).not.toContain(1);
    // Other seeded products still visible.
    expect(ids.length).toBeGreaterThan(0);
  });

  it("public item-add refuses sold-out products with 422", async () => {
    const res = await request(app)
      .post("/api/public/restaurant/checks/test-token-86/items")
      .set("x-tenant-schema", schemaName)
      .send({ product_id: 1, quantity: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unavailable/i);
  });

  it("GET /api/restaurant/sold-out lists 86'd products", async () => {
    const res = await request(app)
      .get("/api/restaurant/sold-out")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.some((p) => p.id === 1)).toBe(true);
  });

  it("DELETE /api/restaurant/products/:id/sold-out clears 86'd status", async () => {
    const res = await request(app)
      .delete("/api/restaurant/products/1/sold-out")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(200);
    expect(res.body.is_sold_out).toBe(false);

    // Public menu now includes the product again.
    const menuRes = await request(app)
      .get("/api/public/restaurant/menu/test-token-86")
      .set("x-tenant-schema", schemaName);
    const ids = (menuRes.body.items || []).map((i) => i.id);
    expect(ids).toContain(1);
  });
});
