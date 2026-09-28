const { toUtcStart, toUtcEnd } = require("../utils/tz");
const { SUPPLIER_TOTALS_SQL } = require("../services/supplier-balance");

module.exports = function registerGRNRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature, createNotification } = deps;

// --- GRN (Goods Received Notes) ---

  app.get("/api/grn", requireAnyPerm(["manage_orders", "view_inventory_reports", "all_access"]), async (req, res) => {
    try {
      const { date_from, date_to } = req.query;
      const where = [];
      const params = [];
      let idx = 1;
      // received_at is TIMESTAMPTZ — date(...) evaluates in the DB session
      // timezone; filter with tenant-tz UTC bounds instead (same as the
      // supplier-ledger route below).
      if (date_from) {
        where.push(`g.received_at >= $${idx++}`);
        params.push(toUtcStart(String(date_from), req.company?.timezone));
      }
      if (date_to) {
        where.push(`g.received_at < $${idx++}`);
        params.push(toUtcEnd(String(date_to), req.company?.timezone));
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

  app.get("/api/grn/by-po/:poId", requireAnyPerm(["manage_orders", "view_inventory_reports", "all_access"]), async (req, res) => {
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

  app.get("/api/grn/:id", requireAnyPerm(["manage_orders", "view_inventory_reports", "all_access"]), async (req, res) => {
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
      const { barcode, quantity, serial_numbers, product_id } = req.body;
      const qty = Math.max(1, parseInt(quantity, 10) || 1);
      const nameQuery = String(req.body.name || req.body.query || "").trim();
      const hasBarcode = !!(barcode && barcode.trim());

      // WS4: accept a barcode, an explicit product_id (a confirmed name-match
      // pick), or a name/query to fuzzy-match against this GRN's lines.
      if (!hasBarcode && !product_id && !nameQuery) {
        return res.status(400).json({ error: "Provide a barcode, a product name, or select a product" });
      }

      // 1. Verify GRN exists
      const { rows: [grn] } = await db.query(
        "SELECT id FROM goods_received_notes WHERE id = $1", [id]
      );
      if (!grn) return res.status(404).json({ error: "GRN not found" });

      // 2. Resolve the product. Priority: confirmed product_id → barcode/sku/
      // variant scan → fuzzy name-match (returns candidates for confirmation).
      let productId = null;
      let productName = null;
      let variantId = null;
      let serialRequired = false;
      let defaultWarrantyMonths = null;

      if (product_id) {
        const { rows: [prod] } = await db.query(
          `SELECT id, name, serial_required, default_warranty_months
             FROM products WHERE id = $1 AND deleted_at IS NULL`,
          [product_id]
        );
        if (!prod) {
          return res.status(404).json({ error: "Selected product not found" });
        }
        productId = prod.id;
        productName = prod.name;
        serialRequired = prod.serial_required === true;
        defaultWarrantyMonths = prod.default_warranty_months;
      } else if (hasBarcode) {
        // 2-G.6: also capture variant_id when the scanned barcode resolves to a
        // specific variant, so any serials we create get tagged with it.
        const trimmed = barcode.trim();
        const { rows: [prod] } = await db.query(
          `SELECT id, name, serial_required, default_warranty_months
             FROM products
            WHERE deleted_at IS NULL AND (barcode = $1 OR sku = $1)`,
          [trimmed]
        );
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
      } else {
        // WS4 name-match fallback — a supplier line with no barcode. Fuzzy-match
        // by name against the products actually on this GRN and return the top
        // candidates for the operator to confirm (never auto-receive a guess).
        try {
          const { rows: cands } = await db.query(
            `SELECT p.id, p.name, p.barcode,
                    round(public.similarity(p.name, $2::text)::numeric, 2) AS sim,
                    gi.qty_ordered, gi.qty_received
               FROM grn_items gi
               JOIN products p ON gi.product_id = p.id
              WHERE gi.grn_id = $1
                AND p.deleted_at IS NULL
                AND public.similarity(p.name, $2::text) > 0.3
              ORDER BY public.similarity(p.name, $2::text) DESC
              LIMIT 5`,
            [id, nameQuery]
          );
          return res.json({
            needs_confirmation: true,
            query: nameQuery,
            candidates: cands.map((c) => ({
              product_id: c.id,
              name: c.name,
              barcode: c.barcode,
              similarity: Number(c.sim),
              qty_ordered: Number(c.qty_ordered),
              qty_received: Number(c.qty_received),
            })),
          });
        } catch (e) {
          return res.status(400).json({
            error: "Name matching is unavailable (pg_trgm extension not installed).",
          });
        }
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

      // V02 backorders — surface open demand for the just-received product so
      // the receiving screen can deep-link to the Backorders fulfillment view.
      // Best-effort: table may not exist on a not-yet-migrated tenant.
      let openBackorders = null;
      try {
        const { rows: [agg] } = await db.query(
          `SELECT COUNT(*)::int AS count,
                  COALESCE(SUM(qty_ordered - qty_fulfilled), 0)::numeric AS qty
             FROM backorders
            WHERE product_id = $1 AND status IN ('open','partial')`,
          [productId]
        );
        if (agg && Number(agg.count) > 0) {
          openBackorders = { count: Number(agg.count), qty: Number(agg.qty) };
        }
      } catch { /* pre-v110 tenant */ }

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
        open_backorders: openBackorders,
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
    requireAnyPerm(["manage_orders", "view_financial_reports", "all_access"]),
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
    LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id AND sp.voided IS NOT TRUE
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
    requireAnyPerm(["manage_orders", "view_financial_reports", "all_access"]),
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
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id AND sp.voided IS NOT TRUE
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
        // pg returns NUMERIC as strings; "5000.00" + 4000 concatenates, which
        // left an invoice cleared in two instalments stuck at 'partial'.
        const invAmount = Number(inv.amount);
        const alreadyPaid = Number(inv.amount_paid);
        const remaining = invAmount - alreadyPaid;
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
          const newPaid = alreadyPaid + amt;
          const newStatus =
            newPaid >= invAmount - 0.001 ? "paid" : "partial";
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
    requireAnyPerm(["manage_orders", "view_financial_reports", "all_access"]),
    requireFeature("supplier_payables"),
    async (req, res) => {
      try {
        // One definition of what we owe (services/supplier-balance.js): the old
        // join counted a bill once per payment on it and ignored returns and
        // voids (D38). Lists every supplier with a balance, including an
        // opening balance only or an advance (negative).
        const { rows } = await db.query(
          `SELECT s.id, s.name AS supplier_name, s.phone, s.payment_terms, s.credit_days,
                  t.invoice_count, t.opening_balance, t.total_invoiced, t.total_paid,
                  t.total_returned, t.balance AS total_due
             FROM suppliers s
             JOIN (${SUPPLIER_TOTALS_SQL}) t ON t.supplier_id = s.id
            WHERE ABS(t.balance) >= 0.005
            ORDER BY t.balance DESC, s.name`,
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
    // C2 #6 (Step 4): money mutation — manage_finance (C6 perm), not blanket admin.
    requirePerm("manage_finance"),
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

        let newStatus = null;
        await db.transaction(async (client) => {
          await client.query(
            "UPDATE supplier_payments SET voided = true, void_reason = $1 WHERE id = $2",
            [reason || null, id],
          );
          // A payment on account (D13) has no bill to recalculate.
          if (payment.supplier_invoice_id == null) return;

          // Recalculate the bill's status from its remaining payments. (D40: an
          // UPDATE of supplier_invoices.amount_paid stood here, a column that
          // doesn't exist, so voiding any bill payment failed and rolled back.)
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
    requireAnyPerm(["manage_orders", "view_financial_reports", "all_access"]),
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

        // Every line the supplier has ever had, with a running balance over ALL
        // of them; the date range only picks which lines to show. So a range
        // starts from the balance brought forward and its closing balance is
        // what is owed at its end (D37: it used to start at 0). The opening
        // balance (D13) always comes first, whatever its date. Voided payments
        // are left out, as everywhere else (services/supplier-balance.js).
        const allSql = `
          WITH lines AS (
            SELECT 0 AS ord, 0 AS line_id, s.opening_balance_date::timestamptz AS date, 'opening' AS type,
                   'Opening balance' AS reference, s.opening_balance AS debit, 0 AS credit, NULL::text AS notes
              FROM suppliers s WHERE s.id = $1 AND COALESCE(s.opening_balance, 0) <> 0
            UNION ALL
            SELECT 1, si.id, si.created_at, 'invoice', COALESCE(si.invoice_number, 'INV-' || si.id),
                   si.amount, 0, si.notes
              FROM supplier_invoices si WHERE si.supplier_id = $1
            UNION ALL
            SELECT 1, g.id, g.received_at, 'grn', g.grn_number, 0, 0, g.notes
              FROM goods_received_notes g JOIN purchase_orders po ON po.id = g.po_id
             WHERE po.supplier_id = $1
            UNION ALL
            SELECT 1, sp.id, sp.paid_at, 'payment',
                   COALESCE(sp.reference, si2.invoice_number, 'PAY-' || sp.id),
                   0, sp.amount,
                   CONCAT_WS(' · ', sp.payment_method,
                             CASE WHEN sp.supplier_invoice_id IS NULL THEN 'on account'
                                  ELSE 'bill ' || COALESCE(si2.invoice_number, 'INV-' || si2.id) END,
                             sp.notes)
              FROM supplier_payments sp
              LEFT JOIN supplier_invoices si2 ON si2.id = sp.supplier_invoice_id
             WHERE sp.supplier_id = $1 AND sp.voided IS NOT TRUE
            UNION ALL
            SELECT 1, sr.id, sr.return_date, 'return', COALESCE(sr.reference_number, 'RET-' || sr.id),
                   0, sr.total_value, sr.reason
              FROM supplier_returns sr WHERE sr.supplier_id = $1
          )
          SELECT *, SUM(debit - credit) OVER (ORDER BY ord, date, type, line_id ROWS UNBOUNDED PRECEDING) AS running_balance
            FROM lines`;

        const params = [supplier_id];
        const fromUtc = from ? toUtcStart(from, tz) : null;
        const toUtc = to ? toUtcEnd(to, tz) : null;
        params.push(fromUtc, toUtc);
        // In range: the opening line only when no start date is chosen (with a
        // start date it is part of the balance brought forward).
        const inRange = `((ord = 0 AND $2::timestamptz IS NULL)
                          OR (ord = 1 AND ($2::timestamptz IS NULL OR date >= $2::timestamptz)
                                      AND ($3::timestamptz IS NULL OR date <= $3::timestamptz)))`;

        const { rows: [tot] } = await db.query(
          `SELECT COUNT(*) FILTER (WHERE ${inRange})::int AS total,
                  COALESCE(SUM(debit - credit) FILTER (WHERE $2::timestamptz IS NOT NULL
                                                        AND (ord = 0 OR date < $2::timestamptz)), 0) AS brought_forward,
                  COALESCE(SUM(debit - credit) FILTER (WHERE ord = 0 OR $3::timestamptz IS NULL OR date <= $3::timestamptz), 0) AS closing
             FROM (${allSql}) a`,
          params,
        );
        const total_count = tot.total;
        const total_pages = Math.ceil(total_count / PAGE_SIZE);

        const { rows } = await db.query(
          `SELECT date, type, reference, debit, credit, notes, running_balance
             FROM (${allSql}) a
            WHERE ${inRange}
            ORDER BY ord DESC, date DESC, type DESC, line_id DESC
            LIMIT $4 OFFSET $5`,
          [...params, PAGE_SIZE, page * PAGE_SIZE],
        );

        const money = (v) => Number(Number(v || 0).toFixed(2));
        const entries = (rows || []).map((r) => ({
          ...r,
          debit: money(r.debit),
          credit: money(r.credit),
          running_balance: money(r.running_balance),
        }));
        const brought_forward = from ? money(tot.brought_forward) : null;
        // The brought-forward line sits at the bottom (oldest) of the last page.
        if (from && page >= Math.max(0, total_pages - 1)) {
          entries.push({
            date: from, type: "brought_forward", reference: "Balance brought forward",
            debit: 0, credit: 0, notes: null, running_balance: brought_forward,
          });
        }
        const closing_balance = money(tot.closing);

        res.json({
          supplier,
          entries,
          brought_forward,
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
