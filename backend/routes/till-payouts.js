/**
 * Till paid-outs (One Toy Store pilot F3 / D50): cash taken out of the drawer
 * for a shop cost, a supplier, the owner's home, a staff advance or a discount
 * given back after the sale. Logic + SQL in services/till-payouts.js.
 */
const payouts = require("../services/till-payouts");
const { tenantToday } = require("../utils/tz");

module.exports = function registerTillPayoutRoutes(app, deps) {
  const { db, requirePerm } = deps;

  const actor = async (req) => {
    const id = Number(req.employee?.id || req.headers["x-employee-id"] || 0) || null;
    if (!id) return { id: null, name: null };
    const { rows: [e] } = await db.query("SELECT id, name FROM employees WHERE id = $1", [id]);
    return { id: e?.id || null, name: e?.name || null };
  };
  const sendErr = (res, err) => res.status(err.statusCode || 500).json({ error: err.message });

  // Everything the Paid out box needs, in one call.
  app.get("/api/till-payouts/options", requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const [cats, sups, staff] = await Promise.all([
        db.query("SELECT id, name FROM expense_categories WHERE name <> $1 ORDER BY id", [payouts.LATE_DISCOUNT_CATEGORY]),
        db.query("SELECT id, name FROM suppliers ORDER BY name"),
        db.query("SELECT id, name FROM employees ORDER BY name"),
      ]);
      res.json({ kinds: payouts.KINDS, categories: cats.rows, suppliers: sups.rows, staff: staff.rows });
    } catch (err) {
      sendErr(res, err);
    }
  });

  // The paid-outs of one shift, newest first, with their total.
  app.get("/api/till-payouts", requirePerm("pos_paid_out"), async (req, res) => {
    const shiftId = Number(req.query.shift_id);
    if (!shiftId) return res.status(400).json({ error: "shift_id required" });
    try {
      const { rows } = await db.query(
        `SELECT p.*, p.amount::float AS amount,
                ec.name AS category_name, s.name AS supplier_name, st.name AS staff_name,
                sa.invoice_number, emp.name AS employee_name,
                (sp.voided IS TRUE) AS voided
           FROM till_payouts p
           LEFT JOIN expenses e ON e.id = p.expense_id
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
           LEFT JOIN supplier_payments sp ON sp.id = p.supplier_payment_id
           LEFT JOIN suppliers s ON s.id = sp.supplier_id
           LEFT JOIN employees st ON st.id = p.staff_employee_id
           LEFT JOIN sales sa ON sa.id = p.sale_id
           LEFT JOIN employees emp ON emp.id = p.employee_id
          WHERE p.shift_id = $1
          ORDER BY p.created_at DESC, p.id DESC`,
        [shiftId],
      );
      res.json({ payouts: rows, total: await payouts.paidOutForShift(db, shiftId) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/till-payouts", requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const who = await actor(req);
      const today = tenantToday(req.company?.timezone || "UTC");
      const payout = await db.transaction((client) =>
        payouts.createPayout(client, req.body || {}, { employeeId: who.id, employeeName: who.name, today }));
      res.status(201).json({ payout: { ...payout, amount: Number(payout.amount) } });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/till-payouts/:id", requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const p = await db.transaction((client) => payouts.removePayout(client, Number(req.params.id)));
      res.json({ removed: p.id });
    } catch (err) {
      sendErr(res, err);
    }
  });
};
