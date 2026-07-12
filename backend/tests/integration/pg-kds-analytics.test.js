/**
 * pg-kds-analytics.test.js — Phase 2-R Wave C / 2-R.5
 *
 * Covers:
 *   1. `balance_strategy='priority'` keeps legacy "first candidate wins" behavior
 *   2. `balance_strategy='least_loaded'` picks the station with fewest open tickets
 *   3. Least-loaded 30s cooldown: a just-assigned station gets skipped
 *   4. `balance_strategy='round_robin'` alternates across equal-priority peers
 *   5. Timing: fire → bump writes bumped_at + prep_seconds; recall sets
 *      recalled_at without erasing bumped_at/prep_seconds
 *   6. `/api/reports/kds/prep-times` returns p50/p95/mean per station
 *   7. Endpoint includes recent load snapshots
 *   8. Tickets outside the date range are excluded
 *   9. Worker snapshotForTenant inserts one row per active station
 */

// Force single-tenant mode BEFORE requires so public-tenant-context
// skips master-db lookup.
delete process.env.MULTI_TENANT;

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { MIGRATIONS } = require("../../migrate-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 300000 });

describe("Phase 2-R.5 — KDS analytics + balance strategies", () => {
  let app, db, deps, cleanup, schemaName;
  const kds = require("../../services/restaurant-kds");

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    // v59 adds printer_config.purpose + kds_stations.balance_strategy/last_assigned_at.
    // v60 adds kds_tickets.fired_at/bumped_at/recalled_at/prep_seconds +
    // kds_station_load_snapshots.
    const v59 = MIGRATIONS.find((m) => m.version === 59);
    await v59.up(await db.getClient());
    const v60 = MIGRATIONS.find((m) => m.version === 60);
    await v60.up(await db.getClient());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      // Analytics endpoint requires view_sales_reports perm — grant all_access in tests.
      req.employeePerms = ["all_access"];
      next();
    });

    require("../../routes/reports/kds-analytics")(app, deps);

    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = true`
    );
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES
         ('phase4_restaurant', true),
         ('phase4_restaurant_kds', true),
         ('phase4_restaurant_kds_analytics', true)
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

  async function wipeKds() {
    await db.query("DELETE FROM kds_station_load_snapshots");
    await db.query("DELETE FROM kds_ticket_items");
    await db.query("DELETE FROM kds_ticket_events");
    await db.query("DELETE FROM kds_tickets");
    await db.query("DELETE FROM kds_station_routes");
    await db.query("DELETE FROM kds_stations");
    await db.query("DELETE FROM draft_order_items WHERE draft_order_id IN (SELECT id FROM draft_orders)");
    await db.query("DELETE FROM draft_orders");
  }

  async function seedDraftOrderWithItem(productId = 1) {
    const { rows: [plan] } = await db.query(
      `INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'P') RETURNING id`
    );
    const { rows: [table] } = await db.query(
      `INSERT INTO restaurant_tables (floor_plan_id, label, capacity) VALUES ($1, 'T', 4) RETURNING id`,
      [plan.id]
    );
    const { rows: [order] } = await db.query(
      `INSERT INTO draft_orders (outlet_id, created_by, table_id, order_context, status)
       VALUES (1, 1, $1, 'dine_in', 'open') RETURNING id`,
      [table.id]
    );
    await db.query(
      `INSERT INTO draft_order_items
         (draft_order_id, product_id, product_name, quantity, price, course_name, kitchen_status)
       VALUES ($1, $2, 'Test Item', 1, 100, 'main', 'pending')`,
      [order.id, productId]
    );
    return order.id;
  }

  it("priority strategy — single candidate returns unchanged", async () => {
    await wipeKds();
    const { rows: [station] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role, balance_strategy)
       VALUES (1, 'Grill', 'prep', 'priority') RETURNING id`
    );
    const orderId = await seedDraftOrderWithItem();
    await db.query(
      `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
       VALUES ($1, 1, true, 10)`,
      [station.id]
    );

    const tickets = await kds.sendToKitchen(deps.db, orderId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].station_id).toBe(station.id);
    expect(tickets[0].fired_at).toBeTruthy();
  });

  it("least_loaded — picks station with fewest open tickets", async () => {
    await wipeKds();
    // Three stations, all match_all @ priority 10 with least_loaded strategy.
    const stations = [];
    for (const name of ["A", "B", "C"]) {
      const { rows: [s] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role, balance_strategy)
         VALUES (1, $1, 'prep', 'least_loaded') RETURNING *`,
        [name]
      );
      stations.push(s);
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
         VALUES ($1, 1, true, 10)`,
        [s.id]
      );
    }
    // Seed existing open tickets: A has 5, B has 2, C has 0.
    // Use raw INSERTs with a fake draft_order_id for load seeding; the target
    // station open-count query just groups by station_id.
    const seedOrder = await seedDraftOrderWithItem();
    for (let i = 0; i < 5; i++) {
      await db.query(
        `INSERT INTO kds_tickets (station_id, draft_order_id, status, fired_at)
         VALUES ($1, $2, 'new', NOW())`,
        [stations[0].id, seedOrder]
      );
    }
    for (let i = 0; i < 2; i++) {
      await db.query(
        `INSERT INTO kds_tickets (station_id, draft_order_id, status, fired_at)
         VALUES ($1, $2, 'new', NOW())`,
        [stations[1].id, seedOrder]
      );
    }

    // Fire a fresh order — should route to station C (0 open).
    const orderId = await seedDraftOrderWithItem();
    const tickets = await kds.sendToKitchen(deps.db, orderId);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].station_id).toBe(stations[2].id);
  });

  it("least_loaded — 30s cooldown skips a just-assigned station", async () => {
    await wipeKds();
    const stations = [];
    for (const name of ["X", "Y"]) {
      const { rows: [s] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role, balance_strategy, last_assigned_at)
         VALUES (1, $1, 'prep', 'least_loaded', NULL) RETURNING *`,
        [name]
      );
      stations.push(s);
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
         VALUES ($1, 1, true, 10)`,
        [s.id]
      );
    }
    // X was just assigned (inside cooldown) — Y should win even though X
    // would otherwise tie on open count.
    await db.query(
      `UPDATE kds_stations SET last_assigned_at = NOW() WHERE id = $1`,
      [stations[0].id]
    );

    const orderId = await seedDraftOrderWithItem();
    const tickets = await kds.sendToKitchen(deps.db, orderId);
    expect(tickets[0].station_id).toBe(stations[1].id);
  });

  it("round_robin — alternates across equal-priority peers", async () => {
    await wipeKds();
    const stations = [];
    for (const name of ["R1", "R2"]) {
      const { rows: [s] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role, balance_strategy)
         VALUES (1, $1, 'prep', 'round_robin') RETURNING *`,
        [name]
      );
      stations.push(s);
      await db.query(
        `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
         VALUES ($1, 1, true, 10)`,
        [s.id]
      );
    }

    // Four sequential fires should hit R1, R2, R1, R2 — last_assigned_at
    // rotates on each fire.
    const hits = [];
    for (let i = 0; i < 4; i++) {
      const orderId = await seedDraftOrderWithItem();
      const tickets = await kds.sendToKitchen(deps.db, orderId);
      hits.push(tickets[0].station_id);
      // Nudge last_assigned_at so the timestamps are distinguishable even
      // inside a single second.
      await new Promise((r) => setTimeout(r, 10));
    }
    const unique = new Set(hits);
    expect(unique.size).toBe(2);
    // First two fires must hit different stations (no last_assigned_at → NULLS FIRST).
    expect(hits[0]).not.toBe(hits[1]);
    // Third fire — R1 is now "older" than R2 (R2 went most recently).
    expect(hits[2]).toBe(hits[0]);
    expect(hits[3]).toBe(hits[1]);
  });

  it("bump sets bumped_at + prep_seconds; recall preserves them and sets recalled_at", async () => {
    await wipeKds();
    const { rows: [s] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role)
       VALUES (1, 'Solo', 'prep') RETURNING *`
    );
    await db.query(
      `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
       VALUES ($1, 1, true, 10)`,
      [s.id]
    );
    const orderId = await seedDraftOrderWithItem();
    const [ticket] = await kds.sendToKitchen(deps.db, orderId);
    expect(ticket.fired_at).toBeTruthy();

    // Back-date fired_at to simulate 2-min prep time.
    await db.query(
      `UPDATE kds_tickets SET fired_at = NOW() - INTERVAL '120 seconds' WHERE id = $1`,
      [ticket.id]
    );

    const bumped = await kds.bumpTicket(deps.db, ticket.id, 1);
    expect(bumped.bumped_at).toBeTruthy();
    expect(bumped.prep_seconds).toBeGreaterThanOrEqual(119);
    expect(bumped.prep_seconds).toBeLessThanOrEqual(125);

    const recalled = await kds.recallTicket(deps.db, ticket.id, 1);
    expect(recalled.recalled_at).toBeTruthy();
    expect(recalled.bumped_at).toBeTruthy(); // preserved
    expect(recalled.prep_seconds).toBeGreaterThanOrEqual(119); // preserved
    expect(recalled.status).toBe("new");
  });

  it("GET /api/reports/kds/prep-times — returns p50/p95/mean per station", async () => {
    await wipeKds();
    const { rows: [grill] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role, target_prep_seconds)
       VALUES (1, 'Grill', 'prep', 300) RETURNING *`
    );
    // Seed 5 bumped tickets with known prep_seconds: 60, 120, 180, 240, 480.
    // Expected: mean = 216, p50 = 180.
    const orderId = await seedDraftOrderWithItem();
    const seconds = [60, 120, 180, 240, 480];
    for (const sec of seconds) {
      await db.query(
        `INSERT INTO kds_tickets (station_id, draft_order_id, status, fired_at, bumped_at, prep_seconds)
         VALUES ($1, $2, 'bumped', NOW() - INTERVAL '1 hour', NOW(), $3)`,
        [grill.id, orderId, sec]
      );
    }

    const res = await request(app)
      .get("/api/reports/kds/prep-times")
      .set("x-employee-id", "1")
      .query({ from: "2020-01-01", to: "2099-01-01" });

    expect(res.status).toBe(200);
    expect(res.body.stations).toBeTruthy();
    const row = res.body.stations.find((r) => r.station_id === grill.id);
    expect(row).toBeTruthy();
    expect(row.count).toBe(5);
    expect(row.p50).toBe(180);
    expect(row.target_prep_seconds).toBe(300);
    expect(Math.round(row.mean)).toBe(216);
  });

  it("GET /api/reports/kds/prep-times — includes snapshots", async () => {
    await wipeKds();
    const { rows: [s] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role)
       VALUES (1, 'S', 'prep') RETURNING *`
    );
    await db.query(
      `INSERT INTO kds_station_load_snapshots (station_id, recorded_at, open_tickets, avg_prep_seconds)
       VALUES
         ($1, NOW() - INTERVAL '30 min', 3, 200),
         ($1, NOW() - INTERVAL '15 min', 5, 220),
         ($1, NOW(), 2, 180)`,
      [s.id]
    );

    const res = await request(app)
      .get("/api/reports/kds/prep-times")
      .set("x-employee-id", "1")
      .query({ from: "2020-01-01", to: "2099-01-01" });

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toBeTruthy();
    expect(res.body.snapshots.length).toBe(3);
    expect(res.body.snapshots[0]).toHaveProperty("station_id", s.id);
  });

  it("GET /api/reports/kds/prep-times — tickets outside date range excluded", async () => {
    await wipeKds();
    const { rows: [s] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role)
       VALUES (1, 'S', 'prep') RETURNING *`
    );
    const orderId = await seedDraftOrderWithItem();
    await db.query(
      `INSERT INTO kds_tickets (station_id, draft_order_id, status, fired_at, bumped_at, prep_seconds)
       VALUES ($1, $2, 'bumped', '2025-06-01', '2025-06-01', 120)`,
      [s.id, orderId]
    );
    await db.query(
      `INSERT INTO kds_tickets (station_id, draft_order_id, status, fired_at, bumped_at, prep_seconds)
       VALUES ($1, $2, 'bumped', '2019-01-01', '2019-01-01', 999)`,
      [s.id, orderId]
    );

    const res = await request(app)
      .get("/api/reports/kds/prep-times")
      .set("x-employee-id", "1")
      .query({ from: "2025-01-01", to: "2025-12-31" });

    expect(res.status).toBe(200);
    const row = res.body.stations.find((r) => r.station_id === s.id);
    expect(row.count).toBe(1); // the 999-second ticket is filtered out
  });

  it("snapshotForTenant inserts one row per active station and trims old rows", async () => {
    await wipeKds();
    const { snapshotForTenant } = require("../../workers/kds-load-snapshot-worker-boss");
    const { rows: [s1] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role) VALUES (1, 'W1', 'prep') RETURNING id`
    );
    const { rows: [s2] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role, is_active) VALUES (1, 'W2-off', 'prep', false) RETURNING id`
    );
    // Pre-existing snapshot older than 30 days should be trimmed.
    await db.query(
      `INSERT INTO kds_station_load_snapshots (station_id, recorded_at, open_tickets) VALUES ($1, NOW() - INTERVAL '45 days', 1)`,
      [s1.id]
    );

    const fakeLogger = { error: () => {}, warn: () => {}, info: () => {}, child: () => fakeLogger };
    const inserted = await snapshotForTenant(db, fakeLogger, "test");
    expect(inserted).toBe(1); // only the active station

    const { rows: fresh } = await db.query(
      `SELECT station_id FROM kds_station_load_snapshots WHERE recorded_at > NOW() - INTERVAL '1 minute'`
    );
    expect(fresh.map((r) => r.station_id)).toEqual([s1.id]);

    // Old row trimmed
    const { rows: old } = await db.query(
      `SELECT id FROM kds_station_load_snapshots WHERE recorded_at < NOW() - INTERVAL '30 days'`
    );
    expect(old.length).toBe(0);

    // Inactive station wasn't snapshotted
    const { rows: inactive } = await db.query(
      `SELECT id FROM kds_station_load_snapshots WHERE station_id = $1`,
      [s2.id]
    );
    expect(inactive.length).toBe(0);
  });
});
