/**
 * Till paid-ins (One Toy Store pilot F3c): cash put into the drawer from the
 * bank, the owner, or a staff member paying back. Same permission as Paid out
 * (pos_paid_out: the person handling drawer cash). Logic + SQL in
 * services/till-payins.js.
 */
const payins = require("../services/till-payins");

module.exports = function registerTillPayinRoutes(app, deps) {
  const { db, requirePerm } = deps;

  const actorId = async (req) => {
    const id = Number(req.employee?.id || req.headers["x-employee-id"] || 0) || null;
    if (!id) return null;
    const { rows: [e] } = await db.query("SELECT id FROM employees WHERE id = $1", [id]);
    return e?.id || null;
  };
  const sendErr = (res, err) => res.status(err.statusCode || 500).json({ error: err.message });

  // Everything the Paid in box needs, in one call.
  app.get("/api/till-payins/options", requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const [accounts, staff] = await Promise.all([
        payins.accountOptions(db),
        db.query("SELECT id, name FROM employees ORDER BY name"),
      ]);
      res.json({ kinds: payins.KINDS, accounts, staff: staff.rows });
    } catch (err) {
      sendErr(res, err);
    }
  });

  // The paid-ins of one shift, newest first, with their total.
  app.get("/api/till-payins", requirePerm("pos_paid_out"), async (req, res) => {
    const shiftId = Number(req.query.shift_id);
    if (!shiftId) return res.status(400).json({ error: "shift_id required" });
    try {
      const { rows } = await db.query(
        `SELECT p.*, p.amount::float AS amount, st.name AS staff_name, emp.name AS employee_name
           FROM till_payins p
           LEFT JOIN employees st ON st.id = p.staff_employee_id
           LEFT JOIN employees emp ON emp.id = p.employee_id
          WHERE p.shift_id = $1
          ORDER BY p.created_at DESC, p.id DESC`,
        [shiftId],
      );
      res.json({ payins: rows, total: await payins.paidInForShift(db, shiftId) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/till-payins", requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const employeeId = await actorId(req);
      const payin = await db.transaction((client) =>
        payins.createPayin(client, req.body || {}, { employeeId }));
      res.status(201).json({ payin: { ...payin, amount: Number(payin.amount) } });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/till-payins/:id", requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const p = await db.transaction((client) => payins.removePayin(client, Number(req.params.id)));
      res.json({ removed: p.id });
    } catch (err) {
      sendErr(res, err);
    }
  });
};
