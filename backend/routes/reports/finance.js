const { SUPPLIER_TOTALS_SQL } = require("../../services/supplier-balance");
const { toUtcStart, toUtcEnd, isValidTz, tenantToday } = require("../../utils/tz");

module.exports = function registerFinanceReports(app, deps, helpers) {
  const { db, requirePerm } = deps;
  // D4 split (PLAN-V2 Step 4, REPORT-PERMS.md §3.8) — explicit per-domain
  // guard on every route; the /api/reports blanket rule in
  // middleware/permissions.js is only a backstop.
  const financeView = requirePerm("view_financial_reports");
  const { getDescendantLeafIds } = helpers || {};

  /* ── helper: convert ? placeholders to $1,$2,... ── */
  function pgify(sql, params) {
    let idx = 1;
    const text = sql.replace(/\?/g, () => `$${idx++}`);
    return { text, values: params };
  }

  // Suppliers with a balance, as of now: opening + bills − payments − returns
  // (services/supplier-balance.js). Only the supplier and search filters apply.
  function supplierBalanceQuery(query, limitSql) {
    const where = ["ABS(t.balance) >= 0.005"];
    const params = [];
    if (query?.supplier_id) { where.push("s.id = ?"); params.push(Number(query.supplier_id)); }
    if (query?.search) { where.push("s.name ILIKE ?"); params.push(`%${query.search}%`); }
    return {
      text: `
        SELECT s.id, s.name AS supplier_name, s.phone, t.invoice_count, t.opening_balance,
               t.total_invoiced, t.total_paid, t.total_returned, t.balance AS total_due
          FROM suppliers s
          JOIN (${SUPPLIER_TOTALS_SQL}) t ON t.supplier_id = s.id
         WHERE ${where.join(" AND ")}
         ORDER BY t.balance DESC, s.name ASC
         ${limitSql}`,
      params,
    };
  }

  function applyRangeFilters(where, params, query, opts = {}, tz = "UTC") {
    const {
      dateColumn,
      timeColumn,
      outletColumn,
      supplierColumn,
      searchSql,
      searchParams,
      columnType, // "utc" (default) or "local"
    } = opts;
    const {
      date_from,
      date_to,
      time_from,
      time_to,
      outlet_id,
      supplier_id,
      search,
    } = query || {};
    const outletIds =
      outlet_id !== undefined && outlet_id !== null && outlet_id !== ""
        ? String(outlet_id).split(",").map(Number).filter(Boolean)
        : [];
    const parsedSupplierId =
      supplier_id !== undefined && supplier_id !== null && supplier_id !== ""
        ? Number(supplier_id)
        : null;

    const isLocal = columnType === "local";
    if (date_from && dateColumn) {
      if (isLocal) {
        where.push(`${dateColumn}::date >= ?::date`);
        params.push(date_from);
      } else {
        where.push(`${dateColumn} >= ?`);
        params.push(toUtcStart(date_from, tz));
      }
    }
    if (date_to && dateColumn) {
      if (isLocal) {
        where.push(`${dateColumn}::date <= ?::date`);
        params.push(date_to);
      } else {
        where.push(`${dateColumn} < ?`);
        params.push(toUtcEnd(date_to, tz));
      }
    }
    // D54: time of day in the shop's timezone, not the DB session's (UTC on prod).
    const timeExpr = isLocal
      ? `${timeColumn}::time`
      : `(${timeColumn} AT TIME ZONE '${isValidTz(tz) ? tz : "UTC"}')::time`;
    if (time_from && timeColumn) {
      where.push(`${timeExpr} >= ?::time`);
      params.push(time_from);
    }
    if (time_to && timeColumn) {
      where.push(`${timeExpr} <= ?::time`);
      params.push(time_to);
    }
    if (outletIds.length && outletColumn) {
      if (outletIds.length === 1) {
        where.push(`${outletColumn} = ?`);
        params.push(outletIds[0]);
      } else {
        where.push(`${outletColumn} IN (${outletIds.map(() => "?").join(",")})`);
        params.push(...outletIds);
      }
    }
    if (parsedSupplierId !== null && supplierColumn) {
      where.push(`${supplierColumn} = ?`);
      params.push(parsedSupplierId);
    }
    if (search && searchSql && Array.isArray(searchParams) && searchParams.length) {
      where.push(searchSql);
      searchParams.forEach(() => params.push(`%${search}%`));
    }
  }

  function roundMoney(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  async function applyProductFilters(where, params, query, aliases = {}) {
    const {
      product = "p",
      sale = "s",
      supplier = null,
      category = "category_id",
      brand = "brand_id",
      searchColumns = [],
    } = aliases;
    const {
      category_id,
      brand_id,
      supplier_id,
      search,
      employee_id,
    } = query || {};

    if (employee_id && sale) {
      where.push(`${sale}.employee_id = ?`);
      params.push(employee_id);
    }

    if (category_id && getDescendantLeafIds) {
      const leafIds = await getDescendantLeafIds(Number(category_id));
      if (!leafIds.length) {
        where.push("1 = 0");
      } else if (leafIds.length === 1) {
        where.push(`${product}.${category} = ?`);
        params.push(Number(leafIds[0]));
      } else {
        where.push(`${product}.${category} IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }

    if (brand_id) {
      where.push(`${product}.${brand} = ?`);
      params.push(Number(brand_id));
    }

    if (supplier_id) {
      if (supplier) {
        where.push(`${supplier} = ?`);
      } else {
        where.push(`${product}.supplier_id = ?`);
      }
      params.push(Number(supplier_id));
    }

    if (search && searchColumns.length) {
      where.push(`(${searchColumns.map((col) => `${col} ILIKE ?`).join(" OR ")})`);
      searchColumns.forEach(() => params.push(`%${search}%`));
    }
  }

  app.get("/api/reports/settlement-overview", financeView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const salesWhere = ["s.voided = false"];
      const salesParams = [];
      applyRangeFilters(salesWhere, salesParams, req.query, {
        dateColumn: "s.timestamp",
        timeColumn: "s.timestamp",
        outletColumn: "s.outlet_id",
      }, tz);

      const expenseWhere = ["1 = 1"];
      const expenseParams = [];
      applyRangeFilters(expenseWhere, expenseParams, req.query, {
        dateColumn: "e.expense_date",
        outletColumn: "e.outlet_id",
        columnType: "local",
      }, tz);

      const supplierPaymentWhere = ["sp.voided IS NOT TRUE"];
      const supplierPaymentParams = [];
      applyRangeFilters(supplierPaymentWhere, supplierPaymentParams, req.query, {
        dateColumn: "sp.paid_at",
        timeColumn: "sp.paid_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "sp.supplier_id",
        searchSql:
          "(s.name ILIKE ? OR COALESCE(si.invoice_number, '') ILIKE ? OR COALESCE(sp.reference, '') ILIKE ?)",
        searchParams: [1, 1, 1],
        // paid_at is TIMESTAMPTZ — must go through the UTC-bounds path, not a
        // bare ::date cast (which evaluates in the DB session timezone).
      }, tz);

      const invoiceWhere = ["1 = 1"];
      const invoiceParams = [];
      applyRangeFilters(invoiceWhere, invoiceParams, req.query, {
        dateColumn: "si.created_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name ILIKE ? OR COALESCE(si.invoice_number, '') ILIKE ?)",
        searchParams: [1, 1],
        // created_at is TIMESTAMPTZ — UTC-bounds path (see paid_at note).
      }, tz);

      const customerWhere = ["COALESCE(c.balance, 0) <> 0"];
      const customerParams = [];
      if (req.query.search) {
        customerWhere.push(
          "(c.name ILIKE ? OR COALESCE(c.mobile, '') ILIKE ? OR c.id::text ILIKE ?)",
        );
        customerParams.push(
          `%${req.query.search}%`,
          `%${req.query.search}%`,
          `%${req.query.search}%`,
        );
      }

      const paymentMixQ = pgify(
        `
          SELECT
            COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
            ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total,
            COUNT(DISTINCT s.id) AS sale_count
          FROM sales s
          JOIN sale_payments sp ON sp.sale_id = s.id
          WHERE ${salesWhere.join(" AND ")}
          GROUP BY COALESCE(sp.payment_method, s.payment_method, 'Unknown')
          ORDER BY total DESC
        `,
        salesParams,
      );
      const { rows: paymentMix } = await db.query(paymentMixQ.text, paymentMixQ.values);

      const inflowQ = pgify(
        `
          SELECT ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total_inflows
          FROM sales s
          JOIN sale_payments sp ON sp.sale_id = s.id
          WHERE ${salesWhere.join(" AND ")}
        `,
        salesParams,
      );
      const { rows: inflowRows } = await db.query(inflowQ.text, inflowQ.values);
      const inflowRow = inflowRows[0] || null;

      const expenseQ = pgify(
        `
          SELECT ROUND(COALESCE(SUM(e.amount), 0), 2) AS expenses
          FROM expenses e
          WHERE ${expenseWhere.join(" AND ")}
        `,
        expenseParams,
      );
      const { rows: expenseRows } = await db.query(expenseQ.text, expenseQ.values);
      const expenseRow = expenseRows[0] || null;

      const supplierPaymentQ = pgify(
        `
          SELECT ROUND(COALESCE(SUM(sp.amount), 0), 2) AS supplier_payments
          FROM supplier_payments sp
          LEFT JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
          JOIN suppliers s ON s.id = sp.supplier_id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          WHERE ${supplierPaymentWhere.join(" AND ")}
        `,
        supplierPaymentParams,
      );
      const { rows: supplierPaymentRows } = await db.query(supplierPaymentQ.text, supplierPaymentQ.values);
      const supplierPaymentRow = supplierPaymentRows[0] || null;

      const invoiceQ = pgify(
        `
          SELECT
            si.id,
            s.name AS supplier_name,
            COALESCE(si.invoice_number, 'INV-' || LPAD(si.id::text, 4, '0')) AS invoice_number,
            si.amount,
            COALESCE(pay.paid_amount, 0) AS paid_amount,
            ROUND(COALESCE(si.amount, 0) - COALESCE(pay.paid_amount, 0), 2) AS outstanding,
            si.status,
            si.due_date,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name
          FROM supplier_invoices si
          JOIN suppliers s ON s.id = si.supplier_id
          LEFT JOIN (
            SELECT supplier_invoice_id, SUM(amount) AS paid_amount
            FROM supplier_payments
            WHERE voided IS NOT TRUE
            GROUP BY supplier_invoice_id
          ) pay ON pay.supplier_invoice_id = si.id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN outlets od ON od.id = grn_direct.outlet_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          LEFT JOIN outlets op ON op.id = grn_po.outlet_id
          WHERE ${invoiceWhere.join(" AND ")}
          ORDER BY outstanding DESC, COALESCE(si.due_date::timestamptz, si.created_at)::date ASC
          LIMIT 10
        `,
        invoiceParams,
      );
      const { rows: invoiceRows } = await db.query(invoiceQ.text, invoiceQ.values);

      // What we owe each supplier: one definition (services/supplier-balance.js),
      // so opening balances, payments on account, returns and voids all count.
      // A balance is as of now, so only the supplier/search filters apply.
      const balanceQ = supplierBalanceQuery(req.query, "LIMIT 8");
      const supplierAgingQ = pgify(balanceQ.text, balanceQ.params);
      const { rows: supplierAging } = await db.query(supplierAgingQ.text, supplierAgingQ.values);

      const recentSupplierPaymentsQ = pgify(
        `
          SELECT
            sp.id,
            sp.paid_at,
            sp.amount,
            sp.payment_method,
            sp.reference,
            s.name AS supplier_name,
            COALESCE(si.invoice_number, 'INV-' || LPAD(si.id::text, 4, '0')) AS invoice_number,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name
          FROM supplier_payments sp
          LEFT JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
          JOIN suppliers s ON s.id = sp.supplier_id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN outlets od ON od.id = grn_direct.outlet_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          LEFT JOIN outlets op ON op.id = grn_po.outlet_id
          WHERE ${supplierPaymentWhere.join(" AND ")}
          ORDER BY sp.paid_at DESC, sp.id DESC
          LIMIT 10
        `,
        supplierPaymentParams,
      );
      const { rows: recentSupplierPayments } = await db.query(recentSupplierPaymentsQ.text, recentSupplierPaymentsQ.values);

      const customerArQ = pgify(
        `
          SELECT
            c.id,
            c.name,
            c.mobile,
            ROUND(COALESCE(c.balance, 0), 2) AS credit_balance
          FROM customers c
          WHERE ${customerWhere.join(" AND ")}
          ORDER BY ABS(COALESCE(c.balance, 0)) DESC, c.name ASC
        `,
        customerParams,
      );
      const { rows: customerAr } = await db.query(customerArQ.text, customerArQ.values);

      const totalInflows = Number(inflowRow?.total_inflows || 0);
      const expenses = Number(expenseRow?.expenses || 0);
      const supplierPayments = Number(supplierPaymentRow?.supplier_payments || 0);
      const supplierOutstanding = supplierAging.reduce(
        (sum, row) => sum + Number(row.total_due || 0),
        0,
      );
      const customerReceivable = customerAr.reduce(
        (sum, row) => sum + Number(row.credit_balance || 0),
        0,
      );
      const totalOutflows = expenses + supplierPayments;

      res.json({
        summary: {
          total_inflows: roundMoney(totalInflows),
          expenses: roundMoney(expenses),
          supplier_payments: roundMoney(supplierPayments),
          total_outflows: roundMoney(totalOutflows),
          net_cashflow: roundMoney(totalInflows - totalOutflows),
          supplier_outstanding: roundMoney(supplierOutstanding),
          customer_receivable: roundMoney(customerReceivable),
          open_supplier_invoices: invoiceRows.filter(
            (row) => Number(row.outstanding || 0) > 0,
          ).length,
          suppliers_with_due: supplierAging.filter(
            (row) => Number(row.total_due || 0) > 0,
          ).length,
        },
        payment_mix: paymentMix,
        supplier_aging: supplierAging,
        outstanding_invoices: invoiceRows,
        recent_supplier_payments: recentSupplierPayments,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/payables-receivables", financeView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const supplierWhere = ["1 = 1"];
      const supplierParams = [];
      applyRangeFilters(supplierWhere, supplierParams, req.query, {
        dateColumn: "si.created_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name ILIKE ? OR COALESCE(si.invoice_number, '') ILIKE ?)",
        searchParams: [1, 1],
      }, tz);

      const customerWhere = ["COALESCE(c.balance, 0) <> 0"];
      const customerParams = [];
      if (req.query.search) {
        customerWhere.push(
          "(c.name ILIKE ? OR COALESCE(c.mobile, '') ILIKE ? OR c.id::text ILIKE ?)",
        );
        customerParams.push(
          `%${req.query.search}%`,
          `%${req.query.search}%`,
          `%${req.query.search}%`,
        );
      }

      const customerSalesJoin = [];
      const customerSalesParams = [];
      if (req.query.date_from) {
        customerSalesJoin.push("s.timestamp >= ?");
        customerSalesParams.push(toUtcStart(req.query.date_from, tz));
      }
      if (req.query.date_to) {
        customerSalesJoin.push("s.timestamp < ?");
        customerSalesParams.push(toUtcEnd(req.query.date_to, tz));
      }
      if (req.query.outlet_id) {
        const ids = String(req.query.outlet_id).split(",").map(Number).filter(Boolean);
        if (ids.length === 1) {
          customerSalesJoin.push("s.outlet_id = ?");
          customerSalesParams.push(ids[0]);
        } else if (ids.length > 1) {
          customerSalesJoin.push(`s.outlet_id IN (${ids.map(() => "?").join(",")})`);
          customerSalesParams.push(...ids);
        }
      }

      const supplierApQ = pgify(
        `
          SELECT
            si.id,
            COALESCE(si.invoice_number, 'INV-' || LPAD(si.id::text, 4, '0')) AS invoice_number,
            si.created_at AS invoice_date,
            si.due_date,
            si.amount,
            COALESCE(pay.paid_amount, 0) AS paid_amount,
            ROUND(COALESCE(si.amount, 0) - COALESCE(pay.paid_amount, 0), 2) AS outstanding,
            si.status,
            s.name AS supplier_name,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name,
            GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(si.due_date::timestamptz, si.created_at))) / 86400.0)::int AS days_open
          FROM supplier_invoices si
          LEFT JOIN suppliers s ON s.id = si.supplier_id
          LEFT JOIN (
            SELECT supplier_invoice_id, SUM(amount) AS paid_amount
            FROM supplier_payments
            WHERE voided IS NOT TRUE
            GROUP BY supplier_invoice_id
          ) pay ON pay.supplier_invoice_id = si.id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN outlets od ON od.id = grn_direct.outlet_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          LEFT JOIN outlets op ON op.id = grn_po.outlet_id
          WHERE ${supplierWhere.join(" AND ")}
          ORDER BY outstanding DESC, days_open DESC, si.id DESC
        `,
        supplierParams,
      );
      const { rows: supplierInvoices } = await db.query(supplierApQ.text, supplierApQ.values);

      // Supplier returns reduce what we owe (the supplier ledger books them as
      // a credit). Listed as negative lines so this report and the ledger agree.
      const returnWhere = ["1 = 1"];
      const returnParams = [];
      applyRangeFilters(returnWhere, returnParams, req.query, {
        dateColumn: "sr.return_date",
        outletColumn: "sr.outlet_id",
        supplierColumn: "sr.supplier_id",
        searchSql: "(s.name ILIKE ? OR COALESCE(sr.reference_number, '') ILIKE ?)",
        searchParams: [1, 1],
      }, tz);
      const supplierReturnQ = pgify(
        `
          SELECT
            sr.id,
            COALESCE(sr.reference_number, 'RET-' || LPAD(sr.id::text, 4, '0')) AS invoice_number,
            sr.return_date AS invoice_date,
            NULL::date AS due_date,
            ROUND(-COALESCE(sr.total_value, 0), 2) AS amount,
            0 AS paid_amount,
            ROUND(-COALESCE(sr.total_value, 0), 2) AS outstanding,
            'supplier_return' AS status,
            s.name AS supplier_name,
            COALESCE(o.name, 'Unassigned') AS outlet_name,
            0 AS days_open
          FROM supplier_returns sr
          LEFT JOIN suppliers s ON s.id = sr.supplier_id
          LEFT JOIN outlets o ON o.id = sr.outlet_id
          WHERE ${returnWhere.join(" AND ")} AND COALESCE(sr.total_value, 0) <> 0
          ORDER BY sr.id DESC
        `,
        returnParams,
      );
      const { rows: supplierReturns } = await db.query(supplierReturnQ.text, supplierReturnQ.values);
      // D13: opening balances (from the paper registers) and payments made on
      // account (no bill) change what we owe too, as in the supplier ledger
      // (one definition: services/supplier-balance.js).
      const openingWhere = ["COALESCE(s.opening_balance, 0) <> 0"];
      const openingParams = [];
      applyRangeFilters(openingWhere, openingParams, req.query, {
        dateColumn: "s.opening_balance_date",
        columnType: "local",
        supplierColumn: "s.id",
        searchSql: "(s.name ILIKE ?)",
        searchParams: [1],
      }, tz);
      const openingQ = pgify(
        `
          SELECT s.id, 'Opening balance' AS invoice_number, s.opening_balance_date AS invoice_date,
                 NULL::date AS due_date, ROUND(s.opening_balance, 2) AS amount, 0 AS paid_amount,
                 ROUND(s.opening_balance, 2) AS outstanding, 'opening_balance' AS status,
                 s.name AS supplier_name, 'Unassigned' AS outlet_name, 0 AS days_open
            FROM suppliers s
           WHERE ${openingWhere.join(" AND ")}
        `,
        openingParams,
      );
      const { rows: supplierOpenings } = await db.query(openingQ.text, openingQ.values);

      const onAccountWhere = ["sp.supplier_invoice_id IS NULL", "sp.voided IS NOT TRUE"];
      const onAccountParams = [];
      applyRangeFilters(onAccountWhere, onAccountParams, req.query, {
        dateColumn: "sp.paid_at",
        supplierColumn: "sp.supplier_id",
        searchSql: "(s.name ILIKE ? OR COALESCE(sp.reference, '') ILIKE ?)",
        searchParams: [1, 1],
      }, tz);
      const onAccountQ = pgify(
        `
          SELECT sp.id, COALESCE(sp.reference, 'PAY-' || LPAD(sp.id::text, 4, '0')) AS invoice_number,
                 sp.paid_at AS invoice_date, NULL::date AS due_date,
                 ROUND(-sp.amount, 2) AS amount, 0 AS paid_amount, ROUND(-sp.amount, 2) AS outstanding,
                 'payment_on_account' AS status, s.name AS supplier_name, 'Unassigned' AS outlet_name, 0 AS days_open
            FROM supplier_payments sp
            JOIN suppliers s ON s.id = sp.supplier_id
           WHERE ${onAccountWhere.join(" AND ")}
           ORDER BY sp.id DESC
        `,
        onAccountParams,
      );
      const { rows: supplierOnAccount } = await db.query(onAccountQ.text, onAccountQ.values);

      // F9: Not received (−), supplier Discount (−), Correction (±) on the
      // supplier account, as in the supplier ledger.
      const entryWhere = ["e.voided IS NOT TRUE"];
      const entryParams = [];
      applyRangeFilters(entryWhere, entryParams, req.query, {
        dateColumn: "e.created_at",
        supplierColumn: "e.supplier_id",
        searchSql: "(s.name ILIKE ? OR COALESCE(e.note, '') ILIKE ?)",
        searchParams: [1, 1],
      }, tz);
      const entryQ = pgify(
        `
          SELECT e.id,
                 CASE e.kind WHEN 'not_received' THEN 'Not received'
                             WHEN 'discount' THEN 'Discount' ELSE 'Correction' END AS invoice_number,
                 e.created_at AS invoice_date, NULL::date AS due_date,
                 ROUND(e.amount, 2) AS amount, 0 AS paid_amount, ROUND(e.amount, 2) AS outstanding,
                 'account_' || e.kind AS status, s.name AS supplier_name, 'Unassigned' AS outlet_name, 0 AS days_open
            FROM supplier_account_entries e
            JOIN suppliers s ON s.id = e.supplier_id
           WHERE ${entryWhere.join(" AND ")}
           ORDER BY e.id DESC
        `,
        entryParams,
      );
      const { rows: supplierEntries } = await db.query(entryQ.text, entryQ.values);

      const supplierAp = [...supplierOpenings, ...supplierInvoices, ...supplierReturns, ...supplierOnAccount, ...supplierEntries];

      const customerArQ = pgify(
        `
          SELECT
            c.id,
            c.name,
            c.mobile,
            ROUND(COALESCE(c.balance, 0), 2) AS credit_balance,
            ROUND(COALESCE(SUM(s.total_amount), 0), 2) AS total_purchases,
            MAX(s.timestamp) AS last_purchase
          FROM customers c
          LEFT JOIN sales s ON s.customer_id = c.id
            AND s.voided = false
            ${customerSalesJoin.length ? `AND ${customerSalesJoin.join(" AND ")}` : ""}
          WHERE ${customerWhere.join(" AND ")}
          GROUP BY c.id, c.name, c.mobile, c.balance
          ORDER BY ABS(COALESCE(c.balance, 0)) DESC, c.name ASC
        `,
        [...customerSalesParams, ...customerParams],
      );
      const { rows: customerAr } = await db.query(customerArQ.text, customerArQ.values);

      const summary = {
        supplier_invoice_count: supplierInvoices.length,
        supplier_return_count: supplierReturns.length,
        supplier_outstanding: roundMoney(
          supplierAp.reduce((sum, row) => sum + Number(row.outstanding || 0), 0),
        ),
        customer_count: customerAr.length,
        customer_receivable: roundMoney(
          customerAr.reduce(
            (sum, row) => sum + Number(row.credit_balance || 0),
            0,
          ),
        ),
      };

      res.json({ summary, supplier_ap: supplierAp, customer_ar: customerAr });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/ar-aging", financeView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";

      let buckets = [30, 60, 90];
      const raw = req.company?.ar_aging_buckets;
      if (Array.isArray(raw) && raw.length === 3) {
        const nums = raw.map((v) => Number(v));
        const allValid =
          nums.every((n) => Number.isInteger(n) && n > 0) &&
          nums[0] < nums[1] &&
          nums[1] < nums[2];
        if (allValid) buckets = nums;
      }
      const [b1, b2, b3] = buckets;

      // Default as_of = tenant-local today. (The old toLocaleString →
      // new Date → toISOString round-trip re-interpreted the wall time in the
      // PROCESS timezone and came out a day early for hours around midnight.)
      const asOf = req.query.as_of && /^\d{4}-\d{2}-\d{2}$/.test(req.query.as_of)
        ? req.query.as_of
        : tenantToday(tz);

      const outletIds =
        req.query.outlet_id !== undefined && req.query.outlet_id !== ""
          ? String(req.query.outlet_id).split(",").map(Number).filter(Boolean)
          : [];

      // "Unpaid" = balance_due > 0 AND status not in terminal/non-AR states.
      // Drafts with balance_due=0 are excluded by the balance test; drafts with
      // non-zero balance surface here intentionally (operator can spot them).
      const where = [
        "ci.balance_due > 0",
        "ci.status NOT IN ('paid','cancelled','void')",
      ];
      const params = [asOf, b1, b1, b2, b2, b3, b3];
      if (outletIds.length === 1) {
        where.push(`ci.outlet_id = $${params.length + 1}`);
        params.push(outletIds[0]);
      } else if (outletIds.length > 1) {
        const placeholders = outletIds.map((_, i) => `$${params.length + 1 + i}`).join(",");
        where.push(`ci.outlet_id IN (${placeholders})`);
        params.push(...outletIds);
      }

      const sql = `
        WITH aged AS (
          SELECT
            ci.customer_id,
            ci.balance_due,
            GREATEST(0, ($1::date - COALESCE(ci.due_date, $1::date))::int) AS days_overdue
          FROM customer_invoices ci
          WHERE ${where.join(" AND ")}
        )
        SELECT
          aged.customer_id,
          c.name,
          ROUND(SUM(CASE WHEN days_overdue <= $2 THEN balance_due ELSE 0 END), 2) AS b0,
          ROUND(SUM(CASE WHEN days_overdue >  $3 AND days_overdue <= $4 THEN balance_due ELSE 0 END), 2) AS b1,
          ROUND(SUM(CASE WHEN days_overdue >  $5 AND days_overdue <= $6 THEN balance_due ELSE 0 END), 2) AS b2,
          ROUND(SUM(CASE WHEN days_overdue >  $7 THEN balance_due ELSE 0 END), 2) AS b3_plus,
          ROUND(SUM(balance_due), 2) AS total
        FROM aged
        JOIN customers c ON c.id = aged.customer_id
        GROUP BY aged.customer_id, c.name
        HAVING SUM(balance_due) > 0
        ORDER BY total DESC, c.name ASC
      `;

      const { rows } = await db.query(sql, params);

      const totals = rows.reduce(
        (acc, r) => {
          acc.b0 += Number(r.b0 || 0);
          acc.b1 += Number(r.b1 || 0);
          acc.b2 += Number(r.b2 || 0);
          acc.b3_plus += Number(r.b3_plus || 0);
          acc.total += Number(r.total || 0);
          return acc;
        },
        { b0: 0, b1: 0, b2: 0, b3_plus: 0, total: 0 },
      );
      totals.b0 = roundMoney(totals.b0);
      totals.b1 = roundMoney(totals.b1);
      totals.b2 = roundMoney(totals.b2);
      totals.b3_plus = roundMoney(totals.b3_plus);
      totals.total = roundMoney(totals.total);

      res.json({ as_of: asOf, buckets, rows, totals });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/supplier-payments-invoices", financeView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const invoiceWhere = ["1 = 1"];
      const invoiceParams = [];
      applyRangeFilters(invoiceWhere, invoiceParams, req.query, {
        dateColumn: "si.created_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name ILIKE ? OR COALESCE(si.invoice_number, '') ILIKE ?)",
        searchParams: [1, 1],
        // created_at is TIMESTAMPTZ — UTC-bounds path (see paid_at note).
      }, tz);

      const paymentWhere = ["sp.voided IS NOT TRUE"];
      const paymentParams = [];
      applyRangeFilters(paymentWhere, paymentParams, req.query, {
        dateColumn: "sp.paid_at",
        timeColumn: "sp.paid_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "sp.supplier_id",
        searchSql:
          "(s.name ILIKE ? OR COALESCE(si.invoice_number, '') ILIKE ? OR COALESCE(sp.reference, '') ILIKE ?)",
        searchParams: [1, 1, 1],
      }, tz);

      if (req.query.status === "open") {
        invoiceWhere.push("si.status <> 'paid'");
      } else if (req.query.status) {
        invoiceWhere.push("si.status = ?");
        invoiceParams.push(req.query.status);
      }

      // Per supplier: one definition of what we owe (services/supplier-balance.js).
      const balanceQ = supplierBalanceQuery(req.query, "");
      const agingQ = pgify(balanceQ.text, balanceQ.params);
      const { rows: aging } = await db.query(agingQ.text, agingQ.values);

      const invoicesQ = pgify(
        `
          SELECT
            si.id,
            COALESCE(si.invoice_number, 'INV-' || LPAD(si.id::text, 4, '0')) AS invoice_number,
            si.created_at,
            si.due_date,
            si.amount,
            si.status,
            s.name AS supplier_name,
            COALESCE(pay.paid_amount, 0) AS amount_paid,
            ROUND(COALESCE(si.amount, 0) - COALESCE(pay.paid_amount, 0), 2) AS amount_due,
            COALESCE(pay.payment_count, 0) AS payment_count,
            pay.last_payment_at,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name
          FROM supplier_invoices si
          JOIN suppliers s ON s.id = si.supplier_id
          LEFT JOIN (
            SELECT
              supplier_invoice_id,
              SUM(amount) AS paid_amount,
              COUNT(*) AS payment_count,
              MAX(paid_at) AS last_payment_at
            FROM supplier_payments
            WHERE voided IS NOT TRUE
            GROUP BY supplier_invoice_id
          ) pay ON pay.supplier_invoice_id = si.id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN outlets od ON od.id = grn_direct.outlet_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          LEFT JOIN outlets op ON op.id = grn_po.outlet_id
          WHERE ${invoiceWhere.join(" AND ")}
          ORDER BY COALESCE(si.due_date::timestamptz, si.created_at)::date ASC, si.id DESC
        `,
        invoiceParams,
      );
      const { rows: invoices } = await db.query(invoicesQ.text, invoicesQ.values);

      const paymentsQ = pgify(
        `
          SELECT
            sp.id,
            sp.paid_at,
            sp.amount,
            sp.payment_method,
            sp.reference,
            sp.paid_by,
            sp.notes,
            s.name AS supplier_name,
            COALESCE(si.invoice_number, 'INV-' || LPAD(si.id::text, 4, '0')) AS invoice_number,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name
          FROM supplier_payments sp
          LEFT JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
          JOIN suppliers s ON s.id = sp.supplier_id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN outlets od ON od.id = grn_direct.outlet_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          LEFT JOIN outlets op ON op.id = grn_po.outlet_id
          WHERE ${paymentWhere.join(" AND ")}
          ORDER BY sp.paid_at DESC, sp.id DESC
          LIMIT 50
        `,
        paymentParams,
      );
      const { rows: payments } = await db.query(paymentsQ.text, paymentsQ.values);

      const summary = {
        suppliers_with_due: aging.filter((row) => Number(row.total_due || 0) > 0).length,
        total_due: roundMoney(
          aging.reduce((sum, row) => sum + Number(row.total_due || 0), 0),
        ),
        open_invoice_count: invoices.filter(
          (row) => Number(row.amount_due || 0) > 0,
        ).length,
        payments_total: roundMoney(
          payments.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        ),
      };

      res.json({ summary, aging, invoices, payments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/finance-payment-mix", financeView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const salesWhere = ["s.voided = false"];
      const salesParams = [];
      applyRangeFilters(salesWhere, salesParams, req.query, {
        dateColumn: "s.timestamp",
        timeColumn: "s.timestamp",
        outletColumn: "s.outlet_id",
      }, tz);

      const supplierPaymentWhere = ["sp.voided IS NOT TRUE"];
      const supplierPaymentParams = [];
      applyRangeFilters(supplierPaymentWhere, supplierPaymentParams, req.query, {
        dateColumn: "sp.paid_at",
        timeColumn: "sp.paid_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "sp.supplier_id",
      }, tz);

      const saleMixQ = pgify(
        `
          SELECT
            COALESCE(sp.payment_method, s.payment_method, 'Unknown') AS payment_method,
            ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total,
            COUNT(DISTINCT s.id) AS sale_count
          FROM sales s
          JOIN sale_payments sp ON sp.sale_id = s.id
          WHERE ${salesWhere.join(" AND ")}
          GROUP BY COALESCE(sp.payment_method, s.payment_method, 'Unknown')
          ORDER BY total DESC
        `,
        salesParams,
      );
      const { rows: saleMix } = await db.query(saleMixQ.text, saleMixQ.values);

      // P22 fix: tz-aware bucketing of business_date. Inline-literal the tz (validated
      // via isValidTz so safe vs SQL injection) to allow Postgres to recognize the
      // SELECT and GROUP BY expressions as equal.
      const safeTz = isValidTz(tz) ? tz : "UTC";
      const dailyInflowsQ = pgify(
        `
          SELECT
            to_char((s.timestamp AT TIME ZONE '${safeTz}')::date, 'YYYY-MM-DD') AS business_date,
            ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total,
            COUNT(DISTINCT s.id) AS sale_count
          FROM sales s
          JOIN sale_payments sp ON sp.sale_id = s.id
          WHERE ${salesWhere.join(" AND ")}
          GROUP BY (s.timestamp AT TIME ZONE '${safeTz}')::date
          ORDER BY business_date DESC
        `,
        salesParams,
      );
      const { rows: dailyInflows } = await db.query(dailyInflowsQ.text, dailyInflowsQ.values);

      const supplierPaymentMixQ = pgify(
        `
          SELECT
            COALESCE(sp.payment_method, 'Unknown') AS payment_method,
            ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total,
            COUNT(*) AS payment_count
          FROM supplier_payments sp
          LEFT JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          WHERE ${supplierPaymentWhere.join(" AND ")}
          GROUP BY COALESCE(sp.payment_method, 'Unknown')
          ORDER BY total DESC
        `,
        supplierPaymentParams,
      );
      const { rows: supplierPaymentMix } = await db.query(supplierPaymentMixQ.text, supplierPaymentMixQ.values);

      const totalInflows = saleMix.reduce(
        (sum, row) => sum + Number(row.total || 0),
        0,
      );
      const totalSupplierOutflows = supplierPaymentMix.reduce(
        (sum, row) => sum + Number(row.total || 0),
        0,
      );

      const saleMixWithPct = saleMix.map((row) => ({
        ...row,
        share_pct:
          totalInflows > 0
            ? roundMoney((Number(row.total || 0) / totalInflows) * 100)
            : 0,
      }));

      res.json({
        summary: {
          total_inflows: roundMoney(totalInflows),
          total_supplier_outflows: roundMoney(totalSupplierOutflows),
          primary_method: saleMixWithPct[0]?.payment_method || null,
        },
        sale_mix: saleMixWithPct,
        supplier_payment_mix: supplierPaymentMix,
        daily_inflows: dailyInflows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/gst-output", financeView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = false", "si.quantity > 0"];
      const params = [];
      applyRangeFilters(where, params, req.query, {
        dateColumn: "s.timestamp",
        timeColumn: "s.timestamp",
        outletColumn: "s.outlet_id",
      }, tz);
      await applyProductFilters(where, params, req.query, {
        product: "p",
        sale: "s",
        supplier: "p.supplier_id",
        searchColumns: [
          "p.name",
          "COALESCE(p.barcode, '')",
          "COALESCE(p.sku, '')",
          "COALESCE(o.name, '')",
          "s.id::text",
        ],
      });

      const taxMode = String(req.query.tax_mode || "gst");
      if (taxMode === "gst") {
        where.push("COALESCE(t.rate, p.gst, 0) > 0");
      } else if (taxMode === "no_tax") {
        where.push("COALESCE(t.rate, p.gst, 0) <= 0");
      }

      const q = pgify(
        `
          SELECT
            s.id AS sale_id,
            s.timestamp,
            COALESCE(o.name, '—') AS outlet_name,
            COALESCE(e.name, '—') AS employee_name,
            p.id AS product_id,
            p.name AS product_name,
            p.barcode,
            p.sku,
            COALESCE(cat.name, '—') AS category,
            COALESCE(b.name, '—') AS brand,
            COALESCE(sup.name, '—') AS supplier,
            COALESCE(t.name, CASE WHEN COALESCE(t.rate, p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END) AS tax_name,
            ROUND(COALESCE(t.rate, p.gst, 0), 2) AS tax_rate,
            si.quantity,
            ROUND(COALESCE(si.price_at_sale, 0), 2) AS unit_price_inclusive,
            ROUND(COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0), 2) AS line_total_inclusive,
            ROUND(
              CASE
                WHEN COALESCE(t.rate, p.gst, 0) > 0
                THEN (COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0))
                     / (1 + (COALESCE(t.rate, p.gst, 0) / 100.0))
                ELSE COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0)
              END,
              2
            ) AS line_total_exclusive,
            ROUND(
              (COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0)) -
              (
                CASE
                  WHEN COALESCE(t.rate, p.gst, 0) > 0
                  THEN (COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0))
                       / (1 + (COALESCE(t.rate, p.gst, 0) / 100.0))
                  ELSE COALESCE(si.quantity, 0) * COALESCE(si.price_at_sale, 0)
                END
              ),
              2
            ) AS gst_amount
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          LEFT JOIN taxes t ON t.id = p.tax_id
          LEFT JOIN categories cat ON cat.id = p.category_id
          LEFT JOIN brands b ON b.id = p.brand_id
          LEFT JOIN suppliers sup ON sup.id = p.supplier_id
          LEFT JOIN outlets o ON o.id = s.outlet_id
          LEFT JOIN employees e ON e.id = s.employee_id
          WHERE ${where.join(" AND ")}
          ORDER BY s.timestamp DESC, s.id DESC
          LIMIT 500
        `,
        params,
      );
      const { rows } = await db.query(q.text, q.values);

      const summaryByTaxMap = new Map();
      rows.forEach((row) => {
        const key = `${row.tax_name}__${row.tax_rate}`;
        const current = summaryByTaxMap.get(key) || {
          tax_name: row.tax_name,
          tax_rate: row.tax_rate,
          line_count: 0,
          quantity: 0,
          taxable_inclusive: 0,
          taxable_exclusive: 0,
          gst_amount: 0,
        };
        current.line_count += 1;
        current.quantity += Number(row.quantity || 0);
        current.taxable_inclusive += Number(row.line_total_inclusive || 0);
        current.taxable_exclusive += Number(row.line_total_exclusive || 0);
        current.gst_amount += Number(row.gst_amount || 0);
        summaryByTaxMap.set(key, current);
      });

      const summary_by_tax = Array.from(summaryByTaxMap.values())
        .map((row) => ({
          ...row,
          quantity: roundMoney(row.quantity),
          taxable_inclusive: roundMoney(row.taxable_inclusive),
          taxable_exclusive: roundMoney(row.taxable_exclusive),
          gst_amount: roundMoney(row.gst_amount),
        }))
        .sort((a, b) => Number(b.gst_amount || 0) - Number(a.gst_amount || 0));

      const totals = summary_by_tax.reduce(
        (acc, row) => {
          acc.line_count += Number(row.line_count || 0);
          acc.quantity += Number(row.quantity || 0);
          acc.taxable_inclusive += Number(row.taxable_inclusive || 0);
          acc.taxable_exclusive += Number(row.taxable_exclusive || 0);
          acc.gst_amount += Number(row.gst_amount || 0);
          return acc;
        },
        { line_count: 0, quantity: 0, taxable_inclusive: 0, taxable_exclusive: 0, gst_amount: 0 },
      );

      res.json({
        summary: {
          ...totals,
          quantity: roundMoney(totals.quantity),
          taxable_inclusive: roundMoney(totals.taxable_inclusive),
          taxable_exclusive: roundMoney(totals.taxable_exclusive),
          gst_amount: roundMoney(totals.gst_amount),
          tax_type_count: summary_by_tax.length,
        },
        summary_by_tax,
        rows,
        tax_mode: taxMode,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/reports/gst-type-summary", financeView, async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const salesWhere = ["s.voided = false", "si.quantity > 0"];
      const salesParams = [];
      applyRangeFilters(salesWhere, salesParams, req.query, {
        dateColumn: "s.timestamp",
        timeColumn: "s.timestamp",
        outletColumn: "s.outlet_id",
      }, tz);
      await applyProductFilters(salesWhere, salesParams, req.query, {
        product: "p",
        sale: "s",
        supplier: "p.supplier_id",
        searchColumns: ["p.name", "COALESCE(p.barcode, '')", "COALESCE(p.sku, '')"],
      });

      const purchaseWhere = ["1 = 1"];
      const purchaseParams = [];
      applyRangeFilters(purchaseWhere, purchaseParams, req.query, {
        dateColumn: "po.created_at",
        outletColumn: "grn_po.outlet_id",
      }, tz);
      await applyProductFilters(purchaseWhere, purchaseParams, req.query, {
        product: "p",
        supplier: "po.supplier_id",
        searchColumns: ["p.name", "COALESCE(p.barcode, '')", "COALESCE(p.sku, '')"],
      });

      const receivedWhere = ["1 = 1"];
      const receivedParams = [];
      applyRangeFilters(receivedWhere, receivedParams, req.query, {
        dateColumn: "grn.received_at",
        timeColumn: "grn.received_at",
        outletColumn: "grn.outlet_id",
        // received_at is TIMESTAMPTZ — UTC-bounds path (see paid_at note).
      }, tz);
      await applyProductFilters(receivedWhere, receivedParams, req.query, {
        product: "p",
        supplier: "po.supplier_id",
        searchColumns: ["p.name", "COALESCE(p.barcode, '')", "COALESCE(p.sku, '')"],
      });

      const saleRowsQ = pgify(
        `
          SELECT
            COALESCE(t.name, CASE WHEN COALESCE(t.rate, p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END) AS tax_name,
            ROUND(COALESCE(t.rate, p.gst, 0), 2) AS tax_rate,
            ROUND(COALESCE(SUM(si.quantity * si.price_at_sale), 0), 2) AS sales_inclusive,
            ROUND(
              COALESCE(
                SUM(
                  CASE
                    WHEN COALESCE(t.rate, p.gst, 0) > 0
                    THEN (si.quantity * si.price_at_sale) / (1 + (COALESCE(t.rate, p.gst, 0) / 100.0))
                    ELSE si.quantity * si.price_at_sale
                  END
                ),
                0
              ),
              2
            ) AS sales_exclusive
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          LEFT JOIN taxes t ON t.id = p.tax_id
          WHERE ${salesWhere.join(" AND ")}
          GROUP BY COALESCE(t.name, CASE WHEN COALESCE(t.rate, p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END),
                   ROUND(COALESCE(t.rate, p.gst, 0), 2)
          ORDER BY tax_rate DESC, tax_name ASC
        `,
        salesParams,
      );
      const { rows: saleRows } = await db.query(saleRowsQ.text, saleRowsQ.values);

      const orderedRowsQ = pgify(
        `
          SELECT
            COALESCE(t.name, CASE WHEN COALESCE(t.rate, p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END) AS tax_name,
            ROUND(COALESCE(t.rate, p.gst, 0), 2) AS tax_rate,
            ROUND(COALESCE(SUM(poi.quantity * poi.cost_price), 0), 2) AS ordered_purchase_value,
            ROUND(COALESCE(SUM((poi.quantity * poi.cost_price) * (COALESCE(t.rate, p.gst, 0) / 100.0)), 0), 2) AS ordered_input_tax
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          JOIN products p ON p.id = poi.product_id
          LEFT JOIN taxes t ON t.id = p.tax_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = po.id
          WHERE ${purchaseWhere.join(" AND ")}
          GROUP BY COALESCE(t.name, CASE WHEN COALESCE(t.rate, p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END),
                   ROUND(COALESCE(t.rate, p.gst, 0), 2)
          ORDER BY tax_rate DESC, tax_name ASC
        `,
        purchaseParams,
      );
      const { rows: orderedRows } = await db.query(orderedRowsQ.text, orderedRowsQ.values);

      const receivedRowsQ = pgify(
        `
          SELECT
            COALESCE(t.name, CASE WHEN COALESCE(t.rate, p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END) AS tax_name,
            ROUND(COALESCE(t.rate, p.gst, 0), 2) AS tax_rate,
            ROUND(COALESCE(SUM(gi.qty_received * gi.cost_price), 0), 2) AS received_purchase_value,
            ROUND(COALESCE(SUM((gi.qty_received * gi.cost_price) * (COALESCE(t.rate, p.gst, 0) / 100.0)), 0), 2) AS received_input_tax
          FROM grn_items gi
          JOIN goods_received_notes grn ON grn.id = gi.grn_id
          LEFT JOIN purchase_orders po ON po.id = grn.po_id
          JOIN products p ON p.id = gi.product_id
          LEFT JOIN taxes t ON t.id = p.tax_id
          WHERE ${receivedWhere.join(" AND ")}
          GROUP BY COALESCE(t.name, CASE WHEN COALESCE(t.rate, p.gst, 0) > 0 THEN 'GST' ELSE 'No Tax' END),
                   ROUND(COALESCE(t.rate, p.gst, 0), 2)
          ORDER BY tax_rate DESC, tax_name ASC
        `,
        receivedParams,
      );
      const { rows: receivedRows } = await db.query(receivedRowsQ.text, receivedRowsQ.values);

      const rollup = new Map();
      const ensure = (tax_name, tax_rate) => {
        const key = `${tax_name}__${tax_rate}`;
        if (!rollup.has(key)) {
          rollup.set(key, {
            tax_name,
            tax_rate,
            sales_inclusive: 0,
            sales_exclusive: 0,
            output_tax: 0,
            ordered_purchase_value: 0,
            ordered_input_tax: 0,
            received_purchase_value: 0,
            received_input_tax: 0,
            net_tax_payable: 0,
          });
        }
        return rollup.get(key);
      };

      saleRows.forEach((row) => {
        const bucket = ensure(row.tax_name, row.tax_rate);
        bucket.sales_inclusive = roundMoney(row.sales_inclusive);
        bucket.sales_exclusive = roundMoney(row.sales_exclusive);
        bucket.output_tax = roundMoney(
          Number(row.sales_inclusive || 0) - Number(row.sales_exclusive || 0),
        );
      });
      orderedRows.forEach((row) => {
        const bucket = ensure(row.tax_name, row.tax_rate);
        bucket.ordered_purchase_value = roundMoney(row.ordered_purchase_value);
        bucket.ordered_input_tax = roundMoney(row.ordered_input_tax);
      });
      receivedRows.forEach((row) => {
        const bucket = ensure(row.tax_name, row.tax_rate);
        bucket.received_purchase_value = roundMoney(row.received_purchase_value);
        bucket.received_input_tax = roundMoney(row.received_input_tax);
      });

      const rows = Array.from(rollup.values())
        .map((row) => ({
          ...row,
          net_tax_payable: roundMoney(
            Number(row.output_tax || 0) - Number(row.received_input_tax || 0),
          ),
        }))
        .sort((a, b) => Number(b.tax_rate || 0) - Number(a.tax_rate || 0));

      const summary = rows.reduce(
        (acc, row) => {
          acc.sales_inclusive += Number(row.sales_inclusive || 0);
          acc.sales_exclusive += Number(row.sales_exclusive || 0);
          acc.output_tax += Number(row.output_tax || 0);
          acc.ordered_purchase_value += Number(row.ordered_purchase_value || 0);
          acc.ordered_input_tax += Number(row.ordered_input_tax || 0);
          acc.received_purchase_value += Number(row.received_purchase_value || 0);
          acc.received_input_tax += Number(row.received_input_tax || 0);
          acc.net_tax_payable += Number(row.net_tax_payable || 0);
          return acc;
        },
        {
          sales_inclusive: 0,
          sales_exclusive: 0,
          output_tax: 0,
          ordered_purchase_value: 0,
          ordered_input_tax: 0,
          received_purchase_value: 0,
          received_input_tax: 0,
          net_tax_payable: 0,
        },
      );

      res.json({
        summary: Object.fromEntries(
          Object.entries(summary).map(([key, value]) => [key, roundMoney(value)]),
        ),
        rows,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
