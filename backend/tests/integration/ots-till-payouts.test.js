/**
 * ots-till-payouts.test.js — One Toy Store pilot F3 / D50.
 *
 * Cash paid out of the till (the register's "EXP" column) must come off the
 * drawer at Close Shift. The owner's 5 kinds (PHASE-F-PLAN F3, Q5.1–Q5.12):
 *   shop_cost      staff food, water, repairs…  → an expense (lowers profit)
 *   supplier       cash to a supplier           → a supplier payment (lowers what we owe)
 *   owner          home, school fees, card bill → owner's drawing (NOT profit)
 *   staff_advance  advance to a staff member    → saved per person (NOT profit)
 *   late_discount  discount handed back later   → an expense tied to the bill
 * Every kind lowers Close Shift's expected cash. Money paid from the bank
 * never touches the drawer.
 *
 * Day 1 (29 Sep): Rs 10,470 of register expenses made the drawer look short.
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

let staffFood; // expense category id

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

const payOut = (body) => admin().post("/api/till-payouts").send(body);

async function closeTill(shiftId, counted) {
  const res = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: counted });
  expect(res.status).toBe(200);
  return res.body;
}

async function dashboardExpected(shiftId) {
  const res = await admin().get("/api/reports/dashboard");
  expect(res.status).toBe(200);
  const row = (res.body.cashPosition?.by_outlet || []).find((r) => r.shift_id === shiftId);
  return { row, todayExpenses: num(res.body.todayExpenses) };
}

const supplierBalance = async (id) =>
  num((await admin().get("/api/suppliers")).body.suppliers.find((s) => s.id === id)?.running_balance);

describe("F3 — the owner's worked example", () => {
  it("float 1,000 + cash sale 500 − paid-out 200 → expected 1,300; a bank-paid expense changes nothing", async () => {
    const shiftId = await openTill(1000);
    await sellCash(500);

    const p = await payOut({ shift_id: shiftId, kind: "shop_cost", amount: 200, category_id: staffFood, note: "10 staff" });
    expect(p.status).toBe(201);

    const bank = await admin().post("/api/expenses").send({ category_id: staffFood, amount: 5000, paid_from: "bank", description: "rent" });
    expect(bank.status).toBe(200);

    const { row } = await dashboardExpected(shiftId);
    expect(num(row.expected_cash)).toBe(1300);
    expect(num(row.paid_out)).toBe(200);

    const closed = await closeTill(shiftId, 1300);
    expect(num(closed.expected_cash)).toBe(1300);
    expect(num(closed.variance)).toBe(0);
    expect(num(closed.paid_out)).toBe(200);

    // The shop cost is an ordinary expense row, paid from the till, on this shift.
    const e = await one("SELECT * FROM expenses WHERE id = (SELECT expense_id FROM till_payouts WHERE id = $1)", [p.body.payout.id]);
    expect(num(e.amount)).toBe(200);
    expect(e.paid_from).toBe("till");
    expect(e.shift_id).toBe(shiftId);
    expect(e.category_id).toBe(staffFood);
    expect((await one("SELECT paid_from FROM expenses WHERE id = $1", [bank.body.id])).paid_from).toBe("bank");
  });
});

describe("F3 — each kind", () => {
  let shiftId;
  beforeAll(async () => {
    shiftId = await openTill(10000);
  });

  it("supplier: lowers what the shop owes that supplier; is not an expense", async () => {
    await db.query("UPDATE suppliers SET opening_balance = 59000 WHERE id = 1");
    const before = await supplierBalance(1);
    const expBefore = num((await one("SELECT COUNT(*) AS n FROM expenses")).n);
    const res = await payOut({ shift_id: shiftId, kind: "supplier", amount: 5000, supplier_id: 1 });
    expect(res.status).toBe(201);
    expect(await supplierBalance(1)).toBe(before - 5000);
    const sp = await one("SELECT * FROM supplier_payments WHERE id = $1", [res.body.payout.supplier_payment_id]);
    expect(sp.payment_method).toBe("Cash");
    expect(num((await one("SELECT COUNT(*) AS n FROM expenses")).n)).toBe(expBefore);
  });

  it("owner / home: off the drawer, not an expense, not in today's expenses", async () => {
    const { todayExpenses: before } = await dashboardExpected(shiftId);
    const res = await payOut({ shift_id: shiftId, kind: "owner", amount: 1000, note: "school fees" });
    expect(res.status).toBe(201);
    expect(res.body.payout.expense_id).toBeNull();
    const { todayExpenses: after } = await dashboardExpected(shiftId);
    expect(after).toBe(before);
  });

  it("owner / home needs a note", async () => {
    expect((await payOut({ shift_id: shiftId, kind: "owner", amount: 100 })).status).toBe(400);
  });

  it("staff advance: saved against the staff member, not an expense", async () => {
    const res = await payOut({ shift_id: shiftId, kind: "staff_advance", amount: 500, staff_employee_id: CASHIER_ID });
    expect(res.status).toBe(201);
    expect(res.body.payout.staff_employee_id).toBe(CASHIER_ID);
    expect(res.body.payout.expense_id).toBeNull();
    expect((await payOut({ shift_id: shiftId, kind: "staff_advance", amount: 500 })).status).toBe(400);
    expect((await payOut({ shift_id: shiftId, kind: "staff_advance", amount: 500, staff_employee_id: 999 })).status).toBe(400);
  });

  it("discount after sale: tied to the bill, counted as an expense (lowers profit)", async () => {
    const saleId = await sellCash(1500);
    const inv = (await one("SELECT invoice_number FROM sales WHERE id = $1", [saleId])).invoice_number;
    const res = await payOut({ shift_id: shiftId, kind: "late_discount", amount: 300, invoice_number: inv });
    expect(res.status).toBe(201);
    expect(res.body.payout.sale_id).toBe(saleId);
    const e = await one(
      `SELECT e.*, ec.name AS cat FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id WHERE e.id = $1`,
      [res.body.payout.expense_id],
    );
    expect(e.cat).toBe("Discount after sale");
    expect(e.reference).toBe(inv);
    expect(e.paid_from).toBe("till");
    // More than the bill, or a bill that doesn't exist: refused.
    expect((await payOut({ shift_id: shiftId, kind: "late_discount", amount: 5000, invoice_number: inv })).status).toBe(400);
    expect((await payOut({ shift_id: shiftId, kind: "late_discount", amount: 10, invoice_number: "NOPE-1" })).status).toBe(400);
  });

  it("the drawer counts every kind: 10,000 + 1,500 − (5,000 + 1,000 + 500 + 300) = 4,700", async () => {
    const list = await admin().get(`/api/till-payouts?shift_id=${shiftId}`);
    expect(list.status).toBe(200);
    expect(num(list.body.total)).toBe(6800);
    expect(list.body.payouts.map((p) => p.kind).sort())
      .toEqual(["late_discount", "owner", "staff_advance", "supplier"]);
    const { row } = await dashboardExpected(shiftId);
    expect(num(row.expected_cash)).toBe(4700);
  });

  it("voiding the supplier payment puts the cash back in the drawer", async () => {
    const p = await one("SELECT supplier_payment_id FROM till_payouts WHERE shift_id = $1 AND kind = 'supplier'", [shiftId]);
    const v = await admin().post(`/api/supplier-payments/${p.supplier_payment_id}/void`).send({ reason: "wrong supplier" });
    expect(v.status).toBe(200);
    const { row } = await dashboardExpected(shiftId);
    expect(num(row.expected_cash)).toBe(9700);
  });

  it("Cash Audit lists the paid-outs as minus lines", async () => {
    const res = await admin().get(`/api/reports/cash-audit?session_id=${shiftId}`);
    expect(res.status).toBe(200);
    const out = res.body.audit.filter((r) => r.type === "Paid out");
    expect(out.map((r) => num(r.amount)).sort((a, b) => a - b)).toEqual([-1000, -500, -300]);
  });
});

describe("F3 — mistakes and edits", () => {
  let shiftId;
  beforeAll(async () => {
    shiftId = await openTill(2000);
  });

  it("refuses a bad amount, an unknown kind, a missing category, a closed or unknown shift", async () => {
    expect((await payOut({ shift_id: shiftId, kind: "shop_cost", amount: 0, category_id: staffFood })).status).toBe(400);
    expect((await payOut({ shift_id: shiftId, kind: "shop_cost", amount: -5, category_id: staffFood })).status).toBe(400);
    expect((await payOut({ shift_id: shiftId, kind: "lunch", amount: 50 })).status).toBe(400);
    expect((await payOut({ shift_id: shiftId, kind: "shop_cost", amount: 50 })).status).toBe(400);
    expect((await payOut({ shift_id: 99999, kind: "owner", amount: 50, note: "x" })).status).toBe(404);
    const closedId = (await one("SELECT id FROM cash_shifts WHERE status = 'closed' ORDER BY id LIMIT 1")).id;
    expect((await payOut({ shift_id: closedId, kind: "owner", amount: 50, note: "x" })).status).toBe(409);
  });

  it("a paid-out typed by mistake can be removed while the shift is open (and its expense goes too)", async () => {
    const res = await payOut({ shift_id: shiftId, kind: "shop_cost", amount: 70, category_id: staffFood });
    const expenseId = res.body.payout.expense_id;
    const del = await admin().delete(`/api/till-payouts/${res.body.payout.id}`);
    expect(del.status).toBe(200);
    expect(await one("SELECT id FROM expenses WHERE id = $1", [expenseId])).toBeUndefined();
    const { row } = await dashboardExpected(shiftId);
    expect(num(row.expected_cash)).toBe(2000);
  });

  it("editing a till expense on the Expenses page keeps its shift and moves the drawer amount with it", async () => {
    const res = await payOut({ shift_id: shiftId, kind: "shop_cost", amount: 300, category_id: staffFood });
    const expenseId = res.body.payout.expense_id;
    // The Expenses page sends no shift_id / paid_from.
    const put = await admin().put(`/api/expenses/${expenseId}`).send({ category_id: staffFood, amount: 350, description: "10 staff + tea" });
    expect(put.status).toBe(200);
    const e = await one("SELECT * FROM expenses WHERE id = $1", [expenseId]);
    expect(e.shift_id).toBe(shiftId);
    expect(e.paid_from).toBe("till");
    expect(num((await one("SELECT amount FROM till_payouts WHERE id = $1", [res.body.payout.id])).amount)).toBe(350);
    const { row } = await dashboardExpected(shiftId);
    expect(num(row.expected_cash)).toBe(1650);
  });

  it("the Expenses list gives the date as YYYY-MM-DD, and saving it back keeps the same day", async () => {
    const e = await admin().post("/api/expenses").send({ category_id: staffFood, amount: 40, paid_from: "bank", expense_date: "2026-09-30" });
    const row = (await admin().get("/api/expenses")).body.expenses.find((x) => x.id === e.body.id);
    expect(row.expense_date).toBe("2026-09-30");
    await admin().put(`/api/expenses/${e.body.id}`).send({ category_id: staffFood, amount: 40, expense_date: row.expense_date });
    expect((await one("SELECT to_char(expense_date, 'YYYY-MM-DD') AS d FROM expenses WHERE id = $1", [e.body.id])).d).toBe("2026-09-30");
  });

  it("an ordinary (bank) expense edited on the Expenses page keeps its shift link too", async () => {
    const e = await admin().post("/api/expenses").send({ category_id: staffFood, amount: 90, paid_from: "bank", shift_id: shiftId });
    await admin().put(`/api/expenses/${e.body.id}`).send({ category_id: staffFood, amount: 95 });
    const row = await one("SELECT shift_id, paid_from FROM expenses WHERE id = $1", [e.body.id]);
    expect(row.shift_id).toBe(shiftId);
    expect(row.paid_from).toBe("bank");
  });

  it("the Expenses page can add a till-cash expense: it lands in the open shift's drawer", async () => {
    const res = await admin().post("/api/expenses").send({ category_id: staffFood, amount: 150, paid_from: "till", outlet_id: 1 });
    expect(res.status).toBe(200);
    const p = await one("SELECT * FROM till_payouts WHERE expense_id = $1", [res.body.id]);
    expect(p.shift_id).toBe(shiftId);
    expect(p.kind).toBe("shop_cost");
    const { row } = await dashboardExpected(shiftId);
    expect(num(row.expected_cash)).toBe(1500);
  });

  it("once the shift is closed its paid-outs are fixed", async () => {
    const res = await payOut({ shift_id: shiftId, kind: "owner", amount: 100, note: "home" });
    await closeTill(shiftId, 1400);
    expect((await admin().delete(`/api/till-payouts/${res.body.payout.id}`)).status).toBe(409);
    const tillExpense = await one("SELECT expense_id FROM till_payouts WHERE shift_id = $1 AND expense_id IS NOT NULL LIMIT 1", [shiftId]);
    expect((await admin().put(`/api/expenses/${tillExpense.expense_id}`).send({ category_id: staffFood, amount: 1 })).status).toBe(409);
    expect((await admin().delete(`/api/expenses/${tillExpense.expense_id}`)).status).toBe(409);
  });

  it("a cashier without the paid-out permission is refused; options list is served to the owner", async () => {
    const shiftId2 = await openTill(500);
    const c = await makeRequest(app, CASHIER_ID).post("/api/till-payouts").send({ shift_id: shiftId2, kind: "owner", amount: 10, note: "x" });
    expect(c.status).toBe(403);
    const opt = await admin().get("/api/till-payouts/options");
    expect(opt.status).toBe(200);
    expect(opt.body.kinds.map((k) => k.key)).toEqual(["shop_cost", "supplier", "owner", "staff_advance", "late_discount"]);
    expect(opt.body.categories.map((c2) => c2.name)).toContain("Staff food");
    expect(opt.body.categories.map((c2) => c2.name)).not.toContain("Discount after sale");
    expect(opt.body.suppliers.length).toBeGreaterThan(0);
    expect(opt.body.staff.map((s) => s.id)).toContain(CASHIER_ID);
  });
});
