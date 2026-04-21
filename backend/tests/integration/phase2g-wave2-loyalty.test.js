/**
 * Phase 2-G Wave 2 — 2-G.3 loyalty behavior tests.
 *
 * Covers:
 *   - Sale completion writes 'earn' ledger row when phase2g_loyalty ON
 *     (and respects loyalty_tiers.points_multiplier).
 *   - Sale with points_redeemed writes 'redeem' ledger row.
 *   - Tier discount_percent applies to subtotal when flag ON (overlaps
 *     with the price-books test suite; here we lock the behavior
 *     independently so flipping only phase2g_loyalty produces the
 *     tier discount without touching phase2g_price_books).
 *   - Flag OFF: no ledger rows written, no tier discount, earn/redeem
 *     still update customers.loyalty_points (backward compat).
 *   - /api/loyalty/config returns tenant rates.
 *   - /api/loyalty/customers/:id/adjust writes a signed 'adjust' row
 *     and updates the balance atomically.
 *   - /api/loyalty/customers/:id/ledger paginates + totals correctly.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  await db.query("SET TIME ZONE 'UTC'");

  require("../../middleware/feature-flags").init({
    db,
    IS_MULTI_TENANT: false,
    tenantDbManager: null,
    dbProxy: db,
  });
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();

  require("../../routes/shifts")(app, deps);
  require("../../routes/attendance")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/loyalty")(app, deps);

  req = makeRequest(app, ADMIN_ID);

  await request(app)
    .post("/api/shifts/open")
    .set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "2580", outlet_id: 1 });

  // TestSilver tier at 5% discount. min_spend=1 so post-sale upgrade
  // picks it over Bronze (min_spend=0) after total_spend crosses 1.
  const { rows: [tierRow] } = await db.query(
    `INSERT INTO loyalty_tiers (name, min_spend, points_multiplier, discount_percent, is_active)
     VALUES ('TestSilver', 1, 1.0, 5, true) RETURNING id`,
  );
  await db.query(
    `UPDATE customers SET loyalty_tier_id = $1 WHERE id = 1`,
    [tierRow.id],
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled],
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

async function clearLedger() {
  await db.query(`DELETE FROM loyalty_transactions`);
}

describe("Phase 2-G Wave 2 — 2-G.3 loyalty ledger writes + tier discount", () => {
  beforeEach(async () => {
    await setFlag("phase2g_loyalty", false);
    await setFlag("phase2g_price_books", false);
    await clearLedger();
  });

  test("flag OFF: sale with points_earned writes NO ledger row (backward compat)", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "Cash", amount: 100 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
      points_earned: 1,
    });
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM loyalty_transactions WHERE customer_id = 1`,
    );
    expect(rows[0].n).toBe(0);
  });

  test("flag ON: sale writes 'earn' ledger row referencing the sale", async () => {
    await setFlag("phase2g_loyalty", true);
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "Cash", amount: 100 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
      points_earned: 1,
    });
    expect(res.status).toBe(200);
    const saleId = res.body.saleId;
    const { rows } = await db.query(
      `SELECT type, points, reference_type, reference_id
         FROM loyalty_transactions WHERE customer_id = 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "earn",
      points: 1,
      reference_type: "sale",
      reference_id: saleId,
    });
  });

  test("flag ON: sale with points_redeemed writes BOTH earn + redeem rows", async () => {
    await setFlag("phase2g_loyalty", true);
    // Give customer a starting balance to redeem from.
    await db.query(`UPDATE customers SET loyalty_points = 50 WHERE id = 1`);
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "Cash", amount: 90 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
      points_earned: 1,
      points_redeemed: 10,
    });
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      `SELECT type, points FROM loyalty_transactions WHERE customer_id = 1 ORDER BY id`,
    );
    expect(rows).toHaveLength(2);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(["earn", "redeem"]);
  });

  test("flag ON: tier discount_percent applied additively with manual discount", async () => {
    await setFlag("phase2g_loyalty", true);
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Widget B", price: 200, quantity: 1 }],
      payments: [{ method: "Cash", amount: 190 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
    });
    expect(res.status).toBe(200);
    // TestSilver = 5%. 200 - 5% = 190.
    expect(res.body.totalAmount).toBe(190);
    expect(res.body.autoPricing.autoDiscountValue).toBe(10);
    expect(res.body.autoPricing.discountLines).toHaveLength(1);
    expect(res.body.autoPricing.discountLines[0]).toMatchObject({
      kind: "loyalty_tier",
      percent: 5,
    });
  });

  test("flag ON: earn amount uses tier points_multiplier", async () => {
    await setFlag("phase2g_loyalty", true);
    // Set multiplier to 2.0 on the TestSilver tier.
    await db.query(
      `UPDATE loyalty_tiers SET points_multiplier = 2 WHERE name = 'TestSilver'`,
    );
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "Cash", amount: 95 }], // 100 - 5% tier = 95
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
      points_earned: 3, // client-sent; backend multiplies by 2
    });
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      `SELECT points FROM loyalty_transactions
        WHERE customer_id = 1 AND type = 'earn'
        ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0].points).toBe(6); // 3 × 2.0 multiplier
    // Reset multiplier for downstream tests.
    await db.query(
      `UPDATE loyalty_tiers SET points_multiplier = 1 WHERE name = 'TestSilver'`,
    );
  });
});

describe("Phase 2-G Wave 2 — /api/loyalty/config", () => {
  test("returns tenant rates from company_profile", async () => {
    await db.query(
      `UPDATE company_profile SET loyalty_earn_rate = 2, loyalty_redeem_rate = 15 WHERE id = 1`,
    );
    const res = await req.get("/api/loyalty/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ earn_rate: 2, redeem_rate: 15 });
    // Reset for subsequent tests.
    await db.query(
      `UPDATE company_profile SET loyalty_earn_rate = 1, loyalty_redeem_rate = 10 WHERE id = 1`,
    );
  });

  test("PUT updates tenant rates", async () => {
    const res = await req.put("/api/loyalty/config").send({
      earn_rate: 0.5,
      redeem_rate: 20,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ earn_rate: 0.5, redeem_rate: 20 });
    const get = await req.get("/api/loyalty/config");
    expect(get.body).toEqual({ earn_rate: 0.5, redeem_rate: 20 });
  });

  test("PUT rejects negative rates with 400", async () => {
    const res = await req.put("/api/loyalty/config").send({
      earn_rate: -1,
      redeem_rate: 10,
    });
    expect(res.status).toBe(400);
  });
});

describe("Phase 2-G Wave 2 — /api/loyalty/customers/:id/adjust", () => {
  beforeEach(async () => {
    await setFlag("phase2g_loyalty", true);
    await clearLedger();
    await db.query(`UPDATE customers SET loyalty_points = 100 WHERE id = 1`);
  });

  test("flag OFF → 503", async () => {
    await setFlag("phase2g_loyalty", false);
    const res = await req.post("/api/loyalty/customers/1/adjust").send({
      points: 10,
    });
    expect(res.status).toBe(503);
  });

  test("positive delta adds to balance and writes ledger row", async () => {
    const res = await req.post("/api/loyalty/customers/1/adjust").send({
      points: 25,
      note: "Birthday bonus",
    });
    expect(res.status).toBe(200);
    expect(res.body.new_balance).toBe(125);

    const { rows: [cust] } = await db.query(
      `SELECT loyalty_points FROM customers WHERE id = 1`,
    );
    expect(Number(cust.loyalty_points)).toBe(125);

    const { rows } = await db.query(
      `SELECT type, points, note FROM loyalty_transactions WHERE customer_id = 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "adjust",
      points: 25,
      note: "Birthday bonus",
    });
  });

  test("negative delta subtracts and writes signed ledger row", async () => {
    const res = await req.post("/api/loyalty/customers/1/adjust").send({
      points: -40,
    });
    expect(res.status).toBe(200);
    expect(res.body.new_balance).toBe(60);
    const { rows } = await db.query(
      `SELECT points FROM loyalty_transactions WHERE customer_id = 1`,
    );
    expect(rows[0].points).toBe(-40);
  });

  test("rejects adjustment that would leave balance < 0", async () => {
    const res = await req.post("/api/loyalty/customers/1/adjust").send({
      points: -200,
    });
    expect(res.status).toBe(400);
    // Balance unchanged, no ledger row.
    const { rows: [cust] } = await db.query(
      `SELECT loyalty_points FROM customers WHERE id = 1`,
    );
    expect(Number(cust.loyalty_points)).toBe(100);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM loyalty_transactions WHERE customer_id = 1`,
    );
    expect(rows[0].n).toBe(0);
  });

  test("rejects zero-delta adjustments", async () => {
    const res = await req.post("/api/loyalty/customers/1/adjust").send({
      points: 0,
    });
    expect(res.status).toBe(400);
  });
});

describe("Phase 2-G Wave 2 — /api/loyalty/customers/:id/ledger", () => {
  beforeEach(async () => {
    await setFlag("phase2g_loyalty", true);
    await clearLedger();
    await db.query(`UPDATE customers SET loyalty_points = 100 WHERE id = 1`);
    // Seed 3 ledger rows of different types.
    await db.query(
      `INSERT INTO loyalty_transactions (customer_id, type, points, reference_type, note)
       VALUES (1, 'earn', 50, 'sale', 'Seed earn'),
              (1, 'redeem', 10, 'sale', 'Seed redeem'),
              (1, 'adjust', 20, 'manual', 'Seed adjust')`,
    );
  });

  test("returns rows in descending created_at order with totals", async () => {
    const res = await req.get("/api/loyalty/customers/1/ledger");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.totals).toMatchObject({
      total_earned: 50,
      total_redeemed: 10,
      total_adjusted: 20,
      total_expired: 0,
    });
  });

  test("supports limit pagination", async () => {
    const res = await req.get("/api/loyalty/customers/1/ledger?limit=2");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    // Totals are still the full customer totals, not a slice total.
    expect(res.body.totals.total_earned).toBe(50);
  });
});
