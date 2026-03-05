/**
 * returns.test.js — Integration tests for POST /api/returns, GET /api/returns
 *
 * Targets bug: B16 (no validation that returned items belong to original sale)
 */

const { createTestApp, closeDb, dbAll, dbGet, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db;
const ADMIN_PIN = "2580";

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

async function ensureCheckoutContext(outletId = 1) {
  const openShift = await dbGet(
    db,
    "SELECT id FROM cash_shifts WHERE outlet_id = ? AND status = 'open' LIMIT 1",
    [outletId],
  );
  if (!openShift) {
    const openRes = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: outletId, employee_id: ADMIN_ID, opening_float: 500 });
    expect(openRes.status).toBe(200);
  }
  const attendanceRes = await makeRequest(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: ADMIN_PIN, outlet_id: outletId });
  expect([200, 400]).toContain(attendanceRes.status);
}

// Helper: create a sale first, then return against it
async function createSaleForReturn() {
  await ensureCheckoutContext(1);
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/sales")
    .send({
      cartItems: [
        { id: 1, quantity: 3, price: 100, cost_price: 60 },
        { id: 2, quantity: 2, price: 200, cost_price: 120 },
      ],
      paymentMethod: "Cash",
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

describe("POST /api/returns — Create Return", () => {
  let saleId;

  beforeAll(async () => {
    saleId = await createSaleForReturn();
  });

  it("return restocks outlet_stock for each product", async () => {
    const stockBefore = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        reason: "Defective item",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    const stockAfter = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");
    expect(stockAfter.quantity).toBe(stockBefore.quantity + 1);
  });

  it("creates returns + return_items records with correct data", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 200,
        refund_method: "Cash",
        reason: "Wrong item",
        items: [{ product_id: 2, quantity: 1, refund_price: 200 }],
      });

    expect(res.status).toBe(200);

    const returnRow = await dbGet(db, "SELECT * FROM returns WHERE id = ?", [res.body.id]);
    expect(returnRow.total_refund).toBe(200);
    expect(returnRow.refund_method).toBe("Cash");
    expect(returnRow.original_sale_id).toBe(saleId);

    const returnItems = await dbAll(db, "SELECT * FROM return_items WHERE return_id = ?", [res.body.id]);
    expect(returnItems).toHaveLength(1);
    expect(returnItems[0].product_id).toBe(2);
    expect(returnItems[0].quantity).toBe(1);
  });

  it("missing outlet_id returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        total_refund: 100,
        refund_method: "Cash",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outlet/i);
  });

  it("empty items array returns 400", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        total_refund: 0,
        refund_method: "Cash",
        items: [],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items/i);
  });

  it("return with product NOT in original sale is rejected — 400 (B16 fixed)", async () => {
    // Product 4 was never in the sale (only products 1 & 2 were)
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 50,
        refund_method: "Cash",
        reason: "Returning product not in sale",
        items: [{ product_id: 4, quantity: 1, refund_price: 50 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not part of the original sale/i);
  });

  it("return qty exceeding sold qty is rejected — 400 (B16 fixed)", async () => {
    // Original sale had qty=3 of product 1, try to return 10
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 1000,
        refund_method: "Cash",
        reason: "Returning more than sold",
        items: [{ product_id: 1, quantity: 10, refund_price: 100 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds sold quantity/i);
  });

  it("cashier without manage_orders permission is blocked from returns (PERMISSION_RULES: manage_orders)", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        total_refund: 100,
        refund_method: "Cash",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/returns — List & Detail", () => {
  it("GET /api/returns returns list of returns", async () => {
    const res = await makeRequest(app).get("/api/returns");
    expect(res.status).toBe(200);
    expect(res.body.returns).toBeDefined();
    expect(Array.isArray(res.body.returns)).toBe(true);
    expect(res.body.returns.length).toBeGreaterThan(0);
  });

  it("GET /api/returns with date filter excludes out-of-range", async () => {
    const res = await makeRequest(app).get("/api/returns?date_from=2099-01-01&date_to=2099-12-31");
    expect(res.status).toBe(200);
    expect(res.body.returns).toHaveLength(0);
  });

  it("GET /api/returns/:id returns detail with items", async () => {
    const allReturns = await dbAll(db, "SELECT id FROM returns LIMIT 1");
    const returnId = allReturns[0].id;

    const res = await makeRequest(app).get(`/api/returns/${returnId}`);
    expect(res.status).toBe(200);
    expect(res.body.returnData).toBeDefined();
    expect(res.body.items).toBeDefined();
  });
});
