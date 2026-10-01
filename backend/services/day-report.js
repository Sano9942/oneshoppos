/**
 * One Toy Store pilot F4 (D51): the day report slip for one shift.
 *
 * Replaces the iPOS "Daily Sale Report" the shop prints at night: per payment
 * mode Sub Total / Dis Rs / Bill Total, then St Net Total, Sub Total,
 * Discount Rs, Total; plus bill count, returns, every Paid out / Paid in,
 * float, the cash that should be in the till, and (once closed) counted +
 * difference + the note count. Printable while the shift is open (check copy)
 * and for any past shift.
 *
 * Same money rules as Close Shift (routes/shifts.js): bills and returns are
 * those of the shift's outlet between opened_at and closed_at (or now), the
 * drawer counts exact 'Cash', a return gives back total_refund − credit_applied
 * (D56), paid-outs / paid-ins by shift_id.
 *
 * Real discount per bill = min(saved discount, items − payments), never < 0.
 * Bills rung before D56 saved an exchange's return credit as the discount
 * (INV-00082: items 390, discount 590, paid Return Credit 390 → 0 real), and
 * iPOS never counts that. Staff bills (discount_type 'staff', toys at cost)
 * get their own line. "Return Credit" is not a payment mode.
 */

const { paidOutForShift, KINDS: PAYOUT_KINDS } = require("./till-payouts");
const { paidInForShift, KINDS: PAYIN_KINDS } = require("./till-payins");

const RETURN_CREDIT = "Return Credit";
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fail = (status, msg) => Object.assign(new Error(msg), { statusCode: status });

// The iPOS mode names for the two it knows; every other method as saved
// ("Online - JazzCash", "Cut from salary"), in capitals like the slip.
function modeLabel(method) {
  if (method === "Cash") return "CASH";
  if (method === "Card") return "CREDIT CARD";
  return String(method || "Other").toUpperCase();
}
const MODE_ORDER = (m) => (m === "Cash" ? 0 : m === "Card" ? 1 : String(m).startsWith("Online") ? 2 : 3);

/**
 * Cash sums for the drawer between the shift's opening and `until`, shared
 * with Close Shift so the slip's expected always equals the closed figure.
 */
async function drawerTotals(db, shift, until) {
  const { rows: [c] } = await db.query(
    `SELECT COALESCE(SUM(sp.amount), 0) AS cash_sales
       FROM sale_payments sp
       JOIN sales s ON sp.sale_id = s.id
      WHERE s.outlet_id = $1 AND s.voided = false AND sp.payment_method = 'Cash'
        AND s.timestamp >= $2 AND s.timestamp <= $3`,
    [shift.outlet_id, shift.opened_at, until],
  );
  const { rows: [r] } = await db.query(
    // D56: only the money handed back, not the part of an exchange's
    // return spent on the new items.
    `SELECT COALESCE(SUM(total_refund - COALESCE(credit_applied, 0)), 0) AS cash_refunds
       FROM returns
      WHERE outlet_id = $1 AND refund_method = 'Cash'
        AND timestamp >= $2 AND timestamp <= $3`,
    [shift.outlet_id, shift.opened_at, until],
  );
  const cashSales = Number(c?.cash_sales || 0);
  const cashRefunds = Number(r?.cash_refunds || 0);
  const paidOut = await paidOutForShift(db, shift.id);
  const paidIn = await paidInForShift(db, shift.id);
  const expectedCash = parseFloat(shift.opening_float) + cashSales - cashRefunds - paidOut + paidIn;
  return { cashSales, cashRefunds, netCashSales: cashSales - cashRefunds, paidOut, paidIn, expectedCash };
}

async function buildDayReport(db, shiftId) {
  const { rows: [shift] } = await db.query(
    `SELECT cs.*, o.name AS outlet_name, e.name AS employee_name
       FROM cash_shifts cs
       LEFT JOIN outlets o ON o.id = cs.outlet_id
       LEFT JOIN employees e ON e.id = cs.employee_id
      WHERE cs.id = $1`,
    [shiftId],
  );
  if (!shift) throw fail(404, "Shift not found");
  const isOpen = shift.status === "open";
  const until = isOpen ? (await db.query("SELECT NOW() AS now")).rows[0].now : shift.closed_at;
  const win = [shift.outlet_id, shift.opened_at, until];

  // One row per not-voided bill: items, saved discount, payments.
  const { rows: bills } = await db.query(
    `SELECT s.id, s.invoice_number, s.payment_method AS header_method, s.total_amount,
            COALESCE(s.discount_amount, 0) AS discount_amount, s.discount_type,
            COALESCE((SELECT SUM(si.quantity * si.price_at_sale) FROM sale_items si WHERE si.sale_id = s.id), 0) AS items_gross,
            COALESCE((SELECT json_agg(json_build_object('method', sp.payment_method, 'amount', sp.amount) ORDER BY sp.id)
                        FROM sale_payments sp WHERE sp.sale_id = s.id), '[]'::json) AS payments
       FROM sales s
      WHERE s.outlet_id = $1 AND s.voided = false
        AND s.timestamp >= $2 AND s.timestamp <= $3
      ORDER BY s.id`,
    win,
  );
  const { rows: [voids] } = await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS value
       FROM sales s
      WHERE s.outlet_id = $1 AND s.voided = true AND s.timestamp >= $2 AND s.timestamp <= $3`,
    win,
  );

  const modes = new Map();
  let staffDiscount = 0;
  let staffBills = 0;
  for (const b of bills) {
    let pays = (Array.isArray(b.payments) ? b.payments : []).map((p) => ({ method: p.method, amount: Number(p.amount || 0) }));
    if (!pays.length) pays = [{ method: b.header_method || "Cash", amount: Number(b.total_amount || 0) }];
    const paidTotal = pays.reduce((s, p) => s + p.amount, 0);
    const isStaff = b.discount_type === "staff";
    const realDiscount = Math.max(0, Math.min(Number(b.discount_amount), Number(b.items_gross) - paidTotal));
    if (isStaff) { staffDiscount += Number(b.discount_amount); staffBills += 1; }

    const counted = pays.filter((p) => p.method !== RETURN_CREDIT && p.amount !== 0);
    const countedTotal = counted.reduce((s, p) => s + p.amount, 0);
    for (const p of counted) {
      const m = modes.get(p.method) || { method: p.method, label: modeLabel(p.method), bills: 0, sub_total: 0, discount: 0, bill_total: 0 };
      // A split bill's discount is shared by what each method paid.
      const share = isStaff || countedTotal <= 0 ? 0 : realDiscount * (p.amount / countedTotal);
      m.bills += 1;
      m.bill_total += p.amount;
      m.discount += share;
      m.sub_total += p.amount + share;
      modes.set(p.method, m);
    }
  }
  const modeRows = [...modes.values()]
    .map((m) => ({ ...m, sub_total: round2(m.sub_total), discount: round2(m.discount), bill_total: round2(m.bill_total) }))
    .sort((a, b) => MODE_ORDER(a.method) - MODE_ORDER(b.method) || a.method.localeCompare(b.method));
  const subTotal = round2(modeRows.reduce((s, m) => s + m.sub_total, 0));
  const discount = round2(modeRows.reduce((s, m) => s + m.discount, 0));
  const total = round2(modeRows.reduce((s, m) => s + m.bill_total, 0));

  // Returns: money handed back, by how it went back (D56).
  const { rows: returnRows } = await db.query(
    `SELECT refund_method AS method, COUNT(*)::int AS count,
            COALESCE(SUM(total_refund - COALESCE(credit_applied, 0)), 0) AS paid_back,
            COUNT(*) FILTER (WHERE COALESCE(credit_applied, 0) > 0 OR refund_method = $4)::int AS exchanges
       FROM returns
      WHERE outlet_id = $1 AND timestamp >= $2 AND timestamp <= $3
      GROUP BY refund_method ORDER BY refund_method`,
    [...win, RETURN_CREDIT],
  );

  const payoutLabel = Object.fromEntries(PAYOUT_KINDS.map((k) => [k.key, k.label]));
  payoutLabel.salary = "Salary";
  const { rows: payouts } = await db.query(
    `SELECT p.id, p.created_at, p.kind, p.amount::float AS amount, p.note,
            ec.name AS category_name, s.name AS supplier_name, st.name AS staff_name,
            (sp.voided IS TRUE) AS voided
       FROM till_payouts p
       LEFT JOIN expenses e ON e.id = p.expense_id
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN supplier_payments sp ON sp.id = p.supplier_payment_id
       LEFT JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN employees st ON st.id = p.staff_employee_id
      WHERE p.shift_id = $1
      ORDER BY p.created_at, p.id`,
    [shift.id],
  );
  const payinLabel = Object.fromEntries(PAYIN_KINDS.map((k) => [k.key, k.label]));
  const { rows: payins } = await db.query(
    `SELECT pi.id, pi.created_at, pi.kind, pi.amount::float AS amount, pi.note, pi.account, st.name AS staff_name
       FROM till_payins pi
       LEFT JOIN employees st ON st.id = pi.staff_employee_id
      WHERE pi.shift_id = $1
      ORDER BY pi.created_at, pi.id`,
    [shift.id],
  );

  const drawer = await drawerTotals(db, shift, until);
  const { rows: denoms } = await db.query(
    `SELECT denomination::float AS denomination, count
       FROM shift_denominations WHERE shift_id = $1 AND stage = 'closing'
      ORDER BY denomination DESC`,
    [shift.id],
  );
  const { rows: [cp] } = await db.query(
    "SELECT COALESCE(NULLIF(trading_name, ''), company_name) AS shop_name FROM company_profile WHERE id = 1",
  );

  const n = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    shop_name: cp?.shop_name || "",
    shift: {
      id: shift.id, status: shift.status, outlet_id: shift.outlet_id, outlet_name: shift.outlet_name,
      employee_name: shift.employee_name, opened_at: shift.opened_at, closed_at: shift.closed_at,
    },
    printed_until: until,
    is_check_copy: isOpen,
    modes: modeRows,
    sub_total: subTotal,
    discount,
    total,
    bill_count: bills.length,
    staff: { bills: staffBills, discount: round2(staffDiscount) },
    voids: { count: voids.count, value: round2(voids.value) },
    returns: returnRows.map((r) => ({ method: r.method, count: r.count, exchanges: r.exchanges, paid_back: round2(r.paid_back) })),
    paid_outs: payouts.map((p) => ({
      id: p.id, at: p.created_at, kind: p.kind, label: payoutLabel[p.kind] || p.kind,
      detail: p.category_name || p.supplier_name || p.staff_name || null,
      note: p.note, amount: round2(p.amount), voided: p.voided === true,
    })),
    paid_ins: payins.map((p) => ({
      id: p.id, at: p.created_at, kind: p.kind, label: payinLabel[p.kind] || p.kind,
      detail: p.account || p.staff_name || null, note: p.note, amount: round2(p.amount),
    })),
    drawer: {
      opening_float: round2(shift.opening_float),
      cash_sales: round2(drawer.cashSales),
      cash_refunds: round2(drawer.cashRefunds),
      paid_out: round2(drawer.paidOut),
      paid_in: round2(drawer.paidIn),
      // A closed shift prints what was saved at Close Shift.
      expected_cash: isOpen ? round2(drawer.expectedCash) : n(shift.expected_cash),
      counted_cash: isOpen ? null : n(shift.closing_cash),
      difference: isOpen ? null : n(shift.variance),
      variance_reason: shift.variance_reason || null,
      notes: denoms.map((d) => ({ denomination: d.denomination, count: Number(d.count) })),
    },
  };
}

module.exports = { buildDayReport, drawerTotals, modeLabel };
