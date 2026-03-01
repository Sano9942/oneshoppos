/**
 * sales.test.js — Integration tests for POST /api/sales, GET /api/sales, PUT /api/sales/:id/void
 *
 * Targets bugs: B1 (hasError race), B2 (negative stock), B3 (wallet overdraft)
 */

const { createTestApp, closeDb, dbAll, dbGet, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

// Helper: make a basic cash sale
function basicSale(overrides = {}) {
  return {
    cartItems: [{ id: 1, quantity: 2, price: 100, cost_price: 60 }],
    paymentMethod: "Cash",
    outlet_id: 1,
    employee_id: ADMIN_ID,
    ...overrides,
  };
}

describe("POST /api/sales — Checkout", () => {
  it("single cash checkout creates sale, items, payments, deducts stock", async () => {
    const stockBefore = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale());

    expect(res.status).toBe(200);
    expect(res.body.saleId).toBeDefined();
    expect(res.body.totalAmount).toBe(200); // 2 * 100

    // sale_items row
    const items = await dbAll(db, "SELECT * FROM sale_items WHERE sale_id = ?", [res.body.saleId]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].price_at_sale).toBe(100);

    // sale_payments row
    const payments = await dbAll(db, "SELECT * FROM sale_payments WHERE sale_id = ?", [res.body.saleId]);
    expect(payments).toHaveLength(1);
    expect(payments[0].payment_method).toBe("Cash");

    // Stock deducted
    const stockAfter = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1");
    expect(stockAfter.quantity).toBe(stockBefore.quantity - 2);
  });

  it("checkout with percent discount calculates total correctly", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 2, quantity: 1, price: 200, cost_price: 120 }],
        discount_amount: 10,
        discount_type: "percent",
      }));

    expect(res.status).toBe(200);
    // subtotal=200, discount=20 (10%), total=180
    expect(res.body.totalAmount).toBe(180);
  });

  it("checkout with fixed discount calculates total correctly", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 2, quantity: 1, price: 200, cost_price: 120 }],
        discount_amount: 50,
        discount_type: "fixed",
      }));

    expect(res.status).toBe(200);
    expect(res.body.totalAmount).toBe(150); // 200 - 50
  });

  it("split payment records multiple sale_payments", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
        payments: [
          { method: "Cash", amount: 30 },
          { method: "Card", amount: 20 },
        ],
      }));

    expect(res.status).toBe(200);

    const sale = await dbGet(db, "SELECT * FROM sales WHERE id = ?", [res.body.saleId]);
    expect(sale.payment_method).toBe("Split");

    const payments = await dbAll(db, "SELECT * FROM sale_payments WHERE sale_id = ?", [res.body.saleId]);
    expect(payments).toHaveLength(2);
  });

  it("checkout with customer earns loyalty points", async () => {
    const before = await dbGet(db, "SELECT loyalty_points FROM customers WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
        customer_id: 1,
        points_earned: 10,
      }));

    expect(res.status).toBe(200);

    const after = await dbGet(db, "SELECT loyalty_points FROM customers WHERE id = 1");
    expect(after.loyalty_points).toBe(before.loyalty_points + 10);
  });

  it("checkout with points_redeemed decreases loyalty points", async () => {
    const before = await dbGet(db, "SELECT loyalty_points FROM customers WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
        customer_id: 1,
        points_redeemed: 5,
      }));

    expect(res.status).toBe(200);
    // total = 50 - 5 (points_redeemed subtracted from total)
    expect(res.body.totalAmount).toBe(45);

    const after = await dbGet(db, "SELECT loyalty_points FROM customers WHERE id = 1");
    expect(after.loyalty_points).toBe(before.loyalty_points - 5);
  });

  it("checkout with Wallet payment debits customer balance and creates ledger entry", async () => {
    const before = await dbGet(db, "SELECT balance FROM customers WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 5, quantity: 1, price: 75, cost_price: 45 }],
        customer_id: 1,
        payments: [{ method: "Wallet", amount: 75 }],
      }));

    expect(res.status).toBe(200);

    const after = await dbGet(db, "SELECT balance FROM customers WHERE id = 1");
    expect(after.balance).toBe(before.balance - 75);

    const ledger = await dbAll(db, "SELECT * FROM customer_wallet_ledger WHERE customer_id = 1 AND reference_id = ?", [res.body.saleId]);
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    expect(ledger[0].type).toBe("debit");
  });

  it("empty cart returns 400", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({ cartItems: [], outlet_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty/i);
  });

  it("missing outlet_id returns 400", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({ cartItems: [{ id: 1, quantity: 1, price: 100 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outlet/i);
  });

  it("invoice number has correct format INV-{year}-{seq}", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
      }));

    expect(res.status).toBe(200);
    expect(res.body.invoiceNumber).toMatch(/^INV-\d{4}-\d{5}$/);
  });

  // --- Bug-finding tests ---

  it("BUG B2: checkout qty exceeding stock succeeds — creates negative outlet_stock", async () => {
    // Widget A has limited stock. Sell way more than available.
    // First check current stock
    const stockBefore = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 3, quantity: stockBefore.quantity + 10, price: 500, cost_price: 300 }],
      }));

    // BUG: B2 — No WHERE quantity >= ? guard, so this succeeds
    expect(res.status).toBe(200);

    const stockAfter = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1");
    // BUG: B2 — Stock goes negative
    expect(stockAfter.quantity).toBe(-10);
  });

  it("BUG B3: Wallet payment exceeding balance succeeds — overdrafts to negative", async () => {
    // Give customer a known balance
    await dbRun(db, "UPDATE customers SET balance = 50 WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 4, quantity: 1, price: 200, cost_price: 30 }],
        customer_id: 1,
        payments: [{ method: "Wallet", amount: 200 }],
      }));

    // BUG: B3 — No balance check, sale succeeds
    expect(res.status).toBe(200);

    const after = await dbGet(db, "SELECT balance FROM customers WHERE id = 1");
    // BUG: B3 — Balance goes negative (50 - 200 = -150)
    expect(after.balance).toBe(-150);
  });
});

describe("GET /api/sales — List & Detail", () => {
  it("returns paginated sales", async () => {
    const res = await makeRequest(app).get("/api/sales?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.sales).toBeDefined();
    expect(Array.isArray(res.body.sales)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it("date range filter excludes out-of-range sales", async () => {
    const res = await makeRequest(app).get("/api/sales?date_from=2099-01-01&date_to=2099-12-31");
    expect(res.status).toBe(200);
    expect(res.body.sales).toHaveLength(0);
  });

  it("GET /api/sales/:id returns sale with items and payments", async () => {
    // Use a sale we created above
    const allSales = await dbAll(db, "SELECT id FROM sales LIMIT 1");
    const saleId = allSales[0].id;

    const res = await makeRequest(app).get(`/api/sales/${saleId}`);
    expect(res.status).toBe(200);
    expect(res.body.sale).toBeDefined();
    expect(res.body.items).toBeDefined();
    expect(res.body.payments).toBeDefined();
  });

  it("GET /api/sales/:id with nonexistent ID returns 404", async () => {
    const res = await makeRequest(app).get("/api/sales/99999");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/sales/:id/void — Void Sale", () => {
  let saleToVoid;

  beforeAll(async () => {
    // Create a fresh sale to void
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 5, quantity: 2, price: 75, cost_price: 45 }],
      }));
    saleToVoid = res.body.saleId;
  });

  it("void restores stock and marks sale voided", async () => {
    const stockBefore = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleToVoid}/void`)
      .send({ void_reason: "Customer requested cancellation" });

    expect(res.status).toBe(200);

    const sale = await dbGet(db, "SELECT * FROM sales WHERE id = ?", [saleToVoid]);
    expect(sale.voided).toBe(1);
    expect(sale.void_reason).toBe("Customer requested cancellation");

    const stockAfter = await dbGet(db, "SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1");
    expect(stockAfter.quantity).toBe(stockBefore.quantity + 2);
  });

  it("double void returns 400", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleToVoid}/void`)
      .send({ void_reason: "Try again" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already voided/i);
  });

  it("void without reason returns 400", async () => {
    // Create another sale to test
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
      }));

    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleRes.body.saleId}/void`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/void_reason/i);
  });

  it("void nonexistent sale returns 404", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put("/api/sales/99999/void")
      .send({ void_reason: "Test" });

    expect(res.status).toBe(404);
  });

  it("cashier without void_sales permission is blocked", async () => {
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
      }));

    const res = await makeRequest(app, CASHIER_ID)
      .put(`/api/sales/${saleRes.body.saleId}/void`)
      .send({ void_reason: "Test" });

    expect(res.status).toBe(403);
  });
});
