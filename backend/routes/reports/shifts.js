const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps) {
  const { db } = deps;

  function loadShift(shiftId, cb) {
    db.get(
      `SELECT cs.*, e.name AS employee_name, o.name AS outlet_name
       FROM cash_shifts cs
       LEFT JOIN employees e ON e.id = cs.employee_id
       LEFT JOIN outlets o ON o.id = cs.outlet_id
       WHERE cs.id = ?`,
      [shiftId],
      cb,
    );
  }

  // Cash Flow: shift records with start/end cash (no sales/returns — unchanged)
  app.get("/api/reports/cash-flow", (req, res) => {
    const { date_from, date_to } = req.query;
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];
    if (date_from) {
      where.push("cs.opened_at >= ?");
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push("cs.opened_at < ?");
      params.push(toUtcEnd(date_to, tz));
    }
    const sql = `
      SELECT
        cs.id,
        cs.outlet_id,
        cs.employee_id,
        cs.status,
        cs.opened_at AS start_time,
        cs.closed_at AS end_time,
        cs.opening_float AS start_cash,
        cs.closing_cash AS end_cash,
        cs.expected_cash,
        cs.variance,
        cs.notes,
        cs.variance_reason,
        cs.variance_approved_by,
        e.name AS employee_name,
        o.name AS outlet_name
      FROM cash_shifts cs
      LEFT JOIN employees e ON e.id = cs.employee_id
      LEFT JOIN outlets o ON o.id = cs.outlet_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY cs.opened_at DESC
    `;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sessions: rows });
    });
  });

  // Cash Audit: cash sales and cash returns linked to this shift
  app.get("/api/reports/cash-audit", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT 'Sale' AS type, s.timestamp, s.total_amount AS amount, s.id AS ref_id
        FROM sales s
        WHERE s.shift_id = ? AND s.voided = 0 AND s.payment_method = 'Cash'
        UNION ALL
        SELECT 'Return' AS type, r.timestamp, -r.total_refund AS amount, r.id AS ref_id
        FROM returns r
        WHERE r.shift_id = ? AND r.refund_method = 'Cash'
        ORDER BY timestamp ASC
      `;
      db.all(sql, [session_id, session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ audit: rows, shift });
      });
    });
  });

  // Shift Summary
  app.get("/api/reports/shift-summary", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          (SELECT ROUND(COALESCE(SUM(total_amount), 0), 2) FROM sales s
           WHERE s.shift_id = ? AND s.voided = 0) AS total_sales,
          (SELECT ROUND(COALESCE(SUM(total_refund), 0), 2) FROM returns r
           WHERE r.shift_id = ?) AS total_returns,
          (SELECT COUNT(*) FROM sales s
           WHERE s.shift_id = ? AND s.voided = 0) AS order_count,
          (SELECT COUNT(*) FROM sales s
           WHERE s.shift_id = ? AND s.voided = 1) AS void_count
      `;
      db.get(sql, [session_id, session_id, session_id, session_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ summary: row, shift });
      });
    });
  });

  // Shift Sales: list of sales linked to this shift
  app.get("/api/reports/shift-sales", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          s.*,
          COALESCE(c.name, 'Walk-in') AS customer_name,
          COALESCE(e.name, '-') AS employee_name
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE s.shift_id = ?
        ORDER BY s.timestamp DESC
      `;
      db.all(sql, [session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ sales: rows, shift });
      });
    });
  });

  // Payment Summary: breakdown of payments by method for this shift
  app.get("/api/reports/payment-summary", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          COALESCE(sp.payment_method, s.payment_method) AS payment_method,
          ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total,
          COUNT(DISTINCT s.id) AS count
        FROM sales s
        LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE s.shift_id = ? AND s.voided = 0
        GROUP BY COALESCE(sp.payment_method, s.payment_method)
        ORDER BY total DESC
      `;
      db.all(sql, [session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ payments: rows, shift });
      });
    });
  });

  // All Denominations (unchanged — already uses shift_id via shift_denominations table)
  app.get("/api/reports/all-denominations", (req, res) => {
    const { session_id } = req.query;
    const params = [];
    const where = [];
    if (session_id) {
      where.push("sd.shift_id = ?");
      params.push(session_id);
    }
    const sql = `
      SELECT
        sd.id,
        sd.shift_id AS session_id,
        sd.stage,
        sd.denomination,
        sd.count,
        ROUND(sd.denomination * sd.count, 2) AS subtotal,
        cs.opened_at AS start_time,
        cs.closed_at AS end_time,
        COALESCE(e.name, '-') AS employee_name,
        COALESCE(o.name, '-') AS outlet_name
      FROM shift_denominations sd
      JOIN cash_shifts cs ON cs.id = sd.shift_id
      LEFT JOIN employees e ON e.id = cs.employee_id
      LEFT JOIN outlets o ON o.id = cs.outlet_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY cs.opened_at DESC, sd.stage ASC, sd.denomination DESC
      LIMIT 500
    `;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ denominations: rows });
    });
  });

  // Current Session Z-Report
  app.get("/api/reports/current-session-zreport", (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    loadShift(session_id, (shiftErr, shift) => {
      if (shiftErr) return res.status(500).json({ error: shiftErr.message });
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          COALESCE(sp.payment_method, s.payment_method) AS method,
          ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total
        FROM sales s
        LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE s.shift_id = ? AND s.voided = 0
        GROUP BY COALESCE(sp.payment_method, s.payment_method)
        ORDER BY total DESC
      `;
      db.all(sql, [session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ zReport: rows, shift });
      });
    });
  });
};
