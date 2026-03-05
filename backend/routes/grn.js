module.exports = function registerGRNRoutes(app, deps) {
  const { db, requirePerm, requireFeature, createNotification } = deps;

// --- GRN (Goods Received Notes) ---

  app.get("/api/grn", (req, res) => {
    const { date_from, date_to } = req.query;
    const where = [];
    const params = [];
    if (date_from) {
      where.push("date(g.received_at,'localtime') >= ?");
      params.push(date_from);
    }
    if (date_to) {
      where.push("date(g.received_at,'localtime') <= ?");
      params.push(date_to);
    }
    const sql = `
    SELECT g.id, g.grn_number, g.received_at, g.notes,
           ('PO-' || printf('%04d', po.id)) as po_number, s.name as supplier_name,
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
    GROUP BY g.id
    ORDER BY g.received_at DESC`;
    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ grns: rows });
    });
  });

  app.get("/api/grn/:id", (req, res) => {
    const { id } = req.params;
    db.get(
      `SELECT g.*, ('PO-' || printf('%04d', po.id)) as po_number, s.name as supplier_name, o.name as outlet_name, e.name as received_by_name
     FROM goods_received_notes g
     LEFT JOIN purchase_orders po ON g.po_id = po.id
     LEFT JOIN suppliers s ON po.supplier_id = s.id
     LEFT JOIN outlets o ON g.outlet_id = o.id
     LEFT JOIN employees e ON g.received_by = e.id
     WHERE g.id = ?`,
      [id],
      (err, grn) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!grn) return res.status(404).json({ error: "GRN not found" });
        db.all(
          `SELECT gi.*, p.name as product_name, p.barcode
         FROM grn_items gi JOIN products p ON gi.product_id = p.id
         WHERE gi.grn_id = ?`,
          [id],
          (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ grn, items });
          },
        );
      },
    );
  });

  // Delete a purchase order
  app.delete(
    "/api/purchase-orders/:id",
    requirePerm("manage_orders"),
    (req, res) => {
      const { id } = req.params;

      db.get(
        "SELECT status FROM purchase_orders WHERE id = ?",
        [id],
        (err, po) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!po) return res.status(404).json({ error: "PO not found" });
          if (po.status === "Received")
            return res
              .status(400)
              .json({ error: "Cannot delete a received PO" });

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run(
              "DELETE FROM purchase_order_items WHERE po_id = ?",
              [id],
              function (err) {
                if (err) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err.message });
                }
              },
            );
            db.run(
              "DELETE FROM purchase_orders WHERE id = ?",
              [id],
              function (err) {
                if (err) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err.message });
                }
              },
            );
            db.run("COMMIT", (err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ message: "Purchase order deleted" });
            });
          });
        },
      );
    },
  );

  // --- SUPPLIER PAYABLES ---

  // GET all supplier invoices (with supplier name, payment totals)
  app.get(
    "/api/supplier-invoices",
    requireFeature("supplier_payables"),
    (req, res) => {
      const { supplier_id, status } = req.query;
      let query = `
    SELECT si.*,
           s.name as supplier_name,
           COALESCE(SUM(sp.amount), 0) as amount_paid,
           si.amount - COALESCE(SUM(sp.amount), 0) as amount_due
    FROM supplier_invoices si
    JOIN suppliers s ON si.supplier_id = s.id
    LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
  `;
      const params = [];
      const wheres = [];
      if (supplier_id) {
        wheres.push("si.supplier_id = ?");
        params.push(supplier_id);
      }
      if (status) {
        wheres.push("si.status = ?");
        params.push(status);
      }
      if (wheres.length) query += " WHERE " + wheres.join(" AND ");
      query += " GROUP BY si.id ORDER BY si.created_at DESC";
      db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ invoices: rows });
      });
    },
  );

  // GET single supplier invoice with its payments
  app.get(
    "/api/supplier-invoices/:id",
    requireFeature("supplier_payables"),
    (req, res) => {
      const { id } = req.params;
      db.get(
        `SELECT si.*, s.name as supplier_name FROM supplier_invoices si
     JOIN suppliers s ON si.supplier_id = s.id WHERE si.id = ?`,
        [id],
        (err, inv) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!inv) return res.status(404).json({ error: "Invoice not found" });
          db.all(
            "SELECT * FROM supplier_payments WHERE supplier_invoice_id = ? ORDER BY paid_at DESC",
            [id],
            (err2, payments) => {
              if (err2) return res.status(500).json({ error: err2.message });
              res.json({ invoice: inv, payments: payments || [] });
            },
          );
        },
      );
    },
  );

  // POST record a payment against a supplier invoice
  app.post(
    "/api/supplier-invoices/:id/pay",
    requireFeature("supplier_payables"),
    (req, res) => {
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

      db.get(
        `SELECT si.*, COALESCE(SUM(sp.amount), 0) as amount_paid
     FROM supplier_invoices si
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     WHERE si.id = ?`,
        [id],
        (err, inv) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!inv) return res.status(404).json({ error: "Invoice not found" });
          if (inv.status === "paid")
            return res
              .status(400)
              .json({ error: "Invoice already fully paid" });

          const amt = parseFloat(amount);
          const remaining = inv.amount - inv.amount_paid;
          if (amt > remaining + 0.001)
            return res.status(400).json({
              error: `Payment exceeds outstanding amount (PKRs ${remaining.toFixed(2)})`,
            });

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run(
              "INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [
                id,
                inv.supplier_id,
                amt,
                payment_method,
                reference || null,
                paid_by || null,
                notes || null,
              ],
              function (err) {
                if (err) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err.message });
                }
                // Update invoice status
                const newPaid = inv.amount_paid + amt;
                const newStatus =
                  newPaid >= inv.amount - 0.001 ? "paid" : "partial";
                db.run(
                  "UPDATE supplier_invoices SET status = ? WHERE id = ?",
                  [newStatus, id],
                  (err2) => {
                    if (err2) {
                      db.run("ROLLBACK");
                      return res.status(500).json({ error: err2.message });
                    }
                    db.run("COMMIT", () => {
                      res.json({
                        message: "Payment recorded",
                        status: newStatus,
                      });
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

  // GET supplier aging summary — one row per supplier with total owed
  app.get(
    "/api/supplier-aging",
    requireFeature("supplier_payables"),
    (req, res) => {
      db.all(
        `SELECT s.id, s.name as supplier_name, s.phone,
            COUNT(DISTINCT si.id) as invoice_count,
            COALESCE(SUM(si.amount), 0) as total_invoiced,
            COALESCE(SUM(sp.amount), 0) as total_paid,
            COALESCE(SUM(si.amount), 0) - COALESCE(SUM(sp.amount), 0) as total_due
     FROM suppliers s
     LEFT JOIN supplier_invoices si ON si.supplier_id = s.id
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     GROUP BY s.id
     HAVING total_invoiced > 0
     ORDER BY total_due DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ aging: rows });
        },
      );
    },
  );

  // GET /api/supplier-ledger/:supplier_id — full chronological statement with running balance
  app.get(
    "/api/supplier-ledger/:supplier_id",
    requireFeature("supplier_payables"),
    (req, res) => {
      const { supplier_id } = req.params;
      const { from, to } = req.query || {};

      const dateWhere = [];
      const invParams = [supplier_id];
      const payParams = [supplier_id];
      if (from) {
        dateWhere.push({ inv: "date(si.created_at) >= ?", pay: "date(sp.paid_at) >= ?" });
        invParams.push(from); payParams.push(from);
      }
      if (to) {
        dateWhere.push({ inv: "date(si.created_at) <= ?", pay: "date(sp.paid_at) <= ?" });
        invParams.push(to); payParams.push(to);
      }
      const invDateSql = dateWhere.length ? " AND " + dateWhere.map((d) => d.inv).join(" AND ") : "";
      const payDateSql = dateWhere.length ? " AND " + dateWhere.map((d) => d.pay).join(" AND ") : "";

      db.get("SELECT * FROM suppliers WHERE id = ?", [supplier_id], (err, supplier) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!supplier) return res.status(404).json({ error: "Supplier not found" });

        // Merge invoices (purchases = credit/you owe more) and payments (debit/you paid)
        db.all(
          `SELECT si.created_at AS date,
                  'purchase' AS type,
                  COALESCE(si.invoice_number, 'INV-' || si.id) AS reference,
                  si.amount AS amount,
                  0 AS payment,
                  si.notes AS notes,
                  si.status AS status
           FROM supplier_invoices si
           WHERE si.supplier_id = ?${invDateSql}

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
           WHERE sp.supplier_id = ?${payDateSql}

           ORDER BY date ASC, type DESC`,
          [...invParams, ...payParams],
          (err2, rows) => {
            if (err2) return res.status(500).json({ error: err2.message });

            // Compute running balance
            let balance = 0;
            const entries = (rows || []).map((r) => {
              balance += Number(r.amount || 0) - Number(r.payment || 0);
              return { ...r, running_balance: Number(balance.toFixed(2)) };
            });

            res.json({
              supplier,
              entries,
              closing_balance: Number(balance.toFixed(2)),
            });
          },
        );
      });
    },
  );
};
