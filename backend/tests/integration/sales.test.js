/**
 * sales.test.js — POST /api/sales, GET /api/sales, PUT /api/sales/:id/void
 *
 * PORTED FROM SQLITE 2026-08-02 (see security.test.js for the full rationale).
 * Originally targeted B1 (hasError race), B2 (negative stock), B3 (wallet
 * overdraft); those regression guards are preserved verbatim in intent.
 *
 * THE PORT HAZARD IN THIS FILE IS TYPES, NOT SQL.
 *
 * node-postgres returns NUMERIC columns as STRINGS to avoid float64 precision
 * loss. Several columns this file asserts on are NUMERIC:
 *
 *   outlet_stock.quantity    NUMERIC(10,3)   -> "10.000"
 *   customers.balance        NUMERIC(12,2)   -> "500.00"
 *   sale_items.price_at_sale NUMERIC(12,2)   -> "100.00"
 *
 * The SQLite original did arithmetic straight off these ("stockBefore.quantity
 * - 2"). Left alone that becomes string arithmetic — "10.000" - 2 happens to
 * coerce to 8 in JS, but "10.000" === 10 is false, so toBe() comparisons fail
 * or, worse, pass for the wrong reason. Every numeric read goes through num().
 *
 * sales.voided is BOOLEAN in Postgres, not the 0/1 integer SQLite stored.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";

/** Coerce a pg NUMERIC (string) to a number. Null/undefined pass through. */
function num(v) {
  return v === null || v === undefined ? v : Number(v);
}

async function one(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows[0];
}

async function all(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

/**
 * The sale path gained an open-shift requirement after these tests were written
 * (this is the documented cause of the pg-batch2/3/8 fixture failures — see
 * memory: stale_pg_batch_fixtures). Satisfy it explicitly rather than letting
 * checkout 400 for a reason unrelated to what each test is asserting.
 */
async function ensureCheckoutContext(outletId = 1) {
  const openShift = await one(
    "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' LIMIT 1",
    [outletId]
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
  if (![200, 400].includes(attendanceRes.status)) {
    throw new Error(`Unexpected attendance status ${attendanceRes.status}`);
  }
}

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
  beforeEach(async () => {
    await ensureCheckoutContext(1);
  });

  it("single cash checkout creates sale, items, payments, deducts stock", async () => {
    const stockBefore = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
    );

    const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send(basicSale());

    expect(res.status).toBe(200);
    expect(res.body.saleId).toBeDefined();
    expect(res.body.totalAmount).toBe(200); // 2 * 100

    const items = await all("SELECT * FROM sale_items WHERE sale_id = $1", [res.body.saleId]);
    expect(items).toHaveLength(1);
    expect(num(items[0].quantity)).toBe(2);
    expect(num(items[0].price_at_sale)).toBe(100);

    const payments = await all("SELECT * FROM sale_payments WHERE sale_id = $1", [
      res.body.saleId,
    ]);
    expect(payments).toHaveLength(1);
    expect(payments[0].payment_method).toBe("Cash");

    const stockAfter = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
    );
    expect(num(stockAfter.quantity)).toBe(num(stockBefore.quantity) - 2);
  });

  it("checkout with percent discount calculates total correctly", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [{ id: 2, quantity: 1, price: 200, cost_price: 120 }],
          discount_amount: 10,
          discount_type: "percent",
        })
      );

    expect(res.status).toBe(200);
    // subtotal=200, discount=20 (10%), total=180
    expect(res.body.totalAmount).toBe(180);
  });

  it("checkout with fixed discount calculates total correctly", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [{ id: 2, quantity: 1, price: 200, cost_price: 120 }],
          discount_amount: 50,
          discount_type: "fixed",
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.totalAmount).toBe(150); // 200 - 50
  });

  it("split payment records multiple sale_payments", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
          payments: [
            { method: "Cash", amount: 30 },
            { method: "Card", amount: 20 },
          ],
        })
      );

    expect(res.status).toBe(200);

    const sale = await one("SELECT * FROM sales WHERE id = $1", [res.body.saleId]);
    expect(sale.payment_method).toBe("Split");

    const payments = await all("SELECT * FROM sale_payments WHERE sale_id = $1", [
      res.body.saleId,
    ]);
    expect(payments).toHaveLength(2);
  });

  it("checkout with customer earns loyalty points", async () => {
    const before = await one("SELECT loyalty_points FROM customers WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
          customer_id: 1,
          points_earned: 10,
        })
      );

    expect(res.status).toBe(200);

    const after = await one("SELECT loyalty_points FROM customers WHERE id = 1");
    expect(num(after.loyalty_points)).toBe(num(before.loyalty_points) + 10);
  });

  it("checkout with points_redeemed decreases loyalty points", async () => {
    const before = await one("SELECT loyalty_points FROM customers WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
          customer_id: 1,
          points_redeemed: 5,
        })
      );

    expect(res.status).toBe(200);
    /**
     * EXPECTATION CORRECTED DURING THE PORT — 45 -> 49.5.
     *
     * The SQLite original asserted 50 - 5 = 45, i.e. one point redeems for one
     * unit of currency. That was the H3 defect: points_redeemed is a POINTS
     * COUNT and was being subtracted from the total as if it were money.
     *
     * It is now converted through company_profile.loyalty_redeem_rate, which is
     * "currency off per 100 points" and defaults to 10 (schema-pg.sql:1273). So
     * 5 points = 5/100 * 10 = 0.50 off, and the total is 49.5.
     *
     * Restoring 45 would mean restoring a bug that let a customer discount a
     * sale by their whole points balance. The points deduction itself is
     * asserted below and is unchanged — 5 points still leave the balance.
     */
    expect(res.body.totalAmount).toBe(49.5);

    const after = await one("SELECT loyalty_points FROM customers WHERE id = 1");
    expect(num(after.loyalty_points)).toBe(num(before.loyalty_points) - 5);
  });

  it("checkout with Wallet payment debits customer balance and creates ledger entry", async () => {
    const before = await one("SELECT balance FROM customers WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [{ id: 5, quantity: 1, price: 75, cost_price: 45 }],
          customer_id: 1,
          payments: [{ method: "Wallet", amount: 75 }],
        })
      );

    expect(res.status).toBe(200);

    const after = await one("SELECT balance FROM customers WHERE id = 1");
    expect(num(after.balance)).toBe(num(before.balance) - 75);

    const ledger = await all(
      "SELECT * FROM customer_wallet_ledger WHERE customer_id = 1 AND reference_id = $1",
      [res.body.saleId]
    );
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
    // Zod validate() now rejects before the route's own check, so the message is
    // the generic coercion failure rather than one naming outlet_id. 400 is the
    // contract; regex widened, not dropped (see auth.test.js for the same case).
    expect(res.body.error).toMatch(/outlet|invalid/i);
  });

  it("invoice number has correct format INV-{year}-{seq}", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({ cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }] }));

    expect(res.status).toBe(200);
    expect(res.body.invoiceNumber).toMatch(/^INV-\d{6}-\d{3,}$/); // D64: INV-yymmdd-001
  });

  // --- Bug-finding tests ---

  it("B2 fix: checkout qty exceeding stock is rejected", async () => {
    const stockBefore = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1"
    );

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [
            { id: 3, quantity: num(stockBefore.quantity) + 10, price: 500, cost_price: 300 },
          ],
        })
      );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_stock");

    const stockAfter = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1"
    );
    expect(num(stockAfter.quantity)).toBe(num(stockBefore.quantity));
  });

  it("B3 fix: Wallet payment exceeding balance is rejected", async () => {
    await db.query("UPDATE customers SET balance = 50 WHERE id = 1");

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(
        basicSale({
          cartItems: [{ id: 4, quantity: 1, price: 200, cost_price: 30 }],
          customer_id: 1,
          payments: [{ method: "Wallet", amount: 200 }],
        })
      );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("insufficient_wallet");

    const after = await one("SELECT balance FROM customers WHERE id = 1");
    expect(num(after.balance)).toBe(50);
  });
});

describe("GET /api/sales — List & Detail", () => {
  beforeAll(async () => {
    await ensureCheckoutContext(1);
    await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({ cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }] }));
  });

  // These four sent no auth header in the SQLite original — incidentally, not as
  // the thing under test. Every data-returning GET requires auth now, so they
  // carry ADMIN_ID. Anonymous access is asserted deliberately in rbac.test.js.
  it("returns paginated sales", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/sales?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.sales).toBeDefined();
    expect(Array.isArray(res.body.sales)).toBe(true);
    expect(num(res.body.page)).toBe(1);
    expect(num(res.body.total)).toBeGreaterThan(0);
  });

  it("date range filter excludes out-of-range sales", async () => {
    const res = await makeRequest(app, ADMIN_ID).get(
      "/api/sales?date_from=2099-01-01&date_to=2099-12-31"
    );
    expect(res.status).toBe(200);
    expect(res.body.sales).toHaveLength(0);
  });

  it("GET /api/sales/:id returns sale with items and payments", async () => {
    const allSales = await all("SELECT id FROM sales LIMIT 1");
    const saleId = allSales[0].id;

    const res = await makeRequest(app, ADMIN_ID).get(`/api/sales/${saleId}`);
    expect(res.status).toBe(200);
    expect(res.body.sale).toBeDefined();
    expect(res.body.items).toBeDefined();
    expect(res.body.payments).toBeDefined();
  });

  it("GET /api/sales/:id with nonexistent ID returns 404", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/sales/99999");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/sales/:id/void — Void Sale", () => {
  let saleToVoid;

  beforeAll(async () => {
    await ensureCheckoutContext(1);
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({ cartItems: [{ id: 5, quantity: 2, price: 75, cost_price: 45 }] }));
    saleToVoid = res.body.saleId;
  });

  it("void restores stock and marks sale voided", async () => {
    const stockBefore = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1"
    );

    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleToVoid}/void`)
      .send({ void_reason: "Customer requested cancellation" });

    expect(res.status).toBe(200);

    const sale = await one("SELECT * FROM sales WHERE id = $1", [saleToVoid]);
    // BOOLEAN in Postgres — the SQLite original asserted the integer 1.
    expect(sale.voided).toBe(true);
    expect(sale.void_reason).toBe("Customer requested cancellation");

    const stockAfter = await one(
      "SELECT quantity FROM outlet_stock WHERE product_id = 5 AND outlet_id = 1"
    );
    expect(num(stockAfter.quantity)).toBe(num(stockBefore.quantity) + 2);
  });

  it("double void returns 400", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleToVoid}/void`)
      .send({ void_reason: "Try again" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already voided/i);
  });

  it("void without reason returns 400", async () => {
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send(basicSale({ cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }] }));

    const res = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleRes.body.saleId}/void`)
      .send({});

    expect(res.status).toBe(400);
    // Same Zod-before-route case as above.
    expect(res.body.error).toMatch(/void_reason|invalid/i);
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
      .send(basicSale({ cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }] }));

    const res = await makeRequest(app, CASHIER_ID)
      .put(`/api/sales/${saleRes.body.saleId}/void`)
      .send({ void_reason: "Test" });

    expect(res.status).toBe(403);
  });
});
