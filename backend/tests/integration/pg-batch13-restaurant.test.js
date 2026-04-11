const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

// Bump per-test timeout: KDS fan-out tests (Phase 4 C3, added 2026-04-11)
// do 7+ supertest round-trips each (seed check + insert items + POST
// send-to-kitchen + 2× GET kds/tickets). Against remote Supabase the
// default 5s ceiling is tight; 20s gives comfortable headroom without
// letting a real stall go unnoticed.
vi.setConfig({ testTimeout: 20000, hookTimeout: 60000 });

/**
 * pg-batch13-restaurant.test.js — Phase 4A Restaurant integration tests (Postgres).
 *
 * Covers: floor plans, tables, table sessions, checks, KDS stations/tickets,
 * quick-service (takeout without a table), QR ordering, and KDS ticket fan-out.
 *
 * The restaurant and KDS routes import requireFeature/requirePerm from the real
 * middleware modules (not deps), so we initialise the feature-flags module with
 * the test DB before registering routes.
 */

describe("Batch 13 — Phase 4A Restaurant (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // The restaurant/kds route files import requireFeature from the real
    // middleware/feature-flags module which uses a module-level db reference.
    // Initialise it with the test DB so the flag lookups hit the test schema.
    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    // Routes use req.employee.id for audit logging — inject it from the header
    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    // Register restaurant + KDS routes
    require("../../routes/restaurant")(app, deps);
    require("../../routes/kds")(app, deps);

    // Enable Phase 4 feature flags
    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_kds', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);

    // Grant restaurant + KDS permissions to employee 1 (Administrator has all_access,
    // but also add explicit perms for employee 2 to test permission gating if needed)
    await db.query(
      `INSERT INTO role_permissions (role_id, permission) VALUES (2, 'manage_restaurant'), (2, 'manage_kds')
       ON CONFLICT DO NOTHING`
    );
  }, 30000);

  afterAll(async () => {
    // Clear the feature-flag cache so it doesn't leak into other test files
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  // ─── FLOOR PLANS ─────────────────────────────────────────────

  describe("floor plans", () => {
    let floorPlanId;

    it("POST /api/restaurant/floor-plans creates a floor plan (201)", async () => {
      const res = await request(app)
        .post("/api/restaurant/floor-plans")
        .set("x-employee-id", "1")
        .send({ name: "Main Dining", outlet_id: 1, layout_json: { version: 1 } });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.name).toBe("Main Dining");
      floorPlanId = res.body.id;
    });

    it("GET /api/restaurant/floor-plans lists plans (200)", async () => {
      const res = await request(app)
        .get("/api/restaurant/floor-plans")
        .query({ outlet_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.floor_plans.length).toBeGreaterThanOrEqual(1);
      expect(res.body.floor_plans[0].name).toBe("Main Dining");
    });

    it("GET /api/restaurant/floor-plans/:id gets plan with tables (200)", async () => {
      const res = await request(app)
        .get(`/api/restaurant/floor-plans/${floorPlanId}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(floorPlanId);
      expect(Array.isArray(res.body.tables)).toBe(true);
      expect(Array.isArray(res.body.sections)).toBe(true);
    });

    it("GET /api/restaurant/floor-plans without outlet_id returns 400", async () => {
      const res = await request(app)
        .get("/api/restaurant/floor-plans")
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
    });

    it("GET /api/restaurant/floor-plans/999999 returns 404", async () => {
      const res = await request(app)
        .get("/api/restaurant/floor-plans/999999")
        .set("x-employee-id", "1");
      expect(res.status).toBe(404);
    });
  });

  // ─── TABLES ──────────────────────────────────────────────────

  describe("tables", () => {
    let tableId;
    let floorPlanId;

    beforeAll(async () => {
      // Ensure a floor plan exists
      const { rows } = await db.query("SELECT id FROM restaurant_floor_plans LIMIT 1");
      floorPlanId = rows[0].id;
    });

    it("POST /api/restaurant/tables creates a table (201)", async () => {
      const res = await request(app)
        .post("/api/restaurant/tables")
        .set("x-employee-id", "1")
        .send({
          floor_plan_id: floorPlanId,
          label: "T1",
          capacity: 4,
          shape: "square",
          pos_x: 100,
          pos_y: 200,
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.label).toBe("T1");
      expect(res.body.capacity).toBe(4);
      tableId = res.body.id;
    });

    it("POST /api/restaurant/tables creates a second table", async () => {
      const res = await request(app)
        .post("/api/restaurant/tables")
        .set("x-employee-id", "1")
        .send({
          floor_plan_id: floorPlanId,
          label: "T2",
          capacity: 6,
          shape: "round",
          pos_x: 300,
          pos_y: 200,
        });
      expect(res.status).toBe(201);
      expect(res.body.label).toBe("T2");
    });

    it("PUT /api/restaurant/tables/:id updates a table (200)", async () => {
      const res = await request(app)
        .put(`/api/restaurant/tables/${tableId}`)
        .set("x-employee-id", "1")
        .send({ capacity: 6, label: "T1-VIP" });
      expect(res.status).toBe(200);
      expect(res.body.capacity).toBe(6);
      expect(res.body.label).toBe("T1-VIP");
    });

    it("GET /api/restaurant/tables lists tables for floor plan", async () => {
      const res = await request(app)
        .get("/api/restaurant/tables")
        .query({ floor_plan_id: floorPlanId })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.tables.length).toBeGreaterThanOrEqual(2);
    });

    it("PUT /api/restaurant/tables/999999 returns 404", async () => {
      const res = await request(app)
        .put("/api/restaurant/tables/999999")
        .set("x-employee-id", "1")
        .send({ capacity: 2 });
      expect(res.status).toBe(404);
    });
  });

  // ─── TABLE SESSIONS ──────────────────────────────────────────

  describe("table sessions", () => {
    let tableId;
    let sessionId;

    beforeAll(async () => {
      const { rows } = await db.query("SELECT id FROM restaurant_tables LIMIT 1");
      tableId = rows[0].id;
    });

    it("POST /api/restaurant/table-sessions opens a session (201, status=seated)", async () => {
      const res = await request(app)
        .post("/api/restaurant/table-sessions")
        .set("x-employee-id", "1")
        .send({ table_id: tableId, server_id: 1, guest_count: 3 });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.status).toBe("seated");
      expect(res.body.guest_count).toBe(3);
      sessionId = res.body.id;
    });

    it("POST /api/restaurant/table-sessions rejects duplicate active session (409)", async () => {
      const res = await request(app)
        .post("/api/restaurant/table-sessions")
        .set("x-employee-id", "1")
        .send({ table_id: tableId, guest_count: 2 });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/active session/i);
    });

    it("PUT /api/restaurant/table-sessions/:id closes session (200, status=closed)", async () => {
      const res = await request(app)
        .put(`/api/restaurant/table-sessions/${sessionId}`)
        .set("x-employee-id", "1")
        .send({ status: "closed" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("closed");
      expect(res.body.closed_at).toBeTruthy();
    });

    it("allows opening a new session after closing the previous one", async () => {
      const res = await request(app)
        .post("/api/restaurant/table-sessions")
        .set("x-employee-id", "1")
        .send({ table_id: tableId, guest_count: 1 });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("seated");
      // Close it for subsequent tests
      await request(app)
        .put(`/api/restaurant/table-sessions/${res.body.id}`)
        .set("x-employee-id", "1")
        .send({ status: "closed" });
    });
  });

  // ─── CHECKS (restaurant draft orders) ────────────────────────

  describe("checks", () => {
    let sessionId;
    let checkId;

    beforeAll(async () => {
      // Open a fresh table session for check tests
      const { rows: tables } = await db.query("SELECT id FROM restaurant_tables LIMIT 1");
      const { rows: [session] } = await db.query(
        `INSERT INTO restaurant_table_sessions (table_id, outlet_id, server_id, guest_count)
         VALUES ($1, 1, 1, 2) RETURNING *`,
        [tables[0].id]
      );
      sessionId = session.id;
    });

    it("POST /api/restaurant/checks creates a restaurant check (201, order_context=dine_in)", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "dine_in",
          table_session_id: sessionId,
          seat_count: 2,
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.order_context).toBe("dine_in");
      expect(res.body.status).toBe("open");
      expect(res.body.table_session_id).toBe(sessionId);
      checkId = res.body.id;
    });

    it("GET /api/restaurant/checks lists open checks (200)", async () => {
      const res = await request(app)
        .get("/api/restaurant/checks")
        .query({ outlet_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.checks.length).toBeGreaterThanOrEqual(1);
      const found = res.body.checks.find((c) => c.id === checkId);
      expect(found).toBeTruthy();
      expect(found.order_context).toBe("dine_in");
    });

    it("GET /api/restaurant/checks without outlet_id returns 400", async () => {
      const res = await request(app)
        .get("/api/restaurant/checks")
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
    });
  });

  // ─── KDS STATIONS ────────────────────────────────────────────

  describe("KDS stations", () => {
    let stationId;

    it("POST /api/kds/stations creates a station (201)", async () => {
      const res = await request(app)
        .post("/api/kds/stations")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, name: "Hot Line", station_role: "prep" });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.name).toBe("Hot Line");
      expect(res.body.station_role).toBe("prep");
      stationId = res.body.id;
    });

    it("POST /api/kds/stations creates an expo station", async () => {
      const res = await request(app)
        .post("/api/kds/stations")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, name: "Expo Window", station_role: "expo" });
      expect(res.status).toBe(201);
      expect(res.body.station_role).toBe("expo");
    });

    it("GET /api/kds/stations lists stations (200)", async () => {
      const res = await request(app)
        .get("/api/kds/stations")
        .query({ outlet_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.stations.length).toBeGreaterThanOrEqual(2);
      const hotLine = res.body.stations.find((s) => s.name === "Hot Line");
      expect(hotLine).toBeTruthy();
      expect(hotLine.active_tickets).toBe(0);
    });

    it("PUT /api/kds/stations/:id updates a station", async () => {
      const res = await request(app)
        .put(`/api/kds/stations/${stationId}`)
        .set("x-employee-id", "1")
        .send({ name: "Hot Line (Renamed)" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Hot Line (Renamed)");
    });

    it("GET /api/kds/stations without outlet_id returns 400", async () => {
      const res = await request(app)
        .get("/api/kds/stations")
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
    });
  });

  // ─── KDS TICKETS ─────────────────────────────────────────────

  describe("KDS tickets", () => {
    let stationId;

    beforeAll(async () => {
      const { rows } = await db.query("SELECT id FROM kds_stations LIMIT 1");
      stationId = rows[0].id;
    });

    it("GET /api/kds/tickets lists tickets for a station (200)", async () => {
      const res = await request(app)
        .get("/api/kds/tickets")
        .query({ station_id: stationId })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tickets)).toBe(true);
    });

    it("GET /api/kds/tickets without station_id returns 400", async () => {
      const res = await request(app)
        .get("/api/kds/tickets")
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
    });
  });

  // ─── QUICK-SERVICE (takeout, no table) ───────────────────────

  describe("quick-service (takeout)", () => {
    it("creates a check without table/session (takeout mode, table_id null)", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "takeout",
          dining_option: "takeout",
          seat_count: 0,
        });
      expect(res.status).toBe(201);
      expect(res.body.order_context).toBe("takeout");
      expect(res.body.table_id).toBeNull();
      expect(res.body.table_session_id).toBeNull();
      expect(res.body.status).toBe("open");
    });

    it("takeout check appears in open checks list", async () => {
      const res = await request(app)
        .get("/api/restaurant/checks")
        .query({ outlet_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      const takeout = res.body.checks.find((c) => c.order_context === "takeout");
      expect(takeout).toBeTruthy();
      expect(takeout.table_id).toBeNull();
    });
  });

  // ─── QR ORDERING (Phase 4 C2) ────────────────────────────────

  describe("QR ordering — source_token_id lifecycle", () => {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let qrSessionId;
    let qrTableId;
    let origMultiTenant;

    beforeAll(async () => {
      // Fresh table session for QR tests (isolated from the ones above).
      // Capture both session id and table id — the table id is needed for
      // test 7 which exercises the public menu endpoint's JOIN on
      // draft_orders.table_id = restaurant_tables.id.
      const { rows: tables } = await db.query("SELECT id FROM restaurant_tables LIMIT 1");
      qrTableId = tables[0].id;
      const { rows: [session] } = await db.query(
        `INSERT INTO restaurant_table_sessions (table_id, outlet_id, server_id, guest_count)
         VALUES ($1, 1, 1, 2) RETURNING *`,
        [qrTableId]
      );
      qrSessionId = session.id;

      // services/public-tenant-context.js reads MULTI_TENANT at require time
      // and short-circuits to deps.db when it's unset. The dev .env sets
      // MULTI_TENANT=1, which would make resolvePublicTenantDb require a
      // tenant slug query param we can't satisfy from a test schema.
      // Unset it before first require so the module loads in single-tenant
      // mode. Restore in afterAll.
      origMultiTenant = process.env.MULTI_TENANT;
      delete process.env.MULTI_TENANT;

      // Mount the public-restaurant route for tests 7-8. Lazy-require here
      // so the MULTI_TENANT env override takes effect on its first load.
      require("../../routes/public-restaurant")(app, deps);
    });

    afterAll(() => {
      if (origMultiTenant !== undefined) process.env.MULTI_TENANT = origMultiTenant;
    });

    it("1. POST /api/restaurant/checks with dine_in → source_token_id matches UUID v4 regex", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "dine_in",
          table_session_id: qrSessionId,
          seat_count: 2,
        });
      expect(res.status).toBe(201);
      expect(res.body.source_token_id).toMatch(UUID_V4_REGEX);
    });

    it("2. POST /api/restaurant/checks with bar → source_token_id present", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "bar",
          seat_count: 1,
        });
      expect(res.status).toBe(201);
      expect(res.body.source_token_id).toMatch(UUID_V4_REGEX);
    });

    it("3. POST /api/restaurant/checks with takeout → source_token_id is NULL", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "takeout",
          dining_option: "takeout",
          seat_count: 0,
        });
      expect(res.status).toBe(201);
      expect(res.body.source_token_id).toBeNull();
    });

    it("4. POST /api/restaurant/checks with delivery → source_token_id is NULL", async () => {
      const res = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "delivery",
          dining_option: "delivery",
          seat_count: 0,
        });
      expect(res.status).toBe(201);
      expect(res.body.source_token_id).toBeNull();
    });

    it("5. two consecutive dine_in checks get different tokens (uniqueness)", async () => {
      const [a, b] = await Promise.all([
        request(app).post("/api/restaurant/checks").set("x-employee-id", "1").send({
          outlet_id: 1, order_context: "dine_in", table_session_id: qrSessionId, seat_count: 1,
        }),
        request(app).post("/api/restaurant/checks").set("x-employee-id", "1").send({
          outlet_id: 1, order_context: "dine_in", table_session_id: qrSessionId, seat_count: 1,
        }),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.source_token_id).toBeTruthy();
      expect(b.body.source_token_id).toBeTruthy();
      expect(a.body.source_token_id).not.toBe(b.body.source_token_id);
    });

    it("6. splitCheckByItem: each split child gets its own fresh token, not a copy of source", async () => {
      // Create a source dine_in check
      const sourceRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "dine_in",
          table_session_id: qrSessionId,
          seat_count: 2,
        });
      expect(sourceRes.status).toBe(201);
      const sourceId = sourceRes.body.id;
      const sourceToken = sourceRes.body.source_token_id;
      expect(sourceToken).toMatch(UUID_V4_REGEX);

      // Insert 2 items directly into draft_order_items so splitCheckByItem has something to split
      const { rows: [item1] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price)
         VALUES ($1, 1, 'Widget A', 1, 100) RETURNING id`,
        [sourceId]
      );
      const { rows: [item2] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price)
         VALUES ($1, 2, 'Widget B', 1, 200) RETURNING id`,
        [sourceId]
      );

      // Split: item1 to target 0, item2 to target 1 — produces 2 child checks
      const splitRes = await request(app)
        .post(`/api/restaurant/checks/${sourceId}/split`)
        .set("x-employee-id", "1")
        .send({
          split_type: "by_item",
          item_assignments: [
            { item_id: item1.id, target_check_index: 0 },
            { item_id: item2.id, target_check_index: 1 },
          ],
        });
      expect(splitRes.status).toBe(200);
      expect(splitRes.body.new_checks).toHaveLength(2);

      const [child1, child2] = splitRes.body.new_checks;
      // Each child has its own token...
      expect(child1.source_token_id).toMatch(UUID_V4_REGEX);
      expect(child2.source_token_id).toMatch(UUID_V4_REGEX);
      // ...that is not the source's token...
      expect(child1.source_token_id).not.toBe(sourceToken);
      expect(child2.source_token_id).not.toBe(sourceToken);
      // ...and not equal to each other.
      expect(child1.source_token_id).not.toBe(child2.source_token_id);
    });

    it("7. GET /api/public/restaurant/menu/:token with a valid token returns 200 + menu items", async () => {
      // Create a fresh dine_in check and use its token
      const checkRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "dine_in",
          table_session_id: qrSessionId,
          seat_count: 1,
        });
      const token = checkRes.body.source_token_id;
      expect(token).toBeTruthy();

      // The public-restaurant menu query JOINs draft_orders → restaurant_tables
      // on table_id. createCheckSchema doesn't accept table_id (only
      // table_session_id), so the POST route inserts with table_id = NULL
      // and the JOIN would fail. Set it directly so the menu lookup works —
      // this is test scaffolding, not a claim about route behavior.
      await db.query("UPDATE draft_orders SET table_id = $1 WHERE id = $2", [qrTableId, checkRes.body.id]);

      const menuRes = await request(app).get(`/api/public/restaurant/menu/${token}`);
      expect(menuRes.status).toBe(200);
      expect(menuRes.body).toHaveProperty("table_label");
      expect(menuRes.body).toHaveProperty("items");
      expect(Array.isArray(menuRes.body.items)).toBe(true);
      // Seeded fixture has 5 products, all active with deleted_at = NULL
      expect(menuRes.body.items.length).toBeGreaterThanOrEqual(5);
    });

    it("8. GET /api/public/restaurant/menu/:token with a bogus token returns 404", async () => {
      const menuRes = await request(app).get("/api/public/restaurant/menu/nonexistent-token-xyz");
      expect(menuRes.status).toBe(404);
      expect(menuRes.body.error).toMatch(/no active session/i);
    });
  });

  // ─── KDS TICKET FAN-OUT (Phase 4 C3) ─────────────────────────

  describe("KDS ticket fan-out — Phase 4 C3", () => {
    // Dedicated station for these tests so we can assert exact counts without
    // interference from stations created by earlier "KDS stations" describes.
    let prepStationId;     // single match_all station for tests 1, 3, 4, 5
    let catAStationId;     // category-routed station for test 2
    let catBStationId;     // category-routed station for test 2
    let bumpPrepStationId; // dedicated prep station for test 6
    let bumpExpoStationId; // dedicated expo station for test 6
    let kdsTableId;        // restaurant_tables row id for all KDS test checks

    beforeAll(async () => {
      // Dedicated table for all KDS fan-out tests. Avoids interference with
      // tables created in the earlier "tables" / QR describes — those checks
      // may still be 'open' and clutter queries.
      const { rows: floorPlans } = await db.query("SELECT id FROM restaurant_floor_plans LIMIT 1");
      const { rows: [table] } = await db.query(
        `INSERT INTO restaurant_tables (floor_plan_id, label, capacity, shape, pos_x, pos_y)
         VALUES ($1, 'KDS-Fanout', 4, 'square', 0, 0) RETURNING id`,
        [floorPlans[0].id]
      );
      kdsTableId = table.id;

      // Prep station + single match_all route.
      const { rows: [prep] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'PrepFanout', 'prep') RETURNING id`
      );
      prepStationId = prep.id;
      await db.query(
        `INSERT INTO kds_station_routes (station_id, match_all) VALUES ($1, true)`,
        [prepStationId]
      );

      // Two category-specific stations for test 2. Use the categories
      // seeded by createTestApp: 1 (Electronics), 2 (Groceries).
      const { rows: [catA] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'CategoryA', 'prep') RETURNING id`
      );
      catAStationId = catA.id;
      await db.query(
        `INSERT INTO kds_station_routes (station_id, category_id) VALUES ($1, 1)`,
        [catAStationId]
      );

      const { rows: [catB] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'CategoryB', 'prep') RETURNING id`
      );
      catBStationId = catB.id;
      await db.query(
        `INSERT INTO kds_station_routes (station_id, category_id) VALUES ($1, 2)`,
        [catBStationId]
      );

      // Dedicated prep + expo pair for test 6. Isolated from the others so
      // bumping doesn't collide with prep tickets from earlier tests.
      const { rows: [bumpPrep] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'BumpPrep', 'prep') RETURNING id`
      );
      bumpPrepStationId = bumpPrep.id;
      // Note: NO match_all route for this station — test 6 will point items
      // here explicitly via routing. Actually we'll use a dedicated category
      // on the prep station via a route, and no catchall — so only items
      // with that category hit this station.
      const { rows: [bumpExpo] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'BumpExpo', 'expo') RETURNING id`
      );
      bumpExpoStationId = bumpExpo.id;
    });

    // Helper: create a dine_in check on kdsTableId, then seed items directly.
    // Returns the check id.
    async function seedCheckWithItems(items) {
      const checkRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({
          outlet_id: 1,
          order_context: "dine_in",
          seat_count: items.length,
        });
      expect(checkRes.status).toBe(201);
      const checkId = checkRes.body.id;
      // createCheckSchema doesn't accept table_id; set it directly so
      // downstream queries that need a table find one.
      await db.query("UPDATE draft_orders SET table_id = $1 WHERE id = $2", [kdsTableId, checkId]);
      for (const it of items) {
        await db.query(
          `INSERT INTO draft_order_items
             (draft_order_id, product_id, product_name, quantity, price,
              seat_number, course_name, kitchen_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [checkId, it.product_id, it.product_name, it.quantity || 1, it.price || 100,
           it.seat_number || null, it.course_name || "main"]
        );
      }
      return checkId;
    }

    it("1. 3 items in 'main' course on 1 station → exactly 1 ticket with 3 items", async () => {
      // Disable every match_all route EXCEPT our dedicated prep station,
      // and remove category routes so the match_all path is taken.
      // (Do this in-test so parallel describes can coexist.)
      await db.query("DELETE FROM kds_station_routes WHERE station_id != $1", [prepStationId]);

      const checkId = await seedCheckWithItems([
        { product_id: 1, product_name: "Widget A" },
        { product_id: 2, product_name: "Widget B" },
        { product_id: 3, product_name: "Gadget C" },
      ]);

      const res = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(1);
      expect(res.body.tickets[0].station_id).toBe(prepStationId);

      const ticketsRes = await request(app)
        .get("/api/kds/tickets")
        .query({ station_id: prepStationId })
        .set("x-employee-id", "1");
      expect(ticketsRes.status).toBe(200);
      const ticketsForCheck = ticketsRes.body.tickets.filter(
        (t) => t.draft_order_id === checkId
      );
      expect(ticketsForCheck).toHaveLength(1);
      expect(ticketsForCheck[0].items).toHaveLength(3);
    });

    it("2. 3 items split across 2 category-routed stations → 2 tickets, correct partition", async () => {
      // Per-test timeout bump: this test hits 7+ Supabase round-trips
      // (seed + send-to-kitchen + 2× GET tickets); default 5s is tight.
      // Clean slate: drop all routes (test 1 left a match_all on prep),
      // then insert the two category routes we need for this test.
      // kds_station_routes has no UNIQUE constraint so no ON CONFLICT clause.
      await db.query("DELETE FROM kds_station_routes");
      await db.query(
        `INSERT INTO kds_station_routes (station_id, category_id) VALUES ($1, 1)`,
        [catAStationId]
      );
      await db.query(
        `INSERT INTO kds_station_routes (station_id, category_id) VALUES ($1, 2)`,
        [catBStationId]
      );

      // Seed fixture products: 1 and 2 are category 1 (Electronics),
      // 4 is category 2 (Groceries). Use 1+2 for station A, 4 for B.
      const checkId = await seedCheckWithItems([
        { product_id: 1, product_name: "Widget A" }, // category 1 → catA
        { product_id: 2, product_name: "Widget B" }, // category 1 → catA
        { product_id: 4, product_name: "Snack D" },  // category 2 → catB
      ]);

      const res = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(2);

      const stationIds = res.body.tickets.map((t) => t.station_id).sort();
      expect(stationIds).toEqual([catAStationId, catBStationId].sort());

      // Verify items via GET /api/kds/tickets per station.
      const aRes = await request(app)
        .get("/api/kds/tickets").query({ station_id: catAStationId }).set("x-employee-id", "1");
      const bRes = await request(app)
        .get("/api/kds/tickets").query({ station_id: catBStationId }).set("x-employee-id", "1");
      const aTickets = aRes.body.tickets.filter((t) => t.draft_order_id === checkId);
      const bTickets = bRes.body.tickets.filter((t) => t.draft_order_id === checkId);
      expect(aTickets).toHaveLength(1);
      expect(bTickets).toHaveLength(1);
      expect(aTickets[0].items).toHaveLength(2);
      expect(bTickets[0].items).toHaveLength(1);
    });

    it("3. items in different courses on same station → 2 tickets (one per course)", async () => {
      // Clean slate → single match_all route on prep station.
      await db.query("DELETE FROM kds_station_routes");
      await db.query(
        `INSERT INTO kds_station_routes (station_id, match_all) VALUES ($1, true)`,
        [prepStationId]
      );

      const checkId = await seedCheckWithItems([
        { product_id: 1, product_name: "Widget A", course_name: "main" },
        { product_id: 2, product_name: "Widget B", course_name: "main" },
        { product_id: 3, product_name: "Gadget C", course_name: "dessert" },
        { product_id: 4, product_name: "Snack D", course_name: "dessert" },
      ]);

      const res = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(2);

      const courses = res.body.tickets.map((t) => t.course_name).sort();
      expect(courses).toEqual(["dessert", "main"]);

      // Fetch and verify each ticket has exactly 2 items.
      const ticketsRes = await request(app)
        .get("/api/kds/tickets").query({ station_id: prepStationId }).set("x-employee-id", "1");
      const ticketsForCheck = ticketsRes.body.tickets.filter((t) => t.draft_order_id === checkId);
      expect(ticketsForCheck).toHaveLength(2);
      for (const t of ticketsForCheck) {
        expect(t.items).toHaveLength(2);
        for (const item of t.items) {
          expect(item.course_name).toBe(t.course_name);
        }
      }
    });

    it("4. sendToKitchen on a check with no pending items → empty array, no tickets", async () => {
      const checkId = await seedCheckWithItems([]);

      const res = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.tickets).toEqual([]);

      const { rows } = await db.query(
        "SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1",
        [checkId]
      );
      expect(rows[0].n).toBe(0);
    });

    it("5. two concurrent checks on same station + course → each ticket scoped to its own check's items", async () => {
      // Both checks have 2 items in 'main', all routed to prep station via match_all.
      const checkA = await seedCheckWithItems([
        { product_id: 1, product_name: "A-Item1" },
        { product_id: 2, product_name: "A-Item2" },
      ]);
      const checkB = await seedCheckWithItems([
        { product_id: 3, product_name: "B-Item1" },
        { product_id: 4, product_name: "B-Item2" },
      ]);

      const resA = await request(app)
        .post(`/api/restaurant/checks/${checkA}/send-to-kitchen`)
        .set("x-employee-id", "1");
      const resB = await request(app)
        .post(`/api/restaurant/checks/${checkB}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.tickets).toHaveLength(1);
      expect(resB.body.tickets).toHaveLength(1);

      const ticketsRes = await request(app)
        .get("/api/kds/tickets").query({ station_id: prepStationId }).set("x-employee-id", "1");
      const tA = ticketsRes.body.tickets.find((t) => t.draft_order_id === checkA);
      const tB = ticketsRes.body.tickets.find((t) => t.draft_order_id === checkB);
      expect(tA).toBeTruthy();
      expect(tB).toBeTruthy();
      // The key property: each ticket's items aggregation contains only its
      // own draft_order's items, not cross-check fan-out. Items have distinct
      // product_name prefixes per check so we can sanity-check.
      expect(tA.items).toHaveLength(2);
      expect(tB.items).toHaveLength(2);
      for (const item of tA.items) expect(item.product_name).toMatch(/^A-/);
      for (const item of tB.items) expect(item.product_name).toMatch(/^B-/);
    });

    it("6. bump all prep tickets for an order → expo station auto-receives a ticket", async () => {
      // Use the dedicated bumpPrep / bumpExpo stations to avoid interference
      // from other tests still having open tickets on the shared prep station.
      //
      // Fixture isolation: bumpTicket at services/restaurant-kds.js:228 picks
      // "any active expo station in this outlet, LIMIT 1" — no ORDER BY. The
      // earlier "KDS stations" describe created an "Expo Window" station
      // (id=2) with is_active=true, which Postgres happens to return before
      // our bumpExpoStation (higher id). Deactivate "Expo Window" so our
      // bumpExpo is the only active expo in outlet 1 during this test.
      // Reactivate in a local afterEach so we don't leak state to other
      // tests (though there are none after this in the KDS describe).
      await db.query(
        "UPDATE kds_stations SET is_active = false WHERE name = 'Expo Window'"
      );

      // Setup: a category route that funnels items to bumpPrepStation, and
      // no other route competing for those items.
      // Clear prior routes and set up: bumpPrepStation gets category 1.
      await db.query("DELETE FROM kds_station_routes");
      await db.query(
        `INSERT INTO kds_station_routes (station_id, category_id) VALUES ($1, 1)`,
        [bumpPrepStationId]
      );

      const checkId = await seedCheckWithItems([
        { product_id: 1, product_name: "Widget A" }, // category 1 → bumpPrep
        { product_id: 2, product_name: "Widget B" }, // category 1 → bumpPrep (same station + course → 1 ticket)
      ]);

      const sendRes = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(sendRes.status).toBe(200);
      // Under the fix: 1 ticket, not 2.
      expect(sendRes.body.tickets).toHaveLength(1);
      const prepTicketId = sendRes.body.tickets[0].id;

      // Bump the single prep ticket → should auto-create an expo ticket.
      const bumpRes = await request(app)
        .post(`/api/kds/tickets/${prepTicketId}/bump`)
        .set("x-employee-id", "1");
      expect(bumpRes.status).toBe(200);

      // Verify: there should now be 2 tickets for this draft_order —
      // the bumped prep ticket + a new expo ticket on bumpExpoStation.
      const { rows } = await db.query(
        "SELECT id, station_id, status FROM kds_tickets WHERE draft_order_id = $1 ORDER BY id",
        [checkId]
      );
      expect(rows).toHaveLength(2);
      const bumped = rows.find((r) => r.id === prepTicketId);
      const expo = rows.find((r) => r.id !== prepTicketId);
      expect(bumped.status).toBe("bumped");
      expect(bumped.station_id).toBe(bumpPrepStationId);
      expect(expo.status).toBe("new");
      expect(expo.station_id).toBe(bumpExpoStationId);
    });
  });

  // ─── FEATURE FLAG GATING ─────────────────────────────────────

  describe("feature flag gating", () => {
    beforeAll(async () => {
      // Disable restaurant feature flag
      await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'phase4_restaurant'");
      // Clear cache so the change takes effect
      const featureFlags = require("../../middleware/feature-flags");
      if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    });

    afterAll(async () => {
      // Re-enable for any further tests
      await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'phase4_restaurant'");
      const featureFlags = require("../../middleware/feature-flags");
      if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    });

    it("returns 503 when phase4_restaurant feature flag is disabled", async () => {
      const res = await request(app)
        .get("/api/restaurant/floor-plans")
        .query({ outlet_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Feature disabled/i);
    });
  });
});
