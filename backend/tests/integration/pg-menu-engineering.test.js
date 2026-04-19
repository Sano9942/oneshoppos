/**
 * pg-menu-engineering.test.js — Phase 2-R Wave C / 2-R.10
 *
 * Boston-matrix menu engineering report:
 *   1. Four products seeded to hit each quadrant (star/plowhorse/puzzle/dog)
 *   2. Void via sale_item_adjustments removes a line from popularity + profit
 *   3. Sales outside date range excluded
 *   4. Category filter scopes the output
 */

delete process.env.MULTI_TENANT;

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { MIGRATIONS } = require("../../migrate-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 300000 });

describe("Phase 2-R.10 — menu engineering report", () => {
  let app, db, deps, cleanup, schemaName;

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    // Wave B (v59) adds sale_item_adjustments. Apply before route register.
    const v59 = MIGRATIONS.find((m) => m.version === 59);
    await v59.up(await db.getClient());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      req.employeePerms = ["all_access"];
      req.company = { timezone: "UTC" };
      next();
    });

    require("../../routes/reports/menu-engineering")(app, deps);

    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = true`
    );
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_restaurant_menu_engineering', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    featureFlags.invalidateFeatureFlagCache();
    featureFlags.invalidateModeCache();
  });

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  async function wipe() {
    await db.query("DELETE FROM sale_item_adjustments");
    await db.query("DELETE FROM sale_items");
    await db.query("DELETE FROM sales");
    // outlet_stock + product_variants FK products — drop child rows first.
    await db.query("DELETE FROM outlet_stock");
    await db.query("DELETE FROM product_variants");
    await db.query("DELETE FROM products WHERE id > 0");
    await db.query("DELETE FROM categories WHERE id > 0");
  }

  async function seedProduct(name, price, cost, categoryId = null) {
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, price, cost_price, category_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, price, cost, categoryId]
    );
    return p.id;
  }

  async function seedSale(productId, qty, price, cost, whenISO = null) {
    const ts = whenISO || new Date().toISOString();
    const { rows: [s] } = await db.query(
      `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, timestamp)
       VALUES ($1, 'cash', 1, 1, $2) RETURNING id`,
      [qty * price, ts]
    );
    const { rows: [si] } = await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [s.id, productId, qty, price, cost]
    );
    return { saleId: s.id, saleItemId: si.id };
  }

  it("classifies four products into the four quadrants", async () => {
    await wipe();
    // Star: high popularity + high margin per unit
    const pStar = await seedProduct("Ribeye", 4000, 1500);
    for (let i = 0; i < 10; i++) await seedSale(pStar, 1, 4000, 1500);
    // Plowhorse: high popularity + low margin
    const pPlow = await seedProduct("Water", 200, 150);
    for (let i = 0; i < 10; i++) await seedSale(pPlow, 1, 200, 150);
    // Puzzle: low popularity + high margin
    const pPuzzle = await seedProduct("Truffle Dish", 8000, 2000);
    for (let i = 0; i < 2; i++) await seedSale(pPuzzle, 1, 8000, 2000);
    // Dog: low popularity + low margin
    const pDog = await seedProduct("Unpopular Snack", 300, 250);
    for (let i = 0; i < 2; i++) await seedSale(pDog, 1, 300, 250);

    const res = await request(app)
      .get("/api/reports/menu-engineering")
      .set("x-employee-id", "1")
      .query({ from: "2020-01-01", to: "2099-01-01" });

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(4);
    const byName = Object.fromEntries(res.body.products.map((p) => [p.name, p]));
    expect(byName.Ribeye.classification).toBe("star");
    expect(byName.Water.classification).toBe("plowhorse");
    expect(byName["Truffle Dish"].classification).toBe("puzzle");
    expect(byName["Unpopular Snack"].classification).toBe("dog");
  });

  it("voided sale_item adjustment excludes that line from popularity + profit", async () => {
    await wipe();
    const pId = await seedProduct("Burger", 1000, 400);
    // Sale A: 3 units, will be voided
    const { saleItemId: voidedLine } = await seedSale(pId, 3, 1000, 400);
    // Sale B: 1 unit, real
    await seedSale(pId, 1, 1000, 400);

    await db.query(
      `INSERT INTO sale_item_adjustments
         (sale_id, sale_item_id, adjustment_type, reason_code, amount, created_by_employee_id)
       VALUES ((SELECT sale_id FROM sale_items WHERE id = $1), $1, 'void', 'spilled', 3000, 1)`,
      [voidedLine]
    );

    const res = await request(app)
      .get("/api/reports/menu-engineering")
      .set("x-employee-id", "1")
      .query({ from: "2020-01-01", to: "2099-01-01" });

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1);
    const row = res.body.products[0];
    expect(row.popularity).toBe(1); // only the un-voided unit counts
    expect(row.revenue).toBe(1000);
    expect(row.profit).toBe(600);
  });

  it("sales outside the date range are excluded", async () => {
    await wipe();
    const pId = await seedProduct("Thing", 500, 100);
    await seedSale(pId, 5, 500, 100, "2019-06-01T12:00:00Z");   // out
    await seedSale(pId, 2, 500, 100, "2025-06-01T12:00:00Z");   // in

    const res = await request(app)
      .get("/api/reports/menu-engineering")
      .set("x-employee-id", "1")
      .query({ from: "2025-01-01", to: "2025-12-31" });

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].popularity).toBe(2);
  });

  it("category filter scopes the output", async () => {
    await wipe();
    const { rows: [catA] } = await db.query(
      `INSERT INTO categories (name) VALUES ('Mains') RETURNING id`
    );
    const { rows: [catB] } = await db.query(
      `INSERT INTO categories (name) VALUES ('Drinks') RETURNING id`
    );
    const pA = await seedProduct("Pizza", 1200, 400, catA.id);
    const pB = await seedProduct("Juice", 400, 100, catB.id);
    await seedSale(pA, 3, 1200, 400);
    await seedSale(pB, 3, 400, 100);

    const res = await request(app)
      .get("/api/reports/menu-engineering")
      .set("x-employee-id", "1")
      .query({ from: "2020-01-01", to: "2099-01-01", category_id: catA.id });

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].name).toBe("Pizza");
  });
});
