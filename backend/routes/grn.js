const { toUtcStart, toUtcEnd } = require("../utils/tz");

module.exports = function registerGRNRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature, createNotification } = deps;

// --- GRN (Goods Received Notes) ---

  app.get("/api/grn", requireAnyPerm(["manage_orders", "view_reports", "all_access"]), async (req, res) => {
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

  app.get("/api/grn/by-po/:poId", requireAnyPerm(["manage_orders", "view_reports", "all_access"]), async (req, res) => {
    try {
      const { rows: [grn] } = await db.query(
        "SELECT id, grn_number FROM goods_received_notes WHERE po_id = $1 ORDER BY id DESC LIMIT 1",
        [req.params.poId]
      );
      if (!grn) return res.status(404).json({ error: "No GRN found for this PO" });
      res.json({ grn });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/grn/:id", requireAnyPerm(["manage_orders", "view_reports", "all_access"]), async (req, res) => {
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
        `SELECT gi.*, p.name as product_name, p.barcode,
                p.serial_required, p.default_warranty_months
           FROM grn_items gi JOIN products p ON gi.product_id = p.id
          WHERE gi.grn_id = $1`,
        [id],
      );
      res.json({ grn, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Scan & Receive: increment qty_received for a GRN item by barcode ---
  app.post("/api/grn/:id/scan-receive", requirePerm("manage_orders"), async (req, res) => {
    try {
      const { id } = req.params;
      const { barcode, quantity, serial_numbers } = req.body;
      const qty = Math.max(1, parseInt(quantity, 10) || 1);

      if (!barcode || !barcode.trim()) {
        return res.status(400).json({ error: "Barcode is required" });
      }

      // 1. Verify GRN exists
      const { rows: [grn] } = await db.query(
        "SELECT id FROM goods_received_notes WHERE id = $1", [id]
      );
      if (!grn) return res.status(404).json({ error: "GRN not found" });

      // 2. Find product by barcode (products table OR product_variants table).
      // 2-G.6: also capture variant_id when the scanned barcode resolves to a
      // specific variant, so any serials we create get tagged with it.
      const trimmed = barcode.trim();
      let productId = null;
      let productName = null;
      let variantId = null;

      const { rows: [prod] } = await db.query(
        `SELECT id, name, serial_required, default_warranty_months
           FROM products
          WHERE deleted_at IS NULL AND (barcode = $1 OR sku = $1)`,
        [trimmed]
      );
      let serialRequired = false;
      let defaultWarrantyMonths = null;
      if (prod) {
        productId = prod.id;
        productName = prod.name;
        serialRequired = prod.serial_required === true;
        defaultWarrantyMonths = prod.default_warranty_months;
      } else {
        const { rows: [variant] } = await db.query(
          `SELECT pv.id AS variant_id, pv.product_id, p.name,
                  p.serial_required, p.default_warranty_months
             FROM product_variants pv
             JOIN products p ON p.id = pv.product_id
            WHERE p.deleted_at IS NULL AND pv.barcode = $1`,
          [trimmed]
        );
        if (variant) {
          productId = variant.product_id;
          productName = variant.name;
          variantId = variant.variant_id;
          serialRequired = variant.serial_required === true;
          defaultWarrantyMonths = variant.default_warranty_months;
        }
      }

      if (!productId) {
        return res.status(404).json({ error: `No product found for barcode "${trimmed}"` });
      }

      // 3. Find the matching grn_item
      const { rows: [grnItem] } = await db.query(
        "SELECT id, qty_ordered, qty_received FROM grn_items WHERE grn_id = $1 AND product_id = $2",
        [id, productId]
      );
      if (!grnItem) {
        return res.status(404).json({ error: `Product "${productName}" is not on this GRN` });
      }

      // 2-G.6: serialized products require one serial per unit at receive time.
      // Validate before mutating anything so the whole operation is atomic.
      if (serialRequired) {
        if (!Array.isArray(serial_numbers) || serial_numbers.length !== qty) {
          return res.status(400).json({
            error: `Product "${productName}" is serialized — provide exactly ${qty} serial number(s).`,
          });
        }
        const trimmedSerials = serial_numbers.map((s) => String(s || "").trim()).filter(Boolean);
        if (trimmedSerials.length !== qty) {
          return res.status(400).json({ error: "Serial numbers cannot be blank." });
        }
        // Check for duplicates within this batch.
        if (new Set(trimmedSerials).size !== trimmedSerials.length) {
          return res.status(400).json({ error: "Duplicate serial numbers in this batch." });
        }
        // Check for collisions with existing serials for this product.
        const { rows: existing } = await db.query(
          `SELECT serial_number FROM product_serial_numbers
             WHERE product_id = $1 AND serial_number = ANY($2::text[])`,
          [productId, trimmedSerials]
        );
        if (existing.length > 0) {
          return res.status(409).json({
            error: `Serial(s) already exist for this product: ${existing.map((r) => r.serial_number).join(", ")}`,
          });
        }
      }

      await db.transaction(async (client) => {
        // 4. Increment qty_received
        const newReceived = Number(grnItem.qty_received || 0) + qty;
        await client.query(
          "UPDATE grn_items SET qty_received = $1 WHERE id = $2",
          [newReceived, grnItem.id]
        );

        // 2-G.6: insert one product_serial_numbers row per serial. Status
        // starts 'available' — warranty_start_date is NULL until the serial
        // is sold. warranty_months pre-fills from the product default so the
        // computed warranty_end_date is a simple start + warranty_months at
        // sale time with no extra lookup.
        if (serialRequired) {
          for (const sn of serial_numbers) {
            await client.query(
              `INSERT INTO product_serial_numbers
                 (product_id, variant_id, serial_number, status, grn_id, warranty_months)
               VALUES ($1, $2, $3, 'available', $4, $5)`,
              [productId, variantId || null, String(sn).trim(), id, defaultWarrantyMonths]
            );
          }
        }
      });

      const newReceivedOut = Number(grnItem.qty_received || 0) + qty;
      const overReceived = newReceivedOut > Number(grnItem.qty_ordered);

      res.json({
        item: {
          grn_item_id: grnItem.id,
          product_id: productId,
          product_name: productName,
          qty_ordered: Number(grnItem.qty_ordered),
          qty_received: newReceivedOut,
          over_received: overReceived,
          serialized: serialRequired,
          serials_recorded: serialRequired ? serial_numbers.length : 0,
        },
      });
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
    requireAnyPerm(["manage_orders", "view_reports", "all_access"]),
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
    requireAnyPerm(["manage_orders", "view_reports", "all_access"]),
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
    requireAnyPerm(["manage_orders", "view_reports", "all_access"]),
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
            "UPDATE supplier_payments SET voided = true, void_reason = $1 WHERE id = $2",
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
                    COALESCE(SUM(CASE WHEN sp.voided = false OR sp.voided IS NULL THEN sp.amount ELSE 0 END), 0) AS total_paid
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
  // Includes: supplier invoices (debit), GRN receipts (info), supplier payments (credit), supplier returns (credit)
  app.get(
    "/api/supplier-ledger/:supplier_id",
    requireAnyPerm(["manage_orders", "view_reports", "all_access"]),
    requireFeature("supplier_payables"),
    async (req, res) => {
      try {
        const { supplier_id } = req.params;
        const { from, to } = req.query || {};
        const tz = req.company?.timezone || "Asia/Karachi";

        const { rows: [supplier] } = await db.query(
          "SELECT * FROM suppliers WHERE id = $1",
          [supplier_id],
        );
        if (!supplier) return res.status(404).json({ error: "Supplier not found" });

        const { page: pageParam = 0 } = req.query;
        const page = Math.max(0, parseInt(pageParam, 10) || 0);
        const PAGE_SIZE = 50;

        // Each UNION branch uses $1 = supplier_id; date filters share $2/$3
        const baseParams = [supplier_id];
        let dateSql = "";
        if (from) {
          baseParams.push(toUtcStart(from, tz));
          dateSql += ` AND __COL__ >= $${baseParams.length}`;
        }
        if (to) {
          baseParams.push(toUtcEnd(to, tz));
          dateSql += ` AND __COL__ <= $${baseParams.length}`;
        }

        const invDate = dateSql.replace(/__COL__/g, "si.created_at");
        const payDate = dateSql.replace(/__COL__/g, "sp.paid_at");
        const grnDate = dateSql.replace(/__COL__/g, "g.received_at");
        const retDate = dateSql.replace(/__COL__/g, "sr.return_date");

        const unionSql = `
          -- Supplier invoices (debit — we owe them)
          SELECT si.created_at AS date,
                 'invoice' AS type,
                 COALESCE(si.invoice_number, 'INV-' || si.id) AS reference,
                 si.amount AS debit,
                 0 AS credit,
                 si.notes AS notes
          FROM supplier_invoices si
          WHERE si.supplier_id = $1${invDate}

          UNION ALL

          -- GRN receipts (informational — goods received)
          SELECT g.received_at AS date,
                 'grn' AS type,
                 g.grn_number AS reference,
                 0 AS debit,
                 0 AS credit,
                 g.notes AS notes
          FROM goods_received_notes g
          JOIN purchase_orders po ON po.id = g.po_id
          WHERE po.supplier_id = $1${grnDate}

          UNION ALL

          -- Payments (credit — we paid them)
          SELECT sp.paid_at AS date,
                 'payment' AS type,
                 COALESCE(si2.invoice_number, 'PAY-' || sp.id) AS reference,
                 0 AS debit,
                 sp.amount AS credit,
                 COALESCE(sp.notes, sp.payment_method) AS notes
          FROM supplier_payments sp
          LEFT JOIN supplier_invoices si2 ON si2.id = sp.supplier_invoice_id
          WHERE sp.supplier_id = $1 AND (sp.voided IS NOT TRUE)${payDate}

          UNION ALL

          -- Supplier returns (credit — reduces what we owe)
          SELECT sr.return_date AS date,
                 'return' AS type,
                 COALESCE(sr.reference_number, 'RET-' || sr.id) AS reference,
                 0 AS debit,
                 sr.total_value AS credit,
                 sr.reason AS notes
          FROM supplier_returns sr
          WHERE sr.supplier_id = $1${retDate}`;

        // Count total
        const { rows: [countRow] } = await db.query(
          `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`,
          baseParams,
        );
        const total_count = Number(countRow?.total || 0);
        const total_pages = Math.ceil(total_count / PAGE_SIZE);

        // Fetch with window-function running balance so pagination is correct
        const limitIdx = baseParams.length + 1;
        const offsetIdx = baseParams.length + 2;
        const { rows } = await db.query(
          `SELECT *,
                  SUM(debit - credit) OVER (ORDER BY date ASC, type ASC) AS running_balance
           FROM (${unionSql}) AS combined
           ORDER BY date DESC, type ASC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...baseParams, PAGE_SIZE, page * PAGE_SIZE],
        );

        const entries = (rows || []).map((r) => ({
          ...r,
          debit: Number(r.debit || 0),
          credit: Number(r.credit || 0),
          running_balance: Number(Number(r.running_balance || 0).toFixed(2)),
        }));

        // Closing balance = total across all entries (not just this page)
        const { rows: [balRow] } = await db.query(
          `SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM (${unionSql}) AS combined`,
          baseParams,
        );
        const closing_balance = Number(Number(balRow?.balance || 0).toFixed(2));

        res.json({
          supplier,
          entries,
          closing_balance,
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
