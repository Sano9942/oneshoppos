/**
 * auditability.test.js — Phase 6A Track 4
 *
 * Verifies sensitive operations leave a complete, correct paper trail in the DB.
 *
 * AU1 — Void sale → sales.voided=1, void_reason set, sale_items NOT deleted
 * AU2 — Open shift → cash_shifts row has correct outlet_id, employee_id, opening_float, opened_at
 * AU3 — Close shift → cash_shifts.status='closed', closing_cash, closed_at all stored
 * AU4 — Open with denominations → shift_denominations rows with stage='opening'
 * AU5 — Close with denominations → shift_denominations rows with stage='closing'
 * AU6 — Return linked to bill → returns.original_sale_id set, return_items rows exist
 * AU7 — Manual return → returns.original_sale_id IS NULL, return_items still exist
 * AU8 — Re-void attempt → 400, original void_reason unchanged
 */

const { createTestApp, closeDb, dbGet, dbAll } = require("../helpers/createTestApp");
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

// ─── AU1 ─────────────────────────────────────────────────────────────────────

describe("AU1 — Void sale leaves audit trail", () => {
  it("voided sale has voided=1, void_reason set, sale_items still present", async () => {
    const saleId = await makeSale([{ id: 1, price: 100, quantity: 1 }]);

    await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleId}/void`)
      .send({ void_reason: "AU1 test void" })
      .expect(200);

    const sale = await dbGet(db, "SELECT voided, void_reason FROM sales WHERE id = ?", [saleId]);
    expect(sale.voided).toBe(1);
    expect(sale.void_reason).toBe("AU1 test void");

    const items = await dbAll(db, "SELECT id FROM sale_items WHERE sale_id = ?", [saleId]);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ─── AU2 ─────────────────────────────────────────────────────────────────────

describe("AU2 — Open shift stores complete record", () => {
  it("shift record has correct outlet_id, employee_id, opening_float, and opened_at", async () => {
    // Use a fresh isolated DB so we can open a new shift
    const ctx2 = await createTestApp();
    const app2 = ctx2.app;
    const db2 = ctx2.db;

    // Clock in for admin in this isolated DB
    await makeRequest(app2).post("/api/attendance/pin-checkin").send({
      pin_code: ADMIN_PIN, outlet_id: OUTLET_ID,
    });

    const res = await makeRequest(app2, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 750,
    });
    expect(res.status).toBe(200);

    // The open shift endpoint returns { message, shift_id }
    const shiftId = res.body.shift_id;
    const shift = await dbGet(db2, "SELECT * FROM cash_shifts WHERE id = ?", [shiftId]);

    expect(Number(shift.outlet_id)).toBe(OUTLET_ID);
    expect(Number(shift.employee_id)).toBe(MANAGER_ID);
    expect(Number(shift.opening_float)).toBe(750);
    expect(shift.opened_at).toBeTruthy();
    expect(shift.status).toBe("open");

    await closeDb(db2);
  });
});

// ─── AU3 ─────────────────────────────────────────────────────────────────────

describe("AU3 — Close shift stores complete record", () => {
  it("closed shift has status=closed, closing_cash, and closed_at all stored", async () => {
    const ctx2 = await createTestApp();
    const app2 = ctx2.app;
    const db2 = ctx2.db;

    // Clock in
    await makeRequest(app2).post("/api/attendance/pin-checkin").send({
      pin_code: ADMIN_PIN, outlet_id: OUTLET_ID,
    });

    const openRes = await makeRequest(app2, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 500,
    });
    expect(openRes.status).toBe(200);
    const shiftId = openRes.body.shift_id;

    const closeRes = await makeRequest(app2, MANAGER_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({ outlet_id: OUTLET_ID, employee_id: MANAGER_ID, closing_cash: 600 });
    expect(closeRes.status).toBe(200);

    const shift = await dbGet(db2, "SELECT * FROM cash_shifts WHERE id = ?", [shiftId]);
    expect(shift.status).toBe("closed");
    expect(Number(shift.closing_cash)).toBe(600);
    expect(shift.closed_at).toBeTruthy();

    await closeDb(db2);
  });
});

// ─── AU4 ─────────────────────────────────────────────────────────────────────

describe("AU4 — Opening denominations stored", () => {
  it("shift_denominations rows with stage=opening are created when opening with denominations", async () => {
    const ctx2 = await createTestApp();
    const app2 = ctx2.app;
    const db2 = ctx2.db;

    await makeRequest(app2).post("/api/attendance/pin-checkin").send({
      pin_code: ADMIN_PIN, outlet_id: OUTLET_ID,
    });

    const openRes = await makeRequest(app2, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 500,
      denominations: [
        { denomination: 100, count: 3 },
        { denomination: 50, count: 4 },
      ],
    });
    expect(openRes.status).toBe(200);
    const shiftId = openRes.body.shift_id;

    const denoms = await dbAll(db2,
      "SELECT stage, denomination, count FROM shift_denominations WHERE shift_id = ? AND stage = 'opening'",
      [shiftId],
    );
    expect(denoms.length).toBeGreaterThanOrEqual(2);
    const d100 = denoms.find(d => Number(d.denomination) === 100);
    expect(d100).toBeTruthy();
    expect(Number(d100.count)).toBe(3);

    await closeDb(db2);
  });
});

// ─── AU5 ─────────────────────────────────────────────────────────────────────

describe("AU5 — Closing denominations stored", () => {
  it("shift_denominations rows with stage=closing are created when closing with denominations", async () => {
    const ctx2 = await createTestApp();
    const app2 = ctx2.app;
    const db2 = ctx2.db;

    await makeRequest(app2).post("/api/attendance/pin-checkin").send({
      pin_code: ADMIN_PIN, outlet_id: OUTLET_ID,
    });

    const openRes = await makeRequest(app2, MANAGER_ID).post("/api/shifts/open").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID, opening_float: 300,
    });
    expect(openRes.status).toBe(200);
    const shiftId = openRes.body.shift_id;

    const closeRes = await makeRequest(app2, MANAGER_ID)
      .post(`/api/shifts/${shiftId}/close`)
      .send({
        outlet_id: OUTLET_ID, employee_id: MANAGER_ID, closing_cash: 400,
        denominations: [
          { denomination: 100, count: 2 },
          { denomination: 50, count: 4 },
        ],
      });
    expect(closeRes.status).toBe(200);

    const denoms = await dbAll(db2,
      "SELECT stage, denomination, count FROM shift_denominations WHERE shift_id = ? AND stage = 'closing'",
      [shiftId],
    );
    expect(denoms.length).toBeGreaterThanOrEqual(2);

    await closeDb(db2);
  });
});

// ─── AU6 ─────────────────────────────────────────────────────────────────────

describe("AU6 — Return linked to bill stores original_sale_id and return_items", () => {
  it("returns.original_sale_id is set and return_items rows exist", async () => {
    const saleId = await makeSale([{ id: 2, price: 200, quantity: 2 }]);

    // POST /api/returns returns { message, id }
    const returnRes = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      original_sale_id: saleId,
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID,
      total_refund: 200, refund_method: "Cash",
      items: [{ product_id: 2, quantity: 1, refund_price: 200 }],
    });
    expect(returnRes.status).toBe(200);
    const returnId = returnRes.body.id;

    const ret = await dbGet(db, "SELECT original_sale_id FROM returns WHERE id = ?", [returnId]);
    expect(Number(ret.original_sale_id)).toBe(saleId);

    const items = await dbAll(db, "SELECT id FROM return_items WHERE return_id = ?", [returnId]);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ─── AU7 ─────────────────────────────────────────────────────────────────────

describe("AU7 — Manual return has NULL original_sale_id but return_items exist", () => {
  it("manual return has no original_sale_id but still records return_items", async () => {
    // POST /api/returns with no original_sale_id — manual return
    const returnRes = await makeRequest(app, MANAGER_ID).post("/api/returns").send({
      outlet_id: OUTLET_ID, employee_id: MANAGER_ID,
      total_refund: 50, refund_method: "Cash",
      items: [{ product_id: 4, quantity: 1, refund_price: 50 }],
    });
    expect(returnRes.status).toBe(200);
    const returnId = returnRes.body.id;

    const ret = await dbGet(db, "SELECT original_sale_id FROM returns WHERE id = ?", [returnId]);
    expect(ret.original_sale_id).toBeFalsy();

    const items = await dbAll(db, "SELECT id FROM return_items WHERE return_id = ?", [returnId]);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ─── AU8 ─────────────────────────────────────────────────────────────────────

describe("AU8 — Re-void attempt is rejected, original void_reason unchanged", () => {
  it("voiding an already-voided sale returns 400 and does not change void_reason", async () => {
    const saleId = await makeSale([{ id: 1, price: 100, quantity: 1 }]);

    // First void
    await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleId}/void`)
      .send({ void_reason: "Original reason" })
      .expect(200);

    // Re-void attempt
    const reVoidRes = await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleId}/void`)
      .send({ void_reason: "Attacker reason" });
    expect(reVoidRes.status).toBe(400);

    // Original void_reason must be unchanged
    const sale = await dbGet(db, "SELECT void_reason FROM sales WHERE id = ?", [saleId]);
    expect(sale.void_reason).toBe("Original reason");
  });
});
