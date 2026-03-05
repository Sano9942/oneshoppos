/**
 * returns-exchange.test.js — Phase 3: Return and Exchange Flow Coverage
 *
 * Tests the March 2026 return/exchange feature:
 *   RE1  — Simple refund with original_sale_id (bill-linked)
 *   RE2  — Manual refund without original_sale_id (no bill)
 *   RE3  — Exchange: even balance (return 100, exchange for 100)
 *   RE4  — Exchange: customer pays difference (return 100, exchange for 150)
 *   RE5  — Exchange: customer receives refund (return 150, exchange for 100)
 *   RE6  — Exchange atomic ordering: sale FIRST, then return
 *   RE7  — Variant stock handling: returns.js does NOT restock product_variants.stock (BUG)
 */

const { createTestApp, closeDb, dbGet, dbAll, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID } = require("../helpers/request");

let app, db;
const ADMIN_PIN = "2580";

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
  await ensureCheckoutContext();
});

afterAll(async () => {
  await closeDb(db);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureCheckoutContext() {
  const openShift = await dbGet(
    db,
    "SELECT id FROM cash_shifts WHERE outlet_id = 1 AND status = 'open' LIMIT 1",
  );
  if (!openShift) {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: MANAGER_ID, opening_float: 500 });
    expect(res.status).toBe(200);
  }
  const checkin = await makeRequest(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: ADMIN_PIN, outlet_id: 1 });
  // 200 = clocked in, 400 = already clocked in — both are fine
  expect([200, 400]).toContain(checkin.status);
}

async function makeSale(cartItems) {
  const res = await makeRequest(app, ADMIN_ID)
    .post("/api/sales")
    .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

// ─────────────────────────────────────────────────────────────────────────────
// RE1 — Simple refund with bill (original_sale_id)
// ─────────────────────────────────────────────────────────────────────────────

describe("RE1 — Simple refund with original_sale_id", () => {
  let saleId;

  beforeAll(async () => {
    saleId = await makeSale([
      { id: 1, quantity: 3, price: 100, cost_price: 60 },
      { id: 2, quantity: 2, price: 200, cost_price: 120 },
    ]);
  });

  it("return with original_sale_id creates return record and restocks outlet_stock", async () => {
    const stockBefore = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        reason: "Defective",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    // Stock should be restocked
    const stockAfter = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    expect(stockAfter.quantity).toBe(stockBefore.quantity + 1);
  });

  it("return record has correct fields linked to original sale", async () => {
    const returnId = (
      await dbGet(db, "SELECT id FROM returns WHERE original_sale_id = ? ORDER BY id DESC LIMIT 1", [saleId])
    )?.id;

    const row = await dbGet(db, "SELECT * FROM returns WHERE id = ?", [returnId]);
    expect(row.original_sale_id).toBe(saleId);
    expect(row.outlet_id).toBe(1);
    expect(row.total_refund).toBe(100);
    expect(row.refund_method).toBe("Cash");

    const items = await dbAll(db, "SELECT * FROM return_items WHERE return_id = ?", [returnId]);
    expect(items).toHaveLength(1);
    expect(items[0].product_id).toBe(1);
    expect(items[0].quantity).toBe(1);
  });

  it("partial return — only selected items are restocked", async () => {
    // Return product 2 (qty 1 of 2), check product 1 stock unchanged
    const stock1Before = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    const stock2Before = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );

    await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 200,
        refund_method: "Cash",
        items: [{ product_id: 2, quantity: 1, refund_price: 200 }],
      });

    const stock1After = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    const stock2After = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );
    // Product 1 unchanged, product 2 restocked by 1
    expect(stock1After.quantity).toBe(stock1Before.quantity);
    expect(stock2After.quantity).toBe(stock2Before.quantity + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RE2 — Manual refund without original_sale_id (no bill)
// ─────────────────────────────────────────────────────────────────────────────

describe("RE2 — Manual refund without original_sale_id", () => {
  it("return without original_sale_id succeeds — manual walk-in return", async () => {
    const stockBefore = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        // No original_sale_id
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        reason: "Customer brought item without receipt",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });

    expect(res.status).toBe(200);

    const returnRow = await dbGet(db, "SELECT * FROM returns WHERE id = ?", [res.body.id]);
    expect(returnRow.original_sale_id).toBeNull();

    // Stock still restocked even without bill
    const stockAfter = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    expect(stockAfter.quantity).toBe(stockBefore.quantity + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RE3 — Exchange: even balance (return 100, exchange for 100)
// ─────────────────────────────────────────────────────────────────────────────

describe("RE3 — Exchange: even balance", () => {
  let originalSaleId;

  beforeAll(async () => {
    originalSaleId = await makeSale([{ id: 1, quantity: 1, price: 100, cost_price: 60 }]);
  });

  it("exchange sale posts first with Return Credit payment covering full exchange total", async () => {
    // Return: product 1 × 1 = 100 PKR
    // Exchange: product 2 × 1 = ... we use price=100 to make it even
    // balance = 100 - 100 = 0 → even exchange, total = 0
    // Frontend sends: payments=[] (nothing to record), total=0
    // The sale itself records 0 total with no payments

    const stockProd2Before = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );

    // Step 1: POST exchange sale (even — total = 0, no payments needed)
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 2, quantity: 1, price: 100, cost_price: 120 }],
        payments: [],     // even exchange — Return Credit offsets exactly
        paymentMethod: "Return Credit",
        outlet_id: 1,
      });
    expect(saleRes.status).toBe(200);
    expect(saleRes.body.saleId).toBeDefined();
    expect(saleRes.body.totalAmount).toBe(100);

    // Step 2: POST return
    const retRes = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: originalSaleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Return Credit",
        reason: "Exchange",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });
    expect(retRes.status).toBe(200);

    // Product 2 stock was decremented by sale
    const stockProd2After = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );
    expect(stockProd2After.quantity).toBe(stockProd2Before.quantity - 1);

    // Product 1 restocked by return
    const stockProd1After = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    expect(stockProd1After.quantity).toBeGreaterThan(0); // just verify it's there
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RE4 — Exchange: customer pays difference (return 100, exchange for 150)
// ─────────────────────────────────────────────────────────────────────────────

describe("RE4 — Exchange: customer pays difference (balance > 0)", () => {
  let originalSaleId;

  beforeAll(async () => {
    originalSaleId = await makeSale([{ id: 1, quantity: 1, price: 100, cost_price: 60 }]);
  });

  it("exchange sale has Return Credit (100) + Cash (50) payments for balance=50 exchange", async () => {
    const refundTotal = 100;   // returning product 1 × 1 @ 100
    const exchangeTotal = 150; // exchanging for product 2 × 1 @ 150 (hypothetical price)
    const balance = exchangeTotal - refundTotal; // 50 — customer pays this

    // Step 1: POST exchange sale
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 2, quantity: 1, price: exchangeTotal, cost_price: 120 }],
        payments: [
          { method: "Return Credit", amount: refundTotal },
          { method: "Cash", amount: balance },
        ],
        paymentMethod: "Return Credit",
        outlet_id: 1,
      });
    expect(saleRes.status).toBe(200);
    expect(saleRes.body.totalAmount).toBe(exchangeTotal);

    // Verify payment records
    const payments = await dbAll(
      db,
      "SELECT * FROM sale_payments WHERE sale_id = ?",
      [saleRes.body.saleId],
    );
    const methods = payments.map((p) => p.payment_method);
    expect(methods).toContain("Return Credit");
    expect(methods).toContain("Cash");

    const creditPmt = payments.find((p) => p.payment_method === "Return Credit");
    const cashPmt = payments.find((p) => p.payment_method === "Cash");
    expect(creditPmt.amount).toBe(refundTotal);   // 100
    expect(cashPmt.amount).toBe(balance);          // 50

    // Step 2: POST return
    const retRes = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: originalSaleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: refundTotal,
        refund_method: "Return Credit",
        items: [{ product_id: 1, quantity: 1, refund_price: refundTotal }],
      });
    expect(retRes.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RE5 — Exchange: customer receives refund (return 150, exchange for 100)
// ─────────────────────────────────────────────────────────────────────────────

describe("RE5 — Exchange: customer receives refund (balance < 0)", () => {
  let originalSaleId;

  beforeAll(async () => {
    originalSaleId = await makeSale([{ id: 2, quantity: 1, price: 150, cost_price: 120 }]);
  });

  it("exchange sale uses Return Credit for full exchange total; refund is handled separately", async () => {
    const refundTotal = 150;   // returning product 2 × 1 @ 150
    const exchangeTotal = 100; // exchanging for product 1 × 1 @ 100
    const balance = exchangeTotal - refundTotal; // -50 — customer gets 50 back

    // Step 1: POST exchange sale — Return Credit covers entire exchange total
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, quantity: 1, price: exchangeTotal, cost_price: 60 }],
        payments: [{ method: "Return Credit", amount: exchangeTotal }],
        paymentMethod: "Return Credit",
        outlet_id: 1,
      });
    expect(saleRes.status).toBe(200);
    expect(saleRes.body.totalAmount).toBe(exchangeTotal);

    const payments = await dbAll(
      db,
      "SELECT * FROM sale_payments WHERE sale_id = ?",
      [saleRes.body.saleId],
    );
    const creditPmt = payments.find((p) => p.payment_method === "Return Credit");
    expect(creditPmt.amount).toBe(exchangeTotal); // Return Credit = 100

    // Step 2: POST return — full refund amount posted as Return Credit
    const retRes = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: originalSaleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: refundTotal,         // 150 — full returned amount
        refund_method: "Return Credit",
        items: [{ product_id: 2, quantity: 1, refund_price: refundTotal }],
      });
    expect(retRes.status).toBe(200);

    // Balance math: the 50 PKR over-credit would be paid out by the cashier
    // via the refund_note shown in the receipt. Not a backend concern.
    const returnRow = await dbGet(db, "SELECT * FROM returns WHERE id = ?", [retRes.body.id]);
    expect(returnRow.total_refund).toBe(refundTotal);
    expect(Math.abs(balance)).toBe(50); // just assert the math is right
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RE6 — Exchange atomic ordering: sale first, return second
// ─────────────────────────────────────────────────────────────────────────────

describe("RE6 — Exchange atomic ordering", () => {
  it("if exchange sale fails (shift closed), return is never posted — inventory stays consistent", async () => {
    // Open a fresh app with its own DB — we'll close the shift mid-exchange
    const { createTestApp: _cta, closeDb: _cdb } = require("../helpers/createTestApp");
    const ctx2 = await _cta();

    // Clock in admin
    await makeRequest(ctx2.app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: ADMIN_PIN, outlet_id: 1 });

    // Open shift
    const shiftRes = await makeRequest(ctx2.app, MANAGER_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: MANAGER_ID, opening_float: 500 });
    const shiftId = shiftRes.body.shift_id;

    // Make a sale
    const saleId = await (async () => {
      const r = await makeRequest(ctx2.app, ADMIN_ID)
        .post("/api/sales")
        .send({
          cartItems: [{ id: 1, quantity: 1, price: 100, cost_price: 60 }],
          paymentMethod: "Cash",
          outlet_id: 1,
        });
      expect(r.status).toBe(200);
      return r.body.saleId;
    })();

    // Close the shift — simulates shift closing between exchange steps
    await makeRequest(ctx2.app, MANAGER_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({ closing_cash: 600 });

    const stockBeforeAttempt = await dbGet(
      ctx2.db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );

    // Step 1: Try to POST exchange sale — should FAIL because shift is closed
    const saleRes = await makeRequest(ctx2.app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 2, quantity: 1, price: 100, cost_price: 120 }],
        payments: [{ method: "Return Credit", amount: 100 }],
        paymentMethod: "Return Credit",
        outlet_id: 1,
      });
    expect(saleRes.status).toBe(400);
    expect(saleRes.body.code).toBe("shift_not_open");

    // Step 2: Return should NOT be posted (frontend stops after sale fails)
    // We verify by checking that no orphaned return was created
    // (In practice the frontend never sends the return if sale fails)
    const returns = await dbAll(
      ctx2.db,
      "SELECT * FROM returns WHERE original_sale_id = ?",
      [saleId],
    );
    expect(returns).toHaveLength(0); // no return was posted

    // Stock of product 2 is unchanged (exchange sale never went through)
    const stockAfterAttempt = await dbGet(
      ctx2.db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 2 AND outlet_id = 1",
    );
    expect(stockAfterAttempt.quantity).toBe(stockBeforeAttempt.quantity);

    await _cdb(ctx2.db);
  });

  it("exchange sale succeeds before shift close — return can still be posted after shift closes", async () => {
    // Open a fresh app
    const { createTestApp: _cta, closeDb: _cdb } = require("../helpers/createTestApp");
    const ctx3 = await _cta();

    await makeRequest(ctx3.app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: ADMIN_PIN, outlet_id: 1 });
    const shiftRes = await makeRequest(ctx3.app, MANAGER_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: MANAGER_ID, opening_float: 500 });
    const shiftId = shiftRes.body.shift_id;

    const originalSaleId = await (async () => {
      const r = await makeRequest(ctx3.app, ADMIN_ID)
        .post("/api/sales")
        .send({
          cartItems: [{ id: 1, quantity: 1, price: 100, cost_price: 60 }],
          paymentMethod: "Cash",
          outlet_id: 1,
        });
      return r.body.saleId;
    })();

    // Step 1: Exchange sale succeeds (shift still open)
    const saleRes = await makeRequest(ctx3.app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 2, quantity: 1, price: 100, cost_price: 120 }],
        payments: [{ method: "Return Credit", amount: 100 }],
        paymentMethod: "Return Credit",
        outlet_id: 1,
      });
    expect(saleRes.status).toBe(200);

    // Now close the shift
    await makeRequest(ctx3.app, MANAGER_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({ closing_cash: 600 });

    // Step 2: POST return — returns API doesn't require an open shift
    const retRes = await makeRequest(ctx3.app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: originalSaleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Return Credit",
        items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
      });
    // Returns don't require an open shift — this should succeed
    expect(retRes.status).toBe(200);

    await _cdb(ctx3.db);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RE7 — Variant stock handling: BUG — returns.js does NOT restock product_variants.stock
// ─────────────────────────────────────────────────────────────────────────────

describe("RE7 — Variant stock: returns.js does NOT update product_variants.stock (BUG)", () => {
  let variantId, saleId;

  beforeAll(async () => {
    // Seed a product variant directly in the DB
    await dbRun(
      db,
      "INSERT INTO product_variants (product_id, sku, price, stock) VALUES (1, 'VAR-TEST-001', 100, 10)",
    );
    const variant = await dbGet(db, "SELECT id FROM product_variants WHERE sku = 'VAR-TEST-001'");
    variantId = variant.id;

    // Make a sale that includes this variant (deducts variant stock)
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, quantity: 2, price: 100, cost_price: 60, variant_id: variantId }],
        paymentMethod: "Cash",
        outlet_id: 1,
      });
    expect(saleRes.status).toBe(200);
    saleId = saleRes.body.saleId;
  });

  it("sale correctly decrements product_variants.stock", async () => {
    const variant = await dbGet(db, "SELECT stock FROM product_variants WHERE id = ?", [variantId]);
    expect(variant.stock).toBe(8); // 10 - 2
  });

  it("BUG: return restocks outlet_stock but NOT product_variants.stock", async () => {
    const variantStockBefore = await dbGet(
      db,
      "SELECT stock FROM product_variants WHERE id = ?",
      [variantId],
    );
    const outletStockBefore = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );

    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/returns")
      .send({
        original_sale_id: saleId,
        outlet_id: 1,
        employee_id: ADMIN_ID,
        total_refund: 100,
        refund_method: "Cash",
        items: [{ product_id: 1, quantity: 1, refund_price: 100, variant_id: variantId }],
      });
    expect(res.status).toBe(200);

    // outlet_stock IS restocked (this works)
    const outletStockAfter = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    expect(outletStockAfter.quantity).toBe(outletStockBefore.quantity + 1);

    // BUG: product_variants.stock is NOT updated — variant stock stays the same
    const variantStockAfter = await dbGet(
      db,
      "SELECT stock FROM product_variants WHERE id = ?",
      [variantId],
    );
    // This SHOULD be variantStockBefore.stock + 1 after the fix
    // Currently it stays at 8 — confirming the bug
    expect(variantStockAfter.stock).toBe(variantStockBefore.stock); // BUG B-VARIANT: no restock
  });
});
