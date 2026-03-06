const { toUtcStart, toUtcEnd } = require("../../utils/tz");

module.exports = function registerFinanceReports(app, deps, helpers) {
  const { db } = deps;
  const { getDescendantLeafIds } = helpers || {};

  const allAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

  const getAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });

  function applyRangeFilters(where, params, query, opts = {}, tz = "UTC") {
    const {
      dateColumn,
      timeColumn,
      outletColumn,
      supplierColumn,
      searchSql,
      searchParams,
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

    if (date_from && dateColumn) {
      where.push(`${dateColumn} >= ?`);
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to && dateColumn) {
      where.push(`${dateColumn} < ?`);
      params.push(toUtcEnd(date_to, tz));
    }
    if (time_from && timeColumn) {
      where.push(`time(${timeColumn}, 'localtime') >= time(?)`);
      params.push(time_from);
    }
    if (time_to && timeColumn) {
      where.push(`time(${timeColumn}, 'localtime') <= time(?)`);
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
      where.push(`(${searchColumns.map((col) => `${col} LIKE ?`).join(" OR ")})`);
      searchColumns.forEach(() => params.push(`%${search}%`));
    }
  }

  app.get("/api/reports/settlement-overview", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const salesWhere = ["s.voided = 0"];
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
      }, tz);

      const supplierPaymentWhere = ["1 = 1"];
      const supplierPaymentParams = [];
      applyRangeFilters(supplierPaymentWhere, supplierPaymentParams, req.query, {
        dateColumn: "sp.paid_at",
        timeColumn: "sp.paid_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name LIKE ? OR COALESCE(si.invoice_number, '') LIKE ? OR COALESCE(sp.reference, '') LIKE ?)",
        searchParams: [1, 1, 1],
      }, tz);

      const invoiceWhere = ["1 = 1"];
      const invoiceParams = [];
      applyRangeFilters(invoiceWhere, invoiceParams, req.query, {
        dateColumn: "si.created_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name LIKE ? OR COALESCE(si.invoice_number, '') LIKE ?)",
        searchParams: [1, 1],
      }, tz);

      const customerWhere = ["COALESCE(c.balance, 0) <> 0"];
      const customerParams = [];
      if (req.query.search) {
        customerWhere.push(
          "(c.name LIKE ? OR COALESCE(c.mobile, '') LIKE ? OR CAST(c.id AS TEXT) LIKE ?)",
        );
        customerParams.push(
          `%${req.query.search}%`,
          `%${req.query.search}%`,
          `%${req.query.search}%`,
        );
      }

      const paymentMix = await allAsync(
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

      const inflowRow = await getAsync(
        `
          SELECT ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total_inflows
          FROM sales s
          JOIN sale_payments sp ON sp.sale_id = s.id
          WHERE ${salesWhere.join(" AND ")}
        `,
        salesParams,
      );

      const expenseRow = await getAsync(
        `
          SELECT ROUND(COALESCE(SUM(e.amount), 0), 2) AS expenses
          FROM expenses e
          WHERE ${expenseWhere.join(" AND ")}
        `,
        expenseParams,
      );

      const supplierPaymentRow = await getAsync(
        `
          SELECT ROUND(COALESCE(SUM(sp.amount), 0), 2) AS supplier_payments
          FROM supplier_payments sp
          JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
          JOIN suppliers s ON s.id = si.supplier_id
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

      const invoiceRows = await allAsync(
        `
          SELECT
            si.id,
            s.name AS supplier_name,
            COALESCE(si.invoice_number, 'INV-' || printf('%04d', si.id)) AS invoice_number,
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
          ORDER BY outstanding DESC, date(COALESCE(si.due_date, si.created_at)) ASC
          LIMIT 10
        `,
        invoiceParams,
      );

      const supplierAging = await allAsync(
        `
          SELECT
            s.id,
            s.name AS supplier_name,
            COUNT(DISTINCT si.id) AS invoice_count,
            ROUND(COALESCE(SUM(si.amount), 0), 2) AS total_invoiced,
            ROUND(COALESCE(SUM(pay.paid_amount), 0), 2) AS total_paid,
            ROUND(COALESCE(SUM(si.amount), 0) - COALESCE(SUM(pay.paid_amount), 0), 2) AS total_due
          FROM suppliers s
          LEFT JOIN supplier_invoices si ON si.supplier_id = s.id
          LEFT JOIN (
            SELECT supplier_invoice_id, SUM(amount) AS paid_amount
            FROM supplier_payments
            GROUP BY supplier_invoice_id
          ) pay ON pay.supplier_invoice_id = si.id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          WHERE ${invoiceWhere.join(" AND ")}
          GROUP BY s.id
          HAVING total_invoiced > 0
          ORDER BY total_due DESC
          LIMIT 8
        `,
        invoiceParams,
      );

      const recentSupplierPayments = await allAsync(
        `
          SELECT
            sp.id,
            sp.paid_at,
            sp.amount,
            sp.payment_method,
            sp.reference,
            s.name AS supplier_name,
            COALESCE(si.invoice_number, 'INV-' || printf('%04d', si.id)) AS invoice_number,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name
          FROM supplier_payments sp
          JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
          JOIN suppliers s ON s.id = si.supplier_id
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

      const customerAr = await allAsync(
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

  app.get("/api/reports/payables-receivables", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const supplierWhere = ["1 = 1"];
      const supplierParams = [];
      applyRangeFilters(supplierWhere, supplierParams, req.query, {
        dateColumn: "si.created_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name LIKE ? OR COALESCE(si.invoice_number, '') LIKE ?)",
        searchParams: [1, 1],
      }, tz);

      const customerWhere = ["COALESCE(c.balance, 0) <> 0"];
      const customerParams = [];
      if (req.query.search) {
        customerWhere.push(
          "(c.name LIKE ? OR COALESCE(c.mobile, '') LIKE ? OR CAST(c.id AS TEXT) LIKE ?)",
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

      const supplierAp = await allAsync(
        `
          SELECT
            si.id,
            COALESCE(si.invoice_number, 'INV-' || printf('%04d', si.id)) AS invoice_number,
            si.created_at AS invoice_date,
            si.due_date,
            si.amount,
            COALESCE(pay.paid_amount, 0) AS paid_amount,
            ROUND(COALESCE(si.amount, 0) - COALESCE(pay.paid_amount, 0), 2) AS outstanding,
            si.status,
            s.name AS supplier_name,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name,
            CAST(
              MAX(
                0,
                julianday('now', 'localtime') -
                  julianday(COALESCE(si.due_date, si.created_at))
              ) AS INTEGER
            ) AS days_open
          FROM supplier_invoices si
          LEFT JOIN suppliers s ON s.id = si.supplier_id
          LEFT JOIN (
            SELECT supplier_invoice_id, SUM(amount) AS paid_amount
            FROM supplier_payments
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

      const customerAr = await allAsync(
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
            AND s.voided = 0
            ${customerSalesJoin.length ? `AND ${customerSalesJoin.join(" AND ")}` : ""}
          WHERE ${customerWhere.join(" AND ")}
          GROUP BY c.id, c.name, c.mobile, c.balance
          ORDER BY ABS(COALESCE(c.balance, 0)) DESC, c.name ASC
        `,
        [...customerSalesParams, ...customerParams],
      );

      const summary = {
        supplier_invoice_count: supplierAp.length,
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

  app.get("/api/reports/supplier-payments-invoices", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const invoiceWhere = ["1 = 1"];
      const invoiceParams = [];
      applyRangeFilters(invoiceWhere, invoiceParams, req.query, {
        dateColumn: "si.created_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name LIKE ? OR COALESCE(si.invoice_number, '') LIKE ?)",
        searchParams: [1, 1],
      }, tz);

      const paymentWhere = ["1 = 1"];
      const paymentParams = [];
      applyRangeFilters(paymentWhere, paymentParams, req.query, {
        dateColumn: "sp.paid_at",
        timeColumn: "sp.paid_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
        searchSql:
          "(s.name LIKE ? OR COALESCE(si.invoice_number, '') LIKE ? OR COALESCE(sp.reference, '') LIKE ?)",
        searchParams: [1, 1, 1],
      }, tz);

      if (req.query.status === "open") {
        invoiceWhere.push("si.status <> 'paid'");
      } else if (req.query.status) {
        invoiceWhere.push("si.status = ?");
        invoiceParams.push(req.query.status);
      }

      const aging = await allAsync(
        `
          SELECT
            s.id,
            s.name AS supplier_name,
            s.phone,
            COUNT(DISTINCT si.id) AS invoice_count,
            ROUND(COALESCE(SUM(si.amount), 0), 2) AS total_invoiced,
            ROUND(COALESCE(SUM(pay.paid_amount), 0), 2) AS total_paid,
            ROUND(COALESCE(SUM(si.amount), 0) - COALESCE(SUM(pay.paid_amount), 0), 2) AS total_due
          FROM suppliers s
          LEFT JOIN supplier_invoices si ON si.supplier_id = s.id
          LEFT JOIN (
            SELECT supplier_invoice_id, SUM(amount) AS paid_amount
            FROM supplier_payments
            GROUP BY supplier_invoice_id
          ) pay ON pay.supplier_invoice_id = si.id
          LEFT JOIN goods_received_notes grn_direct ON grn_direct.id = si.grn_id
          LEFT JOIN (
            SELECT po_id, MIN(outlet_id) AS outlet_id
            FROM goods_received_notes
            GROUP BY po_id
          ) grn_po ON grn_po.po_id = si.po_id
          WHERE ${invoiceWhere.join(" AND ")}
          GROUP BY s.id
          HAVING total_invoiced > 0
          ORDER BY total_due DESC, supplier_name ASC
        `,
        invoiceParams,
      );

      const invoices = await allAsync(
        `
          SELECT
            si.id,
            COALESCE(si.invoice_number, 'INV-' || printf('%04d', si.id)) AS invoice_number,
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
          ORDER BY date(COALESCE(si.due_date, si.created_at)) ASC, si.id DESC
        `,
        invoiceParams,
      );

      const payments = await allAsync(
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
            COALESCE(si.invoice_number, 'INV-' || printf('%04d', si.id)) AS invoice_number,
            COALESCE(od.name, op.name, 'Unassigned') AS outlet_name
          FROM supplier_payments sp
          JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
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

  app.get("/api/reports/finance-payment-mix", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const salesWhere = ["s.voided = 0"];
      const salesParams = [];
      applyRangeFilters(salesWhere, salesParams, req.query, {
        dateColumn: "s.timestamp",
        timeColumn: "s.timestamp",
        outletColumn: "s.outlet_id",
      }, tz);

      const supplierPaymentWhere = ["1 = 1"];
      const supplierPaymentParams = [];
      applyRangeFilters(supplierPaymentWhere, supplierPaymentParams, req.query, {
        dateColumn: "sp.paid_at",
        timeColumn: "sp.paid_at",
        outletColumn: "COALESCE(grn_direct.outlet_id, grn_po.outlet_id)",
        supplierColumn: "si.supplier_id",
      }, tz);

      const saleMix = await allAsync(
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

      const dailyInflows = await allAsync(
        `
          SELECT
            date(s.timestamp, 'localtime') AS business_date,
            ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total,
            COUNT(DISTINCT s.id) AS sale_count
          FROM sales s
          JOIN sale_payments sp ON sp.sale_id = s.id
          WHERE ${salesWhere.join(" AND ")}
          GROUP BY date(s.timestamp, 'localtime')
          ORDER BY business_date DESC
        `,
        salesParams,
      );

      const supplierPaymentMix = await allAsync(
        `
          SELECT
            COALESCE(sp.payment_method, 'Unknown') AS payment_method,
            ROUND(COALESCE(SUM(sp.amount), 0), 2) AS total,
            COUNT(*) AS payment_count
          FROM supplier_payments sp
          JOIN supplier_invoices si ON si.id = sp.supplier_invoice_id
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

  app.get("/api/reports/gst-output", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const where = ["s.voided = 0", "si.quantity > 0"];
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
          "CAST(s.id AS TEXT)",
        ],
      });

      const taxMode = String(req.query.tax_mode || "gst");
      if (taxMode === "gst") {
        where.push("COALESCE(t.rate, p.gst, 0) > 0");
      } else if (taxMode === "no_tax") {
        where.push("COALESCE(t.rate, p.gst, 0) <= 0");
      }

      const rows = await allAsync(
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

  app.get("/api/reports/gst-type-summary", async (req, res) => {
    try {
      const tz = req.company?.timezone || "UTC";
      const salesWhere = ["s.voided = 0", "si.quantity > 0"];
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
      }, tz);
      await applyProductFilters(receivedWhere, receivedParams, req.query, {
        product: "p",
        supplier: "po.supplier_id",
        searchColumns: ["p.name", "COALESCE(p.barcode, '')", "COALESCE(p.sku, '')"],
      });

      const saleRows = await allAsync(
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
          GROUP BY tax_name, tax_rate
          ORDER BY tax_rate DESC, tax_name ASC
        `,
        salesParams,
      );

      const orderedRows = await allAsync(
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
          GROUP BY tax_name, tax_rate
          ORDER BY tax_rate DESC, tax_name ASC
        `,
        purchaseParams,
      );

      const receivedRows = await allAsync(
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
          GROUP BY tax_name, tax_rate
          ORDER BY tax_rate DESC, tax_name ASC
        `,
        receivedParams,
      );

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
