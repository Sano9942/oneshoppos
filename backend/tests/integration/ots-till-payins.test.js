/**
 * ots-till-payins.test.js — One Toy Store pilot F3c.
 *
 * Cash put INTO the drawer that is not a sale: the owner tops up the till
 * from the bank (30 Sep: Rs 220,000 from Bank Alfalah), brings money from
 * home, or a staff member pays back an advance. Three kinds (PHASE-F-PLAN F3c):
 *   bank         pick the account from the till's Online list (Alfalah…)
 *   owner        from the owner / home
 *   staff_repay  a staff member pays back (links to F3b)
 * Close Shift expected = float + cash sales − cash refunds − paid-outs
 * + paid-ins; same in the dashboard cash position and Cash Audit.
 * Not a sale, not profit. Removable while the shift is open.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const ITEM = 4; // no tax: totals are plain arithmetic

let staffFood;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  staffFood = (await one("INSERT INTO expense_categories (name) VALUES ('Staff food') RETURNING id")).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function openTill(float) {
  for (const s of await all("SELECT id FROM cash_shifts WHERE status = 'open'")) {
    await db.query("UPDATE cash_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1", [s.id]);
  }
  const res = await admin().post("/api/shifts/open").send({ outlet_id: 1, employee_id: ADMIN_ID, opening_float: float });
  expect(res.status).toBe(200);
  const att = await makeRequest(app).post("/api/attendance/pin-checkin").send({ pin_code: ADMIN_PIN, outlet_id: 1 });
  if (![200, 400].includes(att.status)) throw new Error(`clock-in ${att.status}`);
  return res.body.shift_id;
}

async function sellCash(price) {
  const res = await admin().post("/api/sales").send({
    outlet_id: 1, employee_id: ADMIN_ID,
    cartItems: [{ id: ITEM, quantity: 1, price }],
    payments: [{ method: "Cash", amount: price }],
  });
  expect(res.status).toBe(200);
  return res.body.saleId;
}

const payIn = (body) => admin().post("/api/till-payins").send(body);
const payOut = (body) => admin().post("/api/till-payouts").send(body);

async function closeTill(shiftId, counted) {
  const res = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: counted });
  expect(res.status).toBe(200);
  return res.body;
}

async function dashboard(shiftId) {
  const res = await admin().get("/api/reports/dashboard");
  expect(res.status).toBe(200);
  const row = (res.body.cashPosition?.by_outlet || []).find((r) => r.shift_id === shiftId);
  return { row, body: res.body };
}

describe("F3c — the owner's worked example", () => {
  it("float 1,000 + cash sale 500 − paid-out 200 + paid-in 300 → expected 1,600", async () => {
    const shiftId = await openTill(1000);
    await sellCash(500);
    expect((await payOut({ shift_id: shiftId, kind: "shop_cost", amount: 200, category_id: staffFood })).status).toBe(201);

    const res = await payIn({ shift_id: shiftId, kind: "bank", amount: 300, account: "Alfalah" });
    expect(res.status).toBe(201);
    expect(res.body.payin.kind).toBe("bank");
    expect(res.body.payin.account).toBe("Alfalah");

    const { row } = await dashboard(shiftId);
    expect(num(row.paid_in)).toBe(300);
    expect(num(row.expected_cash)).toBe(1600);

    const closed = await closeTill(shiftId, 1600);
    expect(num(closed.paid_in)).toBe(300);
    expect(num(closed.expected_cash)).toBe(1600);
    expect(num(closed.variance)).toBe(0);
  });

  it("30 Sep, as it should have been: 48,810 + 57,540 − 276,140 + 220,000 = 50,210", async () => {
    const shiftId = await openTill(48810);
    await sellCash(57540);
    expect((await payOut({ shift_id: shiftId, kind: "owner", amount: 276140, note: "register EXP total" })).status).toBe(201);
    expect((await payIn({ shift_id: shiftId, kind: "bank", amount: 220000, account: "Alfalah", note: "for suppliers" })).status).toBe(201);
    const closed = await closeTill(shiftId, 51210);
    expect(num(closed.expected_cash)).toBe(50210);
    expect(num(closed.variance)).toBe(1000);
  });
});

describe("F3c — each kind, and it is not a sale or profit", () => {
  let shiftId, before;
  beforeAll(async () => {
    shiftId = await openTill(5000);
    before = (await dashboard(shiftId)).body;
  });

  it("from bank: the account must be one of the till's Online choices", async () => {
    expect((await payIn({ shift_id: shiftId, kind: "bank", amount: 100 })).status).toBe(400);
    expect((await payIn({ shift_id: shiftId, kind: "bank", amount: 100, account: "Swiss Bank" })).status).toBe(400);
    const ok = await payIn({ shift_id: shiftId, kind: "bank", amount: 1000, account: "Meezan" });
    expect(ok.status).toBe(201);
  });

  it("from owner / home: no account or staff needed", async () => {
    const res = await payIn({ shift_id: shiftId, kind: "owner", amount: 2000 });
    expect(res.status).toBe(201);
    expect(res.body.payin.account).toBeNull();
    expect(res.body.payin.staff_employee_id).toBeNull();
  });

  it("staff pays back: saved against the staff member", async () => {
    expect((await payIn({ shift_id: shiftId, kind: "staff_repay", amount: 500 })).status).toBe(400);
    expect((await payIn({ shift_id: shiftId, kind: "staff_repay", amount: 500, staff_employee_id: 999 })).status).toBe(400);
    const res = await payIn({ shift_id: shiftId, kind: "staff_repay", amount: 500, staff_employee_id: CASHIER_ID });
    expect(res.status).toBe(201);
    expect(res.body.payin.staff_employee_id).toBe(CASHIER_ID);
  });

  it("refuses a bad amount, an unknown kind, a closed or unknown shift", async () => {
    expect((await payIn({ shift_id: shiftId, kind: "owner", amount: 0 })).status).toBe(400);
    expect((await payIn({ shift_id: shiftId, kind: "owner", amount: -5 })).status).toBe(400);
    expect((await payIn({ shift_id: shiftId, kind: "lottery", amount: 50 })).status).toBe(400);
    expect((await payIn({ shift_id: 99999, kind: "owner", amount: 50 })).status).toBe(404);
    const closedId = (await one("SELECT id FROM cash_shifts WHERE status = 'closed' ORDER BY id LIMIT 1")).id;
    expect((await payIn({ shift_id: closedId, kind: "owner", amount: 50 })).status).toBe(409);
  });

  it("the list and the dashboard: 5,000 + 1,000 + 2,000 + 500 = 8,500; no sale, no expense, no revenue", async () => {
    const list = await admin().get(`/api/till-payins?shift_id=${shiftId}`);
    expect(list.status).toBe(200);
    expect(num(list.body.total)).toBe(3500);
    expect(list.body.payins.map((p) => p.kind).sort()).toEqual(["bank", "owner", "staff_repay"]);
    expect(list.body.payins.find((p) => p.kind === "staff_repay").staff_name).toBeTruthy();

    const { row, body } = await dashboard(shiftId);
    expect(num(row.expected_cash)).toBe(8500);
    expect(num((await one("SELECT COUNT(*) AS n FROM sales WHERE shift_id = $1", [shiftId])).n)).toBe(0);
    expect(num((await one("SELECT COUNT(*) AS n FROM expenses WHERE shift_id = $1", [shiftId])).n)).toBe(0);
    expect(num(body.totalRevenueToday)).toBe(num(before.totalRevenueToday));
    expect(num(body.saleCount)).toBe(num(before.saleCount));
    expect(num(body.todayExpenses)).toBe(num(before.todayExpenses));
  });

  it("Cash Audit lists the paid-ins as plus lines", async () => {
    const res = await admin().get(`/api/reports/cash-audit?session_id=${shiftId}`);
    expect(res.status).toBe(200);
    const inn = res.body.audit.filter((r) => r.type === "Paid in");
    expect(inn.map((r) => num(r.amount)).sort((a, b) => a - b)).toEqual([500, 1000, 2000]);
  });

  it("a paid-in typed by mistake can be removed while the shift is open", async () => {
    const res = await payIn({ shift_id: shiftId, kind: "owner", amount: 70 });
    expect((await admin().delete(`/api/till-payins/${res.body.payin.id}`)).status).toBe(200);
    const { row } = await dashboard(shiftId);
    expect(num(row.expected_cash)).toBe(8500);
  });

  it("once the shift is closed its paid-ins are fixed", async () => {
    const res = await payIn({ shift_id: shiftId, kind: "owner", amount: 100 });
    await closeTill(shiftId, 8600);
    expect((await admin().delete(`/api/till-payins/${res.body.payin.id}`)).status).toBe(409);
    expect(num((await one("SELECT expected_cash FROM cash_shifts WHERE id = $1", [shiftId])).expected_cash)).toBe(8600);
  });
});

describe("F3c — who can", () => {
  it("a cashier without the paid-out permission is refused; the owner gets the options", async () => {
    const shiftId = await openTill(500);
    const c = await makeRequest(app, CASHIER_ID).post("/api/till-payins").send({ shift_id: shiftId, kind: "owner", amount: 10 });
    expect(c.status).toBe(403);
    const opt = await admin().get("/api/till-payins/options");
    expect(opt.status).toBe(200);
    expect(opt.body.kinds.map((k) => k.key)).toEqual(["bank", "owner", "staff_repay"]);
    expect(opt.body.accounts).toContain("Alfalah");
    expect(opt.body.staff.map((s) => s.id)).toContain(CASHIER_ID);
  });
});
