module.exports = function (app, deps, helpers) {
  const { db } = deps;

  // Cash Flow: session records with start/end cash
  app.get("/api/reports/cash-flow", (req, res) => {
    const { date_from, date_to } = req.query;
    let where = [];
    const params = [];
    if (date_from) {
      where.push("date(start_time,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(start_time,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT s.*, e.name AS employee_name, o.name AS outlet_name
    FROM register_sessions s
    JOIN employees e ON s.employee_id = e.id
    JOIN outlets o ON s.outlet_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY s.start_time DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sessions: rows });
    });
  });

  // Cash Audit: breakdown of cash in/out per session
  app.get("/api/reports/cash-audit", (req, res) => {
    const { session_id } = req.query;
    if (!session_id)
      return res.status(400).json({ error: "session_id required" });
    const sql = `
    SELECT 'Sale' as type, s.timestamp, s.total_amount as amount, s.id as ref_id
    FROM sales s
    WHERE s.session_id = ? AND s.voided = 0 AND s.payment_method = 'Cash'
    UNION ALL
    SELECT 'Return' as type, r.timestamp, -r.total_refunded as amount, r.id as ref_id
    FROM returns r
    WHERE r.session_id = ? AND r.payment_method = 'Cash'
    ORDER BY timestamp ASC`;
    db.all(sql, [session_id, session_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ audit: rows });
    });
  });

  // Shift Summary
  app.get("/api/reports/shift-summary", (req, res) => {
    const { session_id } = req.query;
    if (!session_id)
      return res.status(400).json({ error: "session_id required" });
    const sql = `
    SELECT 
      (SELECT SUM(total_amount) FROM sales WHERE session_id = ? AND voided = 0) as total_sales,
      (SELECT SUM(total_refunded) FROM returns WHERE session_id = ?) as total_returns,
      (SELECT COUNT(*) FROM sales WHERE session_id = ? AND voided = 0) as order_count,
      (SELECT COUNT(*) FROM sales WHERE session_id = ? AND voided = 1) as void_count
    `;
    db.get(
      sql,
      [session_id, session_id, session_id, session_id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ summary: row });
      },
    );
  });

  // Shift Sales: list of sales in a session
  app.get("/api/reports/shift-sales", (req, res) => {
    const { session_id } = req.query;
    const sql = `
    SELECT s.*, c.name as customer_name, e.name as employee_name
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN employees e ON s.employee_id = e.id
    WHERE s.session_id = ?
    ORDER BY s.timestamp DESC`;
    db.all(sql, [session_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sales: rows });
    });
  });

  // Payment Summary: breakdown of payments by method for a session
  app.get("/api/reports/payment-summary", (req, res) => {
    const { session_id } = req.query;
    const sql = `
    SELECT payment_method, SUM(total_amount) as total, COUNT(*) as count
    FROM sales
    WHERE session_id = ? AND voided = 0
    GROUP BY payment_method`;
    db.all(sql, [session_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ payments: rows });
    });
  });

  // All Denominations: list of all denomination records
  app.get("/api/reports/all-denominations", (req, res) => {
    const sql = `
    SELECT d.*, e.name as employee_name, s.start_time, s.end_time
    FROM register_denominations d
    JOIN employees e ON d.employee_id = e.id
    LEFT JOIN register_sessions s ON d.session_id = s.id
    ORDER BY d.created_at DESC LIMIT 500`;
    db.all(sql, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ denominations: rows });
    });
  });

  // Current Session Z-Report
  app.get("/api/reports/current-session-zreport", (req, res) => {
    const { session_id } = req.query;
    if (!session_id)
      return res.status(400).json({ error: "session_id required" });
    const sql = `
      SELECT COALESCE(sp.payment_method, s.payment_method) as method, 
             SUM(COALESCE(sp.amount, s.total_amount)) as total
      FROM sales s
      LEFT JOIN sale_payments sp ON s.id = sp.sale_id
      WHERE s.session_id = ? AND s.voided = 0
      GROUP BY method
    `;
    db.all(sql, [session_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ zReport: rows });
    });
  });
};
