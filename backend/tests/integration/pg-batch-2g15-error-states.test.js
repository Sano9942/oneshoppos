/**
 * 2-G.15 Day 3 + Day 4 — POS error-state contracts.
 *
 * Day 3 — Refund collision + idempotency:
 *  1. v74 partial unique index exists on returns(original_sale_id, idempotency_key)
 *  2. POST /api/returns with idempotency_key persists the key
 *  3. Second POST with same key returns 409 { code: "duplicate_return", existing }
 *  4. Different key on the same sale still succeeds
 *  5. Legacy callers (no key) are not blocked by the partial index
 *
 * Day 4 — Insufficient stock error body contract:
 *  6. POST /api/sales over-quantity returns { code, available, product_id, requested }
 *  7. Barcode miss: GET /api/products/scan/:code returns 404 for unknown barcode
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const featureFlags = require("../../middleware/feature-flags");

let app, db, deps, cleanup, req;

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  // Add the v74 column + partial unique index to the test schema. The
  // baseline DDL doesn't ship these yet, so replicate what migrate-pg.js v74
  // produces on a fresh install.
  await db.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_sale_idempotency
      ON returns(original_sale_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);

  // Wire feature-flags module so returns.js can read phase2g_risk_controls
  // (we default it off so the threshold check doesn't interfere).
  featureFlags.init({ db, IS_MULTI_TENANT: false, tenantDbManager: null, dbProxy: db });

  require("../../routes/returns")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/products")(app, deps);

  // Seed a sale we can refund against.
  await db.query(
    `INSERT INTO sales (id, outlet_id, employee_id, total_amount, payment_method, timestamp)
     VALUES (9100, 1, 1, 500, 'Cash', NOW())
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale)
     VALUES (9100, 1, 1, 500)`,
  );
  // Second sale for the legacy-no-key path so we don't collide.
  await db.query(
    `INSERT INTO sales (id, outlet_id, employee_id, total_amount, payment_method, timestamp)
     VALUES (9101, 1, 1, 500, 'Cash', NOW())
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale)
     VALUES (9101, 1, 1, 500)`,
  );

  // Open shift + clock-in so POST /api/sales passes the gate and reaches
  // the stock check we want to exercise.
  await db.query(
    `INSERT INTO cash_shifts (id, outlet_id, employee_id, opened_at, opening_float, status)
     VALUES (8100, 1, 1, NOW(), 0, 'open')
     ON CONFLICT (id) DO NOTHING`,
  );
  // Anchor session_start to today's UTC noon. The attendance gate is now
  // tz-aware ((session_start AT TIME ZONE tz)::date, tenant tz = UTC in the
  // test harness), so UTC noon matches the tenant-local day at any hour and
  // under any PG session timezone.
  const todayUtc = new Date().toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO attendance_sessions (employee_id, outlet_id, session_type, session_start)
     VALUES (1, 1, 'work', ($1::date + INTERVAL '12 hours') AT TIME ZONE 'UTC')`,
    [todayUtc],
  );

  req = makeRequest(app, ADMIN_ID);
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("2-G.15 Day 3 — refund idempotency", () => {
  test("partial unique index exists on returns(original_sale_id, idempotency_key)", async () => {
    // Constrain by current_schema() so a parallel test schema's identical
    // index (or its absence) doesn't influence this assertion.
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'returns'
         AND schemaname = current_schema()
         AND indexname = 'idx_returns_sale_idempotency'`,
    );
    expect(rows.length).toBe(1);
  });

  test("POST /api/returns with idempotency_key persists the key and succeeds", async () => {
    const key = "test-key-001";
    const res = await req.post("/api/returns").send({
      original_sale_id: 9100,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      idempotency_key: key,
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);

    const { rows } = await db.query(
      "SELECT idempotency_key FROM returns WHERE id = $1",
      [res.body.id],
    );
    expect(rows[0].idempotency_key).toBe(key);
  });

  test("duplicate POST with the same idempotency_key returns 409 with existing ref", async () => {
    const key = "test-key-001";
    const res = await req.post("/api/returns").send({
      original_sale_id: 9100,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      idempotency_key: key,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("duplicate_return");
    expect(res.body.existing).toBeTruthy();
    expect(res.body.existing.id).toBeGreaterThan(0);
    expect(Number(res.body.existing.total_refund)).toBe(100);
    expect(res.body.existing.employee_id).toBe(1);
  });

  test("different idempotency_key on the same sale still succeeds", async () => {
    const res = await req.post("/api/returns").send({
      original_sale_id: 9100,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      idempotency_key: "test-key-002",
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
  });

  test("legacy callers (no idempotency_key) are not blocked by the partial index", async () => {
    const res1 = await req.post("/api/returns").send({
      original_sale_id: 9101,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(res1.status).toBe(200);

    // Second legacy call on the same sale should also succeed — partial index
    // excludes NULL keys, so no artificial lockout.
    const res2 = await req.post("/api/returns").send({
      original_sale_id: 9101,
      outlet_id: 1,
      employee_id: 1,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(res2.status).toBe(200);
  });
});

describe("2-G.15 Day 4 — insufficient stock + barcode miss", () => {
  test("POST /api/sales over-quantity returns structured insufficient_stock body", async () => {
    // Product id=1 has 50 at outlet 1 per seed. Refund tests above adjusted
    // that stock; re-query to get the current level and request + 999 more.
    const { rows: stockRows } = await db.query(
      "SELECT COALESCE(quantity, 0)::int AS q FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    const current = stockRows[0]?.q || 0;
    const overQty = current + 999;

    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, quantity: overQty, price: 100 }],
      payments: [{ method: "Cash", amount: overQty * 100 }],
      outlet_id: 1,
      employee_id: 1,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_stock");
    expect(res.body.product_id).toBe(1);
    expect(Number(res.body.available)).toBe(current);
    expect(Number(res.body.requested)).toBe(overQty);
  });

  test("GET /api/products/scan/:barcode returns 404 for unknown barcode", async () => {
    const res = await req.get("/api/products/scan/NOPE-9999-DOES-NOT-EXIST");
    expect(res.status).toBe(404);
  });
});
