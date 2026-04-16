/**
 * pg-offline-sale-sync.test.js — Wave D offline sale sync integration.
 *
 * Validates two things the frontend offline queue depends on:
 * 1. Card sales post with a gateway_ref (sandbox adapter), even when
 *    replayed after coming back online.
 * 2. Replaying the same idempotency_key returns { duplicate: true } with
 *    the original sale info — proves no double-charge on sync retry.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;

beforeAll(async () => {
  process.env.PAYMENT_GATEWAY = "sandbox";
  process.env.SANDBOX_WEBHOOK_SECRET = "test-secret";

  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../routes/sales")(app, deps);

  req = makeRequest(app, ADMIN_ID);

  await db.query(
    `INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status)
     VALUES (1, 1, 1000, 'open')`
  );
  await db.query(
    `INSERT INTO attendance_sessions (employee_id, outlet_id, session_start, session_type)
     VALUES (1, 1, NOW(), 'work')`
  );
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
  delete process.env.PAYMENT_GATEWAY;
  delete process.env.SANDBOX_WEBHOOK_SECRET;
}, 30000);

describe("offline sale sync (sandbox card payment)", () => {
  const OFFLINE_KEY = "test-offline-1";
  let originalSaleId;
  let originalInvoice;
  let originalGatewayRef;

  test("initial POST with Card payment + idempotency_key stores sandbox gateway_ref", async () => {
    const res = await req
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
        payments: [{ method: "Card", amount: 100 }],
        outlet_id: 1,
        employee_id: 1,
        idempotency_key: OFFLINE_KEY,
      })
      .expect(200);

    expect(res.body.saleId).toBeDefined();
    originalSaleId = res.body.saleId;
    originalInvoice = res.body.invoiceNumber;

    const { rows } = await db.query(
      "SELECT payment_method, gateway_ref FROM sale_payments WHERE sale_id = $1",
      [originalSaleId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payment_method).toBe("Card");
    expect(rows[0].gateway_ref).toMatch(/^sandbox_/);
    originalGatewayRef = rows[0].gateway_ref;
  });

  test("replay of same idempotency_key returns duplicate:true with original sale info", async () => {
    const res = await req
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, name: "Widget A", price: 100, quantity: 1 }],
        payments: [{ method: "Card", amount: 100 }],
        outlet_id: 1,
        employee_id: 1,
        idempotency_key: OFFLINE_KEY,
      })
      .expect(200);

    expect(res.body.duplicate).toBe(true);
    expect(res.body.saleId).toBe(originalSaleId);
    expect(res.body.invoiceNumber).toBe(originalInvoice);
  });

  test("gateway_ref persists unchanged after replay (no double charge)", async () => {
    const { rows } = await db.query(
      "SELECT gateway_ref FROM sale_payments WHERE sale_id = $1",
      [originalSaleId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].gateway_ref).toBe(originalGatewayRef);
  });
});
