const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

/**
 * pg-batch13-restaurant.test.js — Phase 4A Restaurant integration tests (Postgres).
 *
 * Covers: floor plans, tables, table sessions, checks, KDS stations/tickets,
 * and quick-service (takeout without a table).
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
