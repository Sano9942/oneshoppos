/**
 * One Toy Store pilot F3c: cash paid INTO the till that is not a sale.
 *
 * 30 Sep: the owner took Rs 220,000 from Bank Alfalah and put it in the
 * drawer; with no way to record it, Close Shift showed +220,000. Three kinds
 * (PHASE-F-PLAN F3c):
 *   bank         from a shop bank / wallet account (the till's Online list)
 *   owner        from the owner / home
 *   staff_repay  a staff member pays back an advance or a toy (F3b)
 * Close Shift, the dashboard cash position and Cash Audit ADD PAID_IN_SQL.
 * Not a sale and not profit: nothing here writes sales or expenses.
 */
const { readOnlineOptions } = require("./online-payments");
const { openShiftOrFail } = require("./till-payouts");

const KINDS = [
  { key: "bank", label: "From bank" },
  { key: "owner", label: "From owner / home" },
  { key: "staff_repay", label: "Staff pays back" },
];
const KIND_KEYS = KINDS.map((k) => k.key);

const TILL_PAYINS_DDL = `
CREATE TABLE IF NOT EXISTS till_payins (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES cash_shifts(id),
  outlet_id INTEGER REFERENCES outlets(id),
  kind TEXT NOT NULL CHECK (kind IN ('bank','owner','staff_repay')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  account TEXT,
  note TEXT,
  staff_employee_id INTEGER REFERENCES employees(id),
  employee_id INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_till_payins_shift ON till_payins(shift_id);
`;

// Cash put into the drawer for one shift ($1).
const PAID_IN_SQL = `
  SELECT COALESCE(SUM(amount), 0) AS paid_in FROM till_payins WHERE shift_id = $1
`;

// Same, as a correlated sub-select on a shift alias `cs` (dashboard).
const PAID_IN_SUBSELECT = `
  COALESCE((SELECT SUM(pi.amount) FROM till_payins pi WHERE pi.shift_id = cs.id), 0)
`;

const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });

async function paidInForShift(db, shiftId) {
  const { rows: [r] } = await db.query(PAID_IN_SQL, [shiftId]);
  return Number(r?.paid_in || 0);
}

async function accountOptions(db) {
  const { rows: [cp] } = await db.query("SELECT online_payment_options FROM company_profile WHERE id = 1");
  return readOnlineOptions(cp?.online_payment_options);
}

/**
 * Record one paid-in. Must run inside the caller's transaction.
 * body: { shift_id, kind, amount, account, staff_employee_id, note }.
 */
async function createPayin(db, body, { employeeId }) {
  const kind = String(body.kind || "");
  if (!KIND_KEYS.includes(kind)) throw fail(400, "Pick where the money came from");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, "Enter an amount above 0");
  const amt = Math.round(amount * 100) / 100;
  const note = body.note ? String(body.note).trim().slice(0, 500) || null : null;
  const shift = await openShiftOrFail(db, Number(body.shift_id));

  let account = null;
  let staffId = null;
  if (kind === "bank") {
    const wanted = String(body.account || "").trim().toLowerCase();
    account = (await accountOptions(db)).find((a) => a.toLowerCase() === wanted) || null;
    if (!account) throw fail(400, "Pick the bank account");
  } else if (kind === "staff_repay") {
    const { rows: [st] } = await db.query("SELECT id FROM employees WHERE id = $1", [Number(body.staff_employee_id) || 0]);
    if (!st) throw fail(400, "Pick the staff member");
    staffId = st.id;
  }

  const { rows: [p] } = await db.query(
    `INSERT INTO till_payins (shift_id, outlet_id, kind, amount, account, note, staff_employee_id, employee_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [shift.id, shift.outlet_id, kind, amt, account, note, staffId, employeeId || null],
  );
  return p;
}

/** Remove a mistaken paid-in while its shift is open (inside a transaction). */
async function removePayin(db, payinId) {
  const { rows: [p] } = await db.query("SELECT * FROM till_payins WHERE id = $1", [payinId]);
  if (!p) throw fail(404, "Paid-in not found");
  await openShiftOrFail(db, p.shift_id);
  await db.query("DELETE FROM till_payins WHERE id = $1", [p.id]);
  return p;
}

module.exports = {
  KINDS, KIND_KEYS, TILL_PAYINS_DDL, PAID_IN_SQL, PAID_IN_SUBSELECT,
  paidInForShift, accountOptions, createPayin, removePayin,
};
