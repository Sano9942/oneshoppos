const express = require("express");

module.exports = function createHRRouter({
  db,
  requireFeature,
  requirePerm,
  createNotification,
}) {
  const router = express.Router();

  router.get(
    "/api/hr/leave",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT lr.*, e.name AS employee_name, a.name AS approved_by_name
           FROM leave_requests lr
           JOIN employees e ON e.id = lr.employee_id
           LEFT JOIN employees a ON a.id = lr.approved_by
           ORDER BY lr.created_at DESC`
        );
        res.json({ leave_requests: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/hr/leave",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const {
          employee_id,
          type = "annual",
          start_date,
          end_date,
          days = 1,
          reason,
          partial_day,
          start_time,
          end_time,
        } = req.body || {};
        if (!employee_id || !start_date || !end_date) {
          return res.status(400).json({ error: "employee_id, start_date and end_date are required" });
        }
        const { rows } = await db.query(
          `INSERT INTO leave_requests (employee_id, type, start_date, end_date, days, reason, status, partial_day, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9) RETURNING id`,
          [employee_id, type, start_date, end_date, Number(days || 1), reason || null,
           partial_day === true, start_time || null, end_time || null]
        );
        createNotification(
          "leave_request",
          "Leave Request Submitted",
          `Employee #${employee_id} submitted a leave request`,
          "/hr/leave",
        );
        res.json({ message: "Leave request created", id: rows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.put(
    "/api/hr/leave/:id/status",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { status, rejection_note } = req.body || {};
        if (!["approved", "rejected", "pending"].includes(status)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        const approvedBy = Number(req.headers["x-employee-id"] || 0) || null;

        // Check for schedule conflicts when approving
        let scheduleImpact = null;
        if (status === "approved") {
          try {
            const { rows: lr } = await db.query("SELECT employee_id, start_date, end_date FROM leave_requests WHERE id = $1", [id]);
            if (lr[0]) {
              const { rows: conflicts } = await db.query(
                `SELECT id FROM scheduled_shifts
                 WHERE employee_id = $1 AND status = 'published'
                   AND shift_date BETWEEN $2 AND $3`,
                [lr[0].employee_id, lr[0].start_date, lr[0].end_date]
              );
              scheduleImpact = conflicts.length > 0 ? "conflicts_found" : "no_conflicts";
            }
          } catch (_) { /* scheduled_shifts may not exist yet */ }
        }

        const { rowCount } = await db.query(
          `UPDATE leave_requests
           SET status = $1, approved_by = $2, approved_at = $3, rejection_note = $4,
               schedule_impact_status = COALESCE($6, schedule_impact_status)
           WHERE id = $5`,
          [
            status,
            status === "approved" || status === "rejected" ? approvedBy : null,
            status === "approved" || status === "rejected" ? new Date().toISOString() : null,
            status === "rejected" ? rejection_note || null : null,
            id,
            scheduleImpact,
          ]
        );
        res.json({ message: "Leave request updated", changed: rowCount || 0, schedule_impact: scheduleImpact });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Leave Balance ─────────────────────────────────────────────────────────
  router.get(
    "/api/hr/leave/balance",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);

        const { rows: employees } = await db.query(
          `SELECT e.id AS employee_id, e.name AS employee_name,
                  COALESCE(e.monthly_leave_allowance, 2) AS monthly_allowance
           FROM employees e
           ORDER BY e.name ASC`
        );

        if (!employees || employees.length === 0) {
          return res.json({ balances: [] });
        }

        const results = [];
        for (const emp of employees) {
          const { rows: leaveRows } = await db.query(
            `SELECT COALESCE(SUM(days), 0) AS used_this_month
             FROM leave_requests
             WHERE employee_id = $1
               AND status = 'approved'
               AND TO_CHAR(start_date::date, 'YYYY-MM') = $2`,
            [emp.employee_id, month]
          );
          const used = Number(leaveRows[0]?.used_this_month || 0);
          results.push({
            employee_id: emp.employee_id,
            employee_name: emp.employee_name,
            monthly_allowance: Number(emp.monthly_allowance || 2),
            used_this_month: used,
            remaining: Math.max(0, Number(emp.monthly_allowance || 2) - used),
          });
        }
        results.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
        res.json({ month, balances: results });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/hr/payroll/periods",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT * FROM payroll_periods ORDER BY start_date DESC, id DESC"
        );
        res.json({ periods: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/hr/payroll/periods",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { period_name, start_date, end_date } = req.body || {};
        const createdBy = Number(req.headers["x-employee-id"] || 0) || null;
        if (!period_name || !start_date || !end_date) {
          return res.status(400).json({ error: "period_name, start_date and end_date are required" });
        }
        const { rows } = await db.query(
          "INSERT INTO payroll_periods (period_name, start_date, end_date, status, created_by) VALUES ($1, $2, $3, 'draft', $4) RETURNING id",
          [period_name, start_date, end_date, createdBy]
        );
        res.json({ message: "Payroll period created", id: rows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/hr/payroll/periods/:id/generate",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows: periodRows } = await db.query(
          "SELECT * FROM payroll_periods WHERE id = $1", [id]
        );
        const period = periodRows[0];
        if (!period) return res.status(404).json({ error: "Payroll period not found" });

        await db.transaction(async (client) => {
          await client.query("DELETE FROM payroll_lines WHERE period_id = $1", [id]);

          const { rows: employees } = await client.query(
            `SELECT id, name,
                    COALESCE(salary_type, 'monthly') AS salary_type,
                    COALESCE(hourly_rate, 0) AS hourly_rate,
                    COALESCE(monthly_salary, 0) AS monthly_salary,
                    COALESCE(daily_rate, 0) AS daily_rate,
                    COALESCE(work_hours_per_day, 8) AS work_hours_per_day,
                    COALESCE(monthly_leave_allowance, 2) AS monthly_leave_allowance
             FROM employees`
          );

          if (!employees || employees.length === 0) {
            return;
          }

          for (const emp of employees) {
            // Get attendance days and hours
            const { rows: attDays } = await client.query(
              `SELECT check_in::date AS work_date,
                     COALESCE(SUM(
                       CASE WHEN check_out IS NOT NULL
                         THEN EXTRACT(EPOCH FROM (check_out - check_in)) / 3600.0
                         ELSE 0 END
                     ), 0) AS day_hours
               FROM employee_attendance
               WHERE employee_id = $1
                 AND check_in::date BETWEEN $2::date AND $3::date
               GROUP BY check_in::date`,
              [emp.id, period.start_date, period.end_date]
            );

            // Get leave days
            const { rows: leaveRows } = await client.query(
              `SELECT COALESCE(SUM(days), 0) AS leave_days
               FROM leave_requests
               WHERE employee_id = $1
                 AND status = 'approved'
                 AND start_date::date <= $2::date
                 AND end_date::date >= $3::date`,
              [emp.id, period.end_date, period.start_date]
            );

            const days = attDays || [];
            const totalDays = days.length;
            const leaveDays = Number(leaveRows[0]?.leave_days || 0);
            const stdHours = Number(emp.work_hours_per_day || 8);

            let totalRegularHours = 0;
            let totalOvertimeHours = 0;
            for (const day of days) {
              const h = Number(day.day_hours || 0);
              totalRegularHours += Math.min(h, stdHours);
              totalOvertimeHours += Math.max(0, h - stdHours);
            }
            const totalHours = Number((totalRegularHours + totalOvertimeHours).toFixed(2));

            let baseRate = 0;
            let grossPay = 0;
            let deductions = 0;
            const noteParts = [];
            const salaryType = emp.salary_type || "monthly";

            if (salaryType === "hourly") {
              baseRate = Number(emp.hourly_rate || 0);
              const regularPay = baseRate * totalRegularHours;
              const overtimePay = baseRate * 1.5 * totalOvertimeHours;
              grossPay = Number((regularPay + overtimePay).toFixed(2));
              if (totalOvertimeHours > 0) {
                noteParts.push(
                  `Regular: ${totalRegularHours.toFixed(1)}h, Overtime: ${totalOvertimeHours.toFixed(1)}h @1.5x`
                );
              }
            } else if (salaryType === "daily") {
              baseRate = Number(emp.daily_rate || 0);
              grossPay = Number((baseRate * totalDays).toFixed(2));
            } else {
              baseRate = Number(emp.monthly_salary || 0);
              grossPay = baseRate;
              const dailyRate = baseRate / 30;
              const leaveAllowance = Number(emp.monthly_leave_allowance || 2);
              const excessLeave = Math.max(0, leaveDays - leaveAllowance);
              const leaveDeduction = Number((excessLeave * dailyRate).toFixed(2));
              if (excessLeave > 0) {
                noteParts.push(
                  `Leave: ${leaveDays}d (${excessLeave} excess × ${dailyRate.toFixed(0)}/d)`
                );
              }
              const expectedDays = 30 - leaveDays;
              const absentDays = Math.max(0, expectedDays - totalDays);
              const absenceDeduction = Number((absentDays * dailyRate).toFixed(2));
              if (absentDays > 0) {
                noteParts.push(
                  `Absent: ${absentDays}d × ${dailyRate.toFixed(0)}/d`
                );
              }
              deductions = Number((leaveDeduction + absenceDeduction).toFixed(2));
            }
            // Commission earnings from Phase 2B commission_earnings table
            let commissionAmount = 0;
            try {
              const { rows: commRows } = await client.query(
                `SELECT COALESCE(SUM(commission_amount), 0) AS total_commission
                 FROM commission_earnings
                 WHERE employee_id = $1 AND status IN ('pending','approved')
                   AND created_at >= $2 AND created_at < $3`,
                [emp.id, period.start_date, period.end_date]
              );
              commissionAmount = Number(commRows[0]?.total_commission || 0);
              if (commissionAmount > 0) {
                noteParts.push(`Commission: ${commissionAmount.toFixed(2)}`);
                // Auto-approve pending commissions included in payroll
                await client.query(
                  `UPDATE commission_earnings SET status = 'approved', approved_at = NOW()
                   WHERE employee_id = $1 AND status = 'pending'
                     AND created_at >= $2 AND created_at < $3`,
                  [emp.id, period.start_date, period.end_date]
                );
              }
            } catch (_) { /* commission_earnings table may not exist yet */ }

            const netPay = Number((grossPay + commissionAmount - deductions).toFixed(2));
            const notes = noteParts.length > 0 ? noteParts.join("; ") : null;

            await client.query(
              `INSERT INTO payroll_lines
               (period_id, employee_id, salary_type, base_rate, total_hours, total_days, leave_days, gross_pay, deductions, net_pay, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [id, emp.id, salaryType, baseRate, totalHours, totalDays, leaveDays, Number((grossPay + commissionAmount).toFixed(2)), deductions, netPay, notes]
            );
          }
        });

        // Finalize the period outside the transaction
        await db.query(
          "UPDATE payroll_periods SET status = 'finalized', finalized_at = NOW() WHERE id = $1",
          [id]
        );

        const { rows: countRows } = await db.query(
          "SELECT COUNT(*) AS cnt FROM payroll_lines WHERE period_id = $1", [id]
        );
        res.json({ message: "Payroll generated", lines: Number(countRows[0]?.cnt || 0) });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/hr/payroll/periods/:id/lines",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows } = await db.query(
          `SELECT pl.*, e.name AS employee_name
           FROM payroll_lines pl
           JOIN employees e ON e.id = pl.employee_id
           WHERE pl.period_id = $1
           ORDER BY e.name ASC`,
          [id]
        );
        res.json({ lines: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Payroll Export (CSV-ready JSON) ──────────────────────────────────────
  router.get(
    "/api/hr/payroll-export",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { period_id } = req.query;
        if (!period_id) {
          return res.status(400).json({ error: "period_id query param is required" });
        }
        const { rows: periodRows } = await db.query(
          "SELECT * FROM payroll_periods WHERE id = $1", [period_id]
        );
        if (!periodRows[0]) {
          return res.status(404).json({ error: "Payroll period not found" });
        }
        const { rows } = await db.query(
          `SELECT e.name AS employee_name,
                  pl.salary_type AS department,
                  pl.total_days AS days_worked,
                  pl.total_hours AS hours_total,
                  CASE WHEN pl.total_hours > (pl.total_days * COALESCE(e.work_hours_per_day, 8))
                       THEN ROUND((pl.total_hours - pl.total_days * COALESCE(e.work_hours_per_day, 8))::numeric, 2)
                       ELSE 0 END AS overtime_hours,
                  pl.leave_days AS leave_days_taken,
                  pl.gross_pay,
                  pl.deductions,
                  pl.net_pay
           FROM payroll_lines pl
           JOIN employees e ON e.id = pl.employee_id
           WHERE pl.period_id = $1
           ORDER BY e.name ASC`,
          [period_id]
        );
        res.json({
          period: periodRows[0],
          rows: rows || [],
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── HR Payroll Lines (manual overrides in hr_payroll_lines) ───────────────
  router.post(
    "/api/hr/payroll/periods/:id/lines",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { employee_id, base_salary, deductions, net_pay, notes } = req.body || {};
        if (!employee_id) {
          return res.status(400).json({ error: "employee_id is required" });
        }
        const baseSalary = Number(base_salary || 0);
        const deductAmt = Number(deductions || 0);
        const netPayVal = net_pay !== undefined ? Number(net_pay) : baseSalary - deductAmt;

        const { rows } = await db.query(
          `INSERT INTO hr_payroll_lines (period_id, employee_id, base_salary, deductions, net_pay, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT(period_id, employee_id) DO UPDATE SET
             base_salary = EXCLUDED.base_salary,
             deductions  = EXCLUDED.deductions,
             net_pay     = EXCLUDED.net_pay,
             notes       = EXCLUDED.notes
           RETURNING id`,
          [id, employee_id, baseSalary, deductAmt, netPayVal, notes || null]
        );
        res.json({ message: "Pay line saved", id: rows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Schedule-Leave Conflicts ────────────────────────────────────────────
  router.get(
    "/api/hr/leave/schedule-conflicts",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { employee_id, from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: "from and to are required" });
        let sql = `
          SELECT lr.id AS leave_id, lr.employee_id, e.name AS employee_name,
                 lr.start_date, lr.end_date, lr.type AS leave_type,
                 ss.id AS shift_id, ss.shift_date, ss.start_time, ss.end_time, ss.status AS shift_status
          FROM leave_requests lr
          JOIN employees e ON e.id = lr.employee_id
          JOIN scheduled_shifts ss ON ss.employee_id = lr.employee_id
            AND ss.shift_date BETWEEN lr.start_date::date AND lr.end_date::date
            AND ss.status != 'cancelled'
          WHERE lr.status IN ('pending', 'approved')
            AND lr.start_date::date <= $2::date AND lr.end_date::date >= $1::date
        `;
        const params = [from, to];
        let idx = 3;
        if (employee_id) { sql += ` AND lr.employee_id = $${idx++}`; params.push(employee_id); }
        sql += " ORDER BY ss.shift_date ASC";
        const { rows } = await db.query(sql, params);
        res.json({ conflicts: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Overtime Alerts ───────────────────────────────────────────────────────
  router.get(
    "/api/hr/overtime-alerts",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    async (req, res) => {
      try {
        const { outlet_id, week } = req.query;
        // week format: YYYY-MM-DD (Monday of the week)
        const weekStart = week || new Date().toISOString().slice(0, 10);
        const WEEKLY_THRESHOLD_HOURS = 40;

        let sql = `
          SELECT e.id AS employee_id, e.name AS employee_name,
                 COALESCE(SUM(
                   EXTRACT(EPOCH FROM (
                     COALESCE(a.session_end, NOW()) - a.session_start
                   )) / 3600.0
                 ), 0)::numeric(8,2) AS hours_worked
          FROM employees e
          LEFT JOIN attendance_sessions a ON a.employee_id = e.id
            AND a.session_start::date >= $1::date
            AND a.session_start::date < ($1::date + INTERVAL '7 days')
            AND a.session_type = 'work'
        `;
        const params = [weekStart];
        let idx = 2;
        if (outlet_id) {
          sql += ` AND a.outlet_id = $${idx++}`;
          params.push(outlet_id);
        }
        sql += `
          GROUP BY e.id, e.name
          HAVING COALESCE(SUM(
            EXTRACT(EPOCH FROM (COALESCE(a.session_end, NOW()) - a.session_start)) / 3600.0
          ), 0) >= $${idx}
          ORDER BY hours_worked DESC
        `;
        params.push(WEEKLY_THRESHOLD_HOURS * 0.8); // Alert at 80% of threshold

        const { rows } = await db.query(sql, params);
        res.json({
          alerts: rows.map(r => ({
            ...r,
            hours_worked: Number(r.hours_worked),
            threshold: WEEKLY_THRESHOLD_HOURS,
            exceeded: Number(r.hours_worked) >= WEEKLY_THRESHOLD_HOURS,
          })),
          week_start: weekStart,
          threshold_hours: WEEKLY_THRESHOLD_HOURS,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  return router;
};
