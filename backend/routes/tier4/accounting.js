const express = require("express");

module.exports = function createAccountingRouter({
  db,
  requireFeature,
  requireAnyPerm,
}) {
  const router = express.Router();

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

  return router;
};
