const { toUtcStart, toUtcEnd } = require("../utils/tz");

module.exports = function registerGRNRoutes(app, deps) {
  const { db, requirePerm, requireFeature, createNotification } = deps;

// --- GRN (Goods Received Notes) ---

  app.get("/api/grn", async (req, res) => {
    try {
      const { date_from, date_to } = req.query;
      const where = [];
      const params = [];
      let idx = 1;
      if (date_from) {
        where.push(`date(g.received_at) >= $${idx++}`);
        params.push(date_from);
      }
      if (date_to) {
        where.push(`date(g.received_at) <= $${idx++}`);
        params.push(date_to);
      }
      const sql = `
    SELECT g.id, g.grn_number, g.received_at, g.notes,
           ('PO-' || LPAD(po.id::text, 4, '0')) as po_number, s.name as supplier_name,
           o.name as outlet_name,
           e.name as received_by_name,
           COUNT(gi.id) as line_count
    FROM goods_received_notes g
    LEFT JOIN purchase_orders po ON g.po_id = po.id
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    LEFT JOIN outlets o ON g.outlet_id = o.id
    LEFT JOIN employees e ON g.received_by = e.id
    LEFT JOIN grn_items gi ON g.id = gi.grn_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY g.id, g.grn_number, g.received_at, g.notes, po.id, s.name, o.name, e.name
    ORDER BY g.received_at DESC`;
      const { rows } = await db.query(sql, params);
      res.json({ grns: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/grn/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [grn] } = await db.query(
        `SELECT g.*, ('PO-' || LPAD(po.id::text, 4, '0')) as po_number, s.name as supplier_name, o.name as outlet_name, e.name as received_by_name
     FROM goods_received_notes g
     LEFT JOIN purchase_orders po ON g.po_id = po.id
     LEFT JOIN suppliers s ON po.supplier_id = s.id
     LEFT JOIN outlets o ON g.outlet_id = o.id
     LEFT JOIN employees e ON g.received_by = e.id
     WHERE g.id = $1`,
        [id],
      );
      if (!grn) return res.status(404).json({ error: "GRN not found" });
      const { rows: items } = await db.query(
        `SELECT gi.*, p.name as product_name, p.barcode
       FROM grn_items gi JOIN products p ON gi.product_id = p.id
       WHERE gi.grn_id = $1`,
        [id],
      );
      res.json({ grn, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a purchase order
  app.delete(
    "/api/purchase-orders/:id",
    requirePerm("manage_orders"),
    async (req, res) => {
      try {
        const { id } = req.params;

        const { rows: [po] } = await db.query(
          "SELECT status FROM purchase_orders WHERE id = $1",
          [id],
        );
        if (!po) return res.status(404).json({ error: "PO not found" });
        if (po.status === "Received")
          return res
            .status(400)
            .json({ error: "Cannot delete a received PO" });

        await db.transaction(async (client) => {
          await client.query(
            "DELETE FROM purchase_order_items WHERE po_id = $1",
            [id],
          );
          await client.query(
            "DELETE FROM purchase_orders WHERE id = $1",
            [id],
          );
        });
        res.json({ message: "Purchase order deleted" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // --- SUPPLIER PAYABLES ---

  // GET all supplier invoices (with supplier name, payment totals)
  app.get(
    "/api/supplier-invoices",
    requireFeature("supplier_payables"),
    async (req, res) => {
      try {
        const { supplier_id, status } = req.query;
        let idx = 1;
        const params = [];
        const wheres = [];
        if (supplier_id) {
          wheres.push(`si.supplier_id = $${idx++}`);
          params.push(supplier_id);
        }
        if (status) {
          wheres.push(`si.status = $${idx++}`);
          params.push(status);
        }
        const whereSql = wheres.length ? " WHERE " + wheres.join(" AND ") : "";
        const query = `
    SELECT si.*,
           s.name as supplier_name,
           COALESCE(SUM(sp.amount), 0) as amount_paid,
           si.amount - COALESCE(SUM(sp.amount), 0) as amount_due
    FROM supplier_invoices si
    JOIN suppliers s ON si.supplier_id = s.id
    LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
    ${whereSql}
    GROUP BY si.id, s.name
    ORDER BY si.created_at DESC`;
        const { rows } = await db.query(query, params);
        res.json({ invoices: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET single supplier invoice with its payments
  app.get(
    "/api/supplier-invoices/:id",
    requireFeature("supplier_payables"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows: [inv] } = await db.query(
          `SELECT si.*, s.name as supplier_name FROM supplier_invoices si
     JOIN suppliers s ON si.supplier_id = s.id WHERE si.id = $1`,
          [id],
        );
        if (!inv) return res.status(404).json({ error: "Invoice not found" });
        const { rows: payments } = await db.query(
          "SELECT * FROM supplier_payments WHERE supplier_invoice_id = $1 ORDER BY paid_at DESC",
          [id],
        );
        res.json({ invoice: inv, payments: payments || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST record a payment against a supplier invoice
  app.post(
    "/api/supplier-invoices/:id/pay",
    requireFeature("supplier_payables"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const {
          amount,
          payment_method = "Cash",
          reference,
          paid_by,
          notes,
        } = req.body;
        if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
          return res.status(400).json({ error: "Valid amount is required" });

        const { rows: [inv] } = await db.query(
          `SELECT si.*, COALESCE(SUM(sp.amount), 0) as amount_paid
     FROM supplier_invoices si
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     WHERE si.id = $1
     GROUP BY si.id`,
          [id],
        );
        if (!inv) return res.status(404).json({ error: "Invoice not found" });
        if (inv.status === "paid")
          return res
            .status(400)
            .json({ error: "Invoice already fully paid" });

        const amt = parseFloat(amount);
        const remaining = inv.amount - inv.amount_paid;
        if (amt > remaining + 0.001)
          return res.status(400).json({
            error: `Payment exceeds outstanding amount (${req.company?.currency_symbol || "$"} ${remaining.toFixed(2)})`,
          });

        await db.transaction(async (client) => {
          await client.query(
            "INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [
              id,
              inv.supplier_id,
              amt,
              payment_method,
              reference || null,
              paid_by || null,
              notes || null,
            ],
          );
          // Update invoice status
          const newPaid = inv.amount_paid + amt;
          const newStatus =
            newPaid >= inv.amount - 0.001 ? "paid" : "partial";
          await client.query(
            "UPDATE supplier_invoices SET status = $1 WHERE id = $2",
            [newStatus, id],
          );
          res.json({
            message: "Payment recorded",
            status: newStatus,
          });
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET supplier aging summary — one row per supplier with total owed
  app.get(
    "/api/supplier-aging",
    requireFeature("supplier_payables"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT s.id, s.name as supplier_name, s.phone,
            COUNT(DISTINCT si.id) as invoice_count,
            COALESCE(SUM(si.amount), 0) as total_invoiced,
            COALESCE(SUM(sp.amount), 0) as total_paid,
            COALESCE(SUM(si.amount), 0) - COALESCE(SUM(sp.amount), 0) as total_due
     FROM suppliers s
     LEFT JOIN supplier_invoices si ON si.supplier_id = s.id
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     GROUP BY s.id, s.name, s.phone
     HAVING COALESCE(SUM(si.amount), 0) > 0
     ORDER BY COALESCE(SUM(si.amount), 0) - COALESCE(SUM(sp.amount), 0) DESC`,
          [],
        );
        res.json({ aging: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST void a supplier payment
  app.post(
    "/api/supplier-payments/:id/void",
    requirePerm("all_access"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { reason } = req.body || {};

        const { rows: [payment] } = await db.query(
          "SELECT * FROM supplier_payments WHERE id = $1",
          [id],
        );
        if (!payment) return res.status(404).json({ error: "Payment not found" });
        if (payment.voided) return res.status(400).json({ error: "Payment is already voided" });

        let newStatus;
        await db.transaction(async (client) => {
          await client.query(
            "UPDATE supplier_payments SET voided = 1, void_reason = $1 WHERE id = $2",
            [reason || null, id],
          );

          // Reverse the effect on the invoice: reduce amount_paid
          await client.query(
            "UPDATE supplier_invoices SET amount_paid = GREATEST(0, COALESCE(amount_paid, 0) - $1) WHERE id = $2",
            [Number(payment.amount), payment.supplier_invoice_id],
          );

          // Recalculate invoice status based on new payment totals
          const { rows: [row] } = await client.query(
            `SELECT si.amount,
                    COALESCE(SUM(CASE WHEN sp.voided = 0 OR sp.voided IS NULL THEN sp.amount ELSE 0 END), 0) AS total_paid
             FROM supplier_invoices si
             LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
             WHERE si.id = $1
             GROUP BY si.id, si.amount`,
            [payment.supplier_invoice_id],
          );
          const totalPaid = Number(row?.total_paid || 0);
          const invoiceAmount = Number(row?.amount || 0);
          newStatus = totalPaid <= 0 ? "unpaid" : totalPaid >= invoiceAmount - 0.001 ? "paid" : "partial";

          await client.query(
            "UPDATE supplier_invoices SET status = $1 WHERE id = $2",
            [newStatus, payment.supplier_invoice_id],
          );
        });

        res.json({ message: "Payment voided successfully", new_invoice_status: newStatus });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET /api/supplier-ledger/:supplier_id — full chronological statement with running balance
  app.get(
    "/api/supplier-ledger/:supplier_id",
    requireFeature("supplier_payables"),
    async (req, res) => {
      try {
        const { supplier_id } = req.params;
        const { from, to } = req.query || {};

        const dateWhere = [];
        const invParams = [supplier_id];
        const payParams = [supplier_id];
        let invIdx = 2;
        let payIdx = 2;
        if (from) {
          dateWhere.push({ inv: `date(si.created_at) >= $INV_IDX`, pay: `date(sp.paid_at) >= $PAY_IDX` });
          invParams.push(from); payParams.push(from);
          invIdx++; payIdx++;
        }
        if (to) {
          dateWhere.push({ inv: `date(si.created_at) <= $INV_IDX`, pay: `date(sp.paid_at) <= $PAY_IDX` });
          invParams.push(to); payParams.push(to);
          invIdx++; payIdx++;
        }

        // Build date filter SQL with correct numbered placeholders
        let invDateSql = "";
        let payDateSql = "";
        if (dateWhere.length) {
          let invI = 2;
          let payI = 2;
          const invParts = [];
          const payParts = [];
          for (const d of dateWhere) {
            invParts.push(d.inv.replace("$INV_IDX", `$${invI++}`));
            payParts.push(d.pay.replace("$PAY_IDX", `$${payI++}`));
          }
          invDateSql = " AND " + invParts.join(" AND ");
          payDateSql = " AND " + payParts.join(" AND ");
        }

        const { rows: [supplier] } = await db.query(
          "SELECT * FROM suppliers WHERE id = $1",
          [supplier_id],
        );
        if (!supplier) return res.status(404).json({ error: "Supplier not found" });

        const { page: pageParam = 0 } = req.query;
        const page = Math.max(0, parseInt(pageParam, 10) || 0);
        const PAGE_SIZE = 50;

        // For the UNION ALL query, the second half needs re-numbered params
        // We'll build a single combined params array with correct numbering
        const allCountParams = [...invParams, ...payParams];
        const payOffset = invParams.length;

        // Build the pay side with offset param numbers
        let payDateSqlNumbered = "";
        if (dateWhere.length) {
          let payI = payOffset + 2;
          const payParts = [];
          for (const d of dateWhere) {
            payParts.push(d.pay.replace("$PAY_IDX", `$${payI++}`));
          }
          payDateSqlNumbered = " AND " + payParts.join(" AND ");
        }

        // Build inv side with original numbering
        let invDateSqlNumbered = invDateSql;

        const unionSql = `
          SELECT si.created_at AS date,
                  'purchase' AS type,
                  COALESCE(si.invoice_number, 'INV-' || si.id) AS reference,
                  si.amount AS amount,
                  0 AS payment,
                  si.notes AS notes,
                  si.status AS status
           FROM supplier_invoices si
           WHERE si.supplier_id = $1${invDateSqlNumbered}

           UNION ALL

           SELECT sp.paid_at AS date,
                  'payment' AS type,
                  COALESCE(si2.invoice_number, 'INV-' || sp.supplier_invoice_id) AS reference,
                  0 AS amount,
                  sp.amount AS payment,
                  COALESCE(sp.notes, sp.payment_method) AS notes,
                  NULL AS status
           FROM supplier_payments sp
           LEFT JOIN supplier_invoices si2 ON si2.id = sp.supplier_invoice_id
           WHERE sp.supplier_id = $${payOffset + 1}${payDateSqlNumbered}`;

        // Count total rows first
        const { rows: [countRow] } = await db.query(
          `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`,
          allCountParams,
        );
        const total_count = Number(countRow?.total || 0);
        const total_pages = Math.ceil(total_count / PAGE_SIZE);

        // Fetch paginated rows
        const limitIdx = allCountParams.length + 1;
        const offsetIdx = allCountParams.length + 2;
        const { rows } = await db.query(
          `${unionSql} ORDER BY date ASC, type DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...allCountParams, PAGE_SIZE, page * PAGE_SIZE],
        );

        // Compute running balance for this page's rows
        let balance = 0;
        const entries = (rows || []).map((r) => {
          balance += Number(r.amount || 0) - Number(r.payment || 0);
          return { ...r, running_balance: Number(balance.toFixed(2)) };
        });

        res.json({
          supplier,
          entries,
          closing_balance: Number(balance.toFixed(2)),
          total_count,
          page,
          total_pages,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
