/**
 * One Toy Store pilot F3b: staff register, staff account and salaries.
 *
 * Owner, 2026-10-01 (PHASE-F-PLAN F3b, Q3b.1–Q3b.15):
 *  - The register is a month grid, one row per staff member (employees with a
 *    monthly salary), a box per day: P present, A absent, S sick. A box the
 *    owner marked wins; otherwise a kiosk clock-in that day shows as P. Only
 *    manage_employees marks it, a reason is required, and every change is kept
 *    in staff_attendance_mark_log (who, when, old → new, why).
 *  - Pay = salary + (allowed − A days) × salary ÷ 30, rounded to the nearest
 *    Rs 10. S days are not taken from the allowance.
 *  - Staff account (what the person owes the shop) = earlier entries from the
 *    paper register + till advances − till pay-backs − amounts cut from
 *    salary. The owner picks how much to cut; the rest carries over.
 *  - Paying a salary: the net leaves the drawer as a till_payouts row of kind
 *    'salary' (Close Shift expected goes down) and the full earned pay (gross)
 *    is a "Salaries" expense paid from the till (profit sees it once; the cut
 *    part only settles the account). Undo only while that shift is open.
 *  - Staff toys (part 2, Q3b.12–Q3b.15): rung at the till at normal price
 *    with a 'staff' discount down to cost (the server works the cost out),
 *    paid Cash / Online / "Cut from salary". A "Cut from salary" bill goes
 *    onto the account; a void, or a return refunded "Cut from salary", takes
 *    it back off. sales.staff_employee_id marks the bill (v150).
 */
const { openShiftOrFail } = require("./till-payouts");

const MARKS = ["P", "A", "S"];
const ENTRY_KINDS = [
  { key: "earlier_advance", label: "Advance (paper register)" },
  { key: "earlier_purchase", label: "Toy taken (paper register)" },
  { key: "adjust", label: "Correction" },
];
const ENTRY_KEYS = ENTRY_KINDS.map((k) => k.key);
const SALARIES_CATEGORY = "Salaries";
// The till's payment name for a staff toy taken against the salary. Not cash,
// card or online: it never touches the drawer (shifts.js counts only 'Cash').
const CUT_FROM_SALARY = "Cut from salary";
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const STAFF_PAY_DDL = `
ALTER TABLE till_payouts DROP CONSTRAINT IF EXISTS till_payouts_kind_check;
ALTER TABLE till_payouts ADD CONSTRAINT till_payouts_kind_check
  CHECK (kind IN ('shop_cost','supplier','owner','staff_advance','late_discount','salary'));
CREATE TABLE IF NOT EXISTS staff_attendance_marks (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  day DATE NOT NULL,
  mark TEXT NOT NULL CHECK (mark IN ('P','A','S')),
  reason TEXT NOT NULL,
  set_by INTEGER REFERENCES employees(id),
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, day)
);
CREATE TABLE IF NOT EXISTS staff_attendance_mark_log (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  day DATE NOT NULL,
  old_mark TEXT,
  new_mark TEXT,
  reason TEXT NOT NULL,
  set_by INTEGER REFERENCES employees(id),
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_mark_log_emp_day ON staff_attendance_mark_log(employee_id, day);
CREATE TABLE IF NOT EXISTS staff_account_entries (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  kind TEXT NOT NULL CHECK (kind IN ('earlier_advance','earlier_purchase','adjust')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),
  entry_date DATE NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_account_entries_emp ON staff_account_entries(employee_id);
CREATE TABLE IF NOT EXISTS staff_salaries (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  monthly_salary NUMERIC(12,2) NOT NULL,
  leave_allowance INTEGER NOT NULL,
  a_days INTEGER NOT NULL,
  s_days INTEGER NOT NULL,
  leave_adjust NUMERIC(12,2) NOT NULL,
  gross NUMERIC(12,2) NOT NULL,
  cut_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cut_amount >= 0),
  net_pay NUMERIC(12,2) NOT NULL CHECK (net_pay >= 0),
  shift_id INTEGER REFERENCES cash_shifts(id),
  payout_id INTEGER REFERENCES till_payouts(id) ON DELETE SET NULL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  note TEXT,
  paid_by INTEGER REFERENCES employees(id),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, month)
);
`;

// v150: the staff member a bill was sold to at cost (staff purchase).
const STAFF_PURCHASE_DDL = `
ALTER TABLE sales ADD COLUMN IF NOT EXISTS staff_employee_id INTEGER REFERENCES employees(id);
CREATE INDEX IF NOT EXISTS idx_sales_staff_employee ON sales(staff_employee_id) WHERE staff_employee_id IS NOT NULL;
`;

const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });

function parseMonth(month) {
  const m = String(month || "").match(MONTH_RE);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw fail(400, "month must be YYYY-MM");
  const days = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { month: `${m[1]}-${m[2]}`, first: `${m[1]}-${m[2]}-01`, last: `${m[1]}-${m[2]}-${String(days).padStart(2, "0")}`, days };
}

function parseDay(day) {
  const m = String(day || "").match(DAY_RE);
  if (!m) throw fail(400, "day must be YYYY-MM-DD");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) throw fail(400, "Not a real date");
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round10 = (n) => Math.round(n / 10) * 10;

async function staffList(db) {
  const { rows } = await db.query(
    `SELECT id, name, monthly_salary::float AS monthly_salary,
            COALESCE(monthly_leave_allowance, 0)::int AS allowance,
            COALESCE(home_staff, false) AS home_staff
       FROM employees
      WHERE deleted_at IS NULL AND COALESCE(monthly_salary, 0) > 0
      ORDER BY id`,
  );
  return rows;
}

/** Salaried staff for the till's Staff button (name only). */
async function tillStaff(db) {
  return (await staffList(db)).map((s) => ({ id: s.id, name: s.name }));
}

async function staffMember(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw fail(400, "Pick the staff member");
  const { rows: [st] } = await db.query(
    `SELECT id, name FROM employees
      WHERE id = $1 AND deleted_at IS NULL AND COALESCE(monthly_salary, 0) > 0`, [n]);
  if (!st) throw fail(400, "Only staff with a monthly salary can buy at cost");
  return st;
}

/**
 * Cost per cart line for a staff purchase, from the database (never the
 * till). A line whose product has no cost price is refused: it would sell at 0.
 * items: [{ id, variant_id?, quantity, price }].
 */
async function staffCosts(db, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw fail(400, "The cart is empty");
  const ids = [...new Set(list.map((i) => Number(i.original_product_id || i.id)).filter((n) => n > 0))];
  const vids = [...new Set(list.map((i) => Number(i.variant_id)).filter((n) => n > 0))];
  const prods = new Map((await db.query(
    "SELECT id, name, cost_price::float AS cost FROM products WHERE id = ANY($1::int[])", [ids])).rows
    .map((r) => [Number(r.id), r]));
  const vars = new Map(vids.length ? (await db.query(
    "SELECT id, cost_price::float AS cost FROM product_variants WHERE id = ANY($1::int[])", [vids])).rows
    .map((r) => [Number(r.id), r]) : []);
  let subtotal = 0;
  let total = 0;
  const lines = list.map((i) => {
    const pid = Number(i.original_product_id || i.id);
    const p = prods.get(pid);
    if (!p) throw fail(400, "Item not found");
    const v = i.variant_id ? vars.get(Number(i.variant_id)) : null;
    const cost = round2(Number(v && v.cost > 0 ? v.cost : p.cost) || 0);
    if (!(cost > 0)) throw fail(400, `${p.name}: no cost price, can't sell it at cost`);
    const qty = Number(i.quantity) || 0;
    const price = Number(i.price) || 0;
    if (qty <= 0) throw fail(400, "Quantity must be above 0");
    subtotal += price * qty;
    total += cost * qty;
    return { id: pid, variant_id: i.variant_id || null, name: p.name, quantity: qty, price, cost };
  });
  subtotal = round2(subtotal);
  total = round2(total);
  return { lines, subtotal, total, staff_discount: round2(Math.max(0, subtotal - total)) };
}

async function staffQuote(db, body) {
  const st = await staffMember(db, body.employee_id);
  return { staff: st, ...(await staffCosts(db, body.items)) };
}

/** A staff purchase may be paid Cash, Online - …, or Cut from salary. */
function staffPaymentAllowed(method) {
  const m = String(method || "");
  return m === "Cash" || m === CUT_FROM_SALARY || m.startsWith("Online - ");
}

/** The month grid. tz = the shop's timezone (clock-ins are bucketed in it). */
async function register(db, monthStr, tz) {
  const { month, first, last, days } = parseMonth(monthStr);
  const staff = await staffList(db);
  const ids = staff.map((s) => s.id);
  const [marks, clocks] = ids.length
    ? await Promise.all([
      db.query(
        `SELECT employee_id, EXTRACT(DAY FROM day)::int AS d, mark, reason
           FROM staff_attendance_marks
          WHERE employee_id = ANY($1) AND day BETWEEN $2 AND $3`,
        [ids, first, last],
      ),
      db.query(
        `SELECT employee_id, EXTRACT(DAY FROM (check_in AT TIME ZONE $4)::date)::int AS d,
                MIN(check_in) AS first_in, MAX(check_out) AS last_out
           FROM employee_attendance
          WHERE employee_id = ANY($1) AND (check_in AT TIME ZONE $4)::date BETWEEN $2 AND $3
          GROUP BY 1, 2`,
        [ids, first, last, tz],
      ),
    ])
    : [{ rows: [] }, { rows: [] }];

  const presentByDay = {};
  const out = staff.map((s) => {
    const cells = {};
    for (const c of clocks.rows.filter((r) => r.employee_id === s.id)) {
      cells[c.d] = { mark: "P", source: "clock", first_in: c.first_in, last_out: c.last_out };
    }
    for (const m of marks.rows.filter((r) => r.employee_id === s.id)) {
      cells[m.d] = { ...(cells[m.d] || {}), mark: m.mark, source: "mark", reason: m.reason };
    }
    let p = 0;
    let a = 0;
    let sick = 0;
    for (const [d, c] of Object.entries(cells)) {
      if (c.mark === "P") {
        p += 1;
        // F4b: home staff are not counted as present in the shop.
        if (!s.home_staff) presentByDay[d] = (presentByDay[d] || 0) + 1;
      } else if (c.mark === "A") a += 1;
      else if (c.mark === "S") sick += 1;
    }
    return { ...s, marks: cells, p_days: p, a_days: a, s_days: sick, diff: s.allowance - a };
  });
  return { month, days, staff: out, present_by_day: presentByDay };
}

/** Set (or clear, mark = null) one box. Inside a transaction. */
async function setMark(db, body, { employeeId }) {
  const day = parseDay(body.day);
  const mark = body.mark === null || body.mark === "" || body.mark === undefined ? null : String(body.mark).toUpperCase();
  if (mark !== null && !MARKS.includes(mark)) throw fail(400, "Mark must be P, A or S");
  const reason = String(body.reason || "").trim().slice(0, 300);
  if (!reason) throw fail(400, "Write why (e.g. from paper register, forgot to clock in, sick)");
  const { rows: [st] } = await db.query(
    "SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL", [Number(body.employee_id) || 0]);
  if (!st) throw fail(400, "Pick the staff member");

  const { rows: [cur] } = await db.query(
    "SELECT mark FROM staff_attendance_marks WHERE employee_id = $1 AND day = $2 FOR UPDATE", [st.id, day]);
  const old = cur?.mark || null;
  if (old === mark) return { employee_id: st.id, day, mark, changed: false };
  if (mark === null) {
    await db.query("DELETE FROM staff_attendance_marks WHERE employee_id = $1 AND day = $2", [st.id, day]);
  } else {
    await db.query(
      `INSERT INTO staff_attendance_marks (employee_id, day, mark, reason, set_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id, day) DO UPDATE
         SET mark = EXCLUDED.mark, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, set_at = NOW()`,
      [st.id, day, mark, reason, employeeId || null],
    );
  }
  await db.query(
    `INSERT INTO staff_attendance_mark_log (employee_id, day, old_mark, new_mark, reason, set_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [st.id, day, old, mark, reason, employeeId || null],
  );
  return { employee_id: st.id, day, mark, changed: true };
}

/** Many boxes, one reason, one transaction (e.g. "fill empty days with P"). */
async function setMarks(db, body, ctx) {
  const list = Array.isArray(body.marks) ? body.marks : [];
  if (!list.length) throw fail(400, "Nothing to mark");
  if (list.length > 31 * 60) throw fail(400, "Too many boxes at once");
  let changed = 0;
  for (const m of list) {
    const r = await setMark(db, { ...m, reason: body.reason }, ctx);
    if (r.changed) changed += 1;
  }
  return { changed };
}

async function markHistory(db, employeeId, monthStr) {
  const { first, last } = parseMonth(monthStr);
  const { rows } = await db.query(
    `SELECT l.id, to_char(l.day, 'YYYY-MM-DD') AS day, l.old_mark, l.new_mark, l.reason, l.set_at,
            e.name AS set_by_name
       FROM staff_attendance_mark_log l
       LEFT JOIN employees e ON e.id = l.set_by
      WHERE l.employee_id = $1 AND l.day BETWEEN $2 AND $3
      ORDER BY l.day, l.id`,
    [employeeId, first, last],
  );
  return rows;
}

async function setAllowance(db, id, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 31) throw fail(400, "Allowed leave must be 0–31 days");
  const { rowCount } = await db.query(
    "UPDATE employees SET monthly_leave_allowance = $1 WHERE id = $2 AND deleted_at IS NULL", [n, id]);
  if (!rowCount) throw fail(404, "Staff member not found");
  return n;
}

// Everything that moves one person's account. amount > 0 = owes the shop
// more; < 0 = owes less: earlier entries, till advances, till pay-backs,
// salary cuts.
const ACCOUNT_SQL = `
  SELECT 'entry' AS source, e.id, e.kind, e.amount::float AS amount, e.entry_date::text AS date,
         e.note, e.created_at AS at, NULL::int AS shift_id, NULL::int AS sale_id
    FROM staff_account_entries e WHERE e.employee_id = $1
  UNION ALL
  SELECT 'till_payout', p.id, 'staff_advance', p.amount::float, NULL, p.note, p.created_at, p.shift_id, NULL
    FROM till_payouts p WHERE p.kind = 'staff_advance' AND p.staff_employee_id = $1
  UNION ALL
  SELECT 'till_payin', i.id, 'staff_repay', -i.amount::float, NULL, i.note, i.created_at, i.shift_id, NULL
    FROM till_payins i WHERE i.kind = 'staff_repay' AND i.staff_employee_id = $1
  UNION ALL
  SELECT 'salary', s.id, 'salary_cut', -s.cut_amount::float, NULL, 'Cut from ' || s.month || ' salary',
         s.paid_at, s.shift_id, NULL
    FROM staff_salaries s WHERE s.employee_id = $1 AND s.cut_amount > 0
  UNION ALL
  SELECT 'sale', sp.id, 'staff_purchase', sp.amount::float, NULL, sa.invoice_number, sa.timestamp, sa.shift_id, sa.id
    FROM sales sa JOIN sale_payments sp ON sp.sale_id = sa.id
   WHERE sa.staff_employee_id = $1 AND COALESCE(sa.voided, false) = false
     AND sp.payment_method = '${CUT_FROM_SALARY}'
  UNION ALL
  SELECT 'return', r.id, 'staff_return', -(r.total_refund - COALESCE(r.credit_applied, 0))::float, NULL, sa.invoice_number, r.timestamp, r.shift_id, sa.id
    FROM returns r JOIN sales sa ON sa.id = r.original_sale_id
   WHERE sa.staff_employee_id = $1 AND r.refund_method = '${CUT_FROM_SALARY}'
`;

async function accountBalance(db, employeeId) {
  const { rows: [r] } = await db.query(`SELECT COALESCE(SUM(amount), 0)::float AS b FROM (${ACCOUNT_SQL}) x`, [employeeId]);
  return round2(Number(r.b || 0));
}

async function account(db, employeeId, tz) {
  const { rows: [emp] } = await db.query(
    "SELECT id, name, monthly_salary::float AS monthly_salary FROM employees WHERE id = $1", [employeeId]);
  if (!emp) throw fail(404, "Staff member not found");
  const { rows } = await db.query(
    `SELECT x.*, COALESCE(x.date, to_char(x.at AT TIME ZONE $2, 'YYYY-MM-DD')) AS day
       FROM (${ACCOUNT_SQL}) x ORDER BY day, x.at, x.id`,
    [employeeId, tz],
  );
  let running = 0;
  const entries = rows.map((r) => {
    running = round2(running + Number(r.amount));
    return { ...r, amount: Number(r.amount), balance: running };
  });
  const { rows: purchases } = await db.query(
    `SELECT sa.id AS sale_id, sa.invoice_number, to_char(sa.timestamp AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
            si.product_id, COALESCE(p.name, si.product_id::text) AS name, si.quantity::float AS quantity,
            si.price_at_sale::float AS price,
            ROUND(((si.price_at_sale - COALESCE(si.cost_price_at_sale, 0)) * si.quantity)::numeric, 2)::float AS staff_discount,
            sa.payment_method AS paid
       FROM sales sa JOIN sale_items si ON si.sale_id = sa.id
       LEFT JOIN products p ON p.id = si.product_id
      WHERE sa.staff_employee_id = $1 AND COALESCE(sa.voided, false) = false
      ORDER BY sa.timestamp, sa.id, si.id`,
    [employeeId, tz],
  );
  return { employee: emp, entries, balance: running, purchases };
}

async function addEntry(db, employeeId, body, { createdBy }) {
  const kind = String(body.kind || "");
  if (!ENTRY_KEYS.includes(kind)) throw fail(400, "Pick what it is");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) throw fail(400, "Enter an amount");
  if (kind !== "adjust" && amount < 0) throw fail(400, "Enter an amount above 0");
  const date = parseDay(body.entry_date);
  const { rows: [st] } = await db.query("SELECT id FROM employees WHERE id = $1", [employeeId]);
  if (!st) throw fail(404, "Staff member not found");
  const note = body.note ? String(body.note).trim().slice(0, 500) || null : null;
  if (kind === "adjust" && !note) throw fail(400, "Write why");
  const { rows: [e] } = await db.query(
    `INSERT INTO staff_account_entries (employee_id, kind, amount, entry_date, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [st.id, kind, round2(amount), date, note, createdBy || null],
  );
  return e;
}

async function removeEntry(db, entryId) {
  const { rows: [e] } = await db.query("DELETE FROM staff_account_entries WHERE id = $1 RETURNING *", [entryId]);
  if (!e) throw fail(404, "Entry not found");
  return e;
}

function payFor(s) {
  const perDay = s.monthly_salary / 30;
  const leaveAdjust = round2(s.diff * perDay);
  return { per_day: round2(perDay), leave_adjust: leaveAdjust, gross: round10(s.monthly_salary + leaveAdjust) };
}

async function salaries(db, monthStr, tz) {
  const reg = await register(db, monthStr, tz);
  const { rows: paid } = await db.query(
    `SELECT s.*, s.gross::float AS gross, s.cut_amount::float AS cut_amount, s.net_pay::float AS net_pay,
            s.leave_adjust::float AS leave_adjust, s.monthly_salary::float AS monthly_salary,
            cs.status AS shift_status, e.name AS paid_by_name
       FROM staff_salaries s
       LEFT JOIN cash_shifts cs ON cs.id = s.shift_id
       LEFT JOIN employees e ON e.id = s.paid_by
      WHERE s.month = $1`,
    [reg.month],
  );
  const staff = [];
  for (const s of reg.staff) {
    const { marks, ...rest } = s;
    staff.push({
      ...rest,
      ...payFor(s),
      marked_days: Object.keys(marks).length,
      balance: await accountBalance(db, s.id),
      paid: paid.find((p) => p.employee_id === s.id) || null,
    });
  }
  // Staff toys at cost this month: the discount given, kept apart from
  // customer discounts (Q3b.14). Shop days, in the shop's timezone.
  const { first, last } = parseMonth(reg.month);
  const { rows: [sd] } = await db.query(
    `SELECT COUNT(*)::int AS bills, COALESCE(SUM(discount_amount), 0)::float AS value
       FROM sales
      WHERE discount_type = 'staff' AND COALESCE(voided, false) = false
        AND (timestamp AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`,
    [first, last, tz],
  );
  return { month: reg.month, days: reg.days, staff, staff_discounts: { bills: sd.bills, value: round2(sd.value) } };
}

async function salariesCategoryId(db) {
  await db.query(
    "INSERT INTO expense_categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    [SALARIES_CATEGORY, "Staff salaries paid from the till (F3b)"],
  );
  const { rows: [c] } = await db.query("SELECT id FROM expense_categories WHERE name = $1", [SALARIES_CATEGORY]);
  return c.id;
}

/** Pay one salary from the till. Inside a transaction. */
async function paySalary(db, body, { employeeId, today, tz }) {
  const reg = await register(db, body.month, tz);
  const s = reg.staff.find((x) => x.id === Number(body.employee_id));
  if (!s) throw fail(400, "Pick a staff member with a salary");
  const shift = await openShiftOrFail(db, Number(body.shift_id));
  const cut = Number(body.cut_amount || 0);
  if (!Number.isFinite(cut) || cut < 0) throw fail(400, "Amount to cut can't be below 0");
  const cutAmt = round2(cut);
  const balance = await accountBalance(db, s.id);
  if (cutAmt > Math.max(0, balance)) throw fail(400, `Only ${balance} is owed; can't cut ${cutAmt}`);
  const pay = payFor(s);
  if (cutAmt > pay.gross) throw fail(400, "Can't cut more than the salary");
  const net = round2(pay.gross - cutAmt);
  const note = body.note ? String(body.note).trim().slice(0, 500) || null : null;

  const { rows: [dup] } = await db.query(
    "SELECT id FROM staff_salaries WHERE employee_id = $1 AND month = $2 FOR UPDATE", [s.id, reg.month]);
  if (dup) throw fail(409, "This month's salary is already paid");

  // F4b: a home staff salary is the owner's home cost: Owner / home paid-out,
  // no shop "Salaries" expense, so it never reaches shop profit.
  let exp = null;
  if (!s.home_staff) {
    ({ rows: [exp] } = await db.query(
      `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date, paid_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'till') RETURNING id`,
      [await salariesCategoryId(db), shift.outlet_id, shift.id, employeeId || null, pay.gross,
        `${s.name}: ${reg.month} salary${cutAmt ? ` (cut ${cutAmt})` : ""}`, `Salary ${reg.month}`, today],
    ));
  }
  let payoutId = null;
  if (net > 0) {
    const kind = s.home_staff ? "owner" : "salary";
    const text = s.home_staff
      ? `${s.name}: ${reg.month} salary (home staff)${note ? `: ${note}` : ""}`
      : `${reg.month} salary${note ? `: ${note}` : ""}`;
    const { rows: [p] } = await db.query(
      `INSERT INTO till_payouts (shift_id, outlet_id, kind, amount, note, expense_id, staff_employee_id, employee_id)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7) RETURNING id`,
      [shift.id, shift.outlet_id, kind, net, text, s.id, employeeId || null],
    );
    payoutId = p.id;
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO staff_salaries (employee_id, month, monthly_salary, leave_allowance, a_days, s_days, leave_adjust,
                                 gross, cut_amount, net_pay, shift_id, payout_id, expense_id, note, paid_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [s.id, reg.month, s.monthly_salary, s.allowance, s.a_days, s.s_days, pay.leave_adjust,
      pay.gross, cutAmt, net, shift.id, payoutId, exp ? exp.id : null, note, employeeId || null],
  );
  return row;
}

/** Undo a salary while its shift is open. Inside a transaction. */
async function undoSalary(db, salaryId) {
  const { rows: [s] } = await db.query("SELECT * FROM staff_salaries WHERE id = $1 FOR UPDATE", [salaryId]);
  if (!s) throw fail(404, "Salary not found");
  const { rows: [cs] } = await db.query("SELECT status FROM cash_shifts WHERE id = $1", [s.shift_id]);
  if (!cs || cs.status !== "open") throw fail(409, "Paid in a closed shift: it can't be undone");
  await db.query("DELETE FROM staff_salaries WHERE id = $1", [s.id]);
  if (s.payout_id) await db.query("DELETE FROM till_payouts WHERE id = $1", [s.payout_id]);
  if (s.expense_id) await db.query("DELETE FROM expenses WHERE id = $1", [s.expense_id]);
  return s;
}

module.exports = {
  MARKS, ENTRY_KINDS, ENTRY_KEYS, SALARIES_CATEGORY, STAFF_PAY_DDL, CUT_FROM_SALARY, STAFF_PURCHASE_DDL,
  tillStaff, staffMember, staffCosts, staffQuote, staffPaymentAllowed,
  parseMonth, register, setMark, setMarks, markHistory, setAllowance,
  account, accountBalance, addEntry, removeEntry, salaries, paySalary, undoSalary,
};
