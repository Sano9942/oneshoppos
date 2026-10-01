/**
 * ots-home-staff.test.js — One Toy Store pilot F4b (owner, 2026-10-01/02).
 *
 * Aslam drives for the owner's home and sometimes helps in the shop. His
 * salary (36,000, 5 leave days allowed, cut like shop staff) is paid from the
 * drawer but is a HOME cost: the "Home staff" tick on the employee makes the
 * Salaries page book it as Owner / home (till paid-out of kind 'owner', no
 * shop "Salaries" expense, not in shop profit). Advances and staff toys go on
 * his account as for shop staff. On the register he has his own section: he
 * is left out of the shop's present count.
 *
 * September: no leave → 36,000 + 5 × 1,200 = 42,000. 30,000 was paid on
 * 1 Oct as Paid out → Owner / home (part payment) → entered on his account as
 * "Advance (paper register)" and cut → 12,000 cash.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup;
const ADMIN_PIN = "2580";
const num = (v) => (v === null || v === undefined ? v : Number(v));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const admin = () => makeRequest(app, ADMIN_ID);
const SEP = "2026-09";
const SHOP = CASHIER_ID; // a shop staff member, for comparison

let ASLAM;
let shiftId;

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("UPDATE employees SET monthly_salary = 0 WHERE id <> $1", [SHOP]);
  await db.query("UPDATE employees SET monthly_salary = 30000 WHERE id = $1", [SHOP]);
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

const register = () => admin().get(`/api/staff-pay/register?month=${SEP}`);
const salaries = () => admin().get(`/api/staff-pay/salaries?month=${SEP}`);
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

describe("F4b — home staff", () => {
  it("an employee can be added with the Home staff tick, and the tick can be changed", async () => {
    const res = await admin().post("/api/employees").send({
      name: "Aslam (driver)", pin_code: "864213", role_id: 3, salary_type: "monthly", monthly_salary: 36000, home_staff: true,
    });
    expect(res.status).toBe(200);
    ASLAM = res.body.id;
    expect((await one("SELECT home_staff FROM employees WHERE id = $1", [ASLAM])).home_staff).toBe(true);

    expect((await admin().put(`/api/employees/${ASLAM}`).send({ home_staff: false })).status).toBe(200);
    expect((await one("SELECT home_staff FROM employees WHERE id = $1", [ASLAM])).home_staff).toBe(false);
    expect((await admin().put(`/api/employees/${ASLAM}`).send({ home_staff: true })).status).toBe(200);
    // Leaving it out of an edit keeps it.
    expect((await admin().put(`/api/employees/${ASLAM}`).send({ name: "Aslam" })).status).toBe(200);
    expect((await one("SELECT home_staff FROM employees WHERE id = $1", [ASLAM])).home_staff).toBe(true);

    const list = await admin().get("/api/employees");
    const emp = (list.body.employees || list.body).find((e) => e.id === ASLAM);
    expect(emp.home_staff).toBe(true);

    expect((await admin().put(`/api/staff-pay/staff/${ASLAM}`).send({ monthly_leave_allowance: 5 })).status).toBe(200);
  });

  it("the register marks him home staff and leaves him out of the shop's present count", async () => {
    const day = "2026-09-10";
    for (const id of [SHOP, ASLAM]) {
      const r = await admin().put("/api/staff-pay/register").send({ employee_id: id, day, mark: "P", reason: "test" });
      expect(r.status).toBe(200);
    }
    const reg = (await register()).body;
    expect(row(reg, ASLAM).home_staff).toBe(true);
    expect(row(reg, SHOP).home_staff).toBe(false);
    expect(reg.present_by_day["10"]).toBe(1);
  });

  it("September pay is 42,000; the 30,000 paid on 1 Oct sits on his account", async () => {
    const e = await admin().post(`/api/staff-pay/accounts/${ASLAM}/entries`).send({
      kind: "earlier_advance", amount: 30000, entry_date: "2026-10-01",
      note: "Part of September salary, paid 1 Oct as Paid out → Owner / home (#18)",
    });
    expect(e.status).toBe(201);
    const s = row((await salaries()).body, ASLAM);
    expect(s.home_staff).toBe(true);
    expect(s.gross).toBe(42000);
    expect(s.balance).toBe(30000);
  });

  it("paying it: 12,000 leaves the drawer as Owner / home, no shop expense, account back to 0", async () => {
    shiftId = await openTill(50000);
    const res = await admin().post("/api/staff-pay/salaries").send({
      employee_id: ASLAM, month: SEP, shift_id: shiftId, cut_amount: 30000,
    });
    expect(res.status).toBe(201);
    const sal = await one("SELECT * FROM staff_salaries WHERE employee_id = $1", [ASLAM]);
    expect(num(sal.gross)).toBe(42000);
    expect(num(sal.net_pay)).toBe(12000);
    expect(sal.expense_id).toBeNull();

    const p = await one("SELECT * FROM till_payouts WHERE id = $1", [sal.payout_id]);
    expect(p.kind).toBe("owner");
    expect(num(p.amount)).toBe(12000);
    expect(p.staff_employee_id).toBe(ASLAM);
    expect(p.expense_id).toBeNull();
    expect(p.note).toMatch(/Aslam/);
    expect(p.note).toMatch(/2026-09 salary/);

    expect(num((await one("SELECT COUNT(*) AS n FROM expenses WHERE shift_id = $1", [shiftId])).n)).toBe(0);
    expect(row((await salaries()).body, ASLAM).balance).toBe(0);

    const close = await admin().post(`/api/shifts/${shiftId}/close`).send({ closing_cash: 38000 });
    expect(close.status).toBe(200);
    expect(num(close.body.expected_cash)).toBe(38000);
  });

  it("a shop staff salary is still a shop expense", async () => {
    const id = await openTill(50000);
    const res = await admin().post("/api/staff-pay/salaries").send({ employee_id: SHOP, month: SEP, shift_id: id, cut_amount: 0 });
    expect(res.status).toBe(201);
    const sal = await one("SELECT * FROM staff_salaries WHERE employee_id = $1", [SHOP]);
    expect(sal.expense_id).not.toBeNull();
    expect((await one("SELECT kind FROM till_payouts WHERE id = $1", [sal.payout_id])).kind).toBe("salary");
  });

  it("undo while the shift is open removes the home payout too", async () => {
    await db.query("DELETE FROM staff_salaries WHERE employee_id = $1", [ASLAM]);
    const id = await openTill(50000);
    const res = await admin().post("/api/staff-pay/salaries").send({ employee_id: ASLAM, month: SEP, shift_id: id, cut_amount: 30000 });
    expect(res.status).toBe(201);
    const sal = await one("SELECT * FROM staff_salaries WHERE employee_id = $1", [ASLAM]);
    expect((await admin().delete(`/api/staff-pay/salaries/${sal.id}`)).status).toBe(200);
    expect(await one("SELECT id FROM till_payouts WHERE id = $1", [sal.payout_id])).toBeUndefined();
  });
});
