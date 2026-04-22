/**
 * 2-G.9 Layaway / hold / special-order integration test.
 *
 * Covers:
 *  1. create hold → holds + hold_items + inventory_reservations row exist;
 *     outlet_stock NOT yet deducted
 *  2. add deposit → balance drops, active → paid transition when balance=0
 *  3. complete hold → sale created + reservations consumed + stock deducted
 *  4. cancel hold → reservations released, status flipped
 *  5. by-barcode lookup — happy path + 404
 *  6. expiry sweep — past-due active holds flip to 'forfeit'
 *  7. feature-flag gate → flag off returns 503
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;
const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");

async function setFlag(key, enabled) {
  await db.query(
    "INSERT INTO feature_flags (key, enabled) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
    [key, enabled],
  );
  invalidateFeatureFlagCache();
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  // Seed the holds schema (migration runs not in test DDL) — apply the
  // same DDL the v71 migration adds.
  await db.query(`
    CREATE TABLE IF NOT EXISTS holds (
      id SERIAL PRIMARY KEY,
      hold_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      customer_phone TEXT,
      customer_name TEXT,
      outlet_id INTEGER NOT NULL REFERENCES outlets(id),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','paid','completed','forfeit','cancelled')),
      total_amount NUMERIC(12,2) NOT NULL,
      deposit_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance_due NUMERIC(12,2) NOT NULL,
      hold_until TIMESTAMPTZ,
      notes TEXT,
      created_by INTEGER REFERENCES employees(id),
      completed_sale_id INTEGER REFERENCES sales(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hold_items (
      id SERIAL PRIMARY KEY,
      hold_id INTEGER NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      quantity NUMERIC(10,3) NOT NULL,
      price_at_hold NUMERIC(12,2) NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hold_payments (
      id SERIAL PRIMARY KEY,
      hold_id INTEGER NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT NOT NULL,
      gateway_ref TEXT,
      paid_at TIMESTAMPTZ DEFAULT NOW(),
      recorded_by INTEGER REFERENCES employees(id)
    )
  `);

  require("../../routes/holds")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  await setFlag("phase2g_holds", true);
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function getOutletStock(productId, outletId) {
  const { rows: [row] } = await db.query(
    "SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2",
    [productId, outletId],
  );
  return Number(row?.quantity || 0);
}

async function createBasicHold({ total = 500, deposit = 0 } = {}) {
  return req.post("/api/holds").send({
    outlet_id: 1,
    customer_id: 1,
    customer_name: "Layaway Joe",
    items: [{ product_id: 1, quantity: 1, price_at_hold: total }],
    total_amount: total,
    deposit_amount: deposit,
    deposit_method: "Cash",
    hold_days: 14,
    notes: "phone held",
  });
}

describe("2-G.9 Holds/Layaway", () => {
  test("feature flag gate — route returns 503 when flag is off", async () => {
    await setFlag("phase2g_holds", false);
    const res = await req.post("/api/holds").send({
      outlet_id: 1, total_amount: 100,
      items: [{ product_id: 1, quantity: 1, price_at_hold: 100 }],
    });
    expect(res.status).toBe(503);
    await setFlag("phase2g_holds", true);
  });

  test("create hold → rows in holds + hold_items + inventory_reservations, stock not deducted yet", async () => {
    const stockBefore = await getOutletStock(1, 1);

    const res = await createBasicHold({ total: 500, deposit: 100 });
    expect(res.status).toBe(201);
    expect(res.body.hold.hold_number).toMatch(/^H-\d{4}-\d{5}$/);
    expect(Number(res.body.hold.total_amount)).toBe(500);
    expect(Number(res.body.hold.deposit_paid)).toBe(100);
    expect(Number(res.body.hold.balance_due)).toBe(400);
    expect(res.body.hold.status).toBe("active");
    expect(res.body.items.length).toBe(1);
    expect(res.body.payments.length).toBe(1);

    const { rows: reservations } = await db.query(
      "SELECT * FROM inventory_reservations WHERE reservation_key LIKE $1",
      [`hold:${res.body.hold.id}:%`],
    );
    expect(reservations.length).toBe(1);
    expect(reservations[0].status).toBe("active");

    const stockAfter = await getOutletStock(1, 1);
    expect(stockAfter).toBe(stockBefore); // stock NOT deducted
  });

  test("add payment → balance drops, flips to 'paid' when balance=0", async () => {
    const created = await createBasicHold({ total: 200, deposit: 50 });
    const holdId = created.body.hold.id;

    let res = await req.post(`/api/holds/${holdId}/payments`).send({ amount: 100, method: "Cash" });
    expect(res.status).toBe(200);
    expect(Number(res.body.hold.deposit_paid)).toBe(150);
    expect(Number(res.body.hold.balance_due)).toBe(50);
    expect(res.body.hold.status).toBe("active");

    res = await req.post(`/api/holds/${holdId}/payments`).send({ amount: 50, method: "Cash" });
    expect(res.status).toBe(200);
    expect(Number(res.body.hold.balance_due)).toBe(0);
    expect(res.body.hold.status).toBe("paid");
  });

  test("complete hold → sale created, reservations consumed, stock deducted", async () => {
    const stockBefore = await getOutletStock(1, 1);
    const created = await createBasicHold({ total: 100, deposit: 0 });
    const holdId = created.body.hold.id;

    const res = await req.post(`/api/holds/${holdId}/complete`).send({
      payments: [{ method: "Cash", amount: 100 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.hold.status).toBe("completed");
    expect(res.body.hold.completed_sale_id).toBeDefined();
    expect(res.body.sale.id).toBe(res.body.hold.completed_sale_id);

    const { rows: reservations } = await db.query(
      "SELECT status FROM inventory_reservations WHERE reservation_key LIKE $1",
      [`hold:${holdId}:%`],
    );
    expect(reservations.every((r) => r.status === "consumed")).toBe(true);

    const stockAfter = await getOutletStock(1, 1);
    expect(stockAfter).toBe(stockBefore - 1);
  });

  test("cancel hold → reservations released, status flipped", async () => {
    const created = await createBasicHold({ total: 100, deposit: 0 });
    const holdId = created.body.hold.id;

    const res = await req.post(`/api/holds/${holdId}/cancel`).send({ reason: "customer changed mind" });
    expect(res.status).toBe(200);
    expect(res.body.hold.status).toBe("cancelled");

    const { rows: reservations } = await db.query(
      "SELECT status FROM inventory_reservations WHERE reservation_key LIKE $1",
      [`hold:${holdId}:%`],
    );
    expect(reservations.every((r) => r.status === "released")).toBe(true);
  });

  test("GET /api/holds/by-barcode/:code — happy path + 404", async () => {
    const created = await createBasicHold({ total: 100 });
    const holdNumber = created.body.hold.hold_number;

    const ok = await req.get(`/api/holds/by-barcode/${holdNumber}`);
    expect(ok.status).toBe(200);
    expect(ok.body.hold.id).toBe(created.body.hold.id);

    const miss = await req.get("/api/holds/by-barcode/H-0000-99999");
    expect(miss.status).toBe(404);
  });

  test("expiry sweep — past-due active holds flip to 'forfeit'", async () => {
    const created = await createBasicHold({ total: 100 });
    const holdId = created.body.hold.id;
    // Force hold_until into the past
    await db.query("UPDATE holds SET hold_until = NOW() - interval '1 day' WHERE id = $1", [holdId]);

    const res = await req.post("/api/holds/_sweep-expired").send({});
    expect(res.status).toBe(200);
    expect(res.body.expired).toBeGreaterThanOrEqual(1);

    const { rows: [after] } = await db.query("SELECT status FROM holds WHERE id = $1", [holdId]);
    expect(after.status).toBe("forfeit");

    const { rows: reservations } = await db.query(
      "SELECT status FROM inventory_reservations WHERE reservation_key LIKE $1",
      [`hold:${holdId}:%`],
    );
    expect(reservations.every((r) => r.status === "released")).toBe(true);
  });
});
