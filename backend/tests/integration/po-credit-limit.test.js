/**
 * po-credit-limit.test.js
 * Verifies that POST /api/purchase-orders returns a warning when
 * a credit supplier would exceed their credit limit.
 */
const { createTestApp, closeDb, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
  // Supplier 2 → credit supplier with limit 500
  await dbRun(db,
    "UPDATE suppliers SET payment_terms = 'credit', credit_days = 30, credit_limit = 500 WHERE id = 2");
});

afterAll(async () => { await closeDb(db); });

const PO_ITEMS = [{ product_id: 1, quantity: 2, cost_price: 100 }];

async function createPO(supplierId, totalCost = 200) {
  return makeRequest(app, ADMIN_ID)
    .post("/api/purchase-orders")
    .send({
      supplier_id: supplierId,
      total_cost: totalCost,
      items: PO_ITEMS,
    });
}

describe("POST /api/purchase-orders — credit limit warning", () => {
  it("cash supplier: no warning field in response", async () => {
    const res = await createPO(1, 200);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.warning).toBeUndefined();
  });

  it("credit supplier under limit: no warning field in response", async () => {
    // limit=500, no outstanding, PO total=200 → 0+200=200 < 500
    const res = await createPO(2, 200);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.warning).toBeUndefined();
  });

  it("credit supplier over limit: 200 response with warning field", async () => {
    // Insert an unpaid invoice to build up outstanding balance of 350
    await dbRun(db,
      "INSERT INTO supplier_invoices (supplier_id, invoice_number, amount, status) VALUES (2, 'INV-TEST', 350, 'unpaid')");
    // Now PO total=200 → outstanding(350)+200=550 > limit(500)
    const res = await createPO(2, 200);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.warning).toMatch(/credit limit/i);
  });

  it("credit supplier with credit_limit=0 (unlimited): no warning", async () => {
    // Each test file gets its own in-memory DB — no teardown needed between tests in this file
    await dbRun(db,
      "UPDATE suppliers SET credit_limit = 0 WHERE id = 2");
    await dbRun(db,
      "INSERT INTO supplier_invoices (supplier_id, invoice_number, amount, status) VALUES (2, 'INV-TEST2', 9999, 'unpaid')");
    const res = await createPO(2, 999);
    expect(res.status).toBe(200);
    expect(res.body.warning).toBeUndefined();
  });
});
