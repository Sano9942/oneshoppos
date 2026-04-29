/**
 * pg-batch-tax-snapshot.test.js — P8 / 3.14 tax snapshot at sale-write
 *
 * Verifies (TDD — written before implementation):
 *   1. POST /api/sales with mixed-rate cart (17% + 5%) populates
 *      sale_items.tax_rate_at_sale and tax_amount_at_sale per line.
 *   2. sales.subtotal + sales.tax_total + sales.tax_inclusive are persisted.
 *   3. tax_inclusive=true (sticker price includes GST): backs out tax from
 *      price (price 100 @ 17% → tax = 100 * 17/117 ≈ 14.53).
 *   4. tax_inclusive=false (exclusive): tax sits on top
 *      (price 100 @ 17% → tax = 17.00).
 *   5. tax_mode='none' (unregistered tenant): every line gets rate=0,
 *      tax_total=0, regardless of product gst.
 *   6. FBR-export endpoint reads from snapshot columns, not live taxes JOIN.
 *   7. Backfill UPDATE marks pre-existing rows with was_backfilled=true.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("P8 — Tax snapshot at sale-write (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Inject a real loadCompanyProfile override so req.company.tax_mode
    // comes from DB (the default stub returns { timezone: "UTC" } only).
    // Must run on EVERY /api/ request (shifts, attendance, sales) so it has
    // to be mounted as Express middleware on the app.
    app.use("/api/", async (req, res, next) => {
      try {
        const { rows: [row] } = await db.query(
          "SELECT * FROM company_profile WHERE id = 1"
        );
        req.company = row || { timezone: "UTC" };
        next();
      } catch (err) {
        next(err);
      }
    });

    require("../../routes/taxes")(app, deps);
    require("../../routes/categories")(app, deps);
    require("../../routes/customers")(app, deps);
    require("../../routes/employees")(app, deps);
    require("../../routes/roles")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/products")(app, deps);
    require("../../routes/sales")(app, deps);

    // Reports — fbr-export reads the snapshot
    require("../../routes/reports/fbr-export")(app, deps);

    // Wire two products at distinct gst rates. Cascade is
    // outlet_tax_profile → products.tax_id → products.gst → category. Clear
    // tax_id on both so gst wins. Product 1: gst=17. Product 2: gst=5.
    await db.query("UPDATE products SET tax_id = NULL, gst = 17 WHERE id = 1");
    await db.query("UPDATE products SET tax_id = NULL, gst = 5 WHERE id = 2");
    // The seeded outlet_tax_profile (if any) and category-tree must not
    // shadow these — we clear category_id to keep the test deterministic.
    await db.query("UPDATE products SET category_id = NULL WHERE id IN (1, 2)");

    // Open shift + clock-in for employee 1
    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    await request(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("inclusive mode: per-line tax extracted from sticker, snapshot persisted", async () => {
    await db.query(
      "UPDATE company_profile SET tax_mode = 'inclusive' WHERE id = 1"
    );

    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [
          { id: 1, name: "Coffee", price: 100, quantity: 1, cost_price: 50 },
          { id: 2, name: "Snack", price: 50, quantity: 2, cost_price: 25 },
        ],
        tax_inclusive: true,
        payments: [{ method: "cash", amount: 200 }],
        idempotency_key: "p8-incl-" + Date.now(),
      });

    expect(res.status).toBe(200);
    const saleId = res.body.saleId;
    expect(saleId).toBeGreaterThan(0);

    const { rows: items } = await db.query(
      `SELECT product_id, quantity, price_at_sale,
              tax_rate_at_sale, tax_amount_at_sale, was_backfilled
         FROM sale_items WHERE sale_id = $1 ORDER BY product_id`,
      [saleId]
    );

    expect(items).toHaveLength(2);

    // Coffee 100 @ 17% inclusive → tax = 100 * 17 / 117 = 14.53
    expect(Number(items[0].tax_rate_at_sale)).toBeCloseTo(17, 2);
    expect(Number(items[0].tax_amount_at_sale)).toBeCloseTo(14.53, 2);
    expect(items[0].was_backfilled).toBe(false);

    // Snack 50×2 @ 5% inclusive → tax = 100 * 5 / 105 = 4.76
    expect(Number(items[1].tax_rate_at_sale)).toBeCloseTo(5, 2);
    expect(Number(items[1].tax_amount_at_sale)).toBeCloseTo(4.76, 2);

    const { rows: [sale] } = await db.query(
      "SELECT subtotal, tax_total, tax_inclusive FROM sales WHERE id = $1",
      [saleId]
    );
    expect(sale.tax_inclusive).toBe(true);
    // Inclusive: subtotal = sum(price*qty) - tax_total = 200 - 19.29
    expect(Number(sale.tax_total)).toBeCloseTo(14.53 + 4.76, 2);
    expect(Number(sale.subtotal)).toBeCloseTo(200 - (14.53 + 4.76), 2);
  });

  it("exclusive mode: tax sits on top, snapshot persisted", async () => {
    await db.query(
      "UPDATE company_profile SET tax_mode = 'exclusive' WHERE id = 1"
    );

    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [
          { id: 1, name: "Coffee", price: 100, quantity: 1, cost_price: 50 },
          { id: 2, name: "Snack", price: 50, quantity: 2, cost_price: 25 },
        ],
        tax_inclusive: false,
        payments: [{ method: "cash", amount: 222 }],
        idempotency_key: "p8-excl-" + Date.now(),
      });

    expect(res.status).toBe(200);
    const saleId = res.body.saleId;

    const { rows: items } = await db.query(
      `SELECT product_id, tax_rate_at_sale, tax_amount_at_sale
         FROM sale_items WHERE sale_id = $1 ORDER BY product_id`,
      [saleId]
    );
    // Coffee 100 @ 17% exclusive → tax = 17.00
    expect(Number(items[0].tax_amount_at_sale)).toBeCloseTo(17, 2);
    // Snack 50×2 @ 5% exclusive → tax = 5.00
    expect(Number(items[1].tax_amount_at_sale)).toBeCloseTo(5, 2);

    const { rows: [sale] } = await db.query(
      "SELECT subtotal, tax_total, tax_inclusive FROM sales WHERE id = $1",
      [saleId]
    );
    expect(sale.tax_inclusive).toBe(false);
    expect(Number(sale.tax_total)).toBeCloseTo(22, 2);
    expect(Number(sale.subtotal)).toBeCloseTo(200, 2); // exclusive: subtotal = gross
  });

  it("tax_mode='none' forces zero tax on every line, even with product.gst > 0", async () => {
    await db.query(
      "UPDATE company_profile SET tax_mode = 'none' WHERE id = 1"
    );

    const res = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [
          { id: 1, name: "Coffee", price: 100, quantity: 1, cost_price: 50 },
        ],
        tax_inclusive: true, // ignored under 'none'
        payments: [{ method: "cash", amount: 100 }],
        idempotency_key: "p8-none-" + Date.now(),
      });
    expect(res.status).toBe(200);

    const { rows: items } = await db.query(
      `SELECT tax_rate_at_sale, tax_amount_at_sale
         FROM sale_items WHERE sale_id = $1`,
      [res.body.saleId]
    );
    expect(Number(items[0].tax_rate_at_sale)).toBe(0);
    expect(Number(items[0].tax_amount_at_sale)).toBe(0);

    const { rows: [sale] } = await db.query(
      "SELECT tax_total, tax_inclusive FROM sales WHERE id = $1",
      [res.body.saleId]
    );
    expect(Number(sale.tax_total)).toBe(0);
    expect(sale.tax_inclusive).toBe(false);
  });

  it("FBR-export endpoint reads from snapshot columns, not live taxes JOIN", async () => {
    // Reset to inclusive + ring up a fresh sale that we will query
    await db.query(
      "UPDATE company_profile SET tax_mode = 'inclusive' WHERE id = 1"
    );
    const sale = await request(app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        outlet_id: 1,
        employee_id: 1,
        cartItems: [
          { id: 1, name: "Coffee", price: 100, quantity: 1, cost_price: 50 },
        ],
        tax_inclusive: true,
        payments: [{ method: "cash", amount: 100 }],
        idempotency_key: "p8-fbr-" + Date.now(),
      });
    expect(sale.status).toBe(200);

    // Now break the live taxes JOIN: clear product.tax_id so any live
    // recompute would yield 0. Snapshot must remain non-zero.
    await db.query("UPDATE products SET tax_id = NULL, gst = 0 WHERE id = 1");

    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/fbr-export?from=${today}&to=${today}`)
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    const ourLine = res.body.rows.find((r) =>
      String(r.invoice_number || "").length > 0 &&
      Number(r.unit_price) === 100
    );
    expect(ourLine).toBeTruthy();
    expect(Number(ourLine.tax_rate)).toBeCloseTo(17, 2);
    expect(Number(ourLine.tax_amount)).toBeCloseTo(14.53, 2);

    // Restore
    await db.query("UPDATE products SET tax_id = NULL, gst = 17 WHERE id = 1");
  });

  it("backfill UPDATE: rows with NULL tax_rate_at_sale get was_backfilled=true and computed amount", async () => {
    // Insert a synthetic "old" sale_items row with NULL tax fields,
    // matching the pre-migration shape, and run the backfill UPDATE that v83
    // applies. This proves the migration's data step is correct.
    await db.query(
      "INSERT INTO sales (id, total_amount, payment_method, outlet_id, employee_id) VALUES (99001, 100, 'Cash', 1, 1) ON CONFLICT (id) DO NOTHING"
    );
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale)
         VALUES (99001, 1, 1, 100, 50)`
    );
    // Force NULL (the column may have a default of false on was_backfilled,
    // but tax_rate_at_sale defaults to NULL because the new sale-write path
    // would have populated it — we want to simulate a pre-deploy row).
    await db.query(
      `UPDATE sale_items SET tax_rate_at_sale = NULL, tax_amount_at_sale = NULL,
                              was_backfilled = false
        WHERE sale_id = 99001`
    );

    // Run the backfill UPDATE (the migration body will run this; here we
    // re-run it directly so the test doesn't need to invoke migrate-pg).
    await db.query(`
      UPDATE sale_items si
         SET tax_rate_at_sale  = COALESCE(p.gst, 0),
             tax_amount_at_sale = ROUND(
               (si.price_at_sale * si.quantity * COALESCE(p.gst, 0) / 100.0)::numeric,
               2
             ),
             was_backfilled     = true
        FROM products p
       WHERE si.product_id = p.id
         AND si.tax_rate_at_sale IS NULL
    `);

    const { rows: [row] } = await db.query(
      `SELECT tax_rate_at_sale, tax_amount_at_sale, was_backfilled
         FROM sale_items WHERE sale_id = 99001`
    );
    expect(Number(row.tax_rate_at_sale)).toBeCloseTo(17, 2);
    expect(Number(row.tax_amount_at_sale)).toBeCloseTo(17, 2); // 100 * 17 / 100
    expect(row.was_backfilled).toBe(true);
  });
});
