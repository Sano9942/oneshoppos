const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 20000, hookTimeout: 60000 });

/**
 * pg-phase21a-courses.test.js — Phase 2.1 Batch A3 course timing controls.
 *
 * Covers the hold / expedite / release lifecycle: placing a course on hold
 * suppresses KDS tickets, releaseHeldCourses (worker-facing) transitions
 * due rows and fires them to the kitchen, and expediteCourse raises the
 * priority so expedited tickets render first.
 */

describe("Phase 2.1 A3 — Course timing controls (Postgres)", () => {
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

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_kds', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);

    // Seed a station with a match_all route so sendToKitchen has a target.
    const { rows: [station] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role)
       VALUES (1, 'PrepCourse', 'prep') RETURNING id`
    );
    await db.query(
      `INSERT INTO kds_station_routes (station_id, match_all) VALUES ($1, true)`,
      [station.id]
    );
    global.__testPrepStationId = station.id;
  }, 30000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  async function seedCheckWithItems(items) {
    const checkRes = await request(app)
      .post("/api/restaurant/checks")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, order_context: "dine_in", seat_count: 1 });
    expect(checkRes.status).toBe(201);
    const checkId = checkRes.body.id;
    for (const it of items) {
      await db.query(
        `INSERT INTO draft_order_items
           (draft_order_id, product_id, product_name, quantity, price, course_name, kitchen_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [checkId, it.product_id, it.product_name, it.quantity || 1, it.price || 100, it.course_name || "main"]
      );
    }
    return checkId;
  }

  describe("hold → release", () => {
    it("holding a course prevents sendToKitchen from creating a ticket for it", async () => {
      const checkId = await seedCheckWithItems([
        { product_id: 1, product_name: "Shrimp", course_name: "appetizer" },
        { product_id: 2, product_name: "Cake", course_name: "dessert" },
      ]);

      // Hold the dessert course until 2 hours from now
      const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const holdRes = await request(app)
        .post(`/api/restaurant/checks/${checkId}/courses/hold`)
        .set("x-employee-id", "1")
        .send({ course_name: "dessert", hold_until: future });
      expect(holdRes.status).toBe(200);
      expect(holdRes.body.status).toBe("held");

      const sendRes = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(sendRes.status).toBe(200);
      // Only the appetizer ticket should be created; dessert is held.
      expect(sendRes.body.tickets).toHaveLength(1);
      expect(sendRes.body.tickets[0].course_name).toBe("appetizer");

      // No ticket row exists for the dessert course
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets
         WHERE draft_order_id = $1 AND course_name = 'dessert'`,
        [checkId]
      );
      expect(rows[0].n).toBe(0);
    });

    it("releaseHeldCourses transitions due rows to 'fired' and sends tickets", async () => {
      const checkId = await seedCheckWithItems([
        { product_id: 1, product_name: "Ice cream", course_name: "dessert" },
      ]);

      // Put the dessert on hold, already in the past
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      await db.query(
        `INSERT INTO restaurant_course_fires (draft_order_id, course_name, status, hold_until)
         VALUES ($1, 'dessert', 'held', $2)`,
        [checkId, past]
      );

      // No tickets before release
      const before = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1`,
        [checkId]
      );
      expect(before.rows[0].n).toBe(0);

      // Run the worker-facing sweep
      const checksSvc = require("../../services/restaurant-checks");
      const released = await checksSvc.releaseHeldCourses(db, null);
      expect(released).toBeGreaterThanOrEqual(1);

      // After release: the course row is fired and a ticket exists
      const { rows: fire } = await db.query(
        `SELECT status, fired_at FROM restaurant_course_fires
         WHERE draft_order_id = $1 AND course_name = 'dessert'`,
        [checkId]
      );
      expect(fire[0].status).toBe("fired");
      expect(fire[0].fired_at).toBeTruthy();

      const { rows: tick } = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1`,
        [checkId]
      );
      expect(tick[0].n).toBeGreaterThanOrEqual(1);
    });
  });

  describe("expedite", () => {
    it("expediteCourse flips expedite=true and raises priority on open tickets", async () => {
      const checkId = await seedCheckWithItems([
        { product_id: 1, product_name: "Salad", course_name: "appetizer" },
      ]);

      // Fire the appetizer course (creates a ticket)
      const sendRes = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(sendRes.status).toBe(200);
      expect(sendRes.body.tickets).toHaveLength(1);

      // Baseline priority (default = 0)
      const before = await db.query(
        `SELECT priority FROM kds_tickets WHERE draft_order_id = $1`,
        [checkId]
      );
      expect(Number(before.rows[0].priority)).toBe(0);

      // Expedite
      const expRes = await request(app)
        .post(`/api/restaurant/checks/${checkId}/courses/expedite`)
        .set("x-employee-id", "1")
        .send({ course_name: "appetizer" });
      expect(expRes.status).toBe(200);
      expect(expRes.body.expedite).toBe(true);

      const after = await db.query(
        `SELECT priority FROM kds_tickets WHERE draft_order_id = $1`,
        [checkId]
      );
      expect(Number(after.rows[0].priority)).toBe(100);
    });

    it("getTickets returns expedited tickets first (priority DESC)", async () => {
      // Seed two checks on the same station: one normal, one expedited.
      // The station is the one we set up in beforeAll.
      const stationId = global.__testPrepStationId;

      const normalCheck = await seedCheckWithItems([
        { product_id: 3, product_name: "Normal dish", course_name: "main" },
      ]);
      await request(app)
        .post(`/api/restaurant/checks/${normalCheck}/send-to-kitchen`)
        .set("x-employee-id", "1");

      const expedCheck = await seedCheckWithItems([
        { product_id: 4, product_name: "Rush dish", course_name: "main" },
      ]);
      await request(app)
        .post(`/api/restaurant/checks/${expedCheck}/send-to-kitchen`)
        .set("x-employee-id", "1");
      await request(app)
        .post(`/api/restaurant/checks/${expedCheck}/courses/expedite`)
        .set("x-employee-id", "1")
        .send({ course_name: "main" });

      const ticketsRes = await request(app)
        .get("/api/kds/tickets")
        .query({ station_id: stationId })
        .set("x-employee-id", "1");
      expect(ticketsRes.status).toBe(200);

      const normal = ticketsRes.body.tickets.find((t) => t.draft_order_id === normalCheck);
      const exped = ticketsRes.body.tickets.find((t) => t.draft_order_id === expedCheck);
      expect(normal).toBeTruthy();
      expect(exped).toBeTruthy();

      // Expedited ticket must appear before the normal one in the array
      const expedIdx = ticketsRes.body.tickets.indexOf(exped);
      const normalIdx = ticketsRes.body.tickets.indexOf(normal);
      expect(expedIdx).toBeLessThan(normalIdx);
    });
  });
});
