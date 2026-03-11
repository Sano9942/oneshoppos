const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db } = deps;

  app.get("/api/reports/labor-performance", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const tz = req.company?.timezone || "UTC";

      const saleWhere = ["s.voided = false", "s.employee_id IS NOT NULL"];
      const attendWhere = ["session_type = 'work'"];
      const saleParams = [];
      const attendParams = [];

      if (date_from) {
        saleWhere.push("s.timestamp >= ?");
        saleParams.push(toUtcStart(date_from, tz));
        attendWhere.push("session_start::date >= ?::date");
        attendParams.push(date_from);
      } else {
        const thirtyDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 24 * 3600 * 1000));
        saleWhere.push("s.timestamp >= ?");
        saleParams.push(toUtcStart(thirtyDaysAgoStr, tz));
        attendWhere.push("session_start::date >= ?::date");
        attendParams.push(thirtyDaysAgoStr);
      }

      if (date_to) {
        saleWhere.push("s.timestamp < ?");
        saleParams.push(toUtcEnd(date_to, tz));
        attendWhere.push("session_start::date <= ?::date");
        attendParams.push(date_to);
      }

      if (outlet_id) {
        const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
        if (ids.length === 1) {
          saleWhere.push("s.outlet_id = ?");
          saleParams.push(ids[0]);
          attendWhere.push("outlet_id = ?");
          attendParams.push(ids[0]);
        } else if (ids.length > 1) {
          const ph = ids.map(() => "?").join(",");
          saleWhere.push(`s.outlet_id IN (${ph})`);
          saleParams.push(...ids);
          attendWhere.push(`outlet_id IN (${ph})`);
          attendParams.push(...ids);
        }
      }

      // Build numbered params: sale params first, then attend params
      const allParams = [...saleParams, ...attendParams];
      let idx = 1;
      const saleWhereStr = saleWhere.join(" AND ").replace(/\?/g, () => `$${idx++}`);
      const attendWhereStr = attendWhere.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
        WITH EmployeeSales AS (
          SELECT employee_id, SUM(total_amount) AS total_revenue
          FROM sales s
          WHERE ${saleWhereStr}
          GROUP BY employee_id
        ),
        EmployeeHours AS (
          SELECT employee_id, SUM(duration_hours) AS total_hours
          FROM attendance_sessions
          WHERE ${attendWhereStr}
          GROUP BY employee_id
        )
        SELECT
          e.id AS employee_id,
          e.name AS employee_name,
          COALESCE(eh.total_hours, 0) AS total_hours,
          COALESCE(es.total_revenue, 0) AS total_revenue,
          CASE
            WHEN COALESCE(eh.total_hours, 0) > 0
              THEN ROUND(COALESCE(es.total_revenue, 0) / eh.total_hours, 2)
            ELSE 0
          END AS revenue_per_hour
        FROM employees e
        LEFT JOIN EmployeeSales es ON e.id = es.employee_id
        LEFT JOIN EmployeeHours eh ON e.id = eh.employee_id
        WHERE es.total_revenue > 0 OR eh.total_hours > 0
        ORDER BY revenue_per_hour DESC
      `;

      const { rows } = await db.query(sql, allParams);
      res.json({ labor_performance: rows });
    } catch (err) {
      console.error("Labor Performance Error:", err);
      res.status(500).json({ error: "Failed to load labor performance data" });
    }
  });

  app.get("/api/reports/loss-prevention", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const tz = req.company?.timezone || "UTC";

      const voidWhere = ["s.voided = true", "s.employee_id IS NOT NULL"];
      const refundWhere = ["r.employee_id IS NOT NULL"];
      const saleWhere = ["s.voided = false", "s.employee_id IS NOT NULL"];
      const voidParams = [];
      const refundParams = [];
      const saleParams = [];

      if (date_from) {
        voidWhere.push("s.timestamp >= ?");
        voidParams.push(toUtcStart(date_from, tz));
        refundWhere.push("r.timestamp >= ?");
        refundParams.push(toUtcStart(date_from, tz));
        saleWhere.push("s.timestamp >= ?");
        saleParams.push(toUtcStart(date_from, tz));
      } else {
        const thirtyDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 24 * 3600 * 1000));
        const thirtyDaysAgoStart = toUtcStart(thirtyDaysAgoStr, tz);
        voidWhere.push("s.timestamp >= ?");
        voidParams.push(thirtyDaysAgoStart);
        refundWhere.push("r.timestamp >= ?");
        refundParams.push(thirtyDaysAgoStart);
        saleWhere.push("s.timestamp >= ?");
        saleParams.push(thirtyDaysAgoStart);
      }

      if (date_to) {
        voidWhere.push("s.timestamp < ?");
        voidParams.push(toUtcEnd(date_to, tz));
        refundWhere.push("r.timestamp < ?");
        refundParams.push(toUtcEnd(date_to, tz));
        saleWhere.push("s.timestamp < ?");
        saleParams.push(toUtcEnd(date_to, tz));
      }

      if (outlet_id) {
        const ids = String(outlet_id).split(",").map(Number).filter(Boolean);
        if (ids.length === 1) {
          voidWhere.push("s.outlet_id = ?");
          voidParams.push(ids[0]);
          refundWhere.push("r.outlet_id = ?");
          refundParams.push(ids[0]);
          saleWhere.push("s.outlet_id = ?");
          saleParams.push(ids[0]);
        } else if (ids.length > 1) {
          const ph = ids.map(() => "?").join(",");
          voidWhere.push(`s.outlet_id IN (${ph})`);
          voidParams.push(...ids);
          refundWhere.push(`r.outlet_id IN (${ph})`);
          refundParams.push(...ids);
          saleWhere.push(`s.outlet_id IN (${ph})`);
          saleParams.push(...ids);
        }
      }

      // Build numbered params: void params, then refund params, then sale params
      const allParams = [...voidParams, ...refundParams, ...saleParams];
      let idx = 1;
      const voidWhereStr = voidWhere.join(" AND ").replace(/\?/g, () => `$${idx++}`);
      const refundWhereStr = refundWhere.join(" AND ").replace(/\?/g, () => `$${idx++}`);
      const saleWhereStr = saleWhere.join(" AND ").replace(/\?/g, () => `$${idx++}`);

      const sql = `
        WITH Voids AS (
          SELECT employee_id, COUNT(id) AS void_count, SUM(total_amount) AS void_value
          FROM sales s
          WHERE ${voidWhereStr}
          GROUP BY employee_id
        ),
        Refunds AS (
          SELECT employee_id, COUNT(id) AS refund_count, SUM(total_refund) AS refund_value
          FROM returns r
          WHERE ${refundWhereStr}
          GROUP BY employee_id
        ),
        ValidSales AS (
          SELECT employee_id, COUNT(id) AS sale_count, SUM(total_amount) AS total_revenue
          FROM sales s
          WHERE ${saleWhereStr}
          GROUP BY employee_id
        )
        SELECT
          e.id AS employee_id,
          e.name AS employee_name,
          COALESCE(vs.total_revenue, 0) AS total_revenue,
          COALESCE(vs.sale_count, 0) AS sale_count,
          COALESCE(v.void_count, 0) AS void_count,
          COALESCE(v.void_value, 0) AS void_value,
          COALESCE(r.refund_count, 0) AS refund_count,
          COALESCE(r.refund_value, 0) AS refund_value,
          ROUND(
            CASE
              WHEN COALESCE(vs.total_revenue, 0) > 0
                THEN (COALESCE(v.void_value, 0) + COALESCE(r.refund_value, 0)) / vs.total_revenue * 100
              ELSE 0
            END,
            2
          ) AS risk_ratio_pct
        FROM employees e
        LEFT JOIN ValidSales vs ON e.id = vs.employee_id
        LEFT JOIN Voids v ON e.id = v.employee_id
        LEFT JOIN Refunds r ON e.id = r.employee_id
        WHERE v.void_count > 0 OR r.refund_count > 0 OR vs.sale_count > 0
        ORDER BY risk_ratio_pct DESC
      `;

      const { rows } = await db.query(sql, allParams);
      res.json({ loss_prevention: rows });
    } catch (err) {
      console.error("Loss Prevention Error:", err);
      res.status(500).json({ error: "Failed to load loss prevention data" });
    }
  });
};
