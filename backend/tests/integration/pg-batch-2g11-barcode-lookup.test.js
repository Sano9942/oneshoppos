/**
 * 2-G.11 — GET /api/sales/by-barcode/:code
 *
 * Exact-match lookup on invoice_number used by the POS return modal when
 * the cashier scans a printed receipt CODE128 barcode.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../routes/sales")(app, deps);

  req = makeRequest(app, ADMIN_ID);

  // Seed one completed sale with a predictable invoice_number
  await db.query(
    `INSERT INTO sales (
       id, employee_id, outlet_id, invoice_number, total_amount, payment_method,
       discount_amount
     ) VALUES (9001, 1, 1, 'INV-2026-00042', 200, 'Cash', 0)`,
  );
  await db.query(
    `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale)
     VALUES (9001, 1, 2, 100)`,
  );
  await db.query(
    `INSERT INTO sale_payments (sale_id, payment_method, amount)
     VALUES (9001, 'Cash', 200)`,
  );
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("GET /api/sales/by-barcode/:code", () => {
  test("returns sale + items + payments on exact invoice_number match", async () => {
    const res = await req.get("/api/sales/by-barcode/INV-2026-00042");
    expect(res.status).toBe(200);
    expect(res.body.sale).toBeDefined();
    expect(res.body.sale.id).toBe(9001);
    expect(res.body.sale.invoice_number).toBe("INV-2026-00042");
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].product_id).toBe(1);
    expect(Array.isArray(res.body.payments)).toBe(true);
    expect(res.body.payments.length).toBe(1);
  });

  test("matches case-insensitively", async () => {
    const res = await req.get("/api/sales/by-barcode/inv-2026-00042");
    expect(res.status).toBe(200);
    expect(res.body.sale.id).toBe(9001);
  });

  test("returns 404 for unknown invoice_number", async () => {
    const res = await req.get("/api/sales/by-barcode/NOT-A-REAL-INVOICE");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test("does not collide with /api/sales/:id (numeric fall-through)", async () => {
    // /api/sales/9001 must still work — by-barcode only matches
    // /by-barcode/:code, not bare numeric ids.
    const res = await req.get("/api/sales/9001");
    expect(res.status).toBe(200);
    expect(res.body.sale.id).toBe(9001);
  });
});
