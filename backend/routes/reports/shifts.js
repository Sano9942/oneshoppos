const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requirePerm } = deps;
  // D4 split (PLAN-V2 Step 4, REPORT-PERMS.md §3.8) — explicit per-domain
  // guard on every route; the /api/reports blanket rule in
  // middleware/permissions.js is only a backstop.
  const salesView = requirePerm("view_sales_reports"); // cash ops — cashiers close shifts

  async function loadShift(shiftId) {
    const { rows } = await db.query(
      `SELECT cs.*, e.name AS employee_name, o.name AS outlet_name
       FROM cash_shifts cs
       LEFT JOIN employees e ON e.id = cs.employee_id
       LEFT JOIN outlets o ON o.id = cs.outlet_id
       WHERE cs.id = $1`,
      [shiftId],
    );
    return rows[0];
  }

  // Cash Flow: shift records with start/end cash (no sales/returns — unchanged)
  app.get("/api/reports/cash-flow", salesView, async (req, res) => {
    try {
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
      const { text, values } = helpers.pgWhere(where, params);
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
        ${where.length ? `WHERE ${text}` : ""}
        ORDER BY cs.opened_at DESC
      `;
      const { rows } = await db.query(sql, values);
      res.json({ sessions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cash Audit: cash sales and cash returns linked to this shift
  app.get("/api/reports/cash-audit", salesView, async (req, res) => {
    try {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ error: "session_id required" });
      const shift = await loadShift(session_id);
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT 'Sale' AS type, s.timestamp, s.total_amount AS amount, s.id AS ref_id
        FROM sales s
        WHERE s.shift_id = $1 AND s.voided = false AND s.payment_method = 'Cash'
        UNION ALL
        SELECT 'Return' AS type, r.timestamp, -r.total_refund AS amount, r.id AS ref_id
        FROM returns r
        WHERE r.shift_id = $2 AND r.refund_method = 'Cash'
        UNION ALL
        -- F3 (D50): cash paid out of the till (a voided supplier payment gave it back)
        SELECT 'Paid out' AS type, p.created_at AS timestamp, -p.amount AS amount, p.id AS ref_id
        FROM till_payouts p
        LEFT JOIN supplier_payments sp ON sp.id = p.supplier_payment_id
        WHERE p.shift_id = $2 AND (p.supplier_payment_id IS NULL OR sp.voided IS NOT TRUE)
        ORDER BY timestamp ASC
      `;
      const { rows } = await db.query(sql, [session_id, session_id]);
      res.json({ audit: rows, shift });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Shift Summary
  app.get("/api/reports/shift-summary", salesView, async (req, res) => {
    try {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ error: "session_id required" });
      const shift = await loadShift(session_id);
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          (SELECT ROUND(COALESCE(SUM(total_amount), 0), 2) FROM sales s
           WHERE s.shift_id = $1 AND s.voided = false) AS total_sales,
          (SELECT ROUND(COALESCE(SUM(total_refund), 0), 2) FROM returns r
           WHERE r.shift_id = $2) AS total_returns,
          (SELECT COUNT(*) FROM sales s
           WHERE s.shift_id = $3 AND s.voided = false) AS order_count,
          (SELECT COUNT(*) FROM sales s
           WHERE s.shift_id = $4 AND s.voided = true) AS void_count
      `;
      const { rows } = await db.query(sql, [session_id, session_id, session_id, session_id]);
      res.json({ summary: rows[0], shift });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Shift Sales: list of sales linked to this shift
  app.get("/api/reports/shift-sales", salesView, async (req, res) => {
    try {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ error: "session_id required" });
      const shift = await loadShift(session_id);
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          s.*,
          COALESCE(c.name, 'Walk-in') AS customer_name,
          COALESCE(e.name, '-') AS employee_name
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        LEFT JOIN employees e ON e.id = s.employee_id
        WHERE s.shift_id = $1
        ORDER BY s.timestamp DESC
      `;
      const { rows } = await db.query(sql, [session_id]);
      res.json({ sales: rows, shift });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Payment Summary: breakdown of payments by method for this shift
  app.get("/api/reports/payment-summary", salesView, async (req, res) => {
    try {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ error: "session_id required" });
      const shift = await loadShift(session_id);
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          COALESCE(sp.payment_method, s.payment_method) AS payment_method,
          ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total,
          COUNT(DISTINCT s.id) AS count
        FROM sales s
        LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE s.shift_id = $1 AND s.voided = false
        GROUP BY COALESCE(sp.payment_method, s.payment_method)
        ORDER BY total DESC
      `;
      const { rows } = await db.query(sql, [session_id]);
      res.json({ payments: rows, shift });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // All Denominations (unchanged — already uses shift_id via shift_denominations table)
  app.get("/api/reports/all-denominations", salesView, async (req, res) => {
    try {
      const { session_id } = req.query;
      const params = [];
      const where = [];
      if (session_id) {
        where.push("sd.shift_id = ?");
        params.push(session_id);
      }
      const { text, values } = helpers.pgWhere(where, params);
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
        ${where.length ? `WHERE ${text}` : ""}
        ORDER BY cs.opened_at DESC, sd.stage ASC, sd.denomination DESC
        LIMIT 500
      `;
      const { rows } = await db.query(sql, values);
      res.json({ denominations: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Current Session Z-Report
  app.get("/api/reports/current-session-zreport", salesView, async (req, res) => {
    try {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ error: "session_id required" });
      const shift = await loadShift(session_id);
      if (!shift) return res.status(404).json({ error: "Shift not found" });
      const sql = `
        SELECT
          COALESCE(sp.payment_method, s.payment_method) AS method,
          ROUND(COALESCE(SUM(COALESCE(sp.amount, s.total_amount)), 0), 2) AS total
        FROM sales s
        LEFT JOIN sale_payments sp ON sp.sale_id = s.id
        WHERE s.shift_id = $1 AND s.voided = false
        GROUP BY COALESCE(sp.payment_method, s.payment_method)
        ORDER BY total DESC
      `;
      const { rows } = await db.query(sql, [session_id]);
      res.json({ zReport: rows, shift });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
