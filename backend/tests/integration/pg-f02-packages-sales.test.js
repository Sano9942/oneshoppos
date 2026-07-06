const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

/**
 * pg-f02-packages-sales.test.js — F02 packages through the POS sale path.
 *
 * Covers the three sales.js / returns.js hooks:
 *   1. SELL — a cart line whose product backs a package template issues a
 *      customer_packages row at sale commit (rejects anonymous).
 *   2. REDEEM — a line flagged redeem_customer_package_id decrements credits
 *      inside the sale transaction; ownership + scope enforced.
 *   3. REFUND — returning an untouched package sale flips it 'refunded';
 *      returning a used package is blocked.
 */

let app, db, deps, cleanup, req, customerId, otherCustomerId;

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled],
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app; db = result.db; deps = result.deps; cleanup = result.cleanup;

  await db.query("SET TIME ZONE 'UTC'");
  require("../../middleware/feature-flags").init({ db, IS_MULTI_TENANT: false, tenantDbManager: null, dbProxy: db });

  require("../../routes/shifts")(app, deps);
  require("../../routes/attendance")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/returns")(app, deps);
  require("../../routes/packages")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  await request(app).post("/api/shifts/open").set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app).post("/api/attendance/pin-checkin").send({ pin_code: "2580", outlet_id: 1 });

  await setFlag("packages_passes", true);

  const { rows: [c] } = await db.query("SELECT id FROM customers ORDER BY id LIMIT 1");
  customerId = c.id;
  const { rows: [c2] } = await db.query(
    "INSERT INTO customers (name) VALUES ('Other Buyer') RETURNING id");
  otherCustomerId = c2.id;
}, 120000);

afterAll(async () => { if (cleanup) await cleanup(); }, 30000);

async function makeTemplate(body) {
  const res = await req.post("/api/package-templates").send(body);
  expect(res.status).toBe(201);
  return res.body;
}

describe("F02 — sell a package at POS", () => {
  test("selling the package product issues a customer_packages row to the buyer", async () => {
    const tpl = await makeTemplate({ name: "POS 8-pack", price: 4000, credits: 8, validity_days: 45 });
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: tpl.product_id, name: "POS 8-pack", price: 4000, quantity: 1 }],
      payments: [{ method: "Cash", amount: 4000 }],
      outlet_id: 1, employee_id: 1, customer_id: customerId,
    });
    expect(res.status).toBe(200);
    expect(res.body.soldPackages).toHaveLength(1);
    expect(res.body.soldPackages[0].credits_remaining).toBe(8);

    const { rows } = await db.query(
      "SELECT customer_id, credits_total, sale_id FROM customer_packages WHERE package_template_id = $1",
      [tpl.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_id).toBe(customerId);
    expect(rows[0].sale_id).toBe(res.body.saleId);
  });

  test("selling quantity=2 issues two separate packages", async () => {
    const tpl = await makeTemplate({ name: "POS dual", price: 1000, credits: 2 });
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: tpl.product_id, name: "POS dual", price: 1000, quantity: 2 }],
      payments: [{ method: "Cash", amount: 2000 }],
      outlet_id: 1, employee_id: 1, customer_id: customerId,
    });
    expect(res.status).toBe(200);
    expect(res.body.soldPackages).toHaveLength(2);
  });

  test("anonymous package sale is rejected and rolls back", async () => {
    const tpl = await makeTemplate({ name: "No-owner", price: 1000, credits: 3 });
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: tpl.product_id, name: "No-owner", price: 1000, quantity: 1 }],
      payments: [{ method: "Cash", amount: 1000 }],
      outlet_id: 1, employee_id: 1, // no customer_id
    });
    expect(res.status).toBe(400);
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM customer_packages WHERE package_template_id = $1", [tpl.id]);
    expect(rows[0].n).toBe(0);
  });

  test("flag OFF: selling the package product issues nothing", async () => {
    const tpl = await makeTemplate({ name: "Flag-off pack", price: 1000, credits: 3 });
    await setFlag("packages_passes", false);
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: tpl.product_id, name: "Flag-off pack", price: 1000, quantity: 1 }],
      payments: [{ method: "Cash", amount: 1000 }],
      outlet_id: 1, employee_id: 1, customer_id: customerId,
    });
    expect(res.status).toBe(200);
    expect(res.body.soldPackages || []).toEqual([]);
    const { rows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM customer_packages WHERE package_template_id = $1", [tpl.id]);
    expect(rows[0].n).toBe(0);
    await setFlag("packages_passes", true);
  });
});

describe("F02 — redeem a package at POS checkout", () => {
  let serviceProductId, pkgId;

  beforeAll(async () => {
    const { rows: [p] } = await db.query(
      "INSERT INTO products (name, price, product_type, status) VALUES ('Yoga class', 0, 'service', 'active') RETURNING id");
    serviceProductId = p.id;
    await db.query(
      "INSERT INTO booking_services (name, duration_minutes, price, product_id) VALUES ('Yoga', 60, 0, $1)", [serviceProductId]);
    // Sell a 5-credit any-scope pack to the buyer.
    const tpl = await makeTemplate({ name: "Redeemable 5", price: 2500, credits: 5 });
    const sold = await req.post(`/api/customers/${customerId}/packages`).send({ template_id: tpl.id });
    pkgId = sold.body.id;
  });

  test("a redeem line decrements credits and writes a redemption linked to the sale", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: serviceProductId, name: "Yoga class", price: 0, quantity: 1, redeem_customer_package_id: pkgId }],
      payments: [{ method: "Cash", amount: 0 }],
      outlet_id: 1, employee_id: 1, customer_id: customerId,
    });
    expect(res.status).toBe(200);
    const { rows: [pkg] } = await db.query(
      "SELECT credits_used FROM customer_packages WHERE id = $1", [pkgId]);
    expect(pkg.credits_used).toBe(1);
    const { rows: [red] } = await db.query(
      "SELECT sale_id, credits FROM package_redemptions WHERE customer_package_id = $1", [pkgId]);
    expect(red.sale_id).toBe(res.body.saleId);
    expect(red.credits).toBe(1);
  });

  test("redeeming another customer's package is rejected (sale rolls back)", async () => {
    const res = await req.post("/api/sales").send({
      cartItems: [{ id: serviceProductId, name: "Yoga class", price: 0, quantity: 1, redeem_customer_package_id: pkgId }],
      payments: [{ method: "Cash", amount: 0 }],
      outlet_id: 1, employee_id: 1, customer_id: otherCustomerId,
    });
    expect(res.status).toBe(400);
    // credits_used stays at 1 (previous test) — the failed sale didn't decrement.
    const { rows: [pkg] } = await db.query(
      "SELECT credits_used FROM customer_packages WHERE id = $1", [pkgId]);
    expect(pkg.credits_used).toBe(1);
  });
});

describe("F02 — refunding a package sale", () => {
  test("returning an untouched package sale flips it to 'refunded'", async () => {
    const tpl = await makeTemplate({ name: "Refundable", price: 1500, credits: 4 });
    const sale = await req.post("/api/sales").send({
      cartItems: [{ id: tpl.product_id, name: "Refundable", price: 1500, quantity: 1 }],
      payments: [{ method: "Cash", amount: 1500 }],
      outlet_id: 1, employee_id: 1, customer_id: customerId,
    });
    expect(sale.status).toBe(200);

    const ret = await req.post("/api/returns").send({
      original_sale_id: sale.body.saleId,
      total_refund: 1500, refund_method: "Cash", outlet_id: 1, employee_id: 1,
      items: [{ product_id: tpl.product_id, quantity: 1, refund_price: 1500 }],
    });
    expect(ret.status).toBe(200);
    const { rows: [pkg] } = await db.query(
      "SELECT status FROM customer_packages WHERE sale_id = $1 AND package_template_id = $2",
      [sale.body.saleId, tpl.id]);
    expect(pkg.status).toBe("refunded");
  });

  test("returning a partially-used package is blocked with a clear error", async () => {
    const tpl = await makeTemplate({ name: "Used pack", price: 1500, credits: 4 });
    const sale = await req.post("/api/sales").send({
      cartItems: [{ id: tpl.product_id, name: "Used pack", price: 1500, quantity: 1 }],
      payments: [{ method: "Cash", amount: 1500 }],
      outlet_id: 1, employee_id: 1, customer_id: customerId,
    });
    const { rows: [pkg] } = await db.query(
      "SELECT id FROM customer_packages WHERE sale_id = $1 AND package_template_id = $2",
      [sale.body.saleId, tpl.id]);
    // Redeem one credit.
    await req.post(`/api/packages/${pkg.id}/redeem`).send({});

    const ret = await req.post("/api/returns").send({
      original_sale_id: sale.body.saleId,
      total_refund: 1500, refund_method: "Cash", outlet_id: 1, employee_id: 1,
      items: [{ product_id: tpl.product_id, quantity: 1, refund_price: 1500 }],
    });
    expect(ret.status).toBe(400);
    expect(String(ret.body.error)).toMatch(/already been used|partially/i);
    const { rows: [after] } = await db.query("SELECT status FROM customer_packages WHERE id = $1", [pkg.id]);
    expect(after.status).not.toBe("refunded");
  });
});
