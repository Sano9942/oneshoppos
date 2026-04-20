/**
 * Phase 2-G Wave 2 — 2-G.4 customer-group price books (behavior tests).
 *
 * Covers the server-side resolution chain when completing a sale for a
 * customer who is in a customer_group. Flag-gated by phase2g_price_books.
 *
 * Resolution order (matches pricing service):
 *   1. per-product price_list_items override (scoped to group)
 *   2. + group discount_percent auto-applied pre-tax
 *   3. + (Track B) loyalty tier discount_percent — tested additively here
 *   4. + existing manual discount
 *
 * Baseline check is flag-OFF — identical to pre-wave-2.
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

  // Align the test schema's session timezone with JS `toISOString()` so the
  // attendance `session_start::date` check in sales.js doesn't silently skip
  // around midnight UTC. Without this, the local Postgres (default
  // Asia/Karachi) and JS ISO dates drift by a day for a 5-hour window each
  // night — causing false "not_clocked_in" 400s.
  await db.query("SET TIME ZONE 'UTC'");

  // Wire the feature-flags module to this test schema so getFeatureFlagsMap
  // (called inline from sales.js auto-pricing block) sees the flags we flip
  // below. createTestApp-pg.js doesn't init this module by default.
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

  req = makeRequest(app, ADMIN_ID);

  // Open shift + pin-checkin via real routes so sales.js attendance check
  // returns "clocked_in". Direct SQL inserts don't populate all the columns
  // the lookup expects, so we use the endpoints as a retail tenant would.
  await request(app)
    .post("/api/shifts/open")
    .set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "2580", outlet_id: 1 });

  // Seed customer group + attach fixture customer (id=1) to it.
  await db.query(
    `INSERT INTO customer_groups (id, name, discount_percent, is_active)
     VALUES (10, 'Wholesale', 10, true)`
  );
  await db.query(
    `SELECT setval(pg_get_serial_sequence('customer_groups','id'), 10, true)`
  );
  await db.query(
    `UPDATE customers SET customer_group_id = 10 WHERE id = 1`
  );

  // Seed loyalty tier + attach customer to it (for additive-stacking tests).
  // Use INSERT ... RETURNING so we don't depend on id=20 being free —
  // schema-pg.sql seeds 4 default tiers (Bronze id=1 with 0% → Platinum
  // id=4 with 8%). Insert a fresh 5% "TestSilver" with a tiny min_spend so
  // the post-sale auto-upgrade in sales.js (lines 980-988) picks it over
  // Bronze as soon as total_spend crosses 1, and before Silver@25000.
  const { rows: [tierRow] } = await db.query(
    `INSERT INTO loyalty_tiers (name, min_spend, discount_percent, is_active)
     VALUES ('TestSilver', 1, 5, true) RETURNING id`
  );
  await db.query(
    `UPDATE customers SET loyalty_tier_id = $1 WHERE id = 1`,
    [tierRow.id]
  );

  // Seed a group-scoped price list with a per-product override:
  //   product id=1 (seeded at PKR 100) → overridden to PKR 80 for Wholesale.
  const { rows: [pl] } = await db.query(
    `INSERT INTO price_lists (name, type, customer_group_id, is_active)
     VALUES ('Wholesale Book', 'customer_group', 10, true) RETURNING id`
  );
  await db.query(
    `INSERT INTO price_list_items (price_list_id, product_id, price, min_qty)
     VALUES ($1, 1, 80, 1)`,
    [pl.id]
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled]
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

// Helper: pull the sale we just created, for persisted-total assertions.
async function getLatestSale() {
  const { rows } = await db.query(
    `SELECT id, total_amount, discount_amount
       FROM sales ORDER BY id DESC LIMIT 1`
  );
  return rows[0];
}

describe("Phase 2-G Wave 2 — 2-G.4 customer-group price books", () => {
  beforeEach(async () => {
    // Ensure clean flag state at the start of every test.
    await setFlag("phase2g_price_books", false);
    await setFlag("phase2g_loyalty", false);
  });

  test("flag OFF: customer-group member totals = non-member totals (regression guard)", async () => {
    // Group-member customer, 2 units of product 1 @ PKR 100.
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 2 }],
      payments: [{ method: "Cash", amount: 200 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.totalAmount).toBe(200);
    expect(res.body.autoPricing.autoDiscountValue).toBe(0);
    expect(res.body.autoPricing.priceBookApplied).toEqual([]);
    expect(res.body.autoPricing.discountLines).toEqual([]);
  });

  test("flag ON: group discount_percent applied as 10% off subtotal", async () => {
    await setFlag("phase2g_price_books", true);

    // Use product 2 (PKR 200) which has no price-book override row, so the
    // only discount comes from the group's 10%.
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Widget B", price: 200, quantity: 1 }],
      payments: [{ method: "Cash", amount: 180 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
    });
    expect(res.status).toBe(200);
    // 200 - 10% = 180
    expect(res.body.totalAmount).toBe(180);
    expect(res.body.autoPricing.autoDiscountValue).toBe(20);
    expect(res.body.autoPricing.discountLines).toHaveLength(1);
    expect(res.body.autoPricing.discountLines[0]).toMatchObject({
      kind: "customer_group",
      customer_group_id: 10,
      percent: 10,
    });
  });

  test("flag ON: per-product override applied before group-% (PKR 100 → PKR 80)", async () => {
    await setFlag("phase2g_price_books", true);

    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
      payments: [{ method: "Cash", amount: 72 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
    });
    expect(res.status).toBe(200);
    // 80 (override) - 10% (group) = 72
    expect(res.body.totalAmount).toBe(72);
    expect(res.body.autoPricing.priceBookApplied).toHaveLength(1);
    expect(res.body.autoPricing.priceBookApplied[0]).toMatchObject({
      product_id: 1,
      original_price: 100,
      override_price: 80,
    });
    expect(res.body.autoPricing.autoDiscountValue).toBe(8); // 10% of 80
  });

  test("flag ON: both phase2g_price_books + phase2g_loyalty stack additively (15%)", async () => {
    await setFlag("phase2g_price_books", true);
    await setFlag("phase2g_loyalty", true);

    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Widget B", price: 200, quantity: 1 }],
      payments: [{ method: "Cash", amount: 170 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
    });
    expect(res.status).toBe(200);
    // 200 - 15% = 170 (10% group + 5% tier, additive)
    expect(res.body.totalAmount).toBe(170);
    expect(res.body.autoPricing.autoDiscountValue).toBe(30);
    expect(res.body.autoPricing.discountLines).toHaveLength(2);
    const kinds = res.body.autoPricing.discountLines.map((d) => d.kind);
    expect(kinds).toContain("customer_group");
    expect(kinds).toContain("loyalty_tier");
  });

  test("flag ON: sale with no customer_id skips auto-pricing entirely", async () => {
    await setFlag("phase2g_price_books", true);

    const res = await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Widget B", price: 200, quantity: 1 }],
      payments: [{ method: "Cash", amount: 200 }],
      outlet_id: 1,
      employee_id: 1,
      // no customer_id
    });
    expect(res.status).toBe(200);
    expect(res.body.totalAmount).toBe(200);
    expect(res.body.autoPricing.autoDiscountValue).toBe(0);
  });

  test("flag ON: persisted sale.total_amount matches auto-discounted total", async () => {
    await setFlag("phase2g_price_books", true);

    await req.post("/api/sales").send({
      cartItems: [{ id: 2, name: "Widget B", price: 200, quantity: 1 }],
      payments: [{ method: "Cash", amount: 180 }],
      outlet_id: 1,
      employee_id: 1,
      customer_id: 1,
    });
    const sale = await getLatestSale();
    expect(Number(sale.total_amount)).toBe(180);
  });
});
