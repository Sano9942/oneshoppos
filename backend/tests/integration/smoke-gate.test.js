/**
 * smoke-gate.test.js — Sequential daily operations smoke suite (T1-T5)
 *
 * Validates the complete daily business cycle in order:
 *   T1 → Login & role session bootstrap
 *   T2 → Kiosk check-in / attendance lifecycle
 *   T3 → Shift open gate enforcement
 *   T4 → POS checkout with precondition enforcement (gates + happy path)
 *   T5 → Shift close and cash reconciliation
 *
 * Tests share a single app + DB because the cycle is inherently sequential.
 * Run with: npm run test:smoke
 */

const { createTestApp, closeDb, dbGet, dbAll, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db;

const ADMIN_PIN   = "2580";
const MANAGER_PIN = "2222";
const CASHIER_PIN = "3333";

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db  = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

// ─────────────────────────────────────────────────────────────────────────────
// T1 — Login and Role Session Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 — Login and Role Session Bootstrap", () => {
  it("Admin login returns employee + all_access permission", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: ADMIN_PIN });

    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(1);
    expect(res.body.permissions).toContain("all_access");
  });

  it("Manager login returns manager permissions (no all_access)", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Manager User", pin: MANAGER_PIN });

    expect(res.status).toBe(200);
    expect(res.body.permissions).not.toContain("all_access");
    expect(res.body.permissions).toContain("manage_orders");
    expect(res.body.permissions).toContain("manage_inventory");
  });

  it("Cashier login returns limited permissions", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Cashier User", pin: CASHIER_PIN });

    expect(res.status).toBe(200);
    expect(res.body.permissions).not.toContain("manage_orders");
    expect(res.body.permissions).not.toContain("manage_inventory");
    expect(res.body.permissions).toContain("view_reports");
  });

  it("Context bootstrap — admin sees all outlets", async () => {
    const res = await makeRequest(app, ADMIN_ID).get("/api/context/bootstrap");

    expect(res.status).toBe(200);
    expect(res.body.employee).toBeDefined();
    expect(res.body.outlets).toBeDefined();
    expect(res.body.outlets.length).toBeGreaterThanOrEqual(2); // Main Store + Branch Store
    expect(res.body.scope_mode_default).toBe("all_branches");
    expect(res.body.allowed_outlet_ids).toBeDefined();
    expect(res.body.primary_outlet_id).toBeDefined();
  });

  it("Context bootstrap — manager sees only assigned outlets (outlet 1)", async () => {
    const res = await makeRequest(app, MANAGER_ID).get("/api/context/bootstrap");

    expect(res.status).toBe(200);
    expect(res.body.scope_mode_default).toBe("single_branch");
    expect(res.body.outlets.length).toBe(1); // Only outlet 1 (from employee_outlets seed)
    expect(res.body.outlets[0].id).toBe(1);
  });

  it("Context bootstrap — no auth returns 401", async () => {
    const res = await makeRequest(app).get("/api/context/bootstrap");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — Kiosk Check-In and Attendance Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 — Kiosk Check-In and Attendance Lifecycle", () => {
  it("PIN status shows employee by PIN", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-status")
      .send({ pin_code: ADMIN_PIN, outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.employee).toBeDefined();
    expect(res.body.employee.name).toBe("Hassan");
  });

  it("PIN check-in succeeds for employee assigned to outlet", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: ADMIN_PIN, outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/welcome/i);
    expect(res.body.session).toBeDefined();
  });

  it("PIN check-in returns 400 if already clocked in (idempotency check)", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: ADMIN_PIN, outlet_id: 1 });

    // Already clocked in — should get an error indicating already checked in
    expect(res.status).toBe(400);
  });

  it("Outlet assignment rejection — employee not assigned to outlet 2 gets 403", async () => {
    // Manager (ID 2) is only in employee_outlets for outlet 1
    const res = await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: MANAGER_PIN, outlet_id: 2 });

    expect(res.status).toBe(403);
  });

  it("Manager can check in at their assigned outlet", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: MANAGER_PIN, outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(MANAGER_ID);
  });

  it("Cashier can check in at outlet 1", async () => {
    const res = await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: CASHIER_PIN, outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(CASHIER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — Shift Open Gate Enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 — Shift Open Gate Enforcement", () => {
  it("Cashier cannot open shift — 403", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: CASHIER_ID, opening_float: 500 });

    expect(res.status).toBe(403);
  });

  it("Manager can open shift", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: MANAGER_ID, opening_float: 500 });

    expect(res.status).toBe(200);
    expect(res.body.shift_id).toBeDefined();
  });

  it("GET /api/shifts/active returns the open shift", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .get("/api/shifts/active?outlet_id=1");

    expect(res.status).toBe(200);
    expect(res.body.shift).toBeDefined();
    expect(res.body.shift.status).toBe("open");
    expect(res.body.shift.outlet_id).toBe(1);
    expect(res.body.shift.opening_float).toBe(500);
  });

  it("Double-open rejected — cannot open second shift while one is open", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: MANAGER_ID, opening_float: 0 });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — POS Checkout With Precondition Enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 — POS Checkout With Precondition Enforcement", () => {
  const cartItems = [{ id: 1, quantity: 2, price: 100, cost_price: 60 }];

  it("Sale blocked when employee is not clocked in — code: employee_not_clocked_in", async () => {
    // Create a fresh test app with a new DB where no one is clocked in
    // but a shift IS open — to test the attendance gate specifically
    const { createTestApp: _cta, closeDb: _cdb } = require("../helpers/createTestApp");
    const ctx2 = await _cta();

    // Open a shift first
    await makeRequest(ctx2.app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: 0 });

    // Try to sell without clocking in
    const res = await makeRequest(ctx2.app, ADMIN_ID)
      .post("/api/sales")
      .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("employee_not_clocked_in");
    await _cdb(ctx2.db);
  });

  it("Sale blocked when no shift is open — code: shift_not_open", async () => {
    // Fresh app — nothing seeded yet, no shift, no checkin
    const { createTestApp: _cta, closeDb: _cdb } = require("../helpers/createTestApp");
    const ctx3 = await _cta();

    // Clock in but DO NOT open shift
    await makeRequest(ctx3.app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: ADMIN_PIN, outlet_id: 1 });

    const res = await makeRequest(ctx3.app, ADMIN_ID)
      .post("/api/sales")
      .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("shift_not_open");
    await _cdb(ctx3.db);
  });

  it("Sale succeeds when shift is open AND employee is clocked in", async () => {
    // Main shared context (T2 clocked in Admin; T3 opened shift)
    const stockBefore = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );

    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.saleId).toBeDefined();
    expect(res.body.invoiceNumber).toMatch(/INV-/);
    expect(res.body.totalAmount).toBe(200); // 2 × 100

    // Verify stock deducted
    const stockAfter = await dbGet(
      db,
      "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1",
    );
    expect(stockAfter.quantity).toBe(stockBefore.quantity - 2);
  });

  it("Cashier (no manage_orders) can still complete a sale", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post("/api/sales")
      .send({ cartItems, paymentMethod: "Cash", outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.saleId).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Shift Close and Cash Reconciliation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 — Shift Close and Cash Reconciliation", () => {
  let shiftId;

  beforeAll(async () => {
    const shift = await dbGet(
      db,
      "SELECT id FROM cash_shifts WHERE outlet_id = 1 AND status = 'open' LIMIT 1",
    );
    shiftId = shift?.id;
  });

  it("Cashier cannot close shift — 403", async () => {
    const res = await makeRequest(app, CASHIER_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({ closing_cash: 700 });

    expect(res.status).toBe(403);
  });

  it("Manager can close shift with reconciliation data", async () => {
    // Sales made in T4: 2 sales × 200 PKR = 400 PKR cash (opening_float was 500)
    // expected_cash = 500 (opening) + 400 (cash sales) = 900
    const closingCash = 900;

    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({
        closing_cash: closingCash,
        variance_reason: "Counted and verified",
      });

    expect(res.status).toBe(200);
  });

  it("Closed shift appears as 'closed' in history", async () => {
    const shift = await dbGet(
      db,
      "SELECT status, closing_cash FROM cash_shifts WHERE id = ?",
      [shiftId],
    );

    expect(shift.status).toBe("closed");
    expect(shift.closing_cash).toBe(900);
  });

  it("Cannot re-open or re-close an already-closed shift", async () => {
    const res = await makeRequest(app, MANAGER_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({ closing_cash: 900 });

    // Should fail — shift is already closed
    expect(res.status).not.toBe(200);
  });

  it("Cannot make a sale after shift is closed — code: shift_not_open", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, quantity: 1, price: 100, cost_price: 60 }],
        paymentMethod: "Cash",
        outlet_id: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("shift_not_open");
  });
});
