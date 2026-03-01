const express = require("express");
const multer = require("multer");
const path = require("path");

module.exports = function createTier4Router({
  db,
  requireFeature,
  requirePerm,
  requireAnyPerm,
  createNotification,
  COMPANY_UPLOADS_DIR,
}) {
  const router = express.Router();

  // --- ROUTES: TIER 4 / NOTIFICATIONS ---

  router.get(
    "/api/notifications",
    requireFeature("notifications"),
    (req, res) => {
      const unreadOnly = Number(req.query.unread_only || 0) === 1;
      const where = unreadOnly ? "WHERE is_read = 0" : "";
      db.all(
        `SELECT * FROM notifications ${where} ORDER BY datetime(created_at) DESC LIMIT 50`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ notifications: rows || [] });
        },
      );
    },
  );

  router.get(
    "/api/notifications/count",
    requireFeature("notifications"),
    (req, res) => {
      db.get(
        "SELECT COUNT(*) AS unread FROM notifications WHERE is_read = 0",
        [],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ unread: Number(row?.unread || 0) });
        },
      );
    },
  );

  router.put(
    "/api/notifications/:id/read",
    requireFeature("notifications"),
    (req, res) => {
      const { id } = req.params;
      db.run(
        "UPDATE notifications SET is_read = 1 WHERE id = ?",
        [id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Notification marked as read",
            changed: this.changes || 0,
          });
        },
      );
    },
  );

  router.put(
    "/api/notifications/read-all",
    requireFeature("notifications"),
    (req, res) => {
      db.run(
        "UPDATE notifications SET is_read = 1 WHERE is_read = 0",
        [],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "All notifications marked as read",
            changed: this.changes || 0,
          });
        },
      );
    },
  );

  // --- ROUTES: TIER 4 / COMPANY PROFILE ---

  router.get(
    "/api/company-profile",
    requireFeature("multi_company"),
    (req, res) => {
      db.get("SELECT * FROM company_profile WHERE id = 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ profile: row || null });
      });
    },
  );

  router.put(
    "/api/company-profile",
    requirePerm("manage_employees"),
    requireFeature("multi_company"),
    (req, res) => {
      const {
        company_name,
        trading_name,
        ntn,
        strn,
        address,
        city,
        country,
        phone,
        email,
        website,
        currency_symbol,
        currency_code,
        fiscal_year_start,
        timezone,
      } = req.body || {};

      db.run(
        `UPDATE company_profile
       SET company_name = COALESCE(?, company_name),
           trading_name = ?,
           ntn = ?,
           strn = ?,
           address = ?,
           city = ?,
           country = COALESCE(?, country),
           phone = ?,
           email = ?,
           website = ?,
           currency_symbol = COALESCE(?, currency_symbol),
           currency_code = COALESCE(?, currency_code),
           fiscal_year_start = COALESCE(?, fiscal_year_start),
           timezone = COALESCE(?, timezone),
           updated_at = datetime('now','localtime')
       WHERE id = 1`,
        [
          company_name || null,
          trading_name || null,
          ntn || null,
          strn || null,
          address || null,
          city || null,
          country || null,
          phone || null,
          email || null,
          website || null,
          currency_symbol || null,
          currency_code || null,
          fiscal_year_start || null,
          timezone || null,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Company profile updated" });
        },
      );
    },
  );

  const companyLogoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, COMPANY_UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
      cb(null, `company_logo_${Date.now()}${ext}`);
    },
  });
  const companyLogoUpload = multer({
    storage: companyLogoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  router.post(
    "/api/company-profile/logo",
    requirePerm("manage_employees"),
    requireFeature("multi_company"),
    companyLogoUpload.single("logo"),
    (req, res) => {
      if (!req.file)
        return res.status(400).json({ error: "Logo file is required" });
      const logoUrl = `/uploads/company/${req.file.filename}`;
      db.run(
        "UPDATE company_profile SET logo_url = ?, updated_at = datetime('now','localtime') WHERE id = 1",
        [logoUrl],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Company logo updated", logo_url: logoUrl });
        },
      );
    },
  );
  // --- ROUTES: TIER 4 / ACCOUNTING ---

  router.get(
    "/api/accounting/pnl",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { from, to, outlet_id } = req.query || {};
      if (!from || !to)
        return res.status(400).json({ error: "from and to are required" });

      const salesParams = [from, to];
      const outletSql = outlet_id ? " AND outlet_id = ?" : "";
      if (outlet_id) salesParams.push(outlet_id);

      db.get(
        `SELECT COALESCE(SUM(total_amount), 0) AS gross_sales,
              COALESCE(SUM(discount_amount), 0) AS discounts
       FROM sales
       WHERE voided = 0
         AND date(timestamp) BETWEEN ? AND ?${outletSql}`,
        salesParams,
        (err, salesRow) => {
          if (err) return res.status(500).json({ error: err.message });

          const cogsParams = [from, to];
          let cogsOutletSql = "";
          if (outlet_id) {
            cogsOutletSql = " AND s.outlet_id = ?";
            cogsParams.push(outlet_id);
          }
          db.get(
            `SELECT COALESCE(SUM(si.cost_price_at_sale * si.quantity), 0) AS cogs
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE s.voided = 0
             AND date(s.timestamp) BETWEEN ? AND ?${cogsOutletSql}`,
            cogsParams,
            (err2, cogsRow) => {
              if (err2) return res.status(500).json({ error: err2.message });
              db.get(
                `SELECT COALESCE(SUM(ri.refund_price * ri.quantity), 0) AS returns
               FROM return_items ri
               JOIN returns r ON r.id = ri.return_id
               WHERE date(r.timestamp) BETWEEN ? AND ?`,
                [from, to],
                (err3, returnsRow) => {
                  if (err3)
                    return res.status(500).json({ error: err3.message });
                  db.all(
                    `SELECT COALESCE(ec.name, 'Uncategorized') AS name, COALESCE(SUM(e.amount), 0) AS total
                   FROM expenses e
                   LEFT JOIN expense_categories ec ON ec.id = e.category_id
                   WHERE date(e.expense_date) BETWEEN ? AND ?
                   GROUP BY COALESCE(ec.name, 'Uncategorized')
                   ORDER BY total DESC`,
                    [from, to],
                    (err4, expenseRows) => {
                      if (err4)
                        return res.status(500).json({ error: err4.message });

                      const grossSales = Number(salesRow?.gross_sales || 0);
                      const discounts = Number(salesRow?.discounts || 0);
                      const returns = Number(returnsRow?.returns || 0);
                      const cogs = Number(cogsRow?.cogs || 0);
                      const netRevenue = grossSales - returns;
                      const grossProfit = netRevenue - cogs;
                      const operatingExpenses = expenseRows || [];
                      const totalOpex = operatingExpenses.reduce(
                        (s, r) => s + Number(r.total || 0),
                        0,
                      );
                      const netProfit = grossProfit - totalOpex;

                      res.json({
                        revenue: {
                          gross_sales: grossSales,
                          discounts,
                          returns,
                          net_revenue: netRevenue,
                        },
                        cogs,
                        gross_profit: grossProfit,
                        gross_margin_pct:
                          netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
                        operating_expenses: operatingExpenses,
                        total_opex: totalOpex,
                        net_profit: netProfit,
                        net_margin_pct:
                          netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0,
                      });
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );

  router.get(
    "/api/accounting/cashflow",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { from, to } = req.query || {};
      if (!from || !to)
        return res.status(400).json({ error: "from and to are required" });

      db.all(
        `SELECT sp.payment_method, COALESCE(SUM(sp.amount), 0) AS total
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       WHERE s.voided = 0 AND date(s.timestamp) BETWEEN ? AND ?
       GROUP BY sp.payment_method
       ORDER BY total DESC`,
        [from, to],
        (err, inflowsRows) => {
          if (err) return res.status(500).json({ error: err.message });
          db.get(
            "SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE date(expense_date) BETWEEN ? AND ?",
            [from, to],
            (err2, expenseRow) => {
              if (err2) return res.status(500).json({ error: err2.message });
              db.get(
                "SELECT COALESCE(SUM(amount), 0) AS supplier_payments FROM supplier_payments WHERE date(paid_at) BETWEEN ? AND ?",
                [from, to],
                (err3, supplierRow) => {
                  if (err3)
                    return res.status(500).json({ error: err3.message });
                  const inflows = inflowsRows || [];
                  const totalInflows = inflows.reduce(
                    (s, r) => s + Number(r.total || 0),
                    0,
                  );
                  const expenses = Number(expenseRow?.expenses || 0);
                  const supplierPayments = Number(
                    supplierRow?.supplier_payments || 0,
                  );
                  const totalOutflows = expenses + supplierPayments;
                  res.json({
                    inflows,
                    total_inflows: totalInflows,
                    outflows: {
                      expenses,
                      supplier_payments: supplierPayments,
                      total: totalOutflows,
                    },
                    net_cashflow: totalInflows - totalOutflows,
                  });
                },
              );
            },
          );
        },
      );
    },
  );

  router.get(
    "/api/accounting/ap",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { status = "" } = req.query || {};
      const where = ["1=1"];
      const params = [];
      if (status) {
        where.push("si.status = ?");
        params.push(status);
      }
      db.all(
        `SELECT si.id, si.invoice_number, si.created_at AS invoice_date, si.due_date, si.amount,
              COALESCE(sp.paid_amount, 0) AS paid_amount,
              (COALESCE(si.amount, 0) - COALESCE(sp.paid_amount, 0)) AS outstanding,
              si.status, s.name AS supplier_name
       FROM supplier_invoices si
       LEFT JOIN suppliers s ON s.id = si.supplier_id
       LEFT JOIN (
         SELECT supplier_invoice_id, COALESCE(SUM(amount), 0) AS paid_amount
         FROM supplier_payments
         GROUP BY supplier_invoice_id
       ) sp ON sp.supplier_invoice_id = si.id
       WHERE ${where.join(" AND ")}
       ORDER BY date(COALESCE(si.due_date, si.created_at)) ASC, si.id DESC`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          db.all(
            `SELECT c.id, c.name, c.mobile, COALESCE(c.balance, 0) AS credit_balance,
                  COALESCE(SUM(s.total_amount), 0) AS total_purchases,
                  MAX(s.timestamp) AS last_purchase
           FROM customers c
           LEFT JOIN sales s ON s.customer_id = c.id AND s.voided = 0
           WHERE COALESCE(c.balance, 0) <> 0
           GROUP BY c.id, c.name, c.mobile, c.balance
           ORDER BY ABS(COALESCE(c.balance, 0)) DESC`,
            [],
            (err2, customerRows) => {
              if (err2) return res.status(500).json({ error: err2.message });
              res.json({
                supplier_ap: rows || [],
                customer_ar: customerRows || [],
              });
            },
          );
        },
      );
    },
  );

  router.get(
    "/api/accounting/periods",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      db.all(
        "SELECT * FROM accounting_periods ORDER BY start_date DESC, id DESC",
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ periods: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/accounting/periods",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { period_name, start_date, end_date } = req.body || {};
      if (!period_name || !start_date || !end_date) {
        return res
          .status(400)
          .json({ error: "period_name, start_date and end_date are required" });
      }
      db.run(
        "INSERT INTO accounting_periods (period_name, start_date, end_date, status) VALUES (?, ?, ?, 'open')",
        [period_name, start_date, end_date],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Accounting period created", id: this.lastID });
        },
      );
    },
  );

  router.put(
    "/api/accounting/periods/:id",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { id } = req.params;
      const { status, notes } = req.body || {};
      if (!status) return res.status(400).json({ error: "status is required" });
      const isClosed = status === "closed";
      db.run(
        `UPDATE accounting_periods
       SET status = ?, notes = ?, closed_by = ?, closed_at = ?
       WHERE id = ?`,
        [
          status,
          notes || null,
          isClosed ? Number(req.headers["x-employee-id"] || 0) || null : null,
          isClosed
            ? new Date().toISOString().replace("T", " ").slice(0, 19)
            : null,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Accounting period updated",
            changed: this.changes || 0,
          });
        },
      );
    },
  );
  // --- ROUTES: TIER 4 / HR ---

  router.get(
    "/api/hr/leave",
    requirePerm("manage_employees"),
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
    requirePerm("manage_employees"),
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
    requirePerm("manage_employees"),
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
    requirePerm("manage_employees"),
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
    requirePerm("manage_employees"),
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
    requirePerm("manage_employees"),
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
                  // Per-day attendance for overtime calculation
                  db.all(
                    `SELECT date(check_in, 'localtime') AS work_date,
                       COALESCE(SUM(
                         CASE WHEN check_out IS NOT NULL
                           THEN (julianday(check_out) - julianday(check_in)) * 24.0
                           ELSE 0 END
                       ), 0) AS day_hours
                     FROM employee_attendance
                     WHERE employee_id = ?
                       AND date(check_in) BETWEEN ? AND ?
                     GROUP BY date(check_in, 'localtime')`,
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

                          // Calculate per-day regular vs overtime hours
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
                              noteParts.push(`Regular: ${totalRegularHours.toFixed(1)}h, Overtime: ${totalOvertimeHours.toFixed(1)}h @1.5x`);
                            }
                          } else if (salaryType === "daily") {
                            baseRate = Number(emp.daily_rate || 0);
                            grossPay = Number((baseRate * totalDays).toFixed(2));
                          } else {
                            // Monthly salary with leave + absence deductions
                            baseRate = Number(emp.monthly_salary || 0);
                            grossPay = baseRate;
                            const dailyRate = baseRate / 30;
                            const leaveAllowance = Number(emp.monthly_leave_allowance || 2);

                            // Leave deduction: only excess leave beyond allowance
                            const excessLeave = Math.max(0, leaveDays - leaveAllowance);
                            const leaveDeduction = Number((excessLeave * dailyRate).toFixed(2));
                            if (excessLeave > 0) {
                              noteParts.push(`Leave: ${leaveDays}d (${excessLeave} excess × ${dailyRate.toFixed(0)}/d)`);
                            }

                            // Absence deduction: days not worked and not on approved leave
                            const expectedDays = 30 - leaveDays;
                            const absentDays = Math.max(0, expectedDays - totalDays);
                            const absenceDeduction = Number((absentDays * dailyRate).toFixed(2));
                            if (absentDays > 0) {
                              noteParts.push(`Absent: ${absentDays}d × ${dailyRate.toFixed(0)}/d`);
                            }

                            deductions = Number((leaveDeduction + absenceDeduction).toFixed(2));
                          }
                          const netPay = Number((grossPay - deductions).toFixed(2));
                          const notes = noteParts.length > 0 ? noteParts.join("; ") : null;

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
    requirePerm("manage_employees"),
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
  // --- ROUTES: TIER 4 / CRM + QUOTATIONS ---

  router.get(
    "/api/crm/leads",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      db.all(
        `SELECT l.*, e.name AS assigned_to_name,
            (SELECT COUNT(*) FROM crm_activities a WHERE a.lead_id = l.id) AS activity_count
     FROM crm_leads l
     LEFT JOIN employees e ON e.id = l.assigned_to
     ORDER BY datetime(l.created_at) DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ leads: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/crm/leads",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const {
        name,
        company,
        phone,
        email,
        source,
        stage = "new",
        priority = "medium",
        expected_value = 0,
        assigned_to,
        notes,
      } = req.body || {};
      if (!name) return res.status(400).json({ error: "name is required" });
      db.run(
        `INSERT INTO crm_leads
     (name, company, phone, email, source, stage, priority, expected_value, assigned_to, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
        [
          name,
          company || null,
          phone || null,
          email || null,
          source || null,
          stage,
          priority,
          Number(expected_value || 0),
          assigned_to || null,
          notes || null,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Lead created", id: this.lastID });
        },
      );
    },
  );

  router.put(
    "/api/crm/leads/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const {
        name,
        company,
        phone,
        email,
        source,
        stage,
        priority,
        expected_value,
        assigned_to,
        notes,
      } = req.body || {};
      db.run(
        `UPDATE crm_leads
     SET name = COALESCE(?, name),
         company = ?,
         phone = ?,
         email = ?,
         source = ?,
         stage = COALESCE(?, stage),
         priority = COALESCE(?, priority),
         expected_value = COALESCE(?, expected_value),
         assigned_to = ?,
         notes = ?,
         updated_at = datetime('now','localtime')
     WHERE id = ?`,
        [
          name || null,
          company || null,
          phone || null,
          email || null,
          source || null,
          stage || null,
          priority || null,
          expected_value !== undefined ? Number(expected_value) : null,
          assigned_to || null,
          notes || null,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Lead updated", changed: this.changes || 0 });
        },
      );
    },
  );

  router.delete(
    "/api/crm/leads/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.run("DELETE FROM crm_leads WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Lead deleted", changed: this.changes || 0 });
      });
    },
  );

  router.post(
    "/api/crm/leads/:id/activities",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const { type = "note", description, employee_id } = req.body || {};
      if (!description)
        return res.status(400).json({ error: "description is required" });
      db.run(
        "INSERT INTO crm_activities (lead_id, employee_id, type, description) VALUES (?, ?, ?, ?)",
        [id, employee_id || null, type, description],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Activity added", id: this.lastID });
        },
      );
    },
  );

  router.get(
    "/api/crm/leads/:id/activities",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.all(
        `SELECT a.*, e.name AS employee_name
     FROM crm_activities a
     LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.lead_id = ?
     ORDER BY datetime(a.created_at) DESC`,
        [id],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ activities: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/crm/leads/:id/convert",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.get("SELECT * FROM crm_leads WHERE id = ?", [id], (err, lead) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!lead) return res.status(404).json({ error: "Lead not found" });
        if (lead.customer_id) {
          return res.json({
            message: "Lead already converted",
            customer_id: lead.customer_id,
          });
        }
        db.run(
          "INSERT INTO customers (name, mobile, email, address) VALUES (?, ?, ?, ?)",
          [
            lead.name,
            lead.phone || null,
            lead.email || null,
            lead.company || null,
          ],
          function (insErr) {
            if (insErr) return res.status(500).json({ error: insErr.message });
            const customerId = this.lastID;
            db.run(
              "UPDATE crm_leads SET customer_id = ?, stage = 'converted', updated_at = datetime('now','localtime') WHERE id = ?",
              [customerId, id],
              (updErr) => {
                if (updErr)
                  return res.status(500).json({ error: updErr.message });
                res.json({
                  message: "Lead converted",
                  customer_id: customerId,
                });
              },
            );
          },
        );
      });
    },
  );

  router.get(
    "/api/quotations",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const {
        status = "",
        customer_id = "",
        from = "",
        to = "",
      } = req.query || {};
      const where = ["1=1"];
      const params = [];
      if (status) {
        where.push("q.status = ?");
        params.push(status);
      }
      if (customer_id) {
        where.push("q.customer_id = ?");
        params.push(customer_id);
      }
      if (from) {
        where.push("date(q.created_at) >= ?");
        params.push(from);
      }
      if (to) {
        where.push("date(q.created_at) <= ?");
        params.push(to);
      }
      db.all(
        `SELECT q.*, c.name AS customer_name, l.name AS lead_name, e.name AS employee_name, o.name AS outlet_name
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN crm_leads l ON l.id = q.lead_id
     LEFT JOIN employees e ON e.id = q.employee_id
     LEFT JOIN outlets o ON o.id = q.outlet_id
     WHERE ${where.join(" AND ")}
     ORDER BY datetime(q.created_at) DESC`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ quotations: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/quotations",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const {
        lead_id,
        customer_id,
        outlet_id,
        employee_id,
        items,
        discount_type = "fixed",
        discount_amount = 0,
        valid_until,
        notes,
      } = req.body || {};
      if (!outlet_id || !items || !Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ error: "outlet_id and items are required" });
      }

      const subtotal = items.reduce(
        (sum, item) =>
          sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
        0,
      );
      const taxTotal = items.reduce((sum, item) => {
        const line = Number(item.unit_price || 0) * Number(item.quantity || 0);
        return sum + (line * Number(item.tax_rate || 0)) / 100;
      }, 0);
      const discount =
        discount_type === "percent"
          ? (subtotal * Number(discount_amount || 0)) / 100
          : Number(discount_amount || 0);
      const total = subtotal + taxTotal - discount;
      const quoteNumber = `Q-${Date.now()}`;

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          `INSERT INTO quotations
       (quote_number, lead_id, customer_id, outlet_id, employee_id, status, discount_type, discount_amount, subtotal, tax_total, total_amount, valid_until, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
          [
            quoteNumber,
            lead_id || null,
            customer_id || null,
            outlet_id,
            employee_id || null,
            discount_type,
            Number(discount_amount || 0),
            subtotal,
            taxTotal,
            total,
            valid_until || null,
            notes || null,
          ],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: err.message });
            }
            const quotationId = this.lastID;
            const stmt = db.prepare(
              `INSERT INTO quotation_items
           (quotation_id, product_id, variant_id, quantity, unit_price, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
            );
            let hasErr = false;
            items.forEach((item) => {
              const qty = Number(item.quantity || 0);
              const unitPrice = Number(item.unit_price || 0);
              const taxRate = Number(item.tax_rate || 0);
              const lineTotal = unitPrice * qty;
              stmt.run(
                quotationId,
                item.product_id,
                item.variant_id || null,
                qty,
                unitPrice,
                taxRate,
                lineTotal,
                (lineErr) => {
                  if (lineErr) hasErr = true;
                },
              );
            });
            stmt.finalize();
            if (hasErr) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to insert quotation items" });
            }
            db.run("COMMIT", (commitErr) => {
              if (commitErr)
                return res.status(500).json({ error: commitErr.message });
              res.json({
                message: "Quotation created",
                id: quotationId,
                quote_number: quoteNumber,
              });
            });
          },
        );
      });
    },
  );

  router.get(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.get(
        `SELECT q.*, c.name AS customer_name, l.name AS lead_name, e.name AS employee_name, o.name AS outlet_name
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN crm_leads l ON l.id = q.lead_id
     LEFT JOIN employees e ON e.id = q.employee_id
     LEFT JOIN outlets o ON o.id = q.outlet_id
     WHERE q.id = ?`,
        [id],
        (err, quotation) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!quotation)
            return res.status(404).json({ error: "Quotation not found" });
          db.all(
            `SELECT qi.*, p.name AS product_name
         FROM quotation_items qi
         JOIN products p ON p.id = qi.product_id
         WHERE qi.quotation_id = ?`,
            [id],
            (itemErr, items) => {
              if (itemErr)
                return res.status(500).json({ error: itemErr.message });
              res.json({ quotation, items: items || [] });
            },
          );
        },
      );
    },
  );

  router.put(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const {
        lead_id,
        customer_id,
        outlet_id,
        employee_id,
        items,
        discount_type = "fixed",
        discount_amount = 0,
        valid_until,
        notes,
      } = req.body || {};
      db.get(
        "SELECT status FROM quotations WHERE id = ?",
        [id],
        (checkErr, row) => {
          if (checkErr)
            return res.status(500).json({ error: checkErr.message });
          if (!row)
            return res.status(404).json({ error: "Quotation not found" });
          if (
            !["draft", "sent"].includes(String(row.status || "").toLowerCase())
          ) {
            return res
              .status(400)
              .json({ error: "Only draft/sent quotations can be edited" });
          }

          const safeItems = Array.isArray(items) ? items : [];
          const subtotal = safeItems.reduce(
            (sum, item) =>
              sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
            0,
          );
          const taxTotal = safeItems.reduce((sum, item) => {
            const line =
              Number(item.unit_price || 0) * Number(item.quantity || 0);
            return sum + (line * Number(item.tax_rate || 0)) / 100;
          }, 0);
          const discount =
            discount_type === "percent"
              ? (subtotal * Number(discount_amount || 0)) / 100
              : Number(discount_amount || 0);
          const total = subtotal + taxTotal - discount;

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run(
              `UPDATE quotations
         SET lead_id = ?, customer_id = ?, outlet_id = ?, employee_id = ?,
             discount_type = ?, discount_amount = ?, subtotal = ?, tax_total = ?, total_amount = ?,
             valid_until = ?, notes = ?, updated_at = datetime('now','localtime')
         WHERE id = ?`,
              [
                lead_id || null,
                customer_id || null,
                outlet_id || null,
                employee_id || null,
                discount_type,
                Number(discount_amount || 0),
                subtotal,
                taxTotal,
                total,
                valid_until || null,
                notes || null,
                id,
              ],
              (updErr) => {
                if (updErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: updErr.message });
                }
                db.run(
                  "DELETE FROM quotation_items WHERE quotation_id = ?",
                  [id],
                  (delErr) => {
                    if (delErr) {
                      db.run("ROLLBACK");
                      return res.status(500).json({ error: delErr.message });
                    }
                    const stmt = db.prepare(
                      "INSERT INTO quotation_items (quotation_id, product_id, variant_id, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    );
                    let hasErr = false;
                    safeItems.forEach((item) => {
                      const qty = Number(item.quantity || 0);
                      const unitPrice = Number(item.unit_price || 0);
                      stmt.run(
                        id,
                        item.product_id,
                        item.variant_id || null,
                        qty,
                        unitPrice,
                        Number(item.tax_rate || 0),
                        unitPrice * qty,
                        (insErr) => {
                          if (insErr) hasErr = true;
                        },
                      );
                    });
                    stmt.finalize();
                    if (hasErr) {
                      db.run("ROLLBACK");
                      return res
                        .status(500)
                        .json({ error: "Failed to update quotation items" });
                    }
                    db.run("COMMIT", (commitErr) => {
                      if (commitErr)
                        return res
                          .status(500)
                          .json({ error: commitErr.message });
                      res.json({ message: "Quotation updated" });
                    });
                  },
                );
              },
            );
          });
        },
      );
    },
  );

  router.put(
    "/api/quotations/:id/status",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const { status } = req.body || {};
      const allowed = [
        "draft",
        "sent",
        "accepted",
        "rejected",
        "expired",
        "converted",
      ];
      if (!allowed.includes(status))
        return res.status(400).json({ error: "Invalid status" });
      db.run(
        "UPDATE quotations SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?",
        [status, id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Quotation status updated",
            changed: this.changes || 0,
          });
        },
      );
    },
  );

  router.delete(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.get("SELECT status FROM quotations WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Quotation not found" });
        if (String(row.status || "").toLowerCase() !== "draft") {
          return res
            .status(400)
            .json({ error: "Only draft quotations can be deleted" });
        }
        db.run("DELETE FROM quotations WHERE id = ?", [id], function (delErr) {
          if (delErr) return res.status(500).json({ error: delErr.message });
          res.json({
            message: "Quotation deleted",
            changed: this.changes || 0,
          });
        });
      });
    },
  );

  router.post(
    "/api/quotations/:id/convert",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const { payment_method = "Cash", employee_id } = req.body || {};
      db.get("SELECT * FROM quotations WHERE id = ?", [id], (err, quote) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!quote)
          return res.status(404).json({ error: "Quotation not found" });
        if (String(quote.status || "").toLowerCase() !== "accepted") {
          return res
            .status(400)
            .json({ error: "Only accepted quotations can be converted" });
        }
        db.all(
          "SELECT * FROM quotation_items WHERE quotation_id = ?",
          [id],
          (itemErr, items) => {
            if (itemErr)
              return res.status(500).json({ error: itemErr.message });
            if (!items || items.length === 0)
              return res.status(400).json({ error: "Quotation has no items" });

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              db.run(
                `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  Number(quote.total_amount || 0),
                  payment_method,
                  quote.outlet_id || null,
                  employee_id || quote.employee_id || null,
                  quote.customer_id || null,
                  Number(quote.discount_amount || 0),
                  quote.discount_type || "fixed",
                  `Converted from quotation ${quote.quote_number || quote.id}`,
                ],
                function (saleErr) {
                  if (saleErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: saleErr.message });
                  }
                  const saleId = this.lastID;
                  const itemStmt = db.prepare(
                    "INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale, cost_price_at_sale) VALUES (?, ?, ?, ?, ?, ?)",
                  );
                  const stockStmt = db.prepare(
                    `UPDATE outlet_stock
               SET quantity = quantity - ?
               WHERE product_id = ? AND outlet_id = ?`,
                  );
                  const payStmt = db.prepare(
                    "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)",
                  );
                  let hasErr = false;
                  items.forEach((it) => {
                    const qty = Number(it.quantity || 0);
                    itemStmt.run(
                      saleId,
                      it.product_id,
                      it.variant_id || null,
                      qty,
                      Number(it.unit_price || 0),
                      0,
                      (insErr) => {
                        if (insErr) hasErr = true;
                      },
                    );
                    stockStmt.run(
                      qty,
                      it.product_id,
                      quote.outlet_id,
                      (stkErr) => {
                        if (stkErr) hasErr = true;
                      },
                    );
                  });
                  payStmt.run(
                    saleId,
                    payment_method,
                    Number(quote.total_amount || 0),
                    (payErr) => {
                      if (payErr) hasErr = true;
                    },
                  );
                  itemStmt.finalize();
                  stockStmt.finalize();
                  payStmt.finalize();

                  if (hasErr) {
                    db.run("ROLLBACK");
                    return res
                      .status(500)
                      .json({ error: "Failed to convert quotation into sale" });
                  }
                  db.run(
                    "UPDATE quotations SET status = 'converted', converted_sale_id = ?, updated_at = datetime('now','localtime') WHERE id = ?",
                    [saleId, id],
                    (updErr) => {
                      if (updErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: updErr.message });
                      }
                      db.run("COMMIT", (commitErr) => {
                        if (commitErr)
                          return res
                            .status(500)
                            .json({ error: commitErr.message });
                        createNotification(
                          "quotation_accepted",
                          "Quotation Converted",
                          `Quotation ${quote.quote_number || id} converted to Sale #${saleId}`,
                          "/sales-history",
                        );
                        res.json({
                          message: "Quotation converted",
                          sale_id: saleId,
                        });
                      });
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

  return router;
};
