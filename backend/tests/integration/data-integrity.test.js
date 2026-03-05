/**
 * data-integrity.test.js — Phase 6A Track 3
 *
 * Verifies outlet_stock, product_variants, and sales stay in sync
 * across all three write paths: sale, return, void.
 *
 * DI1 — Sell 3 units → outlet_stock decremented by 3
 * DI2 — Sell 3 → return 2 → outlet_stock net -1
 * DI3 — Sell variant → both outlet_stock AND product_variants.stock decremented
 * DI4 — Return variant → both tables restocked
 * DI5 — Void a sale → outlet_stock restored to pre-sale level
 * DI6 — Sell → return → dashboard revenue = sale - refund
 * DI7 — Sell → sales-summary report → sale in both summary and detail
 * DI8 — Manual return (no original_sale_id) → stock still restocked
 */

const { createTestApp, closeDb, dbGet, dbAll, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID } = require("../helpers/request");

const OUTLET_ID = 1;
const ADMIN_PIN = "2580";

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
  await ensureCheckoutContext();
});

afterAll(async () => {
  await closeDb(db);
});

async function ensureCheckoutContext() {
  const openShift = await dbGet(db, "SELECT id FROM cash_shifts WHERE outlet_id = 1 AND status = 'open' LIMIT 1");
  if (!openShift) {
    const res = await makeRequest(app, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 500,
    });
    expect(res.status).toBe(200);
  }
  const checkin = await makeRequest(app).post("/api/attendance/pin-checkin").send({
    pin_code: ADMIN_PIN, outlet_id: OUTLET_ID,
  });
  expect([200, 400]).toContain(checkin.status);
}

async function makeSale(cartItems) {
  const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
    cartItems, paymentMethod: "Cash", outlet_id: OUTLET_ID,
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

async function getOutletStock(productId) {
  const row = await dbGet(db,
    "SELECT quantity FROM outlet_stock WHERE product_id = ? AND outlet_id = ?",
    [productId, OUTLET_ID],
  );
  return row?.quantity ?? null;
}

// ─── DI1 ─────────────────────────────────────────────────────────────────────

describe("DI1 — Sale decrements outlet_stock", () => {
  it("selling 3 units of PROD-001 decrements outlet_stock by 3", async () => {
    const before = await getOutletStock(1);

    await makeSale([{ id: 1, price: 100, quantity: 3 }]);

    const after = await getOutletStock(1);
    expect(after).toBe(before - 3);
  });
});

// ─── DI2 ─────────────────────────────────────────────────────────────────────

describe("DI2 — Return restocks outlet_stock (net -1)", () => {
  it("sell 3 then return 2 → net stock change is -1", async () => {
    const before = await getOutletStock(2);

    const saleId = await makeSale([{ id: 2, price: 200, quantity: 3 }]);

    const returnRes = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: OUTLET_ID,
      employee_id: MANAGER_ID,
      total_refund: 400,
      refund_method: "Cash",
      items: [{ product_id: 2, quantity: 2, refund_price: 200 }],
    });
    expect(returnRes.status).toBe(200);

    const after = await getOutletStock(2);
    expect(after).toBe(before - 1);
  });
});

// ─── DI5 ─────────────────────────────────────────────────────────────────────

describe("DI5 — Void restores outlet_stock", () => {
  it("voiding a sale restores outlet_stock to pre-sale level", async () => {
    const before = await getOutletStock(3);

    const saleId = await makeSale([{ id: 3, price: 500, quantity: 2 }]);

    const mid = await getOutletStock(3);
    expect(mid).toBe(before - 2);

    const voidRes = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleId}/void`)
      .send({ void_reason: "Test void for DI5" });
    expect(voidRes.status).toBe(200);

    const after = await getOutletStock(3);
    expect(after).toBe(before);
  });
});

// ─── DI8 ─────────────────────────────────────────────────────────────────────

describe("DI8 — Manual return (no original_sale_id) still restocks", () => {
  it("manual return without bill ID restocks outlet_stock", async () => {
    const before = await getOutletStock(4);

    const returnRes = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      outlet_id: OUTLET_ID,
      employee_id: MANAGER_ID,
      total_refund: 50,
      refund_method: "Cash",
      items: [{ product_id: 4, quantity: 3, refund_price: 50 }],
    });
    expect(returnRes.status).toBe(200);

    const after = await getOutletStock(4);
    expect(after).toBe(before + 3);
  });
});

// ─── DI3/DI4 — Variant stock ──────────────────────────────────────────────────

async function seedVariant(variantDb) {
  // Insert a variant for product 1 with 5 units of stock
  await dbRun(variantDb,
    "INSERT OR IGNORE INTO product_variants (id, product_id, sku, stock, price) VALUES (10, 1, 'PROD-001-M', 5, 100)"
  );
}

describe("DI3 — Sale decrements both outlet_stock AND product_variants.stock", () => {
  it("selling a variant decrements both outlet_stock and product_variants.stock", async () => {
    const ctx = await createTestApp();
    const varApp = ctx.app;
    const varDb = ctx.db;
    await seedVariant(varDb);

    // Open shift + clock in for this isolated db
    await makeRequest(varApp, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 500,
    });
    await makeRequest(varApp).post("/api/attendance/pin-checkin").send({
      pin_code: ADMIN_PIN, outlet_id: OUTLET_ID,
    });

    const outletBefore = await dbGet(varDb,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = ?", [OUTLET_ID]);
    const variantBefore = await dbGet(varDb,
      "SELECT stock FROM product_variants WHERE id = 10");

    const saleRes = await makeRequest(varApp, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: 100, quantity: 2, variant_id: 10 }],
      paymentMethod: "Cash",
      outlet_id: OUTLET_ID,
    });
    expect(saleRes.status).toBe(200);

    const outletAfter = await dbGet(varDb,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = ?", [OUTLET_ID]);
    const variantAfter = await dbGet(varDb,
      "SELECT stock FROM product_variants WHERE id = 10");

    expect(outletAfter.quantity).toBe(outletBefore.quantity - 2);
    expect(variantAfter.stock).toBe(variantBefore.stock - 2);

    await closeDb(varDb);
  });
});

describe("DI4 — Return restocks both outlet_stock AND product_variants.stock", () => {
  it("returning a variant restocks both tables symmetrically", async () => {
    const ctx = await createTestApp();
    const varApp = ctx.app;
    const varDb = ctx.db;
    await seedVariant(varDb);

    await makeRequest(varApp, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 500,
    });
    await makeRequest(varApp).post("/api/attendance/pin-checkin").send({
      pin_code: ADMIN_PIN, outlet_id: OUTLET_ID,
    });

    // Sell 1 variant unit first
    const saleRes = await makeRequest(varApp, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: 100, quantity: 1, variant_id: 10 }],
      paymentMethod: "Cash",
      outlet_id: OUTLET_ID,
    });
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    const outletMid = await dbGet(varDb,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = ?", [OUTLET_ID]);
    const variantMid = await dbGet(varDb,
      "SELECT stock FROM product_variants WHERE id = 10");

    // Return it
    const returnRes = await makeRequest(varApp, MANAGER_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: OUTLET_ID,
      employee_id: MANAGER_ID,
      total_refund: 100,
      refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100, variant_id: 10 }],
    });
    expect(returnRes.status).toBe(200);

    const outletAfter = await dbGet(varDb,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = ?", [OUTLET_ID]);
    const variantAfter = await dbGet(varDb,
      "SELECT stock FROM product_variants WHERE id = 10");

    expect(outletAfter.quantity).toBe(outletMid.quantity + 1);
    expect(variantAfter.stock).toBe(variantMid.stock + 1);

    await closeDb(varDb);
  });
});
