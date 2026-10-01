/**
 * Staff register, staff account and salaries (One Toy Store pilot F3b).
 * Owner-only: manage_employees (Administrators pass via all_access). Paying
 * a salary also takes cash from the drawer, so it needs pos_paid_out too.
 * Logic + SQL in services/staff-pay.js.
 */
const pay = require("../services/staff-pay");
const { tenantToday } = require("../utils/tz");

module.exports = function registerStaffPayRoutes(app, deps) {
  const { db, requirePerm } = deps;
  const OWNER = requirePerm("manage_employees");

  const actorId = async (req) => {
    const id = Number(req.employee?.id || req.headers["x-employee-id"] || 0) || null;
    if (!id) return null;
    const { rows: [e] } = await db.query("SELECT id FROM employees WHERE id = $1", [id]);
    return e?.id || null;
  };
  const tzOf = (req) => req.company?.timezone || "UTC";
  const sendErr = (res, err) => res.status(err.statusCode || 500).json({ error: err.message });

  app.get("/api/staff-pay/register", OWNER, async (req, res) => {
    try {
      res.json(await pay.register(db, req.query.month, tzOf(req)));
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.put("/api/staff-pay/register", OWNER, async (req, res) => {
    try {
      const employeeId = await actorId(req);
      const r = await db.transaction((client) => pay.setMark(client, req.body || {}, { employeeId }));
      res.json(r);
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.put("/api/staff-pay/register/bulk", OWNER, async (req, res) => {
    try {
      const employeeId = await actorId(req);
      res.json(await db.transaction((client) => pay.setMarks(client, req.body || {}, { employeeId })));
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get("/api/staff-pay/register/history", OWNER, async (req, res) => {
    try {
      res.json({ history: await pay.markHistory(db, Number(req.query.employee_id) || 0, req.query.month) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.put("/api/staff-pay/staff/:id", OWNER, async (req, res) => {
    try {
      const n = await pay.setAllowance(db, Number(req.params.id), req.body?.monthly_leave_allowance);
      res.json({ id: Number(req.params.id), monthly_leave_allowance: n });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get("/api/staff-pay/salaries", OWNER, async (req, res) => {
    try {
      res.json(await pay.salaries(db, req.query.month, tzOf(req)));
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/staff-pay/salaries", OWNER, requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const employeeId = await actorId(req);
      const tz = tzOf(req);
      const salary = await db.transaction((client) =>
        pay.paySalary(client, req.body || {}, { employeeId, today: tenantToday(tz), tz }));
      res.status(201).json({ salary });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/staff-pay/salaries/:id", OWNER, requirePerm("pos_paid_out"), async (req, res) => {
    try {
      const s = await db.transaction((client) => pay.undoSalary(client, Number(req.params.id)));
      res.json({ removed: s.id });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.get("/api/staff-pay/accounts/:id", OWNER, async (req, res) => {
    try {
      res.json({ ...(await pay.account(db, Number(req.params.id), tzOf(req))), entry_kinds: pay.ENTRY_KINDS });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.post("/api/staff-pay/accounts/:id/entries", OWNER, async (req, res) => {
    try {
      const createdBy = await actorId(req);
      const e = await pay.addEntry(db, Number(req.params.id), req.body || {}, { createdBy });
      res.status(201).json({ entry: { ...e, amount: Number(e.amount) } });
    } catch (err) {
      sendErr(res, err);
    }
  });

  app.delete("/api/staff-pay/accounts/entries/:entryId", OWNER, async (req, res) => {
    try {
      const e = await pay.removeEntry(db, Number(req.params.entryId));
      res.json({ removed: e.id });
    } catch (err) {
      sendErr(res, err);
    }
  });
};
