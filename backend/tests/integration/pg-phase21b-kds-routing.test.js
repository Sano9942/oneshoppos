const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

/**
 * pg-phase21b-kds-routing.test.js — Phase 2.1 Batch B1 KDS routing rules.
 *
 * Covers the precedence ladder (product_id > modifier_group_id > category_id
 * > match_all), priority tie-breaking, the CHECK constraint that exactly one
 * match type is set, and the read-only previewRouting service.
 */

describe("Phase 2.1 B1 — KDS routing rules (Postgres)", () => {
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
    require("../../routes/kds")(app, deps);
    require("../../routes/modifiers")(app, deps);

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

  async function cleanRoutes() {
    await db.query("DELETE FROM kds_station_routes");
  }

  async function seedStations() {
    const { rows: [grill] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'Grill', 'prep') RETURNING id`
    );
    const { rows: [cold] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'Cold Prep', 'prep') RETURNING id`
    );
    const { rows: [bar] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'Bar', 'prep') RETURNING id`
    );
    return { grillId: grill.id, coldId: cold.id, barId: bar.id };
  }

  describe("CHECK constraint — exactly one match type", () => {
    it("rejects a rule with no match type set", async () => {
      await cleanRoutes();
      const { rows: [station] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'X', 'prep') RETURNING id`
      );
      await expect(
        db.query(
          `INSERT INTO kds_station_routes (station_id, outlet_id) VALUES ($1, 1)`,
          [station.id]
        )
      ).rejects.toThrow(/kds_station_routes_exactly_one_match/);
    });

    it("rejects a rule with two match types set (product + category)", async () => {
      await cleanRoutes();
      const { rows: [station] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'Y', 'prep') RETURNING id`
      );
      await expect(
        db.query(
          `INSERT INTO kds_station_routes (station_id, outlet_id, product_id, category_id)
           VALUES ($1, 1, 1, 1)`,
          [station.id]
        )
      ).rejects.toThrow(/kds_station_routes_exactly_one_match/);
    });

    it("accepts a rule with exactly one match type (match_all)", async () => {
      await cleanRoutes();
      const { rows: [station] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'Z', 'prep') RETURNING id`
      );
      const { rowCount } = await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, match_all) VALUES ($1, 1, true)`,
        [station.id]
      );
      expect(rowCount).toBe(1);
    });
  });

  describe("precedence — highest priority with most specific match wins", () => {
    it("product_id rule at higher priority beats category_id rule", async () => {
      await cleanRoutes();
      const { grillId, coldId } = await seedStations();

      // Category rule for category 1 → cold prep, priority 10
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, category_id, priority)
         VALUES ($1, 1, 1, 10)`,
        [coldId]
      );
      // Product rule for product 1 → grill, priority 100 (higher)
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, product_id, priority)
         VALUES ($1, 1, 1, 100)`,
        [grillId]
      );

      const checkRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, order_context: "dine_in", seat_count: 1 });
      expect(checkRes.status).toBe(201);
      const checkId = checkRes.body.id;
      await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, course_name, kitchen_status)
         VALUES ($1, 1, 'Widget A', 1, 100, 'main', 'pending')`,
        [checkId]
      );

      const previewRes = await request(app)
        .get("/api/kds/routes/preview")
        .query({ draft_order_id: checkId })
        .set("x-employee-id", "1");
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.preview).toHaveLength(1);
      expect(previewRes.body.preview[0].station_id).toBe(grillId);
    });

    it("three rules overlapping — highest priority wins", async () => {
      await cleanRoutes();
      const { grillId, coldId, barId } = await seedStations();
      // category_id=1 → cold prep @ priority 5
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, category_id, priority)
         VALUES ($1, 1, 1, 5)`,
        [coldId]
      );
      // match_all → bar @ priority 1
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
         VALUES ($1, 1, true, 1)`,
        [barId]
      );
      // category_id=1 → grill @ priority 50 (highest)
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, category_id, priority)
         VALUES ($1, 1, 1, 50)`,
        [grillId]
      );

      const checkRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, order_context: "dine_in", seat_count: 1 });
      const checkId = checkRes.body.id;
      await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, course_name, kitchen_status)
         VALUES ($1, 1, 'Widget A', 1, 100, 'main', 'pending')`,
        [checkId]
      );

      const previewRes = await request(app)
        .get("/api/kds/routes/preview")
        .query({ draft_order_id: checkId })
        .set("x-employee-id", "1");
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.preview[0].station_id).toBe(grillId);
    });
  });

  describe("modifier_group routing", () => {
    it("item with a modifier in a routed group goes to that station even if category points elsewhere", async () => {
      await cleanRoutes();
      const { grillId, coldId } = await seedStations();

      // Create modifier group "Grilled"
      const { rows: [mg] } = await db.query(
        `INSERT INTO modifier_groups (name, selection_type, max_select)
         VALUES ('Grilled', 'single', 1) RETURNING id`
      );
      const { rows: [opt] } = await db.query(
        `INSERT INTO modifier_options (group_id, name, price_delta)
         VALUES ($1, 'char-grilled', 0) RETURNING id`,
        [mg.id]
      );

      // Category 1 → cold prep (the "wrong" answer)
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, category_id, priority)
         VALUES ($1, 1, 1, 5)`,
        [coldId]
      );
      // Modifier group "Grilled" → grill (the right answer, higher priority)
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, modifier_group_id, priority)
         VALUES ($1, 1, $2, 50)`,
        [grillId, mg.id]
      );

      const checkRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, order_context: "dine_in", seat_count: 1 });
      const checkId = checkRes.body.id;
      const { rows: [item] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, course_name, kitchen_status)
         VALUES ($1, 1, 'Ribeye', 1, 1500, 'main', 'pending') RETURNING id`,
        [checkId]
      );
      // Attach the modifier so modifier_group_id matches
      await db.query(
        `INSERT INTO draft_order_item_modifiers
          (draft_order_item_id, option_id, option_name_snapshot, price_delta_snapshot)
         VALUES ($1, $2, 'char-grilled', 0)`,
        [item.id, opt.id]
      );

      const previewRes = await request(app)
        .get("/api/kds/routes/preview")
        .query({ draft_order_id: checkId })
        .set("x-employee-id", "1");
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.preview[0].station_id).toBe(grillId);
    });
  });

  describe("previewRouting is read-only", () => {
    it("calling preview does not create any kds_tickets rows", async () => {
      await cleanRoutes();
      await db.query("DELETE FROM kds_tickets");
      const { grillId } = await seedStations();
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
         VALUES ($1, 1, true, 0)`,
        [grillId]
      );

      const checkRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, order_context: "dine_in", seat_count: 1 });
      const checkId = checkRes.body.id;
      await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, course_name, kitchen_status)
         VALUES ($1, 1, 'Widget A', 1, 100, 'main', 'pending')`,
        [checkId]
      );

      const before = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1`,
        [checkId]
      );
      expect(before.rows[0].n).toBe(0);

      const previewRes = await request(app)
        .get("/api/kds/routes/preview")
        .query({ draft_order_id: checkId })
        .set("x-employee-id", "1");
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.preview).toHaveLength(1);

      const after = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1`,
        [checkId]
      );
      expect(after.rows[0].n).toBe(0);
    });
  });

  describe("route CRUD endpoint", () => {
    it("POST /api/kds/routes creates a rule", async () => {
      await cleanRoutes();
      const { grillId } = await seedStations();
      const res = await request(app)
        .post("/api/kds/routes")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, station_id: grillId, match_all: true, priority: 10 });
      expect(res.status).toBe(201);
      expect(res.body.station_id).toBe(grillId);
      expect(res.body.priority).toBe(10);
      expect(res.body.match_all).toBe(true);
    });

    it("POST /api/kds/routes rejects request with zero match types", async () => {
      await cleanRoutes();
      const { grillId } = await seedStations();
      const res = await request(app)
        .post("/api/kds/routes")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, station_id: grillId, priority: 0 });
      expect(res.status).toBe(400);
    });

    it("PUT /api/kds/routes/:id updates priority", async () => {
      await cleanRoutes();
      const { grillId } = await seedStations();
      const create = await request(app)
        .post("/api/kds/routes")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, station_id: grillId, match_all: true, priority: 5 });
      expect(create.status).toBe(201);
      const routeId = create.body.id;
      const upd = await request(app)
        .put(`/api/kds/routes/${routeId}`)
        .set("x-employee-id", "1")
        .send({ priority: 99 });
      expect(upd.status).toBe(200);
      expect(upd.body.priority).toBe(99);
    });

    it("GET /api/kds/routes lists rules for an outlet", async () => {
      await cleanRoutes();
      const { grillId, coldId } = await seedStations();
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority) VALUES ($1, 1, true, 1)`,
        [grillId]
      );
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, category_id, priority) VALUES ($1, 1, 1, 10)`,
        [coldId]
      );
      const res = await request(app)
        .get("/api/kds/routes")
        .query({ outlet_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.routes.length).toBeGreaterThanOrEqual(2);
      // Highest priority first
      expect(res.body.routes[0].priority).toBeGreaterThanOrEqual(res.body.routes[1].priority);
    });
  });
});
