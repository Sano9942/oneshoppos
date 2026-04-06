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

        const { rows: [returnsRow] } = await db.query(
          `SELECT COALESCE(SUM(ri.refund_price * ri.quantity), 0) AS returns
           FROM return_items ri
           JOIN returns r ON r.id = ri.return_id
           WHERE r.timestamp >= $1 AND r.timestamp < $2`,
          [toUtcStart(from, tz), toUtcEnd(to, tz)]
        );

        const { rows: expenseRows } = await db.query(
          `SELECT COALESCE(ec.name, 'Uncategorized') AS name, COALESCE(SUM(e.amount), 0) AS total
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
           WHERE e.expense_date >= $1::date AND e.expense_date <= $2::date
           GROUP BY COALESCE(ec.name, 'Uncategorized')
           ORDER BY total DESC`,
          [from, to]
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
        const { from, to } = req.query || {};
        if (!from || !to)
          return res.status(400).json({ error: "from and to are required" });

        const tz = req.company?.timezone || "UTC";
        const { rows: inflowsRows } = await db.query(
          `SELECT sp.payment_method, COALESCE(SUM(sp.amount), 0) AS total
           FROM sale_payments sp
           JOIN sales s ON s.id = sp.sale_id
           WHERE s.voided = false AND s.timestamp >= $1 AND s.timestamp < $2
           GROUP BY sp.payment_method
           ORDER BY total DESC`,
          [toUtcStart(from, tz), toUtcEnd(to, tz)]
        );

        const { rows: [expenseRow] } = await db.query(
          "SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE expense_date >= $1::date AND expense_date <= $2::date",
          [from, to]
        );

        const { rows: [supplierRow] } = await db.query(
          "SELECT COALESCE(SUM(amount), 0) AS supplier_payments FROM supplier_payments WHERE paid_at::date >= $1::date AND paid_at::date <= $2::date",
          [from, to]
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
          `SELECT s.timestamp::date AS date,
                  COALESCE(SUM(sp.amount), 0) AS inflow
           FROM sale_payments sp
           JOIN sales s ON s.id = sp.sale_id
           WHERE s.voided = false
             AND sp.payment_method = 'Cash'
             AND s.timestamp >= $1 AND s.timestamp < $2${outletSql}
           GROUP BY s.timestamp::date`,
          inflowParams
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

        // Merge by date
        const map = {};
        for (const r of inflowRows || []) {
          const d = typeof r.date === "string" ? r.date : new Date(r.date).toISOString().slice(0, 10);
          map[d] = { date: d, inflow: Number(r.inflow || 0), outflow: 0 };
        }
        for (const r of outflowRows || []) {
          const d = typeof r.date === "string" ? r.date : new Date(r.date).toISOString().slice(0, 10);
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
    requireAnyPerm(["view_reports", "manage_employees"]),
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
    requireAnyPerm(["view_reports", "manage_employees"]),
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
        // Assets: inventory at cost
        const { rows: [invRow] } = await db.query(
          `SELECT COALESCE(SUM(p.cost_price * COALESCE(os.quantity, 0)), 0) AS inventory_value
           FROM products p
           LEFT JOIN outlet_stock os ON os.product_id = p.id
           WHERE COALESCE(os.quantity, 0) > 0`
        );
        const inventoryValue = Number(invRow?.inventory_value || 0);

        // Assets: cash in open shifts
        const { rows: [cashRow] } = await db.query(
          `SELECT COALESCE(SUM(opening_float), 0) AS cash_on_hand
           FROM cash_shifts WHERE status = 'open'`
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
        const { from, to } = req.query || {};
        if (!from || !to) return res.status(400).json({ error: "from and to are required" });
        const tz = req.company?.timezone || "UTC";
        const { rows } = await db.query(
          `SELECT t.name AS tax_name, t.rate,
                  COUNT(DISTINCT s.id) AS transaction_count,
                  COALESCE(SUM(si.quantity * si.price_at_sale), 0) AS taxable_amount,
                  COALESCE(SUM(si.quantity * si.price_at_sale * t.rate / 100.0), 0) AS tax_collected
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id AND s.voided = false
           JOIN products p ON p.id = si.product_id
           JOIN taxes t ON t.id = p.tax_id
           WHERE s.timestamp >= $1 AND s.timestamp < $2
           GROUP BY t.id, t.name, t.rate
           ORDER BY tax_collected DESC`,
          [toUtcStart(from, tz), toUtcEnd(to, tz)]
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
        if (from) { where.push(`sp.paid_at::date >= $${idx++}::date`); params.push(from); }
        if (to) { where.push(`sp.paid_at::date <= $${idx++}::date`); params.push(to); }
        const { rows } = await db.query(
          `SELECT sp.id, sp.amount, sp.payment_method, sp.paid_at, sp.notes,
                  si.invoice_number, s.name AS supplier_name
           FROM supplier_payments sp
           LEFT JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
           LEFT JOIN suppliers s ON s.id = si.supplier_id
           WHERE ${where.join(" AND ")}
           ORDER BY sp.paid_at::date DESC, sp.id DESC`,
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
        if (from) { where.push(`n.created_at::date >= $${idx++}::date`); params.push(from); }
        if (to) { where.push(`n.created_at::date <= $${idx++}::date`); params.push(to); }
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

  return router;
};
