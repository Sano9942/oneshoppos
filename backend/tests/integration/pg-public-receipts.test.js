/**
 * pg-public-receipts.test.js — Integration tests for GET /api/receipts/:invoiceNumber/public
 *
 * Regression: discovered Apr 29 2026 during Phase 3.7 walkthrough that this
 * route was issuing `SELECT method, amount FROM sale_payments` while the
 * actual schema column is `payment_method` (schema-pg.sql:482-488). Result:
 * every public receipt URL on every tenant returned 500. The frontend public
 * page rendered "Receipt Not Found / Failed to load receipt" because of this.
 *
 * No prior test covered this route — that's how the typo survived.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Public receipts (GET /api/receipts/:invoiceNumber/public)", () => {
  let app, db, deps, cleanup;
  const prevMultiTenant = process.env.MULTI_TENANT;

  beforeAll(async () => {
    // The receipts route reads `process.env.MULTI_TENANT` at module-load
    // time. .env / .env.test set it to "1" for prod-parity, which would
    // force the route into multi-tenant lookup mode and cause every test
    // to 400 with "tenant query param is required". Drop the var BEFORE
    // requiring the route so the single-tenant `deps.db` branch is taken.
    delete process.env.MULTI_TENANT;
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/receipts")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
    if (prevMultiTenant !== undefined) process.env.MULTI_TENANT = prevMultiTenant;
  });

  it("returns sale + items + payments shape for a valid invoice number", async () => {
    // Seed: a completed sale with one item and a Cash payment.
    const { rows: [sale] } = await db.query(
      `INSERT INTO sales (invoice_number, total_amount, payment_method, employee_id, outlet_id, voided)
       VALUES ('INV-PUBLIC-TEST', 200, 'Cash', 1, 1, false)
       RETURNING id`
    );
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale)
       VALUES ($1, 1, 2, 100)`,
      [sale.id]
    );
    await db.query(
      `INSERT INTO sale_payments (sale_id, payment_method, amount)
       VALUES ($1, 'Cash', 200)`,
      [sale.id]
    );

    const res = await request(app).get("/api/receipts/INV-PUBLIC-TEST/public");

    expect(res.status).toBe(200);
    expect(res.body.sale.invoice_number).toBe("INV-PUBLIC-TEST");
    expect(res.body.sale.total_amount).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantity).toBe("2.000");
    expect(Array.isArray(res.body.payments)).toBe(true);
    expect(res.body.payments).toHaveLength(1);
    // The bug: this field was named `method` in the route's SQL but the column
    // is `payment_method`. After fix, the public payload still uses `method`
    // as the externally-visible field name (clients depend on it).
    expect(res.body.payments[0].method).toBe("Cash");
    expect(Number(res.body.payments[0].amount)).toBe(200);
  });

  it("returns 404 for an unknown invoice number", async () => {
    const res = await request(app).get("/api/receipts/INV-DOES-NOT-EXIST/public");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 for a voided sale", async () => {
    await db.query(
      `INSERT INTO sales (invoice_number, total_amount, payment_method, employee_id, outlet_id, voided)
       VALUES ('INV-VOIDED-TEST', 50, 'Cash', 1, 1, true)`
    );
    const res = await request(app).get("/api/receipts/INV-VOIDED-TEST/public");
    expect(res.status).toBe(404);
  });
});
