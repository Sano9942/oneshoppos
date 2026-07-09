const express = require("express");
const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function createAccountingRouter({
  db,
  requireFeature,
  requireAnyPerm,
}) {
  const router = express.Router();

  // Returns the closed-period row that contains entryDate (YYYY-MM-DD), or null.
  // accounting_periods.start_date and end_date are TEXT — cast for safe comparison.
  async function findClosedPeriodFor(entryDate) {
    const { rows } = await db.query(
      `SELECT id, period_name FROM accounting_periods
       WHERE status = 'closed'
         AND start_date::date <= $1::date
         AND end_date::date   >= $1::date
       LIMIT 1`,
      [entryDate]
    );
    return rows[0] || null;
  }

  router.get(
    "/api/accounting/pnl",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { from, to, outlet_id } = req.query || {};
        if (!from || !to)
          return res.status(400).json({ error: "from and to are required" });
        const tz = req.company?.timezone || "UTC";

        const salesParams = [toUtcStart(from, tz), toUtcEnd(to, tz)];
        let outletSql = "";
        if (outlet_id) {
          outletSql = ` AND outlet_id = $${salesParams.length + 1}`;
          salesParams.push(outlet_id);
        }

        const { rows: [salesRow] } = await db.query(
          `SELECT COALESCE(SUM(total_amount), 0) AS gross_sales,
                  COALESCE(SUM(discount_amount), 0) AS discounts
           FROM sales
           WHERE voided = false
             AND timestamp >= $1 AND timestamp < $2${outletSql}`,
          salesParams
        );

        const cogsParams = [toUtcStart(from, tz), toUtcEnd(to, tz)];
        let cogsOutletSql = "";
        if (outlet_id) {
          cogsOutletSql = ` AND s.outlet_id = $${cogsParams.length + 1}`;
          cogsParams.push(outlet_id);
        }
        const { rows: [cogsRow] } = await db.query(
          `SELECT COALESCE(SUM(si.cost_price_at_sale * si.quantity), 0) AS cogs
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           WHERE s.voided = false
             AND s.timestamp >= $1 AND s.timestamp < $2${cogsOutletSql}`,
          cogsParams
        );

        const returnsParams = [toUtcStart(from, tz), toUtcEnd(to, tz)];
        let returnsOutletSql = "";
        if (outlet_id) {
          returnsOutletSql = ` AND r.outlet_id = $${returnsParams.length + 1}`;
          returnsParams.push(outlet_id);
        }
        const { rows: [returnsRow] } = await db.query(
          `SELECT COALESCE(SUM(ri.refund_price * ri.quantity), 0) AS returns
           FROM return_items ri
           JOIN returns r ON r.id = ri.return_id
           WHERE r.timestamp >= $1 AND r.timestamp < $2${returnsOutletSql}`,
          returnsParams
        );

        const expBreakParams = [from, to];
        let expBreakOutletSql = "";
        if (outlet_id) {
          expBreakOutletSql = ` AND e.outlet_id = $${expBreakParams.length + 1}`;
          expBreakParams.push(outlet_id);
        }
        const { rows: expenseRows } = await db.query(
          `SELECT COALESCE(ec.name, 'Uncategorized') AS name, COALESCE(SUM(e.amount), 0) AS total
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
           WHERE e.expense_date >= $1::date AND e.expense_date <= $2::date${expBreakOutletSql}
           GROUP BY COALESCE(ec.name, 'Uncategorized')
           ORDER BY total DESC`,
          expBreakParams
        );

        const grossSales = Number(salesRow?.gross_sales || 0);
        const discounts = Number(salesRow?.discounts || 0);
        const returns = Number(returnsRow?.returns || 0);
        const cogs = Number(cogsRow?.cogs || 0);
        const netRevenue = grossSales - returns;
        const grossProfit = netRevenue - cogs;
        const operatingExpenses = expenseRows || [];
        const totalOpex = operatingExpenses.reduce((s, r) => s + Number(r.total || 0), 0);
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
          gross_margin_pct: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
          operating_expenses: operatingExpenses,
          total_opex: totalOpex,
          net_profit: netProfit,
          net_margin_pct: netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/accounting/cashflow",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { from, to, outlet_id } = req.query || {};
        if (!from || !to)
          return res.status(400).json({ error: "from and to are required" });

        const tz = req.company?.timezone || "UTC";
        const inflowParams = [toUtcStart(from, tz), toUtcEnd(to, tz)];
        let inflowOutletSql = "";
        if (outlet_id) {
          inflowOutletSql = ` AND s.outlet_id = $${inflowParams.length + 1}`;
          inflowParams.push(outlet_id);
        }
        const { rows: inflowsRows } = await db.query(
          `SELECT LOWER(sp.payment_method) AS payment_method, COALESCE(SUM(sp.amount), 0) AS total
           FROM sale_payments sp
           JOIN sales s ON s.id = sp.sale_id
           WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2${inflowOutletSql}
           GROUP BY LOWER(sp.payment_method)
           ORDER BY total DESC`,
          inflowParams
        );

        const expParams = [from, to];
        let expOutletSql = "";
        if (outlet_id) {
          expOutletSql = ` AND outlet_id = $${expParams.length + 1}`;
          expParams.push(outlet_id);
        }
        const { rows: [expenseRow] } = await db.query(
          `SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE expense_date >= $1::date AND expense_date <= $2::date${expOutletSql}`,
          expParams
        );

        // supplier_payments has no outlet_id column — never per-outlet.
        // paid_at is TIMESTAMPTZ — filter with tenant-tz UTC bounds, not a
        // bare ::date cast (which evaluates in the DB session timezone).
        const { rows: [supplierRow] } = await db.query(
          "SELECT COALESCE(SUM(amount), 0) AS supplier_payments FROM supplier_payments WHERE paid_at >= $1 AND paid_at < $2",
          [toUtcStart(from, tz), toUtcEnd(to, tz)]
        );

        const inflows = inflowsRows || [];
        const totalInflows = inflows.reduce((s, r) => s + Number(r.total || 0), 0);
        const expenses = Number(expenseRow?.expenses || 0);
        const supplierPayments = Number(supplierRow?.supplier_payments || 0);
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
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Daily Cashflow Breakdown ──────────────────────────────────────────────
  router.get(
    "/api/accounting/cashflow/daily",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { date_from, date_to, outlet_id } = req.query || {};
        if (!date_from || !date_to)
          return res.status(400).json({ error: "date_from and date_to are required" });

        const tz = req.company?.timezone || "UTC";
        const inflowParams = [toUtcStart(date_from, tz), toUtcEnd(date_to, tz)];
        let outletSql = "";
        if (outlet_id) {
          outletSql = ` AND s.outlet_id = $${inflowParams.length + 1}`;
          inflowParams.push(outlet_id);
        }

        const { rows: inflowRows } = await db.query(
          `SELECT (s.timestamp AT TIME ZONE $${inflowParams.length + 1})::date AS date,
                  COALESCE(SUM(sp.amount), 0) AS inflow
           FROM sale_payments sp
           JOIN sales s ON s.id = sp.sale_id
           WHERE s.voided = false
             AND s.timestamp >= $1 AND s.timestamp < $2${outletSql}
           GROUP BY (s.timestamp AT TIME ZONE $${inflowParams.length + 1})::date`,
          [...inflowParams, tz]
        );

        const expParams = [date_from, date_to];
        let expOutletSql = "";
        if (outlet_id) {
          expOutletSql = ` AND outlet_id = $${expParams.length + 1}`;
          expParams.push(outlet_id);
        }

        const { rows: outflowRows } = await db.query(
          `SELECT expense_date AS date,
                  COALESCE(SUM(amount), 0) AS outflow
           FROM expenses
           WHERE expense_date >= $1::date AND expense_date <= $2::date${expOutletSql}
           GROUP BY expense_date`,
          expParams
        );

        // Merge by date. pg returns DATE columns as local-midnight JS Dates —
        // toISOString() would shift them to the PREVIOUS day east of UTC, so
        // use pgDateToStr (local getters) for the round-trip.
        const { pgDateToStr } = require("../../utils/tz");
        const map = {};
        for (const r of inflowRows || []) {
          const d = pgDateToStr(r.date);
          map[d] = { date: d, inflow: Number(r.inflow || 0), outflow: 0 };
        }
        for (const r of outflowRows || []) {
          const d = pgDateToStr(r.date);
          if (!map[d]) map[d] = { date: d, inflow: 0, outflow: 0 };
          map[d].outflow = Number(r.outflow || 0);
        }
        const rows = Object.values(map)
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .map((r) => ({ ...r, net: r.inflow - r.outflow }));

        res.json({ cashflow: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── AP/AR Summary ─────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/ap-ar",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { rows: [apRow] } = await db.query(
          `SELECT COALESCE(SUM(si.amount - COALESCE(sp.paid_amount, 0)), 0) AS total_ap
           FROM supplier_invoices si
           LEFT JOIN (
             SELECT supplier_invoice_id, SUM(amount) AS paid_amount
             FROM supplier_payments GROUP BY supplier_invoice_id
           ) sp ON sp.supplier_invoice_id = si.id
           WHERE si.status != 'paid'`
        );

        const { rows: [arRow] } = await db.query(
          `SELECT COALESCE(SUM(balance), 0) AS total_ar
           FROM customers WHERE COALESCE(balance, 0) > 0`
        );

        const total_ap = Number(apRow?.total_ap || 0);
        const total_ar = Number(arRow?.total_ar || 0);
        res.json({ total_ap, total_ar, net_position: total_ar - total_ap });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/accounting/ap",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { status = "" } = req.query || {};
        const where = ["1=1"];
        const params = [];
        let idx = 1;
        if (status) {
          where.push(`si.status = $${idx++}`);
          params.push(status);
        }
        const { rows } = await db.query(
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
           ORDER BY COALESCE(si.due_date::date, si.created_at::date) ASC, si.id DESC`,
          params
        );

        const { rows: customerRows } = await db.query(
          `SELECT c.id, c.name, c.mobile, COALESCE(c.balance, 0) AS credit_balance,
                  COALESCE(SUM(s.total_amount), 0) AS total_purchases,
                  MAX(s.timestamp) AS last_purchase
           FROM customers c
           LEFT JOIN sales s ON s.customer_id = c.id AND s.voided = false
           WHERE COALESCE(c.balance, 0) <> 0
           GROUP BY c.id, c.name, c.mobile, c.balance
           ORDER BY ABS(COALESCE(c.balance, 0)) DESC`
        );

        res.json({
          supplier_ap: rows || [],
          customer_ar: customerRows || [],
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/accounting/periods",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT * FROM accounting_periods ORDER BY start_date DESC, id DESC"
        );
        res.json({ periods: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/accounting/periods",
    requireAnyPerm(["manage_employees", "all_access"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { period_name, start_date, end_date } = req.body || {};
        if (!period_name || !start_date || !end_date) {
          return res.status(400).json({ error: "period_name, start_date and end_date are required" });
        }
        const { rows } = await db.query(
          "INSERT INTO accounting_periods (period_name, start_date, end_date, status) VALUES ($1, $2, $3, 'open') RETURNING id",
          [period_name, start_date, end_date]
        );
        res.json({ message: "Accounting period created", id: rows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.put(
    "/api/accounting/periods/:id",
    requireAnyPerm(["manage_employees", "all_access"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { status, notes } = req.body || {};
        if (!status) return res.status(400).json({ error: "status is required" });
        const isClosed = status === "closed";
        const { rowCount } = await db.query(
          `UPDATE accounting_periods
           SET status = $1, notes = $2, closed_by = $3, closed_at = $4
           WHERE id = $5`,
          [
            status,
            notes || null,
            isClosed ? Number(req.headers["x-employee-id"] || 0) || null : null,
            isClosed ? new Date().toISOString() : null,
            id,
          ]
        );
        res.json({ message: "Accounting period updated", changed: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/accounting/balance-sheet",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { outlet_id } = req.query || {};

        // Assets: inventory at cost
        const invParams = [];
        let invOutletSql = "";
        if (outlet_id) {
          invOutletSql = ` AND os.outlet_id = $${invParams.length + 1}`;
          invParams.push(outlet_id);
        }
        const { rows: [invRow] } = await db.query(
          `SELECT COALESCE(SUM(p.cost_price * COALESCE(os.quantity, 0)), 0) AS inventory_value
           FROM products p
           LEFT JOIN outlet_stock os ON os.product_id = p.id
           WHERE COALESCE(os.quantity, 0) > 0${invOutletSql}`,
          invParams
        );
        const inventoryValue = Number(invRow?.inventory_value || 0);

        // Assets: cash in open shifts
        const cashParams = [];
        let cashOutletSql = "";
        if (outlet_id) {
          cashOutletSql = ` AND outlet_id = $${cashParams.length + 1}`;
          cashParams.push(outlet_id);
        }
        const { rows: [cashRow] } = await db.query(
          `SELECT COALESCE(SUM(opening_float), 0) AS cash_on_hand
           FROM cash_shifts WHERE status = 'open'${cashOutletSql}`,
          cashParams
        );
        const cashOnHand = Number(cashRow?.cash_on_hand || 0);

        // Liabilities: supplier AP outstanding
        const { rows: [apRow] } = await db.query(
          `SELECT COALESCE(SUM(si.amount - COALESCE(sp.paid_amount, 0)), 0) AS supplier_ap
           FROM supplier_invoices si
           LEFT JOIN (
             SELECT supplier_invoice_id, SUM(amount) AS paid_amount
             FROM supplier_payments GROUP BY supplier_invoice_id
           ) sp ON sp.supplier_invoice_id = si.id
           WHERE si.status != 'paid'`
        );
        const supplierAp = Number(apRow?.supplier_ap || 0);

        // Liabilities: customer credit (negative balance = store owes customer)
        const { rows: [ccRow] } = await db.query(
          `SELECT COALESCE(SUM(ABS(balance)), 0) AS customer_credit
           FROM customers WHERE COALESCE(balance, 0) < 0`
        );
        const customerCredit = Number(ccRow?.customer_credit || 0);

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
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Expense Ledger ─────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/expenses",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { from, to, category_id, outlet_id } = req.query || {};
        const where = ["1=1"];
        const params = [];
        let idx = 1;
        if (from) { where.push(`e.expense_date >= $${idx++}::date`); params.push(from); }
        if (to) { where.push(`e.expense_date <= $${idx++}::date`); params.push(to); }
        if (category_id) { where.push(`e.category_id = $${idx++}`); params.push(category_id); }
        if (outlet_id) { where.push(`e.outlet_id = $${idx++}`); params.push(outlet_id); }
        const { rows } = await db.query(
          `SELECT e.*, ec.name AS category_name, o.name AS outlet_name, em.name AS employee_name
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
           LEFT JOIN outlets o ON o.id = e.outlet_id
           LEFT JOIN employees em ON em.id = e.employee_id
           WHERE ${where.join(" AND ")}
           ORDER BY e.expense_date DESC, e.id DESC`,
          params
        );
        const { rows: cats } = await db.query("SELECT * FROM expense_categories ORDER BY name ASC");
        res.json({ expenses: rows || [], categories: cats || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── AP Aging ───────────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/ap-aging",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT si.id, si.invoice_number, si.created_at AS invoice_date, si.due_date,
                  si.amount,
                  COALESCE(sp.paid_amount, 0) AS paid_amount,
                  (si.amount - COALESCE(sp.paid_amount, 0)) AS outstanding,
                  si.status,
                  s.name AS supplier_name,
                  EXTRACT(EPOCH FROM (NOW() - COALESCE(si.due_date::timestamptz, si.created_at))) / 86400.0 AS days_overdue
           FROM supplier_invoices si
           LEFT JOIN suppliers s ON s.id = si.supplier_id
           LEFT JOIN (
             SELECT supplier_invoice_id, SUM(amount) AS paid_amount
             FROM supplier_payments GROUP BY supplier_invoice_id
           ) sp ON sp.supplier_invoice_id = si.id
           WHERE si.status != 'paid'
             AND (si.amount - COALESCE(sp.paid_amount, 0)) > 0
           ORDER BY days_overdue DESC`
        );
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
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Tax Ledger ─────────────────────────────────────────────────────────────
  router.get(
    "/api/accounting/tax-ledger",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { from, to, outlet_id } = req.query || {};
        if (!from || !to) return res.status(400).json({ error: "from and to are required" });
        const tz = req.company?.timezone || "UTC";
        const taxParams = [toUtcStart(from, tz), toUtcEnd(to, tz)];
        let taxOutletSql = "";
        if (outlet_id) {
          taxOutletSql = ` AND s.outlet_id = $${taxParams.length + 1}`;
          taxParams.push(outlet_id);
        }
        const { rows } = await db.query(
          `SELECT CONCAT(si.tax_rate_at_sale::text, '%') AS tax_name,
                  si.tax_rate_at_sale AS rate,
                  COUNT(DISTINCT s.id) AS transaction_count,
                  COALESCE(SUM(si.quantity * si.price_at_sale), 0) AS taxable_amount,
                  COALESCE(SUM(si.tax_amount_at_sale), 0) AS tax_collected
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id AND s.voided = false
           WHERE s.timestamp >= $1 AND s.timestamp < $2
             AND si.tax_rate_at_sale IS NOT NULL AND si.tax_rate_at_sale > 0${taxOutletSql}
           GROUP BY si.tax_rate_at_sale
           ORDER BY tax_collected DESC`,
          taxParams
        );
        const total_tax = (rows || []).reduce((s, r) => s + Number(r.tax_collected || 0), 0);
        res.json({ rows: rows || [], total_tax });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Supplier Payment History ───────────────────────────────────────────────
  router.get(
    "/api/accounting/supplier-payments",
    requireAnyPerm(["view_reports", "manage_employees"]),
    requireFeature("accounting_core"),
    async (req, res) => {
      try {
        const { from, to } = req.query || {};
        const where = ["1=1"];
        const params = [];
        let idx = 1;
        // paid_at is TIMESTAMPTZ — tenant-tz UTC bounds, not bare ::date.
        const spTz = req.company?.timezone || "UTC";
        if (from) { where.push(`sp.paid_at >= $${idx++}`); params.push(toUtcStart(String(from), spTz)); }
        if (to) { where.push(`sp.paid_at < $${idx++}`); params.push(toUtcEnd(String(to), spTz)); }
        const { rows } = await db.query(
          `SELECT sp.id, sp.amount, sp.payment_method, sp.paid_at, sp.notes,
                  si.invoice_number, s.name AS supplier_name
           FROM supplier_payments sp
           LEFT JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
           LEFT JOIN suppliers s ON s.id = si.supplier_id
           WHERE ${where.join(" AND ")}
           ORDER BY sp.paid_at DESC, sp.id DESC`,
          params
        );
        const total = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
        res.json({ payments: rows || [], total });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Credit & Debit Notes ──────────────────────────────────────────────
  // Shared CRUD factory for both note types (identical schema)
  function mountNoteRoutes(table, prefix) {
    const authMw = [
      requireAnyPerm(["manage_employees", "all_access"]),
      requireFeature("accounting_core"),
    ];

    // List with filters
    router.get(`/api/accounting/${prefix}`, ...authMw, async (req, res) => {
      try {
        const { status, type, from, to } = req.query || {};
        const where = ["1=1"];
        const params = [];
        let idx = 1;
        if (status) { where.push(`n.status = $${idx++}`); params.push(status); }
        if (type) { where.push(`n.type = $${idx++}`); params.push(type); }
        // created_at is TIMESTAMPTZ — tenant-tz UTC bounds, not bare ::date.
        const noteTz = req.company?.timezone || "UTC";
        if (from) { where.push(`n.created_at >= $${idx++}`); params.push(toUtcStart(String(from), noteTz)); }
        if (to) { where.push(`n.created_at < $${idx++}`); params.push(toUtcEnd(String(to), noteTz)); }
        const { rows } = await db.query(
          `SELECT n.*, c.name AS customer_name, s.name AS supplier_name,
                  e.name AS created_by_name, a.name AS approved_by_name
           FROM ${table} n
           LEFT JOIN customers c ON c.id = n.customer_id
           LEFT JOIN suppliers s ON s.id = n.supplier_id
           LEFT JOIN employees e ON e.id = n.created_by
           LEFT JOIN employees a ON a.id = n.approved_by
           WHERE ${where.join(" AND ")}
           ORDER BY n.created_at DESC, n.id DESC`,
          params
        );
        res.json({ notes: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Get by ID
    router.get(`/api/accounting/${prefix}/:id`, ...authMw, async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT n.*, c.name AS customer_name, s.name AS supplier_name,
                  e.name AS created_by_name, a.name AS approved_by_name
           FROM ${table} n
           LEFT JOIN customers c ON c.id = n.customer_id
           LEFT JOIN suppliers s ON s.id = n.supplier_id
           LEFT JOIN employees e ON e.id = n.created_by
           LEFT JOIN employees a ON a.id = n.approved_by
           WHERE n.id = $1`,
          [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "Note not found" });
        res.json(rows[0]);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Create
    router.post(`/api/accounting/${prefix}`, ...authMw, async (req, res) => {
      try {
        const { type, customer_id, supplier_id, amount, reason, reference_type, reference_id, notes } = req.body || {};
        if (!type || !amount || !reason) {
          return res.status(400).json({ error: "type, amount, and reason are required" });
        }
        if (type === "sales" && !customer_id) {
          return res.status(400).json({ error: "customer_id is required for sales type" });
        }
        if (type === "purchase" && !supplier_id) {
          return res.status(400).json({ error: "supplier_id is required for purchase type" });
        }
        if (Number(amount) <= 0) {
          return res.status(400).json({ error: "amount must be positive" });
        }

        // Auto-generate note_number: CN-YYYYMMDD-NNN or DN-YYYYMMDD-NNN
        const tag = prefix === "credit-notes" ? "CN" : "DN";
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const likePattern = `${tag}-${today}-%`;
        const { rows: [countRow] } = await db.query(
          `SELECT COUNT(*) AS cnt FROM ${table} WHERE note_number LIKE $1`,
          [likePattern]
        );
        const seq = String(Number(countRow.cnt) + 1).padStart(3, "0");
        const note_number = `${tag}-${today}-${seq}`;

        const employeeId = Number(req.headers["x-employee-id"] || 0) || null;
        const { rows } = await db.query(
          `INSERT INTO ${table} (note_number, type, customer_id, supplier_id, amount, reason, reference_type, reference_id, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, note_number`,
          [note_number, type, customer_id || null, supplier_id || null, amount, reason, reference_type || null, reference_id || null, notes || null, employeeId]
        );
        res.json({ message: "Note created", id: rows[0].id, note_number: rows[0].note_number });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Update (draft only)
    router.put(`/api/accounting/${prefix}/:id`, ...authMw, async (req, res) => {
      try {
        const { id } = req.params;
        const { type, customer_id, supplier_id, amount, reason, reference_type, reference_id, notes } = req.body || {};

        const { rows: existing } = await db.query(`SELECT status FROM ${table} WHERE id = $1`, [id]);
        if (!existing.length) return res.status(404).json({ error: "Note not found" });
        if (existing[0].status !== "draft") {
          return res.status(400).json({ error: "Only draft notes can be edited" });
        }

        const { rowCount } = await db.query(
          `UPDATE ${table}
           SET type = COALESCE($1, type), customer_id = $2, supplier_id = $3,
               amount = COALESCE($4, amount), reason = COALESCE($5, reason),
               reference_type = $6, reference_id = $7, notes = $8
           WHERE id = $9 AND status = 'draft'`,
          [type, customer_id || null, supplier_id || null, amount, reason, reference_type || null, reference_id || null, notes || null, id]
        );
        res.json({ message: "Note updated", changed: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Approve — adjusts customer/supplier balance inside transaction
    router.put(`/api/accounting/${prefix}/:id/approve`, ...authMw, async (req, res) => {
      try {
        const { id } = req.params;
        const employeeId = Number(req.headers["x-employee-id"] || 0) || null;

        await db.transaction(async (client) => {
          const { rows } = await client.query(
            `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]
          );
          if (!rows.length) throw Object.assign(new Error("Note not found"), { statusCode: 404 });
          const note = rows[0];
          if (note.status !== "draft") {
            throw Object.assign(new Error("Only draft notes can be approved"), { statusCode: 400 });
          }

          await client.query(
            `UPDATE ${table} SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2`,
            [employeeId, id]
          );

          const amt = Number(note.amount);
          const isCreditNote = prefix === "credit-notes";

          // Apply balance adjustment
          if (note.type === "sales" && note.customer_id) {
            // Credit note (sales): decrease customer balance (give credit)
            // Debit note (sales): increase customer balance (customer owes more)
            const delta = isCreditNote ? -amt : amt;
            await client.query(
              `UPDATE customers SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
              [delta, note.customer_id]
            );
          } else if (note.type === "purchase" && note.supplier_id) {
            // Credit note (purchase): decrease supplier running_balance (supplier gives discount)
            // Debit note (purchase): increase supplier running_balance (you owe more)
            const delta = isCreditNote ? -amt : amt;
            await client.query(
              `UPDATE suppliers SET running_balance = COALESCE(running_balance, 0) + $1 WHERE id = $2`,
              [delta, note.supplier_id]
            );
          }

          // Post journal entry if COA accounts exist (best-effort — note approves even without COA)
          // Sales type:   CN → Dr Sales Revenue (4000), Cr AR (1100)
          //               DN → Dr AR (1100),            Cr Sales Revenue (4000)
          // Purchase type: CN → Dr AP (2000), Cr COGS (5000)
          //                DN → Dr COGS (5000), Cr AP (2000)
          const { rows: acctRows } = await client.query(
            `SELECT id, code FROM chart_of_accounts WHERE code = ANY($1) AND is_active = true`,
            [["1100", "2000", "4000", "5000"]]
          );
          if (acctRows.length >= 2) {
            const byCode = Object.fromEntries(acctRows.map((r) => [r.code, r.id]));
            let debitAccountId, creditAccountId;
            if (note.type === "sales") {
              debitAccountId  = isCreditNote ? byCode["4000"] : byCode["1100"];
              creditAccountId = isCreditNote ? byCode["1100"] : byCode["4000"];
            } else {
              debitAccountId  = isCreditNote ? byCode["2000"] : byCode["5000"];
              creditAccountId = isCreditNote ? byCode["5000"] : byCode["2000"];
            }
            if (debitAccountId && creditAccountId) {
              const tag = prefix === "credit-notes" ? "CN" : "DN";
              const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
              const likePattern = `JE-${today}-%`;
              const { rows: [jeCount] } = await client.query(
                `SELECT COUNT(*) AS cnt FROM journal_entries WHERE entry_number LIKE $1`,
                [likePattern]
              );
              const seq = String(Number(jeCount.cnt) + 1).padStart(3, "0");
              const entryNumber = `JE-${today}-${seq}`;
              // entry_date is the tenant-local posting day (CURRENT_DATE is
              // the DB session's day — UTC on prod — a day off near midnight).
              const { tenantToday } = require("../../utils/tz");
              const { rows: [je] } = await client.query(
                `INSERT INTO journal_entries (entry_number, entry_date, description, status, created_by, posted_by, posted_at)
                 VALUES ($1, $4::date, $2, 'posted', $3, $3, NOW())
                 RETURNING id`,
                [entryNumber, `${tag}-${note.note_number}: ${note.reason}`, employeeId, tenantToday(req.company?.timezone)]
              );
              await client.query(
                `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
                 VALUES ($1, $2, $3, 0, $4), ($1, $5, 0, $6, $4)`,
                [je.id, debitAccountId, amt, note.note_number, creditAccountId, amt]
              );
            }
          }
        });

        res.json({ message: "Note approved and balance adjusted" });
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    });

    // Cancel (draft or approved)
    router.put(`/api/accounting/${prefix}/:id/cancel`, ...authMw, async (req, res) => {
      try {
        const { id } = req.params;

        await db.transaction(async (client) => {
          const { rows } = await client.query(
            `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]
          );
          if (!rows.length) throw Object.assign(new Error("Note not found"), { statusCode: 404 });
          const note = rows[0];
          if (note.status === "cancelled") {
            throw Object.assign(new Error("Note is already cancelled"), { statusCode: 400 });
          }

          const wasApproved = note.status === "approved";

          await client.query(
            `UPDATE ${table} SET status = 'cancelled' WHERE id = $1`, [id]
          );

          // Reverse balance adjustment if it was approved
          if (wasApproved) {
            const amt = Number(note.amount);
            const isCreditNote = prefix === "credit-notes";

            if (note.type === "sales" && note.customer_id) {
              const delta = isCreditNote ? amt : -amt; // reverse of approve
              await client.query(
                `UPDATE customers SET balance = COALESCE(balance, 0) + $1 WHERE id = $2`,
                [delta, note.customer_id]
              );
            } else if (note.type === "purchase" && note.supplier_id) {
              const delta = isCreditNote ? amt : -amt; // reverse of approve
              await client.query(
                `UPDATE suppliers SET running_balance = COALESCE(running_balance, 0) + $1 WHERE id = $2`,
                [delta, note.supplier_id]
              );
            }
          }
        });

        res.json({ message: "Note cancelled" });
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    });
  }

  mountNoteRoutes("credit_notes", "credit-notes");
  mountNoteRoutes("debit_notes", "debit-notes");

  // ── Chart of Accounts ─────────────────────────────────────────────────

  const coaAuth = [
    requireAnyPerm(["all_access"]),
    requireFeature("accounting_core"),
  ];

  // Helper: build nested tree from flat rows
  function buildCoaTree(rows) {
    const map = new Map();
    const roots = [];
    for (const r of rows) {
      map.set(r.id, { ...r, children: [] });
    }
    for (const node of map.values()) {
      if (node.parent_id && map.has(node.parent_id)) {
        map.get(node.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    }
    // Sort by code within each level
    const sortByCode = (arr) => {
      arr.sort((a, b) => String(a.code).localeCompare(String(b.code)));
      arr.forEach((n) => sortByCode(n.children));
    };
    sortByCode(roots);
    return roots;
  }

  // List all accounts as tree
  router.get("/api/accounting/coa", ...coaAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, code, name, type, sub_type, parent_id, is_system, is_active, description, normal_balance, created_at
         FROM chart_of_accounts
         ORDER BY code ASC`
      );
      res.json({ accounts: rows || [], tree: buildCoaTree(rows || []) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single account with computed balance
  router.get("/api/accounting/coa/:id", ...coaAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, code, name, type, sub_type, parent_id, is_system, is_active, description, normal_balance, created_at
         FROM chart_of_accounts WHERE id = $1`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Account not found" });
      const account = rows[0];

      // Compute balance from journal entry lines (posted entries only)
      const { rows: [balRow] } = await db.query(
        `SELECT COALESCE(SUM(jel.debit), 0) AS total_debit,
                COALESCE(SUM(jel.credit), 0) AS total_credit
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = $1 AND je.status = 'posted'`,
        [req.params.id]
      );
      const totalDebit = Number(balRow?.total_debit || 0);
      const totalCredit = Number(balRow?.total_credit || 0);
      // Normal balance determines sign: debit-normal accounts = debits - credits
      account.balance = account.normal_balance === "debit"
        ? totalDebit - totalCredit
        : totalCredit - totalDebit;

      res.json(account);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create custom account
  router.post("/api/accounting/coa", ...coaAuth, async (req, res) => {
    try {
      const { code, name, type, sub_type, parent_id, description } = req.body || {};
      if (!code || !name || !type) {
        return res.status(400).json({ error: "code, name, and type are required" });
      }
      const validTypes = ["asset", "liability", "equity", "revenue", "expense"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
      }

      // Check code uniqueness
      const { rows: existing } = await db.query(
        "SELECT id FROM chart_of_accounts WHERE code = $1", [code]
      );
      if (existing.length) {
        return res.status(409).json({ error: "Account code already exists" });
      }

      // Validate parent exists if provided
      if (parent_id) {
        const { rows: parentRows } = await db.query(
          "SELECT id FROM chart_of_accounts WHERE id = $1", [parent_id]
        );
        if (!parentRows.length) {
          return res.status(400).json({ error: "Parent account not found" });
        }
      }

      const normalBalance = ["asset", "expense"].includes(type) ? "debit" : "credit";
      const { rows } = await db.query(
        `INSERT INTO chart_of_accounts (code, name, type, sub_type, parent_id, is_system, is_active, description, normal_balance)
         VALUES ($1, $2, $3, $4, $5, false, true, $6, $7)
         RETURNING id, code, name`,
        [code, name, type, sub_type || null, parent_id || null, description || null, normalBalance]
      );
      res.json({ message: "Account created", id: rows[0].id, code: rows[0].code, name: rows[0].name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Seed default Pakistan-standard accounts (idempotent)
  router.post("/api/accounting/coa/seed", ...coaAuth, async (req, res) => {
    try {
      const { rows: [countRow] } = await db.query("SELECT COUNT(*) AS cnt FROM chart_of_accounts");
      if (Number(countRow.cnt) > 0) {
        return res.json({ message: "Accounts already exist, seed skipped", seeded: 0 });
      }

      const defaults = [
        ["1000", "Cash on Hand", "asset", "current_asset", "debit"],
        ["1010", "Bank Account", "asset", "current_asset", "debit"],
        ["1100", "Accounts Receivable", "asset", "current_asset", "debit"],
        ["1200", "Inventory", "asset", "current_asset", "debit"],
        ["1300", "Fixed Assets", "asset", "fixed_asset", "debit"],
        ["2000", "Accounts Payable", "liability", "current_liability", "credit"],
        ["2100", "Sales Tax Payable", "liability", "current_liability", "credit"],
        ["2200", "Other Payables", "liability", "current_liability", "credit"],
        ["3000", "Owner's Equity", "equity", "equity", "credit"],
        ["3100", "Retained Earnings", "equity", "equity", "credit"],
        ["4000", "Sales Revenue", "revenue", "operating_revenue", "credit"],
        ["4100", "Service Revenue", "revenue", "operating_revenue", "credit"],
        ["4200", "Other Revenue", "revenue", "other_revenue", "credit"],
        ["5000", "Cost of Goods Sold", "expense", "cost_of_sales", "debit"],
        ["5100", "Salaries & Wages", "expense", "operating_expense", "debit"],
        ["5200", "Rent", "expense", "operating_expense", "debit"],
        ["5300", "Utilities", "expense", "operating_expense", "debit"],
        ["5400", "Marketing", "expense", "operating_expense", "debit"],
        ["5500", "Office Supplies", "expense", "operating_expense", "debit"],
        ["5600", "Depreciation", "expense", "operating_expense", "debit"],
        ["5900", "Other Expenses", "expense", "operating_expense", "debit"],
      ];

      for (const [code, name, type, sub_type, normal_balance] of defaults) {
        await db.query(
          `INSERT INTO chart_of_accounts (code, name, type, sub_type, is_system, is_active, normal_balance)
           VALUES ($1, $2, $3, $4, true, true, $5)
           ON CONFLICT (code) DO NOTHING`,
          [code, name, type, sub_type, normal_balance]
        );
      }
      res.json({ message: "Default accounts seeded", seeded: defaults.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update account (system accounts: only name/description editable)
  router.put("/api/accounting/coa/:id", ...coaAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { code, name, type, sub_type, parent_id, description, is_active } = req.body || {};

      const { rows: existing } = await db.query(
        "SELECT * FROM chart_of_accounts WHERE id = $1", [id]
      );
      if (!existing.length) return res.status(404).json({ error: "Account not found" });

      const account = existing[0];

      if (account.is_system) {
        // System accounts: can only update name and description
        const { rowCount } = await db.query(
          `UPDATE chart_of_accounts SET name = COALESCE($1, name), description = $2 WHERE id = $3`,
          [name, description !== undefined ? description : account.description, id]
        );
        return res.json({ message: "System account updated (name/description only)", changed: rowCount || 0 });
      }

      // Check code uniqueness if changing
      if (code && code !== account.code) {
        const { rows: dup } = await db.query(
          "SELECT id FROM chart_of_accounts WHERE code = $1 AND id != $2", [code, id]
        );
        if (dup.length) return res.status(409).json({ error: "Account code already exists" });
      }

      // Validate parent if changing
      if (parent_id !== undefined && parent_id !== null) {
        if (Number(parent_id) === Number(id)) {
          return res.status(400).json({ error: "Account cannot be its own parent" });
        }
        const { rows: parentRows } = await db.query(
          "SELECT id FROM chart_of_accounts WHERE id = $1", [parent_id]
        );
        if (!parentRows.length) return res.status(400).json({ error: "Parent account not found" });
      }

      const newType = type || account.type;
      const normalBalance = ["asset", "expense"].includes(newType) ? "debit" : "credit";

      const { rowCount } = await db.query(
        `UPDATE chart_of_accounts
         SET code = COALESCE($1, code), name = COALESCE($2, name), type = $3,
             sub_type = $4, parent_id = $5, description = $6, normal_balance = $7,
             is_active = COALESCE($8, is_active)
         WHERE id = $9`,
        [
          code || account.code, name || account.name, newType,
          sub_type !== undefined ? sub_type : account.sub_type,
          parent_id !== undefined ? (parent_id || null) : account.parent_id,
          description !== undefined ? description : account.description,
          normalBalance,
          is_active !== undefined ? is_active : null,
          id,
        ]
      );
      res.json({ message: "Account updated", changed: rowCount || 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Soft-delete (set is_active=false). Block if system or has journal entries.
  router.delete("/api/accounting/coa/:id", ...coaAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: existing } = await db.query(
        "SELECT is_system FROM chart_of_accounts WHERE id = $1", [id]
      );
      if (!existing.length) return res.status(404).json({ error: "Account not found" });
      if (existing[0].is_system) {
        return res.status(403).json({ error: "Cannot delete system accounts" });
      }

      // Block if has journal entries
      const { rows: [jeCount] } = await db.query(
        "SELECT COUNT(*) AS cnt FROM journal_entry_lines WHERE account_id = $1", [id]
      );
      if (Number(jeCount.cnt) > 0) {
        return res.status(409).json({ error: "Cannot delete account with journal entries" });
      }

      await db.query(
        "UPDATE chart_of_accounts SET is_active = false WHERE id = $1", [id]
      );
      res.json({ message: "Account deactivated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Post-Dated Cheques ─────────────────────────────────────────────────

  const chequeAuth = [
    requireAnyPerm(["manage_employees", "all_access"]),
    requireFeature("accounting_core"),
  ];

  // List with filters
  router.get("/api/accounting/cheques", ...chequeAuth, async (req, res) => {
    try {
      const { status, type, maturity_from, maturity_to } = req.query || {};
      const where = ["1=1"];
      const params = [];
      let idx = 1;
      if (status) { where.push(`c.status = $${idx++}`); params.push(status); }
      if (type) { where.push(`c.type = $${idx++}`); params.push(type); }
      if (maturity_from) { where.push(`c.maturity_date >= $${idx++}::date`); params.push(maturity_from); }
      if (maturity_to) { where.push(`c.maturity_date <= $${idx++}::date`); params.push(maturity_to); }
      const { rows } = await db.query(
        `SELECT c.*,
                CASE WHEN c.party_type = 'customer' THEN cu.name ELSE su.name END AS party_name
         FROM postdated_cheques c
         LEFT JOIN customers cu ON c.party_type = 'customer' AND cu.id = c.party_id
         LEFT JOIN suppliers su ON c.party_type = 'supplier' AND su.id = c.party_id
         WHERE ${where.join(" AND ")}
         ORDER BY c.maturity_date ASC, c.id DESC`,
        params
      );
      res.json({ cheques: rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upcoming — cheques maturing in next 7 days
  router.get("/api/accounting/cheques/upcoming", ...chequeAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT c.*,
                CASE WHEN c.party_type = 'customer' THEN cu.name ELSE su.name END AS party_name
         FROM postdated_cheques c
         LEFT JOIN customers cu ON c.party_type = 'customer' AND cu.id = c.party_id
         LEFT JOIN suppliers su ON c.party_type = 'supplier' AND su.id = c.party_id
         WHERE c.status = 'pending'
           AND c.maturity_date >= $1::date
           AND c.maturity_date <= $1::date + INTERVAL '7 days'
         ORDER BY c.maturity_date ASC`,
        // Maturity window anchored to the tenant-local day, not the DB
        // session's CURRENT_DATE (UTC on prod).
        [require("../../utils/tz").tenantToday(req.company?.timezone)]
      );
      res.json({ cheques: rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get by ID
  router.get("/api/accounting/cheques/:id", ...chequeAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT c.*,
                CASE WHEN c.party_type = 'customer' THEN cu.name ELSE su.name END AS party_name
         FROM postdated_cheques c
         LEFT JOIN customers cu ON c.party_type = 'customer' AND cu.id = c.party_id
         LEFT JOIN suppliers su ON c.party_type = 'supplier' AND su.id = c.party_id
         WHERE c.id = $1`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Cheque not found" });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create
  router.post("/api/accounting/cheques", ...chequeAuth, async (req, res) => {
    try {
      const { cheque_number, type, party_type, party_id, bank_name, amount, issue_date, maturity_date, notes } = req.body || {};
      if (!cheque_number || !type || !party_type || !party_id || !amount || !issue_date || !maturity_date) {
        return res.status(400).json({ error: "cheque_number, type, party_type, party_id, amount, issue_date, and maturity_date are required" });
      }
      if (Number(amount) <= 0) {
        return res.status(400).json({ error: "amount must be positive" });
      }
      const employeeId = Number(req.headers["x-employee-id"] || 0) || null;
      const { rows } = await db.query(
        `INSERT INTO postdated_cheques (cheque_number, type, party_type, party_id, bank_name, amount, issue_date, maturity_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [cheque_number, type, party_type, party_id, bank_name || null, amount, issue_date, maturity_date, notes || null, employeeId]
      );
      res.json({ message: "Cheque created", id: rows[0].id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update (pending only)
  router.put("/api/accounting/cheques/:id", ...chequeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { cheque_number, type, party_type, party_id, bank_name, amount, issue_date, maturity_date, notes } = req.body || {};

      const { rows: existing } = await db.query("SELECT status FROM postdated_cheques WHERE id = $1", [id]);
      if (!existing.length) return res.status(404).json({ error: "Cheque not found" });
      if (existing[0].status !== "pending") {
        return res.status(400).json({ error: "Only pending cheques can be edited" });
      }

      const { rowCount } = await db.query(
        `UPDATE postdated_cheques
         SET cheque_number = COALESCE($1, cheque_number), type = COALESCE($2, type),
             party_type = COALESCE($3, party_type), party_id = COALESCE($4, party_id),
             bank_name = $5, amount = COALESCE($6, amount),
             issue_date = COALESCE($7, issue_date), maturity_date = COALESCE($8, maturity_date),
             notes = $9
         WHERE id = $10 AND status = 'pending'`,
        [cheque_number, type, party_type, party_id, bank_name !== undefined ? bank_name : null, amount, issue_date, maturity_date, notes !== undefined ? notes : null, id]
      );
      res.json({ message: "Cheque updated", changed: rowCount || 0 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete (pending only)
  router.delete("/api/accounting/cheques/:id", ...chequeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: existing } = await db.query("SELECT status FROM postdated_cheques WHERE id = $1", [id]);
      if (!existing.length) return res.status(404).json({ error: "Cheque not found" });
      if (existing[0].status !== "pending") {
        return res.status(400).json({ error: "Only pending cheques can be deleted" });
      }
      await db.query("DELETE FROM postdated_cheques WHERE id = $1 AND status = 'pending'", [id]);
      res.json({ message: "Cheque deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Status Transitions ──────────────────────────────────────────────

  // Deposit (pending → deposited)
  router.put("/api/accounting/cheques/:id/deposit", ...chequeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: existing } = await db.query("SELECT status FROM postdated_cheques WHERE id = $1", [id]);
      if (!existing.length) return res.status(404).json({ error: "Cheque not found" });
      if (existing[0].status !== "pending") {
        return res.status(400).json({ error: "Only pending cheques can be deposited" });
      }
      await db.query(
        "UPDATE postdated_cheques SET status = 'deposited', deposited_at = NOW() WHERE id = $1",
        [id]
      );
      res.json({ message: "Cheque deposited" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear (deposited → cleared) — adjusts customer/supplier balance
  router.put("/api/accounting/cheques/:id/clear", ...chequeAuth, async (req, res) => {
    try {
      const { id } = req.params;

      await db.transaction(async (client) => {
        const { rows } = await client.query(
          "SELECT * FROM postdated_cheques WHERE id = $1 FOR UPDATE", [id]
        );
        if (!rows.length) throw Object.assign(new Error("Cheque not found"), { statusCode: 404 });
        const cheque = rows[0];
        if (cheque.status !== "deposited") {
          throw Object.assign(new Error("Only deposited cheques can be cleared"), { statusCode: 400 });
        }

        await client.query(
          "UPDATE postdated_cheques SET status = 'cleared', cleared_at = NOW() WHERE id = $1",
          [id]
        );

        const amt = Number(cheque.amount);

        if (cheque.type === "receivable" && cheque.party_type === "customer") {
          // Customer paid us — decrease their balance
          await client.query(
            "UPDATE customers SET balance = COALESCE(balance, 0) - $1 WHERE id = $2",
            [amt, cheque.party_id]
          );
        } else if (cheque.type === "payable" && cheque.party_type === "supplier") {
          // We paid supplier — record payment
          await client.query(
            `INSERT INTO supplier_payments (supplier_invoice_id, amount, payment_method, notes, paid_at)
             VALUES (NULL, $1, 'cheque', $2, NOW())`,
            [amt, `PDC cleared: ${cheque.cheque_number}`]
          );
        }

        // Post journal entry if COA accounts exist (best-effort — cheque clears even without COA)
        // Receivable: Dr Cash (1000), Cr AR (1100)
        // Payable:    Dr AP (2000),  Cr Cash (1000)
        const neededCodes = cheque.type === "receivable" ? ["1000", "1100"] : ["2000", "1000"];
        const { rows: acctRows } = await client.query(
          `SELECT id, code FROM chart_of_accounts WHERE code = ANY($1) AND is_active = true`,
          [neededCodes]
        );
        if (acctRows.length >= 2) {
          const byCode = Object.fromEntries(acctRows.map((r) => [r.code, r.id]));
          const debitAccountId  = cheque.type === "receivable" ? byCode["1000"] : byCode["2000"];
          const creditAccountId = cheque.type === "receivable" ? byCode["1100"] : byCode["1000"];
          if (debitAccountId && creditAccountId) {
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
            const likePattern = `JE-${today}-%`;
            const { rows: [jeCount] } = await client.query(
              `SELECT COUNT(*) AS cnt FROM journal_entries WHERE entry_number LIKE $1`,
              [likePattern]
            );
            const seq = String(Number(jeCount.cnt) + 1).padStart(3, "0");
            const entryNumber = `JE-${today}-${seq}`;
            // Tenant-local posting day (see credit/debit-note posting above).
            const { tenantToday } = require("../../utils/tz");
            const { rows: [je] } = await client.query(
              `INSERT INTO journal_entries (entry_number, entry_date, description, status, created_by, posted_by, posted_at)
               VALUES ($1, $4::date, $2, 'posted', $3, $3, NOW())
               RETURNING id`,
              [entryNumber, `PDC cleared: ${cheque.cheque_number}`, cheque.created_by, tenantToday(req.company?.timezone)]
            );
            await client.query(
              `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
               VALUES ($1, $2, $3, 0, $4), ($1, $5, 0, $6, $4)`,
              [je.id, debitAccountId, amt, cheque.cheque_number, creditAccountId, amt]
            );
          }
        }
      });

      res.json({ message: "Cheque cleared and balance adjusted" });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Bounce (deposited → bounced)
  router.put("/api/accounting/cheques/:id/bounce", ...chequeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: existing } = await db.query("SELECT status FROM postdated_cheques WHERE id = $1", [id]);
      if (!existing.length) return res.status(404).json({ error: "Cheque not found" });
      if (existing[0].status !== "deposited") {
        return res.status(400).json({ error: "Only deposited cheques can be bounced" });
      }
      await db.query(
        "UPDATE postdated_cheques SET status = 'bounced', bounced_at = NOW() WHERE id = $1",
        [id]
      );
      res.json({ message: "Cheque bounced" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cancel (pending → cancelled)
  router.put("/api/accounting/cheques/:id/cancel", ...chequeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: existing } = await db.query("SELECT status FROM postdated_cheques WHERE id = $1", [id]);
      if (!existing.length) return res.status(404).json({ error: "Cheque not found" });
      if (existing[0].status !== "pending") {
        return res.status(400).json({ error: "Only pending cheques can be cancelled" });
      }
      await db.query(
        "UPDATE postdated_cheques SET status = 'cancelled' WHERE id = $1",
        [id]
      );
      res.json({ message: "Cheque cancelled" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Journal Entries ────────────────────────────────────────────────

  const jeAuth = [
    requireAnyPerm(["all_access"]),
    requireFeature("accounting_core"),
  ];

  // List with date range, status filter, pagination
  router.get("/api/accounting/journal-entries", ...jeAuth, async (req, res) => {
    try {
      const { from, to, status, page = 1, per_page = 50 } = req.query || {};
      const where = ["1=1"];
      const params = [];
      let idx = 1;
      if (from) { where.push(`je.entry_date >= $${idx++}::date`); params.push(from); }
      if (to) { where.push(`je.entry_date <= $${idx++}::date`); params.push(to); }
      if (status) { where.push(`je.status = $${idx++}`); params.push(status); }

      const offset = (Math.max(1, Number(page)) - 1) * Number(per_page);
      const { rows: countRows } = await db.query(
        `SELECT COUNT(*) AS total FROM journal_entries je WHERE ${where.join(" AND ")}`,
        params
      );
      const total = Number(countRows[0]?.total || 0);

      params.push(Number(per_page));
      params.push(offset);
      const { rows } = await db.query(
        `SELECT je.*,
                e.name AS created_by_name,
                pb.name AS posted_by_name,
                vb.name AS voided_by_name,
                COALESCE(lines.total_debit, 0) AS total_debit,
                COALESCE(lines.total_credit, 0) AS total_credit,
                COALESCE(lines.line_count, 0) AS line_count
         FROM journal_entries je
         LEFT JOIN employees e ON e.id = je.created_by
         LEFT JOIN employees pb ON pb.id = je.posted_by
         LEFT JOIN employees vb ON vb.id = je.voided_by
         LEFT JOIN (
           SELECT journal_entry_id,
                  SUM(debit) AS total_debit,
                  SUM(credit) AS total_credit,
                  COUNT(*) AS line_count
           FROM journal_entry_lines GROUP BY journal_entry_id
         ) lines ON lines.journal_entry_id = je.id
         WHERE ${where.join(" AND ")}
         ORDER BY je.entry_date DESC, je.id DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        params
      );
      res.json({ entries: rows || [], total, page: Number(page), per_page: Number(per_page) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single entry with lines
  router.get("/api/accounting/journal-entries/:id", ...jeAuth, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT je.*,
                e.name AS created_by_name,
                pb.name AS posted_by_name,
                vb.name AS voided_by_name
         FROM journal_entries je
         LEFT JOIN employees e ON e.id = je.created_by
         LEFT JOIN employees pb ON pb.id = je.posted_by
         LEFT JOIN employees vb ON vb.id = je.voided_by
         WHERE je.id = $1`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Journal entry not found" });
      const entry = rows[0];

      const { rows: lines } = await db.query(
        `SELECT jel.*, coa.code AS account_code, coa.name AS account_name, coa.type AS account_type
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
         WHERE jel.journal_entry_id = $1
         ORDER BY jel.id ASC`,
        [req.params.id]
      );
      entry.lines = lines || [];
      res.json(entry);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create journal entry with lines
  router.post("/api/accounting/journal-entries", ...jeAuth, async (req, res) => {
    try {
      const { entry_date, description, lines } = req.body || {};
      if (!entry_date || !description) {
        return res.status(400).json({ error: "entry_date and description are required" });
      }
      if (!Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ error: "At least 2 lines are required" });
      }

      // Validate balance
      let totalDebit = 0, totalCredit = 0;
      for (const line of lines) {
        totalDebit += Number(line.debit || 0);
        totalCredit += Number(line.credit || 0);
      }
      if (Math.abs(totalDebit - totalCredit) > 0.005) {
        return res.status(400).json({ error: "Entry is unbalanced: total debits must equal total credits" });
      }

      // Validate all account_ids exist and are active
      const accountIds = [...new Set(lines.map((l) => Number(l.account_id)))];
      const { rows: accounts } = await db.query(
        `SELECT id, is_active FROM chart_of_accounts WHERE id = ANY($1::int[])`,
        [accountIds]
      );
      const activeSet = new Set(accounts.filter((a) => a.is_active).map((a) => a.id));
      for (const aid of accountIds) {
        if (!activeSet.has(aid)) {
          return res.status(400).json({ error: `Account ID ${aid} not found or inactive` });
        }
      }

      // Block back-dating into a closed accounting period
      const closedPeriod = await findClosedPeriodFor(entry_date);
      if (closedPeriod) {
        return res.status(409).json({
          error: `Cannot create entry: accounting period "${closedPeriod.period_name}" is closed`,
          code: "PERIOD_CLOSED",
        });
      }

      // Generate entry_number: JE-YYYYMMDD-NNN
      const dateStr = entry_date.replace(/-/g, "");
      const { rows: [seqRow] } = await db.query(
        `SELECT COUNT(*) AS cnt FROM journal_entries WHERE entry_number LIKE $1`,
        [`JE-${dateStr}-%`]
      );
      const seq = String(Number(seqRow?.cnt || 0) + 1).padStart(3, "0");
      const entry_number = `JE-${dateStr}-${seq}`;

      const employeeId = Number(req.headers["x-employee-id"] || 0) || null;

      const result = await db.transaction(async (client) => {
        const { rows: [entry] } = await client.query(
          `INSERT INTO journal_entries (entry_number, entry_date, description, status, created_by)
           VALUES ($1, $2, $3, 'draft', $4) RETURNING id`,
          [entry_number, entry_date, description, employeeId]
        );
        for (const line of lines) {
          await client.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit)
             VALUES ($1, $2, $3, $4, $5)`,
            [entry.id, line.account_id, line.description || null, Number(line.debit || 0), Number(line.credit || 0)]
          );
        }
        return entry;
      });

      res.json({ message: "Journal entry created", id: result.id, entry_number });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update draft journal entry
  router.put("/api/accounting/journal-entries/:id", ...jeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [existing] } = await db.query(
        "SELECT id, status FROM journal_entries WHERE id = $1", [id]
      );
      if (!existing) return res.status(404).json({ error: "Journal entry not found" });
      if (existing.status !== "draft") {
        return res.status(400).json({ error: "Only draft entries can be edited" });
      }

      const { entry_date, description, lines } = req.body || {};
      if (!entry_date || !description) {
        return res.status(400).json({ error: "entry_date and description are required" });
      }
      if (!Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ error: "At least 2 lines are required" });
      }

      let totalDebit = 0, totalCredit = 0;
      for (const line of lines) {
        totalDebit += Number(line.debit || 0);
        totalCredit += Number(line.credit || 0);
      }
      if (Math.abs(totalDebit - totalCredit) > 0.005) {
        return res.status(400).json({ error: "Entry is unbalanced: total debits must equal total credits" });
      }

      const accountIds = [...new Set(lines.map((l) => Number(l.account_id)))];
      const { rows: accounts } = await db.query(
        `SELECT id, is_active FROM chart_of_accounts WHERE id = ANY($1::int[])`,
        [accountIds]
      );
      const activeSet = new Set(accounts.filter((a) => a.is_active).map((a) => a.id));
      for (const aid of accountIds) {
        if (!activeSet.has(aid)) {
          return res.status(400).json({ error: `Account ID ${aid} not found or inactive` });
        }
      }

      // Block re-dating a draft into a closed accounting period
      const closedPeriod = await findClosedPeriodFor(entry_date);
      if (closedPeriod) {
        return res.status(409).json({
          error: `Cannot save entry: accounting period "${closedPeriod.period_name}" is closed`,
          code: "PERIOD_CLOSED",
        });
      }

      await db.transaction(async (client) => {
        await client.query(
          `UPDATE journal_entries SET entry_date = $1, description = $2 WHERE id = $3`,
          [entry_date, description, id]
        );
        await client.query("DELETE FROM journal_entry_lines WHERE journal_entry_id = $1", [id]);
        for (const line of lines) {
          await client.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, line.account_id, line.description || null, Number(line.debit || 0), Number(line.credit || 0)]
          );
        }
      });

      res.json({ message: "Journal entry updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Post a draft entry
  router.put("/api/accounting/journal-entries/:id/post", ...jeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [entry] } = await db.query(
        "SELECT id, status, entry_date FROM journal_entries WHERE id = $1", [id]
      );
      if (!entry) return res.status(404).json({ error: "Journal entry not found" });
      if (entry.status === "posted") return res.status(400).json({ error: "Entry is already posted" });
      if (entry.status === "voided") return res.status(400).json({ error: "Cannot post a voided entry" });

      // Block posting into a closed accounting period (draft existed before close)
      // pg returns DATE columns as local-midnight JS Dates — toISOString()
      // would give the PREVIOUS day east of UTC; pgDateToStr round-trips it.
      const { pgDateToStr } = require("../../utils/tz");
      const entryDateStr = pgDateToStr(entry.entry_date);
      const closedPeriod = await findClosedPeriodFor(entryDateStr);
      if (closedPeriod) {
        return res.status(409).json({
          error: `Cannot post entry: accounting period "${closedPeriod.period_name}" is closed`,
          code: "PERIOD_CLOSED",
        });
      }

      const employeeId = Number(req.headers["x-employee-id"] || 0) || null;
      await db.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $1, posted_at = NOW() WHERE id = $2`,
        [employeeId, id]
      );
      res.json({ message: "Journal entry posted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Void a posted entry
  router.put("/api/accounting/journal-entries/:id/void", ...jeAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [entry] } = await db.query(
        "SELECT id, status FROM journal_entries WHERE id = $1", [id]
      );
      if (!entry) return res.status(404).json({ error: "Journal entry not found" });
      if (entry.status === "voided") return res.status(400).json({ error: "Entry is already voided" });
      if (entry.status === "draft") return res.status(400).json({ error: "Cannot void a draft entry — delete it instead" });

      const employeeId = Number(req.headers["x-employee-id"] || 0) || null;
      await db.query(
        `UPDATE journal_entries SET status = 'voided', voided_by = $1, voided_at = NOW() WHERE id = $2`,
        [employeeId, id]
      );
      res.json({ message: "Journal entry voided" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Trial Balance ──────────────────────────────────────────────────
  router.get("/api/accounting/trial-balance", ...jeAuth, async (req, res) => {
    try {
      const { from, to } = req.query || {};
      const dateWhere = [];
      const params = [];
      let idx = 1;
      if (from) { dateWhere.push(`je.entry_date >= $${idx++}::date`); params.push(from); }
      if (to) { dateWhere.push(`je.entry_date <= $${idx++}::date`); params.push(to); }
      const dateClause = dateWhere.length
        ? `AND ${dateWhere.join(" AND ")}`
        : "";

      const { rows } = await db.query(
        `SELECT coa.id, coa.code, coa.name, coa.type, coa.normal_balance,
                COALESCE(SUM(jel.debit), 0) AS total_debit,
                COALESCE(SUM(jel.credit), 0) AS total_credit
         FROM chart_of_accounts coa
         LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted' ${dateClause}
         WHERE coa.is_active = true
         GROUP BY coa.id, coa.code, coa.name, coa.type, coa.normal_balance
         HAVING COALESCE(SUM(jel.debit), 0) > 0 OR COALESCE(SUM(jel.credit), 0) > 0
         ORDER BY coa.code ASC`,
        params
      );

      const accounts = (rows || []).map((r) => {
        const td = Number(r.total_debit || 0);
        const tc = Number(r.total_credit || 0);
        return {
          ...r,
          total_debit: td,
          total_credit: tc,
          balance: r.normal_balance === "debit" ? td - tc : tc - td,
        };
      });
      const grandDebit = accounts.reduce((s, a) => s + a.total_debit, 0);
      const grandCredit = accounts.reduce((s, a) => s + a.total_credit, 0);
      res.json({ accounts, grand_total_debit: grandDebit, grand_total_credit: grandCredit });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Next code suggestion for a given type
  router.get("/api/accounting/coa/next-code/:type", ...coaAuth, async (req, res) => {
    try {
      const { type } = req.params;
      const prefixMap = { asset: "1", liability: "2", equity: "3", revenue: "4", expense: "5" };
      const prefix = prefixMap[type];
      if (!prefix) return res.status(400).json({ error: "Invalid account type" });

      const { rows: [maxRow] } = await db.query(
        `SELECT MAX(code) AS max_code FROM chart_of_accounts
         WHERE code ~ $1`,
        [`^${prefix}\\d+$`]
      );
      const maxCode = maxRow?.max_code ? Number(maxRow.max_code) : Number(prefix + "000") - 10;
      const next = String(maxCode + 10).padStart(4, "0");
      res.json({ next_code: next });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
