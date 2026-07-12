const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function (app, deps, helpers) {
  const { db, requirePerm } = deps;
  // D4 split (PLAN-V2 Step 4, REPORT-PERMS.md §3.8) — explicit per-domain
  // guard on every route; the /api/reports blanket rule in
  // middleware/permissions.js is only a backstop.
  const hrView = requirePerm("view_hr_reports");

  app.get("/api/reports/labor-performance", hrView, async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const tz = req.company?.timezone || "UTC";

      const saleWhere = ["s.voided = false", "s.employee_id IS NOT NULL"];
      const attendWhere = ["session_type = 'work'"];
      const saleParams = [];
      const attendParams = [];

      // session_start is TIMESTAMPTZ like s.timestamp — both filters use the
      // same tenant-tz UTC bounds (a bare ::date cast evaluates in the DB
      // session timezone and drifts from the sales window near midnight).
      if (date_from) {
        saleWhere.push("s.timestamp >= ?");
        saleParams.push(toUtcStart(date_from, tz));
        attendWhere.push("session_start >= ?");
        attendParams.push(toUtcStart(date_from, tz));
      } else {
        const thirtyDaysAgoStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 24 * 3600 * 1000));
        saleWhere.push("s.timestamp >= ?");
        saleParams.push(toUtcStart(thirtyDaysAgoStr, tz));
        attendWhere.push("session_start >= ?");
        attendParams.push(toUtcStart(thirtyDaysAgoStr, tz));
      }

      if (date_to) {
        saleWhere.push("s.timestamp < ?");
        saleParams.push(toUtcEnd(date_to, tz));
        attendWhere.push("session_start < ?");
        attendParams.push(toUtcEnd(date_to, tz));
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

  app.get("/api/reports/loss-prevention", hrView, async (req, res) => {
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

  // ── Labor vs Sales Report (Phase 2) ──────────────────────────────────────
  app.get("/api/reports/labor-vs-sales", hrView, async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const tz = req.company?.timezone || "UTC";

      const params = [];
      let idx = 1;
      const dateFromUtc = date_from ? toUtcStart(date_from, tz) : toUtcStart(
        new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 86400000)), tz
      );
      const dateToUtc = date_to ? toUtcEnd(date_to, tz) : toUtcEnd(
        new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()), tz
      );
      // session_start is TIMESTAMPTZ — reuse the same UTC bounds as the sales
      // window (the old $3/$4 ::date casts evaluated in the DB session TZ).
      params.push(dateFromUtc, dateToUtc);

      let outletFilter = "";
      if (outlet_id) {
        outletFilter = `AND s.outlet_id = $3 AND a.outlet_id = $3`;
        params.push(outlet_id);
      }

      const sql = `
        WITH emp_sales AS (
          SELECT s.employee_id,
                 COUNT(s.id) AS sale_count,
                 SUM(s.total_amount) AS revenue
          FROM sales s
          WHERE s.voided = false AND s.employee_id IS NOT NULL
            AND s.timestamp >= $1 AND s.timestamp < $2
            ${outlet_id ? "AND s.outlet_id = $3" : ""}
          GROUP BY s.employee_id
        ),
        emp_hours AS (
          SELECT a.employee_id,
                 COALESCE(SUM(
                   EXTRACT(EPOCH FROM (COALESCE(a.session_end, NOW()) - a.session_start)) / 3600.0
                 ), 0)::numeric(10,2) AS hours_worked
          FROM attendance_sessions a
          WHERE a.session_type = 'work'
            AND a.session_start >= $1
            AND a.session_start < $2
            ${outlet_id ? "AND a.outlet_id = $3" : ""}
          GROUP BY a.employee_id
        )
        SELECT
          e.id AS employee_id,
          e.name AS employee_name,
          COALESCE(eh.hours_worked, 0) AS hours_worked,
          COALESCE(es.sale_count, 0)::int AS sale_count,
          COALESCE(es.revenue, 0) AS revenue,
          CASE WHEN COALESCE(eh.hours_worked, 0) > 0
            THEN ROUND((COALESCE(es.revenue, 0) / eh.hours_worked)::numeric, 2)
            ELSE 0
          END AS revenue_per_hour,
          COALESCE(e.hourly_rate, 0) AS hourly_rate,
          CASE WHEN COALESCE(e.hourly_rate, 0) > 0
            THEN ROUND((COALESCE(eh.hours_worked, 0) * e.hourly_rate)::numeric, 2)
            ELSE 0
          END AS labor_cost
        FROM employees e
        LEFT JOIN emp_sales es ON e.id = es.employee_id
        LEFT JOIN emp_hours eh ON e.id = eh.employee_id
        WHERE es.revenue > 0 OR eh.hours_worked > 0
        ORDER BY revenue_per_hour DESC
      `;
      const { rows } = await db.query(sql, params);
      res.json({ labor_vs_sales: rows });
    } catch (err) {
      console.error("Labor vs Sales Error:", err);
      res.status(500).json({ error: "Failed to load labor vs sales report" });
    }
  });

  // ── Staff Attribution Report (Phase 2) ───────────────────────────────────
  app.get("/api/reports/staff-attribution", hrView, async (req, res) => {
    try {
      const { date_from, date_to, outlet_id } = req.query;
      const tz = req.company?.timezone || "UTC";

      const dateFromUtc = date_from ? toUtcStart(date_from, tz) : toUtcStart(
        new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() - 30 * 86400000)), tz
      );
      const dateToUtc = date_to ? toUtcEnd(date_to, tz) : toUtcEnd(
        new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()), tz
      );

      const params = [dateFromUtc, dateToUtc];
      let outletCond = "";
      if (outlet_id) {
        outletCond = "AND outlet_id = $3";
        params.push(outlet_id);
      }

      const sql = `
        WITH emp_sales AS (
          SELECT employee_id,
                 COUNT(id) AS sale_count,
                 SUM(total_amount) AS revenue,
                 SUM(discount_amount) AS discount_total
          FROM sales
          WHERE voided = false AND employee_id IS NOT NULL
            AND timestamp >= $1 AND timestamp < $2
            ${outletCond}
          GROUP BY employee_id
        ),
        emp_voids AS (
          SELECT employee_id, COUNT(id) AS void_count
          FROM sales
          WHERE voided = true AND employee_id IS NOT NULL
            AND timestamp >= $1 AND timestamp < $2
            ${outletCond}
          GROUP BY employee_id
        ),
        emp_returns AS (
          SELECT employee_id,
                 COUNT(id) AS return_count,
                 SUM(total_refund) AS return_total
          FROM returns
          WHERE employee_id IS NOT NULL
            AND timestamp >= $1 AND timestamp < $2
            ${outletCond}
          GROUP BY employee_id
        ),
        emp_approvals AS (
          SELECT requested_by AS employee_id, COUNT(id) AS approval_count
          FROM approval_events
          WHERE created_at >= $1 AND created_at < $2
          GROUP BY requested_by
        )
        SELECT
          e.id AS employee_id,
          e.name AS employee_name,
          COALESCE(es.sale_count, 0)::int AS sale_count,
          COALESCE(es.revenue, 0) AS revenue,
          COALESCE(es.discount_total, 0) AS discount_total,
          COALESCE(ev.void_count, 0)::int AS void_count,
          COALESCE(er.return_count, 0)::int AS return_count,
          COALESCE(er.return_total, 0) AS return_total,
          COALESCE(ea.approval_count, 0)::int AS approval_count
        FROM employees e
        LEFT JOIN emp_sales es ON e.id = es.employee_id
        LEFT JOIN emp_voids ev ON e.id = ev.employee_id
        LEFT JOIN emp_returns er ON e.id = er.employee_id
        LEFT JOIN emp_approvals ea ON e.id = ea.employee_id
        WHERE es.sale_count > 0 OR ev.void_count > 0 OR er.return_count > 0 OR ea.approval_count > 0
        ORDER BY COALESCE(es.revenue, 0) DESC
      `;
      const { rows } = await db.query(sql, params);
      res.json({ staff_attribution: rows });
    } catch (err) {
      console.error("Staff Attribution Error:", err);
      res.status(500).json({ error: "Failed to load staff attribution report" });
    }
  });
};
