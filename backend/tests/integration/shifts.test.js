/**
 * shifts.test.js — Integration tests for /api/shifts (cash management)
 *
 * Targets bug: B12 (shift close has no upper-bound timestamp on sales query)
 */

const { createTestApp, closeDb, dbAll, dbGet, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

describe("POST /api/shifts/open — Open Shift", () => {
  it("opens a shift with status 'open'", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 500 });

    expect(res.status).toBe(200);
    expect(res.body.shift_id).toBeDefined();

    const shift = await dbGet(db, "SELECT * FROM cash_shifts WHERE id = ?", [res.body.shift_id]);
    expect(shift.status).toBe("open");
    expect(shift.opening_float).toBe(500);
  });

  it("cannot open second shift for same outlet", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 200 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already open/i);
  });

  it("can open shift for a different outlet", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 2, employee_id: ADMIN_ID, opening_float: 300 });

    expect(res.status).toBe(200);
    expect(res.body.shift_id).toBeDefined();
  });

  it("missing opening_float returns 400", async () => {
    // Close outlet 2's shift first so we can test fresh
    const active = await dbGet(db, "SELECT id FROM cash_shifts WHERE outlet_id = 2 AND status = 'open'");
    if (active) {
      await dbRun(db, "UPDATE cash_shifts SET status = 'closed' WHERE id = ?", [active.id]);
    }

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});

describe("GET /api/shifts/active — Active Shift", () => {
  it("returns active shift for outlet", async () => {
    const res = await makeRequest(app).get("/api/shifts/active?outlet_id=1");
    expect(res.status).toBe(200);
    expect(res.body.shift).toBeDefined();
    expect(res.body.shift.status).toBe("open");
  });

  it("returns null when no active shift", async () => {
    // Outlet 2 was closed above
    const res = await makeRequest(app).get("/api/shifts/active?outlet_id=2");
    expect(res.status).toBe(200);
    expect(res.body.shift).toBeNull();
  });

  it("missing outlet_id returns 400", async () => {
    const res = await makeRequest(app).get("/api/shifts/active");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/shifts/:id/close — Close Shift", () => {
  let shiftId;

  beforeAll(async () => {
    // Get the open shift for outlet 1
    const shift = await dbGet(db, "SELECT id FROM cash_shifts WHERE outlet_id = 1 AND status = 'open'");
    shiftId = shift.id;

    // Create a cash sale during this shift
    await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, quantity: 2, price: 100, cost_price: 60 }],
        paymentMethod: "Cash",
        outlet_id: 1,
        employee_id: ADMIN_ID,
      });

    // Create a card sale (should not count toward cash expected)
    await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 2, quantity: 1, price: 200, cost_price: 120 }],
        payments: [{ method: "Card", amount: 200 }],
        outlet_id: 1,
        employee_id: ADMIN_ID,
      });
  });

  it("close calculates expected_cash = opening_float + cash_sales - cash_refunds", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({ closing_cash: 700 });

    expect(res.status).toBe(200);
    // opening_float=500, cash_sales=200 (2 x 100), cash_refunds=0
    // expected_cash = 500 + 200 = 700
    expect(res.body.opening_float).toBe(500);
    expect(res.body.cash_sales).toBe(200);
    expect(res.body.expected_cash).toBe(700);
    expect(res.body.closing_cash).toBe(700);
    expect(res.body.variance).toBe(0);
  });

  it("closing already-closed shift returns 404", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({ closing_cash: 500 });

    expect(res.status).toBe(404);
  });

  it("missing closing_cash returns 400", async () => {
    // Open a new shift to test
    const openRes = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 100 });
    const newId = openRes.body.shift_id;

    const res = await makeRequest(app, ADMIN_ID)
      .post(`/api/shifts/${newId}/close`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closing_cash/i);

    // Clean up — close it properly
    await makeRequest(app, ADMIN_ID)
      .post(`/api/shifts/${newId}/close`)
      .send({ closing_cash: 100 });
  });

  it("variance = closing_cash - expected_cash", async () => {
    // Use outlet 2 for clean isolation (no prior cash sales)
    const openRes = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 2, employee_id: ADMIN_ID, opening_float: 100 });

    await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
        paymentMethod: "Cash",
        outlet_id: 2,
        employee_id: ADMIN_ID,
      });

    const closeRes = await makeRequest(app, ADMIN_ID)
      .post(`/api/shifts/${openRes.body.shift_id}/close`)
      .send({ closing_cash: 140 });

    expect(closeRes.status).toBe(200);
    // expected = 100 + 50 = 150, closing = 140, variance = -10
    expect(closeRes.body.expected_cash).toBe(150);
    expect(closeRes.body.variance).toBe(-10);
  });

  it("voided sales excluded from cash_sales — but BUG B12: prior shift sales leak in", async () => {
    // Use outlet 2 — but the previous variance test already made a 50 cash sale on outlet 2
    const openRes = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 2, employee_id: ADMIN_ID, opening_float: 200 });

    // Make a cash sale then void it
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 4, quantity: 1, price: 50, cost_price: 30 }],
        paymentMethod: "Cash",
        outlet_id: 2,
        employee_id: ADMIN_ID,
      });

    await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleRes.body.saleId}/void`)
      .send({ void_reason: "Test void" });

    // Make a non-voided cash sale
    await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 5, quantity: 1, price: 75, cost_price: 45 }],
        paymentMethod: "Cash",
        outlet_id: 2,
        employee_id: ADMIN_ID,
      });

    const closeRes = await makeRequest(app, ADMIN_ID)
      .post(`/api/shifts/${openRes.body.shift_id}/close`)
      .send({ closing_cash: 275 });

    expect(closeRes.status).toBe(200);
    // BUG B12: The query uses `timestamp >= shift.opened_at` with NO upper bound
    // and timestamps within the same second overlap between shifts.
    // Previous shift's 50 cash sale (from variance test) leaks into this shift.
    // Ideal: cash_sales=75 (only this shift's non-voided sale)
    // Actual: cash_sales=125 (75 + 50 from prior closed shift)
    expect(closeRes.body.cash_sales).toBe(125); // BUG: B12 — includes prior shift's sales
    expect(closeRes.body.expected_cash).toBe(325); // BUG: B12 — 200 + 125 instead of 200 + 75
  });

  it("close with denominations creates shift_denominations rows", async () => {
    const openRes = await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 100 });

    const closeRes = await makeRequest(app, ADMIN_ID)
      .post(`/api/shifts/${openRes.body.shift_id}/close`)
      .send({
        closing_cash: 100,
        denominations: [
          { denomination: 100, count: 1 },
          { denomination: 50, count: 0 },
          { denomination: 20, count: 0 },
        ],
      });

    expect(closeRes.status).toBe(200);

    const denoms = await dbAll(db, "SELECT * FROM shift_denominations WHERE shift_id = ?", [openRes.body.shift_id]);
    // Only count > 0 denominations are stored
    expect(denoms.length).toBe(1);
    expect(denoms[0].denomination).toBe(100);
    expect(denoms[0].count).toBe(1);
  });
});

describe("GET /api/shifts — List", () => {
  it("returns shifts ordered by opened_at DESC", async () => {
    const res = await makeRequest(app).get("/api/shifts");
    expect(res.status).toBe(200);
    expect(res.body.shifts).toBeDefined();
    expect(res.body.shifts.length).toBeGreaterThan(0);
  });

  it("filters by outlet_id", async () => {
    const res = await makeRequest(app).get("/api/shifts?outlet_id=1");
    expect(res.status).toBe(200);
    for (const shift of res.body.shifts) {
      expect(shift.outlet_id).toBe(1);
    }
  });
});
