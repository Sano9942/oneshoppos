module.exports = function (app, deps) {
  const { db } = deps;

  app.get("/api/reports/labor-performance", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      const saleWhere = ["s.voided = 0", "s.employee_id IS NOT NULL"];
      const attendWhere = ["session_type = 'work'"];
      const saleParams = [];
      const attendParams = [];

      if (date_from) {
        saleWhere.push("date(s.timestamp, 'localtime') >= ?");
        saleParams.push(date_from);
        attendWhere.push("date(session_start, 'localtime') >= ?");
        attendParams.push(date_from);
      } else {
        saleWhere.push(
          "date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')",
        );
        attendWhere.push(
          "date(session_start, 'localtime') >= date('now', '-30 days', 'localtime')",
        );
      }

      if (date_to) {
        saleWhere.push("date(s.timestamp, 'localtime') <= ?");
        saleParams.push(date_to);
        attendWhere.push("date(session_start, 'localtime') <= ?");
        attendParams.push(date_to);
      }

      if (outlet_id) {
        saleWhere.push("s.outlet_id = ?");
        saleParams.push(outlet_id);
        attendWhere.push("outlet_id = ?");
        attendParams.push(outlet_id);
      }

      const sql = `
        WITH EmployeeSales AS (
          SELECT employee_id, SUM(total_amount) AS total_revenue
          FROM sales s
          WHERE ${saleWhere.join(" AND ")}
          GROUP BY employee_id
        ),
        EmployeeHours AS (
          SELECT employee_id, SUM(duration_hours) AS total_hours
          FROM attendance_sessions
          WHERE ${attendWhere.join(" AND ")}
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

      const rows = await getQuery(sql, [...saleParams, ...attendParams]);
      res.json({ labor_performance: rows });
    } catch (err) {
      console.error("Labor Performance Error:", err);
      res.status(500).json({ error: "Failed to load labor performance data" });
    }
  });

  app.get("/api/reports/loss-prevention", async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const getQuery = (query, params = []) =>
        new Promise((resolve, reject) => {
          db.all(query, params, (err, rows) =>
            err ? reject(err) : resolve(rows),
          );
        });

      const voidWhere = ["s.voided = 1", "s.employee_id IS NOT NULL"];
      const refundWhere = ["r.employee_id IS NOT NULL"];
      const saleWhere = ["s.voided = 0", "s.employee_id IS NOT NULL"];
      const voidParams = [];
      const refundParams = [];
      const saleParams = [];

      if (date_from) {
        voidWhere.push("date(s.timestamp, 'localtime') >= ?");
        voidParams.push(date_from);
        refundWhere.push("date(r.timestamp, 'localtime') >= ?");
        refundParams.push(date_from);
        saleWhere.push("date(s.timestamp, 'localtime') >= ?");
        saleParams.push(date_from);
      } else {
        voidWhere.push(
          "date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')",
        );
        refundWhere.push(
          "date(r.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')",
        );
        saleWhere.push(
          "date(s.timestamp, 'localtime') >= date('now', '-30 days', 'localtime')",
        );
      }

      if (date_to) {
        voidWhere.push("date(s.timestamp, 'localtime') <= ?");
        voidParams.push(date_to);
        refundWhere.push("date(r.timestamp, 'localtime') <= ?");
        refundParams.push(date_to);
        saleWhere.push("date(s.timestamp, 'localtime') <= ?");
        saleParams.push(date_to);
      }

      if (outlet_id) {
        voidWhere.push("s.outlet_id = ?");
        voidParams.push(outlet_id);
        refundWhere.push("r.outlet_id = ?");
        refundParams.push(outlet_id);
        saleWhere.push("s.outlet_id = ?");
        saleParams.push(outlet_id);
      }

      const sql = `
        WITH Voids AS (
          SELECT employee_id, COUNT(id) AS void_count, SUM(total_amount) AS void_value
          FROM sales s
          WHERE ${voidWhere.join(" AND ")}
          GROUP BY employee_id
        ),
        Refunds AS (
          SELECT employee_id, COUNT(id) AS refund_count, SUM(total_refund) AS refund_value
          FROM returns r
          WHERE ${refundWhere.join(" AND ")}
          GROUP BY employee_id
        ),
        ValidSales AS (
          SELECT employee_id, COUNT(id) AS sale_count, SUM(total_amount) AS total_revenue
          FROM sales s
          WHERE ${saleWhere.join(" AND ")}
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

      const rows = await getQuery(sql, [...voidParams, ...refundParams, ...saleParams]);
      res.json({ loss_prevention: rows });
    } catch (err) {
      console.error("Loss Prevention Error:", err);
      res.status(500).json({ error: "Failed to load loss prevention data" });
    }
  });
};
