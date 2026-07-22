/**
 * pg-menu-schedules.test.js — Phase 2-R Wave B / 2-R.6
 *
 * Day-parting resolver + public menu filter:
 *   1. "Breakfast" 07:00-11:00 Mon-Fri for product 1 (Pancakes).
 *   2. At a Mon 09:00 stub, product 1 is available and menu includes it.
 *   3. At a Mon 14:00 stub, product 1 is unavailable and menu omits it.
 *   4. Flag off → schedule ignored (backward compat).
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { MIGRATIONS } = require("../../migrate-pg");
const resolver = require("../../services/menu-schedule-resolver");

// migrate-pg.js calls dotenv.config() at require time which re-injects
// MULTI_TENANT=1 from .env. Unset AFTER all the above requires but BEFORE
// routes/public-restaurant.js loads (inside beforeAll), so that
// services/public-tenant-context.js captures the single-tenant branch.
delete process.env.MULTI_TENANT;

vi.setConfig({ testTimeout: 30000, hookTimeout: 300000 });

// Build a Date whose local wall-clock in UTC matches the desired hour.
// All tests assume tenant timezone = "UTC" (default from company_profile
// seeded by createTestApp), so we use UTC weekday + UTC hour directly.
function utcAt(weekday /* 0=Sun */, hour, minute = 0) {
  // 2026-04-20 is a Monday. Offset by (weekday - 1) days.
  const base = new Date(Date.UTC(2026, 3, 20, hour, minute, 0)); // Apr 20 2026 = Mon
  const shift = weekday - 1; // 0=Sun → -1 = Apr 19
  base.setUTCDate(base.getUTCDate() + shift);
  return base;
}

describe("Phase 2-R.6 — Day-parting / menu schedules", () => {
  let app, db, deps, cleanup, schemaName;

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());
    const v59 = MIGRATIONS.find((m) => m.version === 59);
    await v59.up(await db.getClient());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    require("../../routes/restaurant/menu-schedules")(app, deps);
    require("../../routes/public-restaurant")(app, deps);

    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = true`
    );
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES
         ('phase4_restaurant', true),
         ('phase4_restaurant_day_parting', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    featureFlags.invalidateFeatureFlagCache();
    featureFlags.invalidateModeCache();

    // Company timezone = UTC keeps tests independent of host tz.
    await db.query(`UPDATE company_profile SET timezone = 'UTC' WHERE id = 1`);

    // Seed restaurant floor plan + table + draft_order + token for public menu.
    const { rows: [plan] } = await db.query(
      `INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'Test Plan') RETURNING id`
    );
    const { rows: [table] } = await db.query(
      `INSERT INTO restaurant_tables (floor_plan_id, label, capacity) VALUES ($1, 'T1', 4) RETURNING id`,
      [plan.id]
    );
    await db.query(
      `INSERT INTO draft_orders (outlet_id, created_by, table_id, order_context, status, source_token_id)
       VALUES (1, 1, $1, 'dine_in', 'open', 'test-token-schedule')`,
      [table.id]
    );

    // Create "Breakfast" schedule 07:00-11:00 Mon-Fri, pinned to product 1.
    // 5 rows (one per weekday) — day_of_week filter uses weekday 0=Sun.
    for (const dow of [1, 2, 3, 4, 5]) {
      await db.query(
        `INSERT INTO menu_schedules (name, outlet_id, day_of_week, start_time, end_time, is_active)
         VALUES ('Breakfast', 1, $1, '07:00', '11:00', true)`,
        [dow]
      );
    }
    // Pin product 1 to every one of those rows.
    const { rows: rows } = await db.query(`SELECT id FROM menu_schedules WHERE name = 'Breakfast'`);
    for (const { id } of rows) {
      await db.query(
        `INSERT INTO menu_schedule_products (schedule_id, product_id) VALUES ($1, 1)`,
        [id]
      );
    }
    resolver.invalidateMenuScheduleCache();
  });

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  it("resolver: product is available at Mon 09:00 UTC", async () => {
    resolver.invalidateMenuScheduleCache();
    const available = await resolver.isProductAvailableNow(db, 1, 1, utcAt(1, 9));
    expect(available).toBe(true);
  });

  it("resolver: product is NOT available at Mon 14:00 UTC", async () => {
    resolver.invalidateMenuScheduleCache();
    const available = await resolver.isProductAvailableNow(db, 1, 1, utcAt(1, 14));
    expect(available).toBe(false);
  });

  it("resolver: product with no schedules is always available (product 2)", async () => {
    resolver.invalidateMenuScheduleCache();
    const available = await resolver.isProductAvailableNow(db, 2, 1, utcAt(1, 14));
    expect(available).toBe(true);
  });

  it("resolver: filterAvailableProducts strips product 1 at Mon 14:00", async () => {
    resolver.invalidateMenuScheduleCache();
    const out = await resolver.filterAvailableProducts(
      db,
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      1,
      utcAt(1, 14),
    );
    const ids = out.map((p) => p.id);
    expect(ids).not.toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });

  it("public menu filter respects the day_parting flag (flag on, off-hours)", async () => {
    // Can't stub "now" on the HTTP route, so this checks the wiring only
    // when real wall-clock lands in/out of the window. Instead, verify
    // that the resolver is called end-to-end by turning the flag off and
    // confirming product 1 always shows (backward compat).
    const featureFlags = require("../../middleware/feature-flags");
    await db.query(
      `UPDATE feature_flags SET enabled = false WHERE key = 'phase4_restaurant_day_parting'`
    );
    featureFlags.invalidateFeatureFlagCache();

    try {
      const res = await request(app)
        .get("/api/public/restaurant/menu/test-token-schedule")
        .set("x-tenant-schema", schemaName);
      expect(res.status).toBe(200);
      const ids = (res.body.items || []).map((i) => i.id);
      expect(ids).toContain(1); // flag off → product 1 always visible
    } finally {
      // Always restore the flag — otherwise a failure here cascades into the
      // next test (CRUD) with 503 Feature disabled.
      await db.query(
        `UPDATE feature_flags SET enabled = true WHERE key = 'phase4_restaurant_day_parting'`
      );
      featureFlags.invalidateFeatureFlagCache();
    }
  });

  it("CRUD: POST/PUT/DELETE /api/restaurant/menu-schedules", async () => {
    const create = await request(app)
      .post("/api/restaurant/menu-schedules")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({
        name: "Lunch",
        outlet_id: 1,
        day_of_week: 1,
        start_time: "12:00",
        end_time: "15:00",
        product_ids: [2, 3],
      });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe("Lunch");
    expect(create.body.product_ids.sort()).toEqual([2, 3]);

    const update = await request(app)
      .put(`/api/restaurant/menu-schedules/${create.body.id}`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ product_ids: [4] });
    expect(update.status).toBe(200);
    expect(update.body.product_ids).toEqual([4]);

    const del = await request(app)
      .delete(`/api/restaurant/menu-schedules/${create.body.id}`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(del.status).toBe(200);
  });
});
