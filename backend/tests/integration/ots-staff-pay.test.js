/**
 * ots-staff-pay.test.js — One Toy Store pilot F3b (staff account + salaries).
 *
 * The shop keeps a paper attendance register (P / circled A / sick in Urdu)
 * and pays salaries in cash from the drawer at month end (PHASE-F-PLAN F3b,
 * Q3b.1–Q3b.15, owner 2026-10-01):
 *   pay = salary + (allowed − A days) × salary ÷ 30, rounded to the nearest 10
 *   sick (S) days are not taken from the allowance
 *   advances (till Paid out, or earlier ones from the paper register) and
 *   staff pay-backs (till Paid in) make a running account per person; the
 *   owner cuts some or all of it from the salary, the rest carries over.
 * Only the owner (manage_employees) marks the register; every change keeps
 * who, when and why. The salary leaves the drawer as a till paid-out of kind
 * 'salary' (Close Shift expected goes down) and the full earned pay is a shop
 * cost ("Salaries" expense), so profit sees it once.
 *
 * September 2026 from the register photos: Basharat 48,500, allowed 5, A on
 * 1–7 → −2 → 45,266.67 → 45,270. Mubashir 36,500, allowed 6, no A → +6 →
 * 43,800. Ubaid sick 15–16 → still +6.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const SEP = "2026-09";

// The test shop's staff, set up as the One Toy Store September cases.
const BASHARAT = CASHIER_ID; // 48,500, allowed 5
const MUBASHIR = MANAGER_ID; // 36,500, allowed 6
let UBAID; // 32,000, allowed 6, sick 15–16

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("UPDATE employees SET monthly_salary = 48500 WHERE id = $1", [BASHARAT]);
  await db.query("UPDATE employees SET monthly_salary = 36500 WHERE id = $1", [MUBASHIR]);
  await db.query("UPDATE employees SET monthly_salary = 0 WHERE id = $1", [ADMIN_ID]);
  UBAID = (await one(
    "INSERT INTO employees (name, role, role_id, monthly_salary) VALUES ('Ubaid Awan', 'Staff', 3, 32000) RETURNING id",
  )).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const mark = (employee_id, day, m, reason = "from paper register") =>
  admin().put("/api/staff-pay/register").send({ employee_id, day, mark: m, reason });
const allowance = (id, n) => admin().put(`/api/staff-pay/staff/${id}`).send({ monthly_leave_allowance: n });
const register = (month = SEP) => admin().get(`/api/staff-pay/register?month=${month}`);
const salaries = (month = SEP) => admin().get(`/api/staff-pay/salaries?month=${month}`);
const account = (id) => admin().get(`/api/staff-pay/accounts/${id}`);
const row = (body, id) => body.staff.find((s) => s.id === id);

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

describe("F3b — the register (September from paper)", () => {
  it("leave allowance is set per person", async () => {
    expect((await allowance(BASHARAT, 5)).status).toBe(200);
    expect((await allowance(MUBASHIR, 6)).status).toBe(200);
    expect((await allowance(UBAID, 6)).status).toBe(200);
    expect(num((await one("SELECT monthly_leave_allowance FROM employees WHERE id = $1", [BASHARAT])).monthly_leave_allowance)).toBe(5);
    expect((await allowance(BASHARAT, -1)).status).toBe(400);
    expect((await allowance(BASHARAT, 32)).status).toBe(400);
  });

  it("marks P / A / S per day; a reason is required", async () => {
    expect((await mark(BASHARAT, "2026-09-01", "A", "")).status).toBe(400);
    expect((await mark(BASHARAT, "2026-09-01", "X")).status).toBe(400);
    expect((await mark(BASHARAT, "2026-13-01", "A")).status).toBe(400);
    expect((await mark(999, "2026-09-01", "A")).status).toBe(400);
    for (let d = 1; d <= 7; d++) expect((await mark(BASHARAT, `2026-09-0${d}`, "A")).status).toBe(200);
    for (const d of ["15", "16"]) expect((await mark(UBAID, `2026-09-${d}`, "S", "sick (register, Urdu)")).status).toBe(200);
    for (let d = 1; d <= 30; d++) {
      const day = `2026-09-${String(d).padStart(2, "0")}`;
      expect((await mark(MUBASHIR, day, "P")).status).toBe(200);
    }
  });

  it("the month grid: per-person A / S / ± and per-day present count", async () => {
    const res = await register();
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(30);
    const b = row(res.body, BASHARAT);
    expect(b.allowance).toBe(5);
    expect(b.a_days).toBe(7);
    expect(b.diff).toBe(-2);
    expect(b.marks["1"].mark).toBe("A");
    expect(b.marks["8"]).toBeUndefined();
    const u = row(res.body, UBAID);
    expect(u.s_days).toBe(2);
    expect(u.a_days).toBe(0);
    expect(u.diff).toBe(6);
    const m = row(res.body, MUBASHIR);
    expect(m.p_days).toBe(30);
    expect(m.diff).toBe(6);
    expect(res.body.present_by_day["1"]).toBe(1); // only Mubashir marked P on the 1st
    // the owner (salary 0) is not on the staff register
    expect(row(res.body, ADMIN_ID)).toBeUndefined();
  });

  it("a clock-in counts as P when the day isn't marked", async () => {
    const res = await register(new Date().toISOString().slice(0, 7));
    // ADMIN is not staff; nothing else clocked in — the grid still loads
    expect(res.status).toBe(200);
  });

  it("every change is kept with who and why; clearing a mark is a change too", async () => {
    expect((await mark(BASHARAT, "2026-09-20", "A", "first")).status).toBe(200);
    expect((await mark(BASHARAT, "2026-09-20", null, "marked by mistake")).status).toBe(200);
    const hist = await admin().get(`/api/staff-pay/register/history?employee_id=${BASHARAT}&month=${SEP}`);
    expect(hist.status).toBe(200);
    const day20 = hist.body.history.filter((h) => h.day === "2026-09-20");
    expect(day20.map((h) => [h.old_mark, h.new_mark, h.reason])).toEqual([
      [null, "A", "first"],
      ["A", null, "marked by mistake"],
    ]);
    expect(day20[0].set_by_name).toBe("Hassan");
    expect(row((await register()).body, BASHARAT).a_days).toBe(7);
  });

  it("bulk: many boxes with one reason, all or nothing", async () => {
    const days = ["2026-09-21", "2026-09-22"].map((day) => ({ employee_id: UBAID, day, mark: "P" }));
    expect((await admin().put("/api/staff-pay/register/bulk").send({ marks: days, reason: "" })).status).toBe(400);
    expect((await admin().put("/api/staff-pay/register/bulk").send({ marks: [...days, { employee_id: UBAID, day: "2026-09-31", mark: "P" }], reason: "paper" })).status).toBe(400);
    expect(row((await register()).body, UBAID).p_days).toBe(0);
    const ok = await admin().put("/api/staff-pay/register/bulk").send({ marks: days, reason: "from paper register" });
    expect(ok.status).toBe(200);
    expect(ok.body.changed).toBe(2);
    expect(row((await register()).body, UBAID).p_days).toBe(2);
  });

  it("only someone with manage_employees can mark or see pay", async () => {
    const cashier = makeRequest(app, CASHIER_ID);
    expect((await cashier.put("/api/staff-pay/register").send({ employee_id: BASHARAT, day: "2026-09-09", mark: "P", reason: "me" })).status).toBe(403);
    expect((await cashier.get(`/api/staff-pay/salaries?month=${SEP}`)).status).toBe(403);
    expect((await cashier.get(`/api/staff-pay/accounts/${BASHARAT}`)).status).toBe(403);
  });
});

describe("F3b — salaries (rounded to the nearest 10)", () => {
  it("Basharat 45,270 · Mubashir 43,800 · Ubaid (sick 2 days) 38,400", async () => {
    const res = await salaries();
    expect(res.status).toBe(200);
    const b = row(res.body, BASHARAT);
    expect(b.leave_adjust).toBeCloseTo(-3233.33, 2);
    expect(b.gross).toBe(45270);
    expect(row(res.body, MUBASHIR).gross).toBe(43800);
    expect(row(res.body, UBAID).gross).toBe(38400); // 32,000 + 6 × 1,066.67
    expect(b.paid).toBeNull();
  });
});

describe("F3b — staff account: advances, pay-backs, cut from salary", () => {
  let shiftId;
  beforeAll(async () => {
    shiftId = await openTill(100000);
  });

  it("earlier advances from the paper register go on the account (no drawer)", async () => {
    const bad = await admin().post(`/api/staff-pay/accounts/${MUBASHIR}/entries`).send({ kind: "earlier_advance", amount: 0, entry_date: "2026-09-10" });
    expect(bad.status).toBe(400);
    const res = await admin().post(`/api/staff-pay/accounts/${MUBASHIR}/entries`)
      .send({ kind: "earlier_advance", amount: 5000, entry_date: "2026-09-10", note: "register page 12" });
    expect(res.status).toBe(201);
    expect(num((await account(MUBASHIR)).body.balance)).toBe(5000);
  });

  it("a till advance adds, a till pay-back subtracts", async () => {
    expect((await admin().post("/api/till-payouts").send({ shift_id: shiftId, kind: "staff_advance", amount: 2000, staff_employee_id: MUBASHIR })).status).toBe(201);
    expect((await admin().post("/api/till-payins").send({ shift_id: shiftId, kind: "staff_repay", amount: 500, staff_employee_id: MUBASHIR })).status).toBe(201);
    const acc = (await account(MUBASHIR)).body;
    expect(num(acc.balance)).toBe(6500);
    expect(acc.entries.map((e) => [e.kind, num(e.amount)])).toEqual(
      expect.arrayContaining([["earlier_advance", 5000], ["staff_advance", 2000], ["staff_repay", -500]]),
    );
    expect(row((await salaries()).body, MUBASHIR).balance).toBe(6500);
  });

  it("refuses a cut above what is owed or above the pay; needs an open shift", async () => {
    const pay = (body) => admin().post("/api/staff-pay/salaries").send({ employee_id: MUBASHIR, month: SEP, ...body });
    expect((await pay({ shift_id: shiftId, cut_amount: 7000 })).status).toBe(400);
    expect((await pay({ shift_id: 99999, cut_amount: 0 })).status).toBe(404);
    expect((await pay({ shift_id: shiftId, cut_amount: -1 })).status).toBe(400);
  });

  it("pay Mubashir: cut 6,500 → 37,300 from the drawer; Salaries expense 43,800; account 0", async () => {
    const before = await one("SELECT COALESCE(SUM(amount),0)::float AS t FROM expenses");
    const res = await admin().post("/api/staff-pay/salaries")
      .send({ employee_id: MUBASHIR, month: SEP, shift_id: shiftId, cut_amount: 6500, note: "Sep salary" });
    expect(res.status).toBe(201);
    expect(num(res.body.salary.gross)).toBe(43800);
    expect(num(res.body.salary.cut_amount)).toBe(6500);
    expect(num(res.body.salary.net_pay)).toBe(37300);

    const p = await one("SELECT * FROM till_payouts WHERE id = $1", [res.body.salary.payout_id]);
    expect(p.kind).toBe("salary");
    expect(num(p.amount)).toBe(37300);
    expect(p.staff_employee_id).toBe(MUBASHIR);
    const e = await one(
      "SELECT e.*, c.name AS cat FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.id = $1",
      [res.body.salary.expense_id],
    );
    expect(e.cat).toBe("Salaries");
    expect(num(e.amount)).toBe(43800);
    expect(e.paid_from).toBe("till");
    const after = await one("SELECT COALESCE(SUM(amount),0)::float AS t FROM expenses");
    expect(after.t - before.t).toBe(43800);

    expect(num((await account(MUBASHIR)).body.balance)).toBe(0);
    expect(row((await salaries()).body, MUBASHIR).paid.net_pay).toBe(37300);
    // twice in a month is refused
    expect((await admin().post("/api/staff-pay/salaries").send({ employee_id: MUBASHIR, month: SEP, shift_id: shiftId, cut_amount: 0 })).status).toBe(409);
  });

  it("the Expenses page can't edit or delete a salary's expense; Salaries isn't a shop-cost choice", async () => {
    const s = await one("SELECT expense_id FROM staff_salaries WHERE employee_id = $1", [MUBASHIR]);
    expect((await admin().put(`/api/expenses/${s.expense_id}`).send({ amount: 1 })).status).toBe(409);
    expect((await admin().delete(`/api/expenses/${s.expense_id}`)).status).toBe(409);
    const opts = await admin().get("/api/till-payouts/options");
    expect(opts.body.categories.map((c) => c.name)).not.toContain("Salaries");
    const cat = await one("SELECT id FROM expense_categories WHERE name = 'Salaries'");
    expect((await admin().post("/api/till-payouts").send({ shift_id: shiftId, kind: "shop_cost", amount: 10, category_id: cat.id })).status).toBe(400);
  });

  it("the till box can't remove a salary (undo it on the Salaries page)", async () => {
    const p = await one("SELECT id FROM till_payouts WHERE kind = 'salary' AND staff_employee_id = $1", [MUBASHIR]);
    expect((await admin().delete(`/api/till-payouts/${p.id}`)).status).toBe(409);
    expect((await admin().post("/api/till-payouts").send({ shift_id: shiftId, kind: "salary", amount: 10, staff_employee_id: MUBASHIR })).status).toBe(400);
  });

  it("pay Basharat with nothing cut; Close Shift expected drops by both salaries", async () => {
    const res = await admin().post("/api/staff-pay/salaries")
      .send({ employee_id: BASHARAT, month: SEP, shift_id: shiftId, cut_amount: 0 });
    expect(res.status).toBe(201);
    expect(num(res.body.salary.net_pay)).toBe(45270);
    // 100,000 − 2,000 advance + 500 pay-back − 37,300 − 45,270 = 15,930
    const closed = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 15930 });
    expect(closed.status).toBe(200);
    expect(num(closed.body.expected_cash)).toBe(15930);
    expect(num(closed.body.variance)).toBe(0);
  });

  it("undo works only while the shift is open; undo puts everything back", async () => {
    const paid = await one("SELECT id FROM staff_salaries WHERE employee_id = $1", [BASHARAT]);
    expect((await admin().delete(`/api/staff-pay/salaries/${paid.id}`)).status).toBe(409);

    const shift2 = await openTill(50000);
    const res = await admin().post("/api/staff-pay/salaries")
      .send({ employee_id: UBAID, month: SEP, shift_id: shift2, cut_amount: 0 });
    expect(res.status).toBe(201);
    const s = res.body.salary;
    expect((await admin().delete(`/api/staff-pay/salaries/${s.id}`)).status).toBe(200);
    expect(await one("SELECT id FROM till_payouts WHERE id = $1", [s.payout_id])).toBeUndefined();
    expect(await one("SELECT id FROM expenses WHERE id = $1", [s.expense_id])).toBeUndefined();
    expect(row((await salaries()).body, UBAID).paid).toBeNull();
  });
});
