/**
 * One Toy Store pilot F3 (D50): cash paid out of the till.
 *
 * The shop's paper register writes down every note that leaves the drawer.
 * Five kinds (owner, 2026-09-30, PHASE-F-PLAN F3 / Q5):
 *   shop_cost      staff food, water, repairs…   → also an expense row (profit)
 *   supplier       cash to a supplier            → also a supplier payment (balance)
 *   owner          home, school fees, card bill  → owner's drawing, NOT an expense
 *   staff_advance  advance to a staff member     → saved per person, NOT an expense
 *   late_discount  discount handed back later    → an expense tied to the bill
 * EVERY kind comes off the drawer: Close Shift and the dashboard cash position
 * both subtract PAID_OUT_SQL. Only expense rows reach profit, so owner money
 * and advances never lower it.
 *
 * expenses.paid_from (v147) says where an expense was paid from: 'till' rows
 * always have a till_payouts row; 'bank' / 'other' never touch the drawer.
 */

const KINDS = [
  { key: "shop_cost", label: "Shop cost" },
  { key: "supplier", label: "Pay supplier" },
  { key: "owner", label: "Owner / home" },
  { key: "staff_advance", label: "Staff advance" },
  { key: "late_discount", label: "Discount after sale" },
];
const KIND_KEYS = KINDS.map((k) => k.key);
const PAID_FROM = ["till", "bank", "other"];
const LATE_DISCOUNT_CATEGORY = "Discount after sale";

const TILL_PAYOUTS_DDL = `
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_from TEXT NOT NULL DEFAULT 'other'
  CHECK (paid_from IN ('till','bank','other'));
CREATE TABLE IF NOT EXISTS till_payouts (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL REFERENCES cash_shifts(id),
  outlet_id INTEGER REFERENCES outlets(id),
  kind TEXT NOT NULL CHECK (kind IN ('shop_cost','supplier','owner','staff_advance','late_discount')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note TEXT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  supplier_payment_id INTEGER REFERENCES supplier_payments(id),
  staff_employee_id INTEGER REFERENCES employees(id),
  sale_id INTEGER REFERENCES sales(id),
  employee_id INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_till_payouts_shift ON till_payouts(shift_id);
CREATE INDEX IF NOT EXISTS idx_till_payouts_expense ON till_payouts(expense_id);
`;

// Cash that left the drawer for one shift ($1). A voided supplier payment
// gives its cash back (the payout row stays as history).
const PAID_OUT_SQL = `
  SELECT COALESCE(SUM(p.amount), 0) AS paid_out
    FROM till_payouts p
    LEFT JOIN supplier_payments sp ON sp.id = p.supplier_payment_id
   WHERE p.shift_id = $1
     AND (p.supplier_payment_id IS NULL OR sp.voided IS NOT TRUE)
`;

// Same, as a correlated sub-select on a shift alias `cs` (dashboard).
const PAID_OUT_SUBSELECT = `
  COALESCE((SELECT SUM(p.amount)
              FROM till_payouts p
              LEFT JOIN supplier_payments sp ON sp.id = p.supplier_payment_id
             WHERE p.shift_id = cs.id
               AND (p.supplier_payment_id IS NULL OR sp.voided IS NOT TRUE)), 0)
`;

const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });

async function paidOutForShift(db, shiftId) {
  const { rows: [r] } = await db.query(PAID_OUT_SQL, [shiftId]);
  return Number(r?.paid_out || 0);
}

async function openShiftOrFail(db, shiftId) {
  const { rows: [shift] } = await db.query("SELECT id, outlet_id, status FROM cash_shifts WHERE id = $1", [shiftId]);
  if (!shift) throw fail(404, "Shift not found");
  if (shift.status !== "open") throw fail(409, "That shift is closed; its paid-outs are final");
  return shift;
}

async function lateDiscountCategoryId(db) {
  await db.query(
    "INSERT INTO expense_categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    [LATE_DISCOUNT_CATEGORY, "Discount given back in cash after the bill was charged in full"],
  );
  const { rows: [c] } = await db.query("SELECT id FROM expense_categories WHERE name = $1", [LATE_DISCOUNT_CATEGORY]);
  return c.id;
}

/**
 * Record one paid-out. Must run inside the caller's transaction (db = tx
 * client). body: { shift_id, kind, amount, note, category_id, supplier_id,
 * staff_employee_id, invoice_number }. Returns the till_payouts row.
 */
async function createPayout(db, body, { employeeId, employeeName, today }) {
  const kind = String(body.kind || "");
  if (!KIND_KEYS.includes(kind)) throw fail(400, "Pick what the money was for");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, "Enter an amount above 0");
  const amt = Math.round(amount * 100) / 100;
  const note = body.note ? String(body.note).trim().slice(0, 500) || null : null;
  const shift = await openShiftOrFail(db, Number(body.shift_id));

  const row = {
    shift_id: shift.id, outlet_id: shift.outlet_id, kind, amount: amt, note,
    expense_id: null, supplier_payment_id: null, staff_employee_id: null, sale_id: null,
  };

  const addExpense = async (categoryId, reference) => {
    const { rows: [e] } = await db.query(
      `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date, paid_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'till') RETURNING id`,
      [categoryId, shift.outlet_id, shift.id, employeeId || null, amt, note, reference || null, today],
    );
    return e.id;
  };

  if (kind === "shop_cost") {
    const { rows: [cat] } = await db.query("SELECT id, name FROM expense_categories WHERE id = $1", [Number(body.category_id) || 0]);
    if (!cat) throw fail(400, "Pick what the shop cost was for");
    if (cat.name === "Salaries") throw fail(400, "Salaries are paid on the Salaries page");
    row.expense_id = await addExpense(cat.id, null);
  } else if (kind === "supplier") {
    const { rows: [sup] } = await db.query("SELECT id FROM suppliers WHERE id = $1", [Number(body.supplier_id) || 0]);
    if (!sup) throw fail(400, "Pick the supplier");
    const { rows: [sp] } = await db.query(
      `INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, notes)
       VALUES (NULL, $1, $2, 'Cash', $3, $4, $5) RETURNING id`,
      [sup.id, amt, `Till, shift #${shift.id}`, employeeName || null, note],
    );
    row.supplier_payment_id = sp.id;
  } else if (kind === "owner") {
    if (!note) throw fail(400, "Write what the money was for (e.g. school fees)");
  } else if (kind === "staff_advance") {
    const { rows: [st] } = await db.query("SELECT id FROM employees WHERE id = $1", [Number(body.staff_employee_id) || 0]);
    if (!st) throw fail(400, "Pick the staff member");
    row.staff_employee_id = st.id;
  } else if (kind === "late_discount") {
    const inv = String(body.invoice_number || "").trim();
    const { rows: [sale] } = inv
      ? await db.query("SELECT id, invoice_number, total_amount, voided FROM sales WHERE invoice_number = $1", [inv])
      : { rows: [] };
    if (!sale || sale.voided) throw fail(400, "Bill not found");
    if (amt > Number(sale.total_amount)) throw fail(400, "The discount is more than the bill");
    row.sale_id = sale.id;
    row.expense_id = await addExpense(await lateDiscountCategoryId(db), sale.invoice_number);
  }

  const { rows: [p] } = await db.query(
    `INSERT INTO till_payouts (shift_id, outlet_id, kind, amount, note, expense_id, supplier_payment_id,
                               staff_employee_id, sale_id, employee_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [row.shift_id, row.outlet_id, kind, amt, note, row.expense_id, row.supplier_payment_id,
      row.staff_employee_id, row.sale_id, employeeId || null],
  );
  return p;
}

/** Remove a mistaken paid-out while its shift is open (inside a transaction). */
async function removePayout(db, payoutId) {
  const { rows: [p] } = await db.query("SELECT * FROM till_payouts WHERE id = $1", [payoutId]);
  if (!p) throw fail(404, "Paid-out not found");
  if (p.kind === "salary") throw fail(409, "A salary is undone on the Salaries page");
  await openShiftOrFail(db, p.shift_id);
  await db.query("DELETE FROM till_payouts WHERE id = $1", [p.id]);
  if (p.expense_id) await db.query("DELETE FROM expenses WHERE id = $1", [p.expense_id]);
  if (p.supplier_payment_id) {
    await db.query(
      "UPDATE supplier_payments SET voided = true, void_reason = COALESCE(void_reason, 'Till paid-out removed') WHERE id = $1",
      [p.supplier_payment_id],
    );
  }
  return p;
}

/** The till payout behind an expense row, with its shift status (or null). */
async function payoutForExpense(db, expenseId) {
  const { rows: [p] } = await db.query(
    `SELECT p.*, cs.status AS shift_status FROM till_payouts p
       JOIN cash_shifts cs ON cs.id = p.shift_id WHERE p.expense_id = $1`,
    [expenseId],
  );
  return p || null;
}

module.exports = {
  KINDS, KIND_KEYS, PAID_FROM, LATE_DISCOUNT_CATEGORY,
  TILL_PAYOUTS_DDL, PAID_OUT_SQL, PAID_OUT_SUBSELECT,
  paidOutForShift, createPayout, removePayout, payoutForExpense, openShiftOrFail,
};
