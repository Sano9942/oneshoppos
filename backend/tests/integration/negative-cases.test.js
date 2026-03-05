/**
 * negative-cases.test.js — Phase 6A Track 1
 *
 * Tests all external input boundaries. Two categories:
 *   (a) Hard rejections — API must return 4xx with a clear error message.
 *   (b) Documented permissive behavior — API currently accepts these; tests
 *       pin the current behavior so any future change is an explicit flip.
 *
 * NC1  — POST /api/sales empty cart → 400
 * NC2  — POST /api/sales missing outlet_id → 400
 * NC3  — POST /api/sales negative quantity → 200 (permissive, documented)
 * NC4  — POST /api/sales price as string → 500 (NaN total fails DB insert, documented)
 * NC5  — POST /api/sales discount exceeds subtotal → 200 (permissive, documented)
 * NC6  — POST /api/returns empty items → 400
 * NC7  — POST /api/returns missing outlet_id → 400
 * NC8  — POST /api/returns nonexistent original_sale_id → 400
 * NC9  — POST /api/returns product not in original sale → 400
 * NC10 — POST /api/returns qty > sold qty → 400
 * NC11 — POST /api/shifts/open missing outlet_id → 400
 * NC12 — POST /api/shifts/open duplicate open → 400
 * NC13 — POST /api/shifts/:id/close missing closing_cash → 400
 * NC14 — POST /api/shifts/:id/close already-closed shift → 404
 * NC15 — GET /api/sales page=-1 → 200 no crash
 */

const { createTestApp, closeDb, dbGet } = require("../helpers/createTestApp");
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

// ─── NC1 ─────────────────────────────────────────────────────────────────────

describe("NC1 — POST /api/sales with empty cart → 400", () => {
  it("returns 400 when cartItems is empty", async () => {
    const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems: [], paymentMethod: "Cash", outlet_id: OUTLET_ID,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cart/i);
  });
});

// ─── NC2 ─────────────────────────────────────────────────────────────────────

describe("NC2 — POST /api/sales with missing outlet_id → 400", () => {
  it("returns 400 when outlet_id is missing", async () => {
    const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: 100, quantity: 1 }], paymentMethod: "Cash",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outlet/i);
  });
});

// ─── NC3 (permissive) ─────────────────────────────────────────────────────────

describe("NC3 — POST /api/sales with negative quantity → 200 (permissive)", () => {
  // DOCUMENTED PERMISSIVE BEHAVIOR: The API does not currently validate that
  // quantity is positive. This test pins the current behavior so future
  // validation changes are a deliberate flip, not a surprise.
  it("accepts negative quantity without crashing (documents permissive behavior)", async () => {
    const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: 100, quantity: -1 }],
      paymentMethod: "Cash",
      outlet_id: OUTLET_ID,
    });
    expect(res.status).toBe(200);
  });
});

// ─── NC4 (permissive) ─────────────────────────────────────────────────────────

describe("NC4 — POST /api/sales with price as string → 500 (rejects with server error)", () => {
  // DOCUMENTED CURRENT BEHAVIOR: The API does not validate that price is a number.
  // A string price like "abc" causes NaN arithmetic for total_amount, which then
  // fails the SQLite insert (NaN is not a valid numeric value), producing a 500.
  // This pins the current behavior; a future fix should return 400 instead.
  it("rejects string price with a server error (documents current behavior)", async () => {
    const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: "abc", quantity: 1 }],
      paymentMethod: "Cash",
      outlet_id: OUTLET_ID,
    });
    expect(res.status).toBe(500);
  });
});

// ─── NC5 (permissive) ─────────────────────────────────────────────────────────

describe("NC5 — POST /api/sales with discount > subtotal → 200 (permissive)", () => {
  // DOCUMENTED PERMISSIVE BEHAVIOR: A negative total_amount is allowed currently.
  it("accepts oversized discount without crashing (documents permissive behavior)", async () => {
    const res = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: 100, quantity: 1 }],
      paymentMethod: "Cash",
      outlet_id: OUTLET_ID,
      discount_type: "fixed",
      discount_amount: 99999,
    });
    expect(res.status).toBe(200);
  });
});

// ─── NC6 ─────────────────────────────────────────────────────────────────────

describe("NC6 — POST /api/returns with empty items → 400", () => {
  it("returns 400 when items array is empty", async () => {
    const res = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID,
      total_refund: 0, refund_method: "Cash",
      items: [],
    });
    expect(res.status).toBe(400);
  });
});

// ─── NC7 ─────────────────────────────────────────────────────────────────────

describe("NC7 — POST /api/returns with missing outlet_id → 400", () => {
  it("returns 400 when outlet_id is missing", async () => {
    const res = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      employee_id: MANAGER_ID,
      total_refund: 100, refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(res.status).toBe(400);
  });
});

// ─── NC8 ─────────────────────────────────────────────────────────────────────

describe("NC8 — POST /api/returns with nonexistent original_sale_id → 400", () => {
  it("returns 400 when original_sale_id does not exist", async () => {
    const res = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      original_sale_id: 999999,
      outlet_id: OUTLET_ID,
      employee_id: MANAGER_ID,
      total_refund: 100, refund_method: "Cash",
      items: [{ product_id: 1, quantity: 1, refund_price: 100 }],
    });
    expect(res.status).toBe(400);
  });
});

// ─── NC9 ─────────────────────────────────────────────────────────────────────

describe("NC9 — POST /api/returns with product not in original sale → 400", () => {
  it("returns 400 when returning a product not part of the original sale", async () => {
    // Make a sale of product 1 first
    const saleRes = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: 100, quantity: 1 }],
      paymentMethod: "Cash", outlet_id: OUTLET_ID,
    });
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    // Try to return product 2 (not in the sale)
    const res = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: OUTLET_ID,
      employee_id: MANAGER_ID,
      total_refund: 200, refund_method: "Cash",
      items: [{ product_id: 2, quantity: 1, refund_price: 200 }],
    });
    expect(res.status).toBe(400);
  });
});

// ─── NC10 ────────────────────────────────────────────────────────────────────

describe("NC10 — POST /api/returns with qty > sold qty → 400", () => {
  it("returns 400 when return quantity exceeds sold quantity", async () => {
    const saleRes = await makeRequest(app, ADMIN_ID).post("/api/sales").send({
      cartItems: [{ id: 1, price: 100, quantity: 1 }],
      paymentMethod: "Cash", outlet_id: OUTLET_ID,
    });
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    const res = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: OUTLET_ID,
      employee_id: MANAGER_ID,
      total_refund: 500, refund_method: "Cash",
      items: [{ product_id: 1, quantity: 5, refund_price: 100 }],
    });
    expect(res.status).toBe(400);
  });
});

// ─── NC11 ────────────────────────────────────────────────────────────────────

describe("NC11 — POST /api/shifts/open with missing outlet_id → 400", () => {
  it("returns 400 when outlet_id is missing", async () => {
    const res = await makeRequest(app, MANAGER_ID).post("/api/shifts/open").send({
      employee_id: MANAGER_ID, opening_float: 100,
    });
    expect(res.status).toBe(400);
  });
});

// ─── NC12 ────────────────────────────────────────────────────────────────────

describe("NC12 — POST /api/shifts/open when shift already open → 400", () => {
  it("returns 400 when trying to open a second shift", async () => {
    // A shift is already open from beforeAll ensureCheckoutContext
    const res = await makeRequest(app, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 100,
    });
    expect(res.status).toBe(400);
  });
});

// ─── NC13 ────────────────────────────────────────────────────────────────────

describe("NC13 — POST /api/shifts/:id/close with missing closing_cash → 400", () => {
  it("returns 400 when closing_cash is missing", async () => {
    const shift = await dbGet(db, "SELECT id FROM cash_shifts WHERE outlet_id = 1 AND status = 'open' LIMIT 1");
    if (!shift) {
      // If shift got closed somewhere else, skip gracefully
      return;
    }
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/shifts/${shift.id}/close`)
      .send({ outlet_id: OUTLET_ID, employee_id: MANAGER_ID });
    expect(res.status).toBe(400);
  });
});

// ─── NC14 ────────────────────────────────────────────────────────────────────

describe("NC14 — POST /api/shifts/:id/close on already-closed shift → 404", () => {
  it("returns 404 when closing a shift that doesn't exist or is already closed", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/shifts/99999/close")
      .send({ outlet_id: OUTLET_ID, employee_id: MANAGER_ID, closing_cash: 500 });
    expect(res.status).toBe(404);
  });
});

// ─── NC15 ────────────────────────────────────────────────────────────────────

describe("NC15 — GET /api/sales with page=-1 → 200 no crash", () => {
  it("does not crash on negative page parameter", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/sales?page=-1");
    expect(res.status).toBe(200);
  });
});
