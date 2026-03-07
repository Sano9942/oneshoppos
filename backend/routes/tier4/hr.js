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
    (req, res) => {
      db.all(
        `SELECT lr.*, e.name AS employee_name, a.name AS approved_by_name
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     LEFT JOIN employees a ON a.id = lr.approved_by
     ORDER BY datetime(lr.created_at) DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ leave_requests: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/hr/leave",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    (req, res) => {
      const {
        employee_id,
        type = "annual",
        start_date,
        end_date,
        days = 1,
        reason,
      } = req.body || {};
      if (!employee_id || !start_date || !end_date) {
        return res
          .status(400)
          .json({ error: "employee_id, start_date and end_date are required" });
      }
      db.run(
        `INSERT INTO leave_requests (employee_id, type, start_date, end_date, days, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [
          employee_id,
          type,
          start_date,
          end_date,
          Number(days || 1),
          reason || null,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          createNotification(
            "leave_request",
            "Leave Request Submitted",
            `Employee #${employee_id} submitted a leave request`,
            "/hr/leave",
          );
          res.json({ message: "Leave request created", id: this.lastID });
        },
      );
    },
  );

  router.put(
    "/api/hr/leave/:id/status",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    (req, res) => {
      const { id } = req.params;
      const { status, rejection_note } = req.body || {};
      if (!["approved", "rejected", "pending"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const approvedBy = Number(req.headers["x-employee-id"] || 0) || null;
      db.run(
        `UPDATE leave_requests
       SET status = ?, approved_by = ?, approved_at = ?, rejection_note = ?
       WHERE id = ?`,
        [
          status,
          status === "approved" || status === "rejected" ? approvedBy : null,
          status === "approved" || status === "rejected"
            ? new Date().toISOString().replace("T", " ").slice(0, 19)
            : null,
          status === "rejected" ? rejection_note || null : null,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Leave request updated",
            changed: this.changes || 0,
          });
        },
      );
    },
  );

  router.get(
    "/api/hr/payroll/periods",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    (req, res) => {
      db.all(
        "SELECT * FROM payroll_periods ORDER BY start_date DESC, id DESC",
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ periods: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/hr/payroll/periods",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    (req, res) => {
      const { period_name, start_date, end_date } = req.body || {};
      const createdBy = Number(req.headers["x-employee-id"] || 0) || null;
      if (!period_name || !start_date || !end_date) {
        return res
          .status(400)
          .json({ error: "period_name, start_date and end_date are required" });
      }
      db.run(
        "INSERT INTO payroll_periods (period_name, start_date, end_date, status, created_by) VALUES (?, ?, ?, 'draft', ?)",
        [period_name, start_date, end_date, createdBy],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Payroll period created", id: this.lastID });
        },
      );
    },
  );

  router.post(
    "/api/hr/payroll/periods/:id/generate",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    (req, res) => {
      const { id } = req.params;
      db.get(
        "SELECT * FROM payroll_periods WHERE id = ?",
        [id],
        (err, period) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!period)
            return res.status(404).json({ error: "Payroll period not found" });

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("DELETE FROM payroll_lines WHERE period_id = ?", [id]);
            db.all(
              `SELECT id, name,
                  COALESCE(salary_type, 'monthly') AS salary_type,
                  COALESCE(hourly_rate, 0) AS hourly_rate,
                  COALESCE(monthly_salary, 0) AS monthly_salary,
                  COALESCE(daily_rate, 0) AS daily_rate,
                  COALESCE(work_hours_per_day, 8) AS work_hours_per_day,
                  COALESCE(monthly_leave_allowance, 2) AS monthly_leave_allowance
           FROM employees`,
              [],
              (empErr, employees) => {
                if (empErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: empErr.message });
                }

                if (!employees || employees.length === 0) {
                  db.run("COMMIT");
                  return res.json({ message: "Payroll generated", lines: 0 });
                }

                let pending = employees.length;
                let failed = false;

                employees.forEach((emp) => {
                  db.all(
                    `SELECT date(check_in) AS work_date,
                       COALESCE(SUM(
                         CASE WHEN check_out IS NOT NULL
                           THEN (julianday(check_out) - julianday(check_in)) * 24.0
                           ELSE 0 END
                       ), 0) AS day_hours
                     FROM employee_attendance
                     WHERE employee_id = ?
                       AND date(check_in) BETWEEN ? AND ?
                     GROUP BY date(check_in)`,
                    [emp.id, period.start_date, period.end_date],
                    (attErr, attDays) => {
                      if (attErr && !failed) {
                        failed = true;
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: attErr.message });
                      }
                      db.get(
                        `SELECT COALESCE(SUM(days), 0) AS leave_days
                     FROM leave_requests
                     WHERE employee_id = ?
                       AND status = 'approved'
                       AND date(start_date) <= date(?)
                       AND date(end_date) >= date(?)`,
                        [emp.id, period.end_date, period.start_date],
                        (leaveErr, leaveRow) => {
                          if (leaveErr && !failed) {
                            failed = true;
                            db.run("ROLLBACK");
                            return res
                              .status(500)
                              .json({ error: leaveErr.message });
                          }

                          const days = attDays || [];
                          const totalDays = days.length;
                          const leaveDays = Number(leaveRow?.leave_days || 0);
                          const stdHours = Number(emp.work_hours_per_day || 8);

                          let totalRegularHours = 0;
                          let totalOvertimeHours = 0;
                          for (const day of days) {
                            const h = Number(day.day_hours || 0);
                            totalRegularHours += Math.min(h, stdHours);
                            totalOvertimeHours += Math.max(0, h - stdHours);
                          }
                          const totalHours = Number(
                            (totalRegularHours + totalOvertimeHours).toFixed(2),
                          );

                          let baseRate = 0;
                          let grossPay = 0;
                          let deductions = 0;
                          const noteParts = [];
                          const salaryType = emp.salary_type || "monthly";

                          if (salaryType === "hourly") {
                            baseRate = Number(emp.hourly_rate || 0);
                            const regularPay = baseRate * totalRegularHours;
                            const overtimePay =
                              baseRate * 1.5 * totalOvertimeHours;
                            grossPay = Number(
                              (regularPay + overtimePay).toFixed(2),
                            );
                            if (totalOvertimeHours > 0) {
                              noteParts.push(
                                `Regular: ${totalRegularHours.toFixed(1)}h, Overtime: ${totalOvertimeHours.toFixed(1)}h @1.5x`,
                              );
                            }
                          } else if (salaryType === "daily") {
                            baseRate = Number(emp.daily_rate || 0);
                            grossPay = Number(
                              (baseRate * totalDays).toFixed(2),
                            );
                          } else {
                            baseRate = Number(emp.monthly_salary || 0);
                            grossPay = baseRate;
                            const dailyRate = baseRate / 30;
                            const leaveAllowance = Number(
                              emp.monthly_leave_allowance || 2,
                            );
                            const excessLeave = Math.max(
                              0,
                              leaveDays - leaveAllowance,
                            );
                            const leaveDeduction = Number(
                              (excessLeave * dailyRate).toFixed(2),
                            );
                            if (excessLeave > 0) {
                              noteParts.push(
                                `Leave: ${leaveDays}d (${excessLeave} excess × ${dailyRate.toFixed(0)}/d)`,
                              );
                            }
                            const expectedDays = 30 - leaveDays;
                            const absentDays = Math.max(
                              0,
                              expectedDays - totalDays,
                            );
                            const absenceDeduction = Number(
                              (absentDays * dailyRate).toFixed(2),
                            );
                            if (absentDays > 0) {
                              noteParts.push(
                                `Absent: ${absentDays}d × ${dailyRate.toFixed(0)}/d`,
                              );
                            }
                            deductions = Number(
                              (leaveDeduction + absenceDeduction).toFixed(2),
                            );
                          }
                          const netPay = Number(
                            (grossPay - deductions).toFixed(2),
                          );
                          const notes =
                            noteParts.length > 0 ? noteParts.join("; ") : null;

                          db.run(
                            `INSERT INTO payroll_lines
                         (period_id, employee_id, salary_type, base_rate, total_hours, total_days, leave_days, gross_pay, deductions, net_pay, notes)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                              id,
                              emp.id,
                              salaryType,
                              baseRate,
                              totalHours,
                              totalDays,
                              leaveDays,
                              grossPay,
                              deductions,
                              netPay,
                              notes,
                            ],
                            (lineErr) => {
                              if (lineErr && !failed) {
                                failed = true;
                                db.run("ROLLBACK");
                                return res
                                  .status(500)
                                  .json({ error: lineErr.message });
                              }
                              pending -= 1;
                              if (pending === 0 && !failed) {
                                db.run("COMMIT", (commitErr) => {
                                  if (commitErr)
                                    return res
                                      .status(500)
                                      .json({ error: commitErr.message });
                                  db.run(
                                    "UPDATE payroll_periods SET status = 'finalized', finalized_at = datetime('now','localtime') WHERE id = ?",
                                    [id],
                                    () => {},
                                  );
                                  res.json({
                                    message: "Payroll generated",
                                    lines: employees.length,
                                  });
                                });
                              }
                            },
                          );
                        },
                      );
                    },
                  );
                });
              },
            );
          });
        },
      );
    },
  );

  router.get(
    "/api/hr/payroll/periods/:id/lines",
    requirePerm("all_access"),
    requireFeature("advanced_hr"),
    (req, res) => {
      const { id } = req.params;
      db.all(
        `SELECT pl.*, e.name AS employee_name
       FROM payroll_lines pl
       JOIN employees e ON e.id = pl.employee_id
       WHERE pl.period_id = ?
       ORDER BY e.name ASC`,
        [id],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ lines: rows || [] });
        },
      );
    },
  );

  return router;
};
