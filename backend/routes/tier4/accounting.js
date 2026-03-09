const express = require("express");
const { toUtcStart, toUtcEnd } = require("../../utils/tz");

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
      const tz = req.company?.timezone || "UTC";

      const salesParams = [toUtcStart(from, tz), toUtcEnd(to, tz)];
      const outletSql = outlet_id ? " AND outlet_id = ?" : "";
      if (outlet_id) salesParams.push(outlet_id);

      db.get(
        `SELECT COALESCE(SUM(total_amount), 0) AS gross_sales,
              COALESCE(SUM(discount_amount), 0) AS discounts
       FROM sales
       WHERE voided = 0
         AND timestamp >= ? AND timestamp < ?${outletSql}`,
        salesParams,
        (err, salesRow) => {
          if (err) return res.status(500).json({ error: err.message });

          const cogsParams = [toUtcStart(from, tz), toUtcEnd(to, tz)];
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
             AND s.timestamp >= ? AND s.timestamp < ?${cogsOutletSql}`,
            cogsParams,
            (err2, cogsRow) => {
              if (err2) return res.status(500).json({ error: err2.message });
              db.get(
                `SELECT COALESCE(SUM(ri.refund_price * ri.quantity), 0) AS returns
               FROM return_items ri
               JOIN returns r ON r.id = ri.return_id
               WHERE r.timestamp >= ? AND r.timestamp < ?`,
                [toUtcStart(from, tz), toUtcEnd(to, tz)],
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

      const tz = req.company?.timezone || "UTC";
      db.all(
        `SELECT sp.payment_method, COALESCE(SUM(sp.amount), 0) AS total
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id
       WHERE s.voided = 0 AND s.timestamp >= ? AND s.timestamp < ?
       GROUP BY sp.payment_method
       ORDER BY total DESC`,
        [toUtcStart(from, tz), toUtcEnd(to, tz)],
        (err, inflowsRows) => {
          if (err) return res.status(500).json({ error: err.message });
          db.get(
            "SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE date(expense_date) >= ? AND date(expense_date) <= ?",
            [from, to],
            (err2, expenseRow) => {
              if (err2) return res.status(500).json({ error: err2.message });
              db.get(
                "SELECT COALESCE(SUM(amount), 0) AS supplier_payments FROM supplier_payments WHERE date(paid_at) >= ? AND date(paid_at) <= ?",
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

  // ── Daily Cashflow Breakdown ──────────────────────────────────────────────
  router.get(
    "/api/accounting/cashflow/daily",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { date_from, date_to, outlet_id } = req.query || {};
      if (!date_from || !date_to)
        return res.status(400).json({ error: "date_from and date_to are required" });

      const tz = req.company?.timezone || "UTC";
      const inflowParams = [toUtcStart(date_from, tz), toUtcEnd(date_to, tz)];
      const outletSql = outlet_id ? " AND s.outlet_id = ?" : "";
      if (outlet_id) inflowParams.push(outlet_id);

      // Daily cash inflows from sale_payments (Cash only)
      db.all(
        `SELECT date(s.timestamp) AS date,
                COALESCE(SUM(sp.amount), 0) AS inflow
         FROM sale_payments sp
         JOIN sales s ON s.id = sp.sale_id
         WHERE s.voided = 0
           AND sp.payment_method = 'Cash'
           AND s.timestamp >= ? AND s.timestamp < ?${outletSql}
         GROUP BY date(s.timestamp)`,
        inflowParams,
        (err, inflowRows) => {
          if (err) return res.status(500).json({ error: err.message });

          // Daily cash outflows from expenses (local date — no UTC conversion)
          const expParams = [date_from, date_to];
          if (outlet_id) expParams.push(outlet_id);
          const expOutletSql = outlet_id ? " AND outlet_id = ?" : "";

          db.all(
            `SELECT date(expense_date) AS date,
                    COALESCE(SUM(amount), 0) AS outflow
             FROM expenses
             WHERE date(expense_date) >= ? AND date(expense_date) <= ?${expOutletSql}
             GROUP BY date(expense_date)`,
            expParams,
            (err2, outflowRows) => {
              if (err2) return res.status(500).json({ error: err2.message });

              // Merge by date
              const map = {};
              for (const r of inflowRows || []) {
                map[r.date] = { date: r.date, inflow: Number(r.inflow || 0), outflow: 0 };
              }
              for (const r of outflowRows || []) {
                if (!map[r.date]) map[r.date] = { date: r.date, inflow: 0, outflow: 0 };
                map[r.date].outflow = Number(r.outflow || 0);
              }
              const rows = Object.values(map)
                .sort((a, b) => (a.date < b.date ? -1 : 1))
                .map((r) => ({ ...r, net: r.inflow - r.outflow }));

              res.json({ cashflow: rows });
            },
          );
        },
      );
    },
  );

  // ── AP/AR Summary ─────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/ap-ar",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      db.get(
        `SELECT COALESCE(SUM(si.amount - COALESCE(sp.paid_amount, 0)), 0) AS total_ap
         FROM supplier_invoices si
         LEFT JOIN (
           SELECT supplier_invoice_id, SUM(amount) AS paid_amount
           FROM supplier_payments GROUP BY supplier_invoice_id
         ) sp ON sp.supplier_invoice_id = si.id
         WHERE si.status != 'paid'`,
        [],
        (err, apRow) => {
          if (err) return res.status(500).json({ error: err.message });
          db.get(
            `SELECT COALESCE(SUM(balance), 0) AS total_ar
             FROM customers WHERE COALESCE(balance, 0) > 0`,
            [],
            (err2, arRow) => {
              if (err2) return res.status(500).json({ error: err2.message });
              const total_ap = Number(apRow?.total_ap || 0);
              const total_ar = Number(arRow?.total_ar || 0);
              res.json({ total_ap, total_ar, net_position: total_ar - total_ap });
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

  router.get(
    "/api/accounting/balance-sheet",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      db.serialize(() => {
        // Assets
        const assetQueries = [
          // 1. Inventory at cost (products with stock > 0)
          new Promise((resolve, reject) =>
            db.get(
              `SELECT COALESCE(SUM(p.cost_price * COALESCE(pi.quantity, 0)), 0) AS inventory_value
               FROM products p
               LEFT JOIN product_inventory pi ON pi.product_id = p.id
               WHERE COALESCE(pi.quantity, 0) > 0`,
              [],
              (err, row) => (err ? reject(err) : resolve(Number(row?.inventory_value || 0))),
            ),
          ),
          // 2. Cash in open shifts
          new Promise((resolve, reject) =>
            db.get(
              `SELECT COALESCE(SUM(opening_cash), 0) AS cash_on_hand
               FROM cash_shifts WHERE status = 'open'`,
              [],
              (err, row) => (err ? reject(err) : resolve(Number(row?.cash_on_hand || 0))),
            ),
          ),
        ];

        // Liabilities
        const liabilityQueries = [
          // 3. Supplier AP outstanding
          new Promise((resolve, reject) =>
            db.get(
              `SELECT COALESCE(SUM(si.amount - COALESCE(sp.paid_amount, 0)), 0) AS supplier_ap
               FROM supplier_invoices si
               LEFT JOIN (
                 SELECT supplier_invoice_id, SUM(amount) AS paid_amount
                 FROM supplier_payments GROUP BY supplier_invoice_id
               ) sp ON sp.supplier_invoice_id = si.id
               WHERE si.status != 'paid'`,
              [],
              (err, row) => (err ? reject(err) : resolve(Number(row?.supplier_ap || 0))),
            ),
          ),
          // 4. Customer credit liabilities (negative balance = store owes customer)
          new Promise((resolve, reject) =>
            db.get(
              `SELECT COALESCE(SUM(ABS(balance)), 0) AS customer_credit
               FROM customers WHERE COALESCE(balance, 0) < 0`,
              [],
              (err, row) => (err ? reject(err) : resolve(Number(row?.customer_credit || 0))),
            ),
          ),
        ];

        Promise.all([...assetQueries, ...liabilityQueries])
          .then(([inventoryValue, cashOnHand, supplierAp, customerCredit]) => {
            const totalAssets = inventoryValue + cashOnHand;
            const totalLiabilities = supplierAp + customerCredit;
            const equity = totalAssets - totalLiabilities;
            res.json({
              assets: {
                inventory_value: inventoryValue,
                cash_on_hand: cashOnHand,
                total: totalAssets,
              },
              liabilities: {
                supplier_ap: supplierAp,
                customer_credit: customerCredit,
                total: totalLiabilities,
              },
              equity,
            });
          })
          .catch((err) => res.status(500).json({ error: err.message }));
      });
    },
  );

  // ── Expense Ledger ─────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/expenses",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { from, to, category_id, outlet_id } = req.query || {};
      const where = ["1=1"];
      const params = [];
      if (from) { where.push("date(e.expense_date) >= ?"); params.push(from); }
      if (to) { where.push("date(e.expense_date) <= ?"); params.push(to); }
      if (category_id) { where.push("e.category_id = ?"); params.push(category_id); }
      if (outlet_id) { where.push("e.outlet_id = ?"); params.push(outlet_id); }
      db.all(
        `SELECT e.*, ec.name AS category_name, o.name AS outlet_name, em.name AS employee_name
         FROM expenses e
         LEFT JOIN expense_categories ec ON ec.id = e.category_id
         LEFT JOIN outlets o ON o.id = e.outlet_id
         LEFT JOIN employees em ON em.id = e.employee_id
         WHERE ${where.join(" AND ")}
         ORDER BY date(e.expense_date) DESC, e.id DESC`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          db.all("SELECT * FROM expense_categories ORDER BY name ASC", [], (err2, cats) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ expenses: rows || [], categories: cats || [] });
          });
        },
      );
    },
  );

  // ── AP Aging ───────────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/ap-aging",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      db.all(
        `SELECT si.id, si.invoice_number, si.created_at AS invoice_date, si.due_date,
                si.amount,
                COALESCE(sp.paid_amount, 0) AS paid_amount,
                (si.amount - COALESCE(sp.paid_amount, 0)) AS outstanding,
                si.status,
                s.name AS supplier_name,
                CAST(julianday('now') - julianday(COALESCE(si.due_date, si.created_at)) AS INTEGER) AS days_overdue
         FROM supplier_invoices si
         LEFT JOIN suppliers s ON s.id = si.supplier_id
         LEFT JOIN (
           SELECT supplier_invoice_id, SUM(amount) AS paid_amount
           FROM supplier_payments GROUP BY supplier_invoice_id
         ) sp ON sp.supplier_invoice_id = si.id
         WHERE si.status != 'paid'
           AND (si.amount - COALESCE(sp.paid_amount, 0)) > 0
         ORDER BY days_overdue DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          const buckets = { current: [], d30: [], d60: [], d90: [], over90: [] };
          let totals = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
          (rows || []).forEach((r) => {
            const d = Number(r.days_overdue || 0);
            const amt = Number(r.outstanding || 0);
            let key;
            if (d <= 0) key = "current";
            else if (d <= 30) key = "d30";
            else if (d <= 60) key = "d60";
            else if (d <= 90) key = "d90";
            else key = "over90";
            buckets[key].push(r);
            totals[key] += amt;
          });
          res.json({ buckets, totals });
        },
      );
    },
  );

  // ── Tax Ledger ─────────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/tax-ledger",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { from, to } = req.query || {};
      if (!from || !to) return res.status(400).json({ error: "from and to are required" });
      const tz = req.company?.timezone || "UTC";
      db.all(
        `SELECT t.name AS tax_name, t.rate,
                COUNT(DISTINCT s.id) AS transaction_count,
                COALESCE(SUM(si.quantity * si.price_at_sale), 0) AS taxable_amount,
                COALESCE(SUM(si.quantity * si.price_at_sale * t.rate / 100.0), 0) AS tax_collected
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id AND s.voided = 0
         JOIN products p ON p.id = si.product_id
         JOIN taxes t ON t.id = p.tax_id
         WHERE s.timestamp >= ? AND s.timestamp < ?
         GROUP BY t.id, t.name, t.rate
         ORDER BY tax_collected DESC`,
        [toUtcStart(from, tz), toUtcEnd(to, tz)],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          const total_tax = (rows || []).reduce((s, r) => s + Number(r.tax_collected || 0), 0);
          res.json({ rows: rows || [], total_tax });
        },
      );
    },
  );

  // ── Supplier Payment History ───────────────────────────────────────────────
  router.get(
    "/api/accounting/supplier-payments",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    (req, res) => {
      const { from, to } = req.query || {};
      const where = ["1=1"];
      const params = [];
      if (from) { where.push("date(sp.paid_at) >= ?"); params.push(from); }
      if (to) { where.push("date(sp.paid_at) <= ?"); params.push(to); }
      db.all(
        `SELECT sp.id, sp.amount, sp.payment_method, sp.paid_at, sp.notes,
                si.invoice_number, s.name AS supplier_name
         FROM supplier_payments sp
         LEFT JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
         LEFT JOIN suppliers s ON s.id = si.supplier_id
         WHERE ${where.join(" AND ")}
         ORDER BY date(sp.paid_at) DESC, sp.id DESC`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          const total = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
          res.json({ payments: rows || [], total });
        },
      );
    },
  );

  return router;
};
