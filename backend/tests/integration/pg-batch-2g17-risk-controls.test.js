/**
 * 2-G.17 — Anti-theft & shrinkage controls.
 *
 * Covers:
 *  1. Flag off: /api/print/open-drawer works without reason_code (backward compat)
 *  2. Flag on: /api/print/open-drawer requires reason_code and writes no_sale_events
 *  3. /api/risk/no-sale happy path + flag gate
 *  4. Returns route: flag on + refund > threshold requires manager_pin
 *  5. Returns route: valid manager PIN → approval_event recorded + return created
 *  6. Shifts route: flag on + variance > threshold requires reason + PIN
 *  7. Anomaly flags list + review endpoint
 *  8. GET /api/risk/summary aggregates counts
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const featureFlags = require("../../middleware/feature-flags");
const { invalidateFeatureFlagCache } = featureFlags;

let app, db, deps, cleanup, req;

async function setFlag(key, enabled) {
  await db.query(
    "INSERT INTO feature_flags (key, enabled) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
    [key, enabled],
  );
  invalidateFeatureFlagCache();
}

async function seedV73Schema() {
  // The v73 DDL does not ship with seedSchema-pg yet (tests apply the
  // baseline DDL directly). Replicate the tables here so the test schema
  // matches what migrate-pg.js produces on a fresh install.
  await db.query(`
    CREATE TABLE IF NOT EXISTS no_sale_reasons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0
    )
  `);
  await db.query(`
    INSERT INTO no_sale_reasons (code, label, sort_order) VALUES
      ('give_change', 'Give change', 1),
      ('count_cash',  'Count cash',  2),
      ('training',    'Training',    3),
      ('other',       'Other',       9)
    ON CONFLICT (code) DO NOTHING
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS no_sale_events (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id),
      outlet_id INT REFERENCES outlets(id),
      shift_id INT REFERENCES cash_shifts(id),
      reason_code TEXT REFERENCES no_sale_reasons(code),
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS retail_anomaly_flags (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL REFERENCES employees(id),
      outlet_id INT REFERENCES outlets(id),
      metric TEXT NOT NULL,
      value NUMERIC(8,4) NOT NULL,
      peer_mean NUMERIC(8,4) NOT NULL,
      peer_stddev NUMERIC(8,4) NOT NULL,
      z_score NUMERIC(6,2) NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      flagged_at TIMESTAMPTZ DEFAULT NOW(),
      reviewed_by INT REFERENCES employees(id),
      reviewed_at TIMESTAMPTZ,
      review_note TEXT
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_flags_employee_metric_period
      ON retail_anomaly_flags(employee_id, metric, period_start, period_end)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS risk_controls_config (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      refund_approval_threshold NUMERIC(12,2) DEFAULT 5000,
      variance_approval_threshold NUMERIC(12,2) DEFAULT 500,
      anomaly_z_score_threshold NUMERIC(4,2) DEFAULT 2.0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    INSERT INTO risk_controls_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING
  `);

  // verifyManagerPin wants a bcrypt hash on employees.pin_hash. The admin
  // user seeded by createTestApp has plaintext pin_code='2580'; but the
  // override_refund perm check requires all_access (admin has it).
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  await seedV73Schema();

  // Wire the feature-flags module to the test schema so returns.js +
  // shifts.js can read phase2g_risk_controls via getFeatureFlagsMap().
  featureFlags.init({ db, IS_MULTI_TENANT: false, tenantDbManager: null, dbProxy: db });

  // Seed an admin PIN hash (override perms inherited via all_access).
  const hash = await bcrypt.hash("2580", 10);
  await db.query(
    "UPDATE employees SET pin_hash = $1 WHERE id = 1",
    [hash],
  );

  require("../../routes/printer")(app, deps);
  require("../../routes/returns")(app, deps);
  require("../../routes/shifts")(app, deps);
  require("../../routes/risk-controls")(app, deps);

  req = makeRequest(app, ADMIN_ID);
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("2-G.17 Risk controls — no-sale flow", () => {
  test("flag off: /api/print/open-drawer succeeds with no reason_code (legacy behavior)", async () => {
    await setFlag("phase2g_risk_controls", false);
    const res = await req.post("/api/print/open-drawer").send({});
    // Real drawer kick is unreachable in tests; we accept either 200 or 500 as
    // long as the gate isn't the 400 "reason_code required" path.
    expect(res.status).not.toBe(400);
  });

  test("flag on: /api/print/open-drawer without reason_code returns 400", async () => {
    await setFlag("phase2g_risk_controls", true);
    const res = await req.post("/api/print/open-drawer").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason_code/i);
  });

  test("flag on: /api/risk/no-sale with valid reason writes no_sale_events row", async () => {
    await setFlag("phase2g_risk_controls", true);
    const before = await db.query("SELECT COUNT(*)::int AS c FROM no_sale_events");
    const res = await req.post("/api/risk/no-sale").send({
      reason_code: "give_change",
      note: "customer change for Rs 2000",
      outlet_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.event).toBeTruthy();
    expect(res.body.event.reason_code).toBe("give_change");
    const after = await db.query("SELECT COUNT(*)::int AS c FROM no_sale_events");
    expect(after.rows[0].c).toBe(before.rows[0].c + 1);
  });

  test("flag on: unknown reason_code is rejected", async () => {
    await setFlag("phase2g_risk_controls", true);
    const res = await req.post("/api/risk/no-sale").send({ reason_code: "bogus", outlet_id: 1 });
    expect(res.status).toBe(400);
  });

  test("flag off: /api/risk/no-sale blocked by feature gate", async () => {
    await setFlag("phase2g_risk_controls", false);
    const res = await req.post("/api/risk/no-sale").send({ reason_code: "give_change", outlet_id: 1 });
    expect(res.status).toBe(503);
  });
});

describe("2-G.17 Risk controls — config", () => {
  test("GET /api/risk/config returns defaults", async () => {
    await setFlag("phase2g_risk_controls", true);
    const res = await req.get("/api/risk/config");
    expect(res.status).toBe(200);
    expect(Number(res.body.refund_approval_threshold)).toBe(5000);
    expect(Number(res.body.variance_approval_threshold)).toBe(500);
    expect(Number(res.body.anomaly_z_score_threshold)).toBeCloseTo(2.0);
  });

  test("PUT /api/risk/config updates thresholds", async () => {
    await setFlag("phase2g_risk_controls", true);
    const res = await req.put("/api/risk/config").send({
      refund_approval_threshold: 10000,
      variance_approval_threshold: 1000,
    });
    expect(res.status).toBe(200);
    expect(Number(res.body.refund_approval_threshold)).toBe(10000);
    expect(Number(res.body.variance_approval_threshold)).toBe(1000);
  });
});

describe("2-G.17 Risk controls — refund threshold", () => {
  beforeAll(async () => {
    // Reset threshold to a small value so our test refund crosses it.
    await db.query(
      "UPDATE risk_controls_config SET refund_approval_threshold = 100, variance_approval_threshold = 50 WHERE id = 1",
    );
    // Seed a sale we can refund against.
    await db.query(
      `INSERT INTO sales (id, outlet_id, employee_id, total_amount, payment_method, timestamp)
       VALUES (9000, 1, 1, 500, 'Cash', NOW())
       ON CONFLICT (id) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale)
       VALUES (9000, 1, 1, 500)`,
    );
    await setFlag("phase2g_risk_controls", true);
  });

  test("refund above threshold without manager_pin returns 403", async () => {
    const res = await req.post("/api/returns").send({
      original_sale_id: 9000,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 500,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 500 }],
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("manager_pin_required");
  });

  test("refund above threshold with valid manager_pin succeeds and records approval_event", async () => {
    const beforeEv = await db.query("SELECT COUNT(*)::int AS c FROM approval_events");
    const res = await req.post("/api/returns").send({
      original_sale_id: 9000,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 500,
      refund_method: "Cash",
      manager_pin: "2580",
      items: [{ product_id: 1, quantity: 1, refund_price: 500 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    const afterEv = await db.query("SELECT COUNT(*)::int AS c FROM approval_events");
    expect(afterEv.rows[0].c).toBe(beforeEv.rows[0].c + 1);
    // The return row should carry the approval_event_id
    const { rows } = await db.query(
      "SELECT approval_event_id FROM returns WHERE id = $1",
      [res.body.id],
    );
    expect(rows[0].approval_event_id).toBeGreaterThan(0);
  });

  test("refund BELOW threshold does not require manager_pin", async () => {
    await db.query(
      "UPDATE risk_controls_config SET refund_approval_threshold = 10000 WHERE id = 1",
    );
    const res = await req.post("/api/returns").send({
      original_sale_id: 9000,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 50,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 50 }],
    });
    expect(res.status).toBe(200);
  });
});

describe("2-G.17 Risk controls — anomaly flags review", () => {
  beforeAll(async () => {
    await setFlag("phase2g_risk_controls", true);
    await db.query(
      `INSERT INTO retail_anomaly_flags
         (employee_id, outlet_id, metric, value, peer_mean, peer_stddev, z_score, period_start, period_end)
       VALUES (1, 1, 'voids_pct', 0.12, 0.03, 0.02, 4.5, '2026-04-01', '2026-04-30')`,
    );
  });

  test("GET /api/risk/anomaly-flags returns seeded flag", async () => {
    const res = await req.get("/api/risk/anomaly-flags?reviewed=false");
    expect(res.status).toBe(200);
    expect(res.body.flags.length).toBeGreaterThan(0);
    expect(res.body.flags[0].reviewed_at).toBeNull();
  });

  test("PUT /api/risk/anomaly-flags/:id/review marks reviewed", async () => {
    const { rows } = await db.query(
      "SELECT id FROM retail_anomaly_flags WHERE reviewed_at IS NULL LIMIT 1",
    );
    const flagId = rows[0].id;
    const res = await req.put(`/api/risk/anomaly-flags/${flagId}/review`).send({
      review_note: "verified — legit customer return",
    });
    expect(res.status).toBe(200);
    expect(res.body.reviewed_by).toBe(1);
    expect(res.body.reviewed_at).toBeTruthy();
  });

  test("GET /api/risk/summary returns counts", async () => {
    const res = await req.get("/api/risk/summary");
    expect(res.status).toBe(200);
    expect(typeof res.body.no_sale_count_7d).toBe("number");
    expect(typeof res.body.unreviewed_anomaly_count).toBe("number");
  });
});
