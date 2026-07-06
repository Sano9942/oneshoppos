const { toUtcStart, toUtcEnd } = require("../utils/tz");
const logger = require("../services/logger");
const { getFeatureFlagsMap } = require("../middleware/feature-flags");
const { recordApprovalEvent } = require("../services/approval-policy");
const { resolveTaxSnapshot } = require("../services/tax-snapshot");
const { verifyManagerPin } = require("../services/manager-pin");
const kitEngine = require("../services/kit-engine");
const batchStock = require("../services/batch-stock");

module.exports = function registerSalesRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, createNotification, notifyLowStockForSale, path, fs, UPLOADS_DIR } = deps;
  const { validate } = require("../middleware/validate");
  const { CreateSaleSchema, VoidSaleSchema } = require("../schemas/sales");

  // --- HELPERS (inlined because these functions live in other route modules) ---

  async function generateInvoiceNumber(client) {
    const year = new Date().getFullYear();
    await client.query(
      "INSERT INTO invoice_sequences (year, last_seq) VALUES ($1, 1) ON CONFLICT(year) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1",
      [year]
    );
    const { rows: [row] } = await client.query(
      "SELECT last_seq FROM invoice_sequences WHERE year = $1",
      [year]
    );
    const seq = String(row.last_seq).padStart(5, "0");
    return `INV-${year}-${seq}`;
  }

  async function assignInvoiceNumberToSale(saleId, retriesLeft) {
    try {
      const invoiceNumber = await db.transaction(async (client) => {
        const invNum = await generateInvoiceNumber(client);
        const { rowCount } = await client.query(
          "UPDATE sales SET invoice_number = $1 WHERE id = $2 AND invoice_number IS NULL",
          [invNum, saleId]
        );
        if (rowCount > 0) return invNum;
        // Another process may have set it already
        const { rows: [existing] } = await client.query(
          "SELECT invoice_number FROM sales WHERE id = $1",
          [saleId]
        );
        if (existing && existing.invoice_number) return existing.invoice_number;
        throw new Error("Invoice number update affected zero rows");
      });
      return invoiceNumber;
    } catch (err) {
      if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1);
      throw err;
    }
  }

  // enqueueInventorySyncEvents is a Shopify sync helper defined in orders.js.
  // For sales, we call it as a no-op if unavailable (sync is non-blocking).
  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const ordersModule = deps.enqueueInventorySyncEvents;
      if (typeof ordersModule === "function") return ordersModule(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

  async function getActiveShiftForOutlet(outletId) {
    const { rows: [row] } = await db.query(
      "SELECT * FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
      [Number(outletId)]
    );
    return row || null;
  }

  async function getEmployeeCheckoutStatus(employeeId, outletId) {
    const today = new Date().toISOString().slice(0, 10);
    const { rows: [openSession] } = await db.query(
      `SELECT * FROM attendance_sessions
       WHERE employee_id = $1 AND outlet_id = $2 AND session_end IS NULL
         AND session_start::date = $3::date
       ORDER BY session_start DESC
       LIMIT 1`,
      [Number(employeeId), Number(outletId), today]
    );
    if (openSession) {
      return openSession.session_type === "work" ? "clocked_in" : "on_break";
    }
    const { rows: [countRow] } = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM attendance_sessions
       WHERE employee_id = $1 AND outlet_id = $2
         AND session_start::date = $3::date`,
      [Number(employeeId), Number(outletId), today]
    );
    return Number(countRow?.cnt || 0) > 0 ? "clocked_out" : "not_clocked_in";
  }

// --- SALES HISTORY ROUTES ---

  /**
   * @swagger
   * /api/sales:
   *   get:
   *     summary: List all sales
   *     description: Returns paginated sales with optional date range, payment method, employee, and outlet filters.
   *     tags: [Sales]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: from
   *         schema: { type: string, format: date }
   *         description: Start date (YYYY-MM-DD)
   *       - in: query
   *         name: to
   *         schema: { type: string, format: date }
   *         description: End date (YYYY-MM-DD)
   *       - in: query
   *         name: payment_method
   *         schema: { type: string, enum: [cash, card, credit, split] }
   *       - in: query
   *         name: employee_id
   *         schema: { type: integer }
   *       - in: query
   *         name: outlet_id
   *         schema: { type: integer }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 50 }
   *     responses:
   *       200:
   *         description: Paginated sales list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 sales:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Sale'
   *                 total:
   *                   type: integer
   *       401:
   *         description: Unauthorized
   */
  // GET all sales (paginated, filterable)
  app.get("/api/sales", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        search = "",
        date_from = "",
        date_to = "",
        outlet_id = "",
      } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let conditions = ["(s.voided IS NULL OR s.voided = false)"];
      let params = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(
          `(CAST(s.id AS TEXT) ILIKE $${paramIdx} OR e.name ILIKE $${paramIdx + 1} OR o.name ILIKE $${paramIdx + 2} OR s.invoice_number ILIKE $${paramIdx + 3})`
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        paramIdx += 4;
      }
      const tz = req.company?.timezone || "UTC";
      if (date_from) {
        conditions.push(`s.timestamp >= $${paramIdx++}`);
        params.push(toUtcStart(date_from, tz));
      }
      if (date_to) {
        conditions.push(`s.timestamp < $${paramIdx++}`);
        params.push(toUtcEnd(date_to, tz));
      }
      if (outlet_id) {
        conditions.push(`s.outlet_id = $${paramIdx++}`);
        params.push(Number(outlet_id));
      }

      const where = conditions.join(" AND ");

      const countQuery = `SELECT COUNT(*) as total FROM sales s
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN employees e ON s.employee_id = e.id
      LEFT JOIN customers c ON s.customer_id = c.id
      WHERE ${where}`;

      const { rows: [countRow] } = await db.query(countQuery, params);
      const total = Number(countRow?.total || 0);

      const listParams = [...params, parseInt(limit), offset];

      const listQuery = `
      SELECT s.id, s.timestamp, s.total_amount, s.payment_method, s.voided, s.void_reason,
             COALESCE(s.discount_amount, 0) as discount_amount, s.discount_type,
             s.invoice_number, s.outlet_id, s.fbr_status,
             o.name as outlet_name, e.name as employee_name,
             c.name as customer_name, c.email as customer_email,
             COUNT(si.id) as item_count
      FROM sales s
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN employees e ON s.employee_id = e.id
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE ${where}
      GROUP BY s.id, s.timestamp, s.total_amount, s.payment_method, s.voided, s.void_reason,
               s.discount_amount, s.discount_type, s.invoice_number, s.outlet_id, s.fbr_status,
               o.name, e.name, c.name, c.email
      ORDER BY s.timestamp DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;

      const { rows } = await db.query(listQuery, listParams);
      res.json({
        sales: rows,
        total,
        pages: Math.ceil(total / parseInt(limit)),
        page: parseInt(page),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2-G.11: Look up a sale by scannable invoice barcode (CODE128 of
  // invoice_number printed on the receipt). Used by POSReturnExchangeModal
  // to auto-load a sale when the cashier scans the receipt.
  app.get(
    "/api/sales/by-barcode/:code",
    requireAnyPerm(["view_reports", "pos_park", "all_access"]),
    async (req, res) => {
      const code = String(req.params.code || "").trim();
      if (!code) return res.status(400).json({ error: "barcode required" });

      try {
        const { rows: [sale] } = await db.query(
          `SELECT s.*, o.name as outlet_name, e.name as employee_name
           FROM sales s
           LEFT JOIN outlets o ON s.outlet_id = o.id
           LEFT JOIN employees e ON s.employee_id = e.id
           WHERE UPPER(s.invoice_number) = UPPER($1)
           LIMIT 1`,
          [code],
        );
        if (!sale) return res.status(404).json({ error: "Sale not found" });

        const { rows: items } = await db.query(
          `SELECT si.*, p.name as product_name, p.barcode
           FROM sale_items si JOIN products p ON si.product_id = p.id
           WHERE si.sale_id = $1`,
          [sale.id],
        );

        const { rows: payments } = await db.query(
          "SELECT * FROM sale_payments WHERE sale_id = $1",
          [sale.id],
        );

        res.json({ sale, items, payments });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET a single sale with full line items and payments
  app.get("/api/sales/:id", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { id } = req.params;

    try {
      const { rows: [sale] } = await db.query(
        `SELECT s.*, o.name as outlet_name, e.name as employee_name
       FROM sales s
       LEFT JOIN outlets o ON s.outlet_id = o.id
       LEFT JOIN employees e ON s.employee_id = e.id
       WHERE s.id = $1`,
        [id]
      );
      if (!sale) return res.status(404).json({ error: "Sale not found" });

      // F2 (Apr 28 2026): join return_items so each line item carries
      // refunded_qty and the sale carries refund_total. Sales History detail
      // panel + POS Return / Exchange modal use these to show "× (qty −
      // refunded) of qty" and disable the Return button when fully refunded.
      const { rows: items } = await db.query(
        `SELECT si.*, p.name as product_name, p.barcode,
                COALESCE(rsum.refunded_qty, 0) AS refunded_qty
         FROM sale_items si
         JOIN products p ON si.product_id = p.id
         LEFT JOIN (
           SELECT ri.product_id, ri.variant_id, SUM(ri.quantity) AS refunded_qty
             FROM return_items ri
             JOIN returns r ON r.id = ri.return_id
            WHERE r.original_sale_id = $1
            GROUP BY ri.product_id, ri.variant_id
         ) rsum
           ON rsum.product_id = si.product_id
          AND rsum.variant_id IS NOT DISTINCT FROM si.variant_id
        WHERE si.sale_id = $1`,
        [id]
      );

      const { rows: payments } = await db.query(
        "SELECT * FROM sale_payments WHERE sale_id = $1",
        [id]
      );

      const { rows: [refundAgg] } = await db.query(
        `SELECT COALESCE(SUM(total_refund), 0) AS refund_total
           FROM returns
          WHERE original_sale_id = $1`,
        [id]
      );
      sale.refund_total = Number(refundAgg?.refund_total || 0);

      res.json({ sale, items, payments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // VOID a sale — marks as voided and restores stock to outlet
  app.put(
    "/api/sales/:id/void",
    requireAnyPerm(["void_sales", "pos_void"]),
    validate(VoidSaleSchema),
    async (req, res) => {
      const { id } = req.params;
      const { void_reason } = req.body;

      try {
        // Fetch the sale first to check it exists and isn't already voided
        const { rows: [sale] } = await db.query("SELECT * FROM sales WHERE id = $1", [id]);
        if (!sale) return res.status(404).json({ error: "Sale not found" });
        if (sale.voided)
          return res.status(400).json({ error: "Sale is already voided" });
        if (!sale.outlet_id)
          return res
            .status(400)
            .json({ error: "Cannot void sales without outlet attribution" });

        // Fetch line items to restore stock
        const { rows: items } = await db.query(
          "SELECT * FROM sale_items WHERE sale_id = $1",
          [id]
        );

        await db.transaction(async (client) => {
          // Mark the sale as voided
          await client.query(
            "UPDATE sales SET voided = true, void_reason = $1 WHERE id = $2",
            [void_reason, id]
          );

          // Restore stock for each item back to the outlet
          for (const item of items) {
            // v45: outlet_stock.quantity + product_variants.stock are NUMERIC(10,3),
            // matching sale_items.quantity — restore with full fractional precision.
            const restoreQtyInt = Number(item.quantity);

            // F01: if this line is a kit, restore COMPONENT stock (not the kit's,
            // which holds none). Server-authoritative via bom_type; the engine
            // keeps outlet_stock + variant_outlet_stock + the variant rollup in
            // sync, mirroring the sale-time decrement.
            const { rows: [prod] } = await client.query(
              "SELECT COALESCE(bom_type, 'standard') AS bom_type, COALESCE(track_batches, false) AS track_batches FROM products WHERE id = $1",
              [item.product_id]
            );

            if (prod && prod.bom_type === "kit") {
              await kitEngine.restockComponents(client, {
                productId: item.product_id,
                outletId: sale.outlet_id,
                qty: restoreQtyInt,
              });
              // F07: return each tracked component's units to the batch it left
              // from at sale time (resolved via the original sale's movements).
              const comps = await kitEngine.loadComponents(client, item.product_id);
              for (const comp of comps) {
                await batchStock.returnToBatch(client, {
                  productId: comp.component_product_id,
                  variantId: comp.component_variant_id || null,
                  outletId: sale.outlet_id,
                  qty: batchStock.roundQty(Number(comp.quantity) * restoreQtyInt),
                  refType: "void",
                  refId: id,
                  originalSaleId: id,
                });
              }
            } else {
              await client.query(
                `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
                 ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
                [item.product_id, sale.outlet_id, restoreQtyInt, restoreQtyInt]
              );

              // Restore variant global stock if item has a variant.
              // 2-G.1: also restore per-outlet variant stock so matrix view
              // matches the authoritative cross-outlet rollup.
              if (item.variant_id) {
                await client.query(
                  `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
                  [restoreQtyInt, item.variant_id]
                );
                await client.query(
                  `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (variant_id, outlet_id)
                     DO UPDATE SET quantity = variant_outlet_stock.quantity + $3`,
                  [item.variant_id, sale.outlet_id, restoreQtyInt]
                );
              }

              // F07: return voided units to their original batch (else newest /
              // a fresh return batch) so the invariant holds after the restore.
              if (prod && prod.track_batches === true) {
                await batchStock.returnToBatch(client, {
                  productId: item.product_id,
                  variantId: item.variant_id || null,
                  outletId: sale.outlet_id,
                  qty: restoreQtyInt,
                  refType: "void",
                  refId: id,
                  originalSaleId: id,
                });
              }
            }

            // 2-G.6: release any serials bridged to this sale_item back to
            // 'available' and clear the warranty dates. The bridge rows stay
            // intact for history (sale_item_serials is append-only outside
            // of sale_items cascading delete).
            await client.query(
              `UPDATE product_serial_numbers
                  SET status = 'available',
                      sale_id = NULL,
                      warranty_start_date = NULL,
                      warranty_end_date = NULL
                WHERE id IN (
                  SELECT serial_id FROM sale_item_serials WHERE sale_item_id = $1
                )`,
              [item.id],
            );
          }
        });

        const syncChanges = items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          outlet_id: sale.outlet_id,
          delta: Number(item.quantity || 0),
          reason: "void",
          reference_type: "sale_void",
          reference_id: id,
        }));
        enqueueInventorySyncEvents(syncChanges, {}, () => {});

        // FBR: queue debit note if sale was posted to FBR
        try {
          if (sale.fbr_status === "posted") {
            const { buildDebitNotePayload, enqueueFbrInvoice } = require("../services/fbr");
            const payload = buildDebitNotePayload(sale, req.company);
            await enqueueFbrInvoice(db, { saleId: Number(id), invoiceType: "debit_note", payload, tenantSlug: req.tenantSlug });
          }
        } catch (fbrErr) {
          logger.error({ err: fbrErr, saleId: id }, "FBR void enqueue failed (non-blocking)");
        }

        // Reverse any pending/approved commissions
        db.query(
          `UPDATE commission_earnings SET status = 'reversed', reversed_at = NOW(), reversal_reason = 'Sale voided'
           WHERE sale_id = $1 AND status IN ('pending','approved')`,
          [id]
        ).catch(err => console.error("[commission] void reversal error:", err.message));

        // F06 — unlink + reopen the appointment this sale paid for, so the
        // cashier can re-ring it after a mistaken sale (same reversal duty as
        // the completion-04 on-account invoice lesson). 'in_progress', not
        // 'completed' — the service happened; only the payment was undone.
        if (sale.appointment_id) {
          db.query(
            `UPDATE appointments SET sale_id = NULL, status = 'in_progress', updated_at = NOW()
             WHERE id = $1 AND sale_id = $2`,
            [sale.appointment_id, id]
          ).catch(err => console.error("[f06] appointment unlink on void error:", err.message));
        }

        res.json({
          message: "Sale voided successfully. Stock has been restored.",
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  /**
   * @swagger
   * /api/sales:
   *   post:
   *     summary: Create a sale (POS checkout)
   *     description: Process a cart checkout. Creates sale record, deducts stock (with FOR UPDATE row locks), generates invoice number, and optionally enqueues FBR invoice.
   *     tags: [Sales]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [cartItems, payment_method, outlet_id]
   *             properties:
   *               cartItems:
   *                 type: array
   *                 description: "Cart items (use 'id' not 'product_id', 'price' not 'unit_price')"
   *                 items:
   *                   type: object
   *                   required: [id, quantity, price]
   *                   properties:
   *                     id: { type: integer, description: Product ID }
   *                     variant_id: { type: integer, nullable: true }
   *                     quantity: { type: integer }
   *                     price: { type: number, format: double }
   *                     discount: { type: number, default: 0 }
   *               payment_method: { type: string, enum: [cash, card, credit, split] }
   *               outlet_id: { type: integer }
   *               customer_id: { type: integer, nullable: true }
   *               discount: { type: number, description: "Overall sale discount" }
   *               tax: { type: number }
   *               note: { type: string }
   *     responses:
   *       200:
   *         description: Sale created with invoice number
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 sale:
   *                   $ref: '#/components/schemas/Sale'
   *                 invoice_number: { type: string }
   *       400:
   *         description: Insufficient stock or validation error
   *       401:
   *         description: Unauthorized
   */
  // Process a Sale (Cart Checkout)
  app.post("/api/sales", validate(CreateSaleSchema), async (req, res) => {
    const {
      cartItems,
      paymentMethod,
      payments,
      outlet_id,
      employee_id,
      customer_id,
      discount_amount = 0,
      discount_type = "fixed",
      points_earned = 0,
      points_redeemed = 0,
      notes = null,
      idempotency_key = null,
      folio_id = null,
      treatment_folio_id = null,
      // Phase 2.1 C1 — tip capture inputs (restaurant flow). draft_order_id
      // links the sale back to the check; non-restaurant sales pass nothing.
      draft_order_id = null,
      // W17 — when settling a check tied to a seated table, the sale needs
      // to flip the table session to 'dirty' (busser cleanup state) so the
      // floor view stops showing the table as occupied.
      table_session_id = null,
      tip_amount = 0,
      tip_method = null,
      // Phase 2.1 C1 wiring — server-of-record override from POS checkout
      // when there's no table session (direct dine-in / walk-in tip flow).
      server_id = null,
      // P8 (3.14): cart tax-inclusive toggle. Falls back to the tenant's
      // configured tax_mode below.
      tax_inclusive: tax_inclusive_in,
      // Tier 0.1 wholesale — manager PIN to override a hard credit-limit
      // block on a Credit tender. Ignored when no Credit tender is used.
      manager_pin = null,
      // Tier 1.2 wholesale field sales — when set, links the sale back to the
      // field_visit it came from. Validated as a positive int by Zod; existence
      // is enforced at INSERT via the FK constraint on sales.field_visit_id.
      // field_visit_uuid is the offline-friendly alternative: rep app passes the
      // same uuid the visit was checked in with, and we resolve it to the id
      // here (works even when the rep app never saw the visit's numeric id).
      field_visit_id: field_visit_id_in = null,
      field_visit_uuid = null,
      // F06 — when the POS checkout started from "today's appointments", the
      // sale links back to the appointment; post-commit the appointment is
      // marked completed with the sale backlink (revenue attribution).
      appointment_id = null,
      // Tier 1.3 wholesale schemes — POS / rep-app sends the applied promotions
      // from /api/promotions/quote. Persisted to sale_promotion_applications
      // as an audit trail (snapshot — doesn't affect totals; the discount is
      // already folded into discount_amount client-side).
      applied_promotions = [],
    } = req.body;

    // Resolve field_visit_uuid → field_visits.id when only the uuid is given.
    // Same-tenant lookup via deps.db proxy. Missing/unknown uuid is treated as
    // "no linkage" (NULL) rather than a hard error — the rep app may post the
    // order before the offline visit has finished syncing.
    let field_visit_id = field_visit_id_in;
    if (!field_visit_id && field_visit_uuid) {
      try {
        const { rows: [v] } = await db.query(
          "SELECT id FROM field_visits WHERE client_uuid = $1 LIMIT 1",
          [field_visit_uuid]
        );
        if (v?.id) field_visit_id = v.id;
      } catch { /* swallow — keep NULL */ }
    }

    // Tier 2.2 — MOQ / case-pack enforcement for field-rep orders only. POS
    // (and any other in-store/internal flow) bypasses by design — physical
    // cashiers handle overrides naturally. Gated on field_visit_uuid OR a
    // resolved field_visit_id so offline replays from the rep app still
    // enforce. Cart-item shape here is { id, quantity, ... } — id is the
    // product_id (POS contract), so we remap before calling validateMoq.
    if ((field_visit_id || field_visit_uuid) && Array.isArray(cartItems) && cartItems.length) {
      try {
        const { validateMoq } = require("../services/moq");
        const moqItems = cartItems.map((it) => ({
          product_id: Number(it.id),
          quantity: Number(it.quantity || 0),
        }));
        const moqResult = await validateMoq(db, moqItems);
        if (!moqResult.ok) {
          return res.status(400).json({
            error: "Order violates minimum order quantity rules",
            code: "MOQ_VIOLATION",
            violations: moqResult.violations,
            hint: "Ask the manager to ring this through POS if you need to bypass MOQ.",
          });
        }
      } catch (moqErr) {
        // MOQ columns missing on a not-yet-migrated tenant → treat as no-op.
        // Migration v95 ships the columns; a fresh tenant on v95+ never lands
        // here. Logging only — never block the sale on the guard's own bug.
        if (!String(moqErr.message || "").includes("min_order_qty")) {
          console.warn("[sales] MOQ guard skipped:", moqErr.message);
        }
      }
    }

    // F06 — validate the appointment link before opening the transaction: it
    // must exist, be in a checkout-able state, and not already be paid for.
    if (appointment_id) {
      try {
        const { rows: [appt] } = await db.query(
          "SELECT id, status, sale_id FROM appointments WHERE id = $1",
          [Number(appointment_id)]
        );
        if (!appt) return res.status(400).json({ error: "Linked appointment not found" });
        if (appt.sale_id) {
          return res.status(409).json({ error: "Appointment is already linked to a sale", code: "APPOINTMENT_ALREADY_PAID" });
        }
        if (!["confirmed", "in_progress", "pending"].includes(appt.status)) {
          return res.status(400).json({ error: `Appointment is ${appt.status} and cannot be checked out` });
        }
      } catch (apptErr) {
        // Pre-v100 tenant without the sale_id column — treat as no linkage.
        if (!/sale_id/.test(String(apptErr.message || ""))) {
          console.warn("[sales] appointment link check skipped:", apptErr.message);
        }
      }
    }

    // Mutually-exclusive: a sale can be on a room folio OR a treatment folio, not both.
    if (folio_id && treatment_folio_id) {
      return res.status(400).json({ error: "Sale cannot be attached to both a room folio and a treatment folio" });
    }

    // M10 — treatment_folio_id (POS "charge to plan") pre-validation.
    let chargeToTreatmentFolio = null;
    if (treatment_folio_id) {
      const tfid = Number(treatment_folio_id);
      if (!Number.isInteger(tfid) || tfid <= 0) {
        return res.status(400).json({ error: "Invalid treatment_folio_id" });
      }
      try {
        const { rows: [tfRow] } = await db.query(
          `SELECT tf.id, tf.status, tf.plan_id, p.outlet_id AS plan_outlet_id
           FROM treatment_folios tf
           LEFT JOIN treatment_plans p ON p.id = tf.plan_id
           WHERE tf.id = $1`,
          [tfid]
        );
        if (!tfRow) return res.status(404).json({ error: "Treatment folio not found" });
        if (tfRow.status !== "open") {
          return res.status(400).json({ error: "Treatment folio is not open" });
        }
        if (tfRow.plan_outlet_id && Number(tfRow.plan_outlet_id) !== Number(outlet_id)) {
          return res.status(400).json({ error: "Treatment folio belongs to a different outlet" });
        }
        chargeToTreatmentFolio = tfRow;
      } catch (tfErr) {
        if (String(tfErr.message || "").includes("does not exist")) {
          return res.status(400).json({ error: "Treatment plans are not enabled for this tenant" });
        }
        return res.status(500).json({ error: tfErr.message });
      }
    }

    // M9 — folio_id (POS "charge to room") pre-validation.
    let chargeToFolio = null;
    if (folio_id) {
      const folioId = Number(folio_id);
      if (!Number.isInteger(folioId) || folioId <= 0) {
        return res.status(400).json({ error: "Invalid folio_id" });
      }
      try {
        const { rows: [folioRow] } = await db.query(
          `SELECT gf.id, gf.status, gf.booking_id, b.outlet_id AS booking_outlet_id
           FROM guest_folios gf
           LEFT JOIN room_bookings b ON b.id = gf.booking_id
           WHERE gf.id = $1`,
          [folioId]
        );
        if (!folioRow) return res.status(404).json({ error: "Folio not found" });
        if (folioRow.status !== "open") {
          return res.status(400).json({ error: "Folio is not open" });
        }
        if (folioRow.booking_outlet_id && Number(folioRow.booking_outlet_id) !== Number(outlet_id)) {
          return res.status(400).json({ error: "Folio belongs to a different outlet" });
        }
        chargeToFolio = folioRow;
      } catch (folioErr) {
        // If guest_folios table doesn't exist yet (pre-v38 tenant), surface a clear error.
        if (String(folioErr.message || "").includes("does not exist")) {
          return res.status(400).json({ error: "Room management is not enabled for this tenant" });
        }
        return res.status(500).json({ error: folioErr.message });
      }
    }

    const authenticatedEmployeeId =
      Number(req.headers["x-employee-id"] || employee_id || 0) || null;
    for (const item of cartItems) {
      if (!isFinite(Number(item.price)) || !isFinite(Number(item.quantity))) {
        return res.status(400).json({ error: "Cart items must have valid numeric price and quantity" });
      }
    }
    if (!authenticatedEmployeeId) {
      return res.status(401).json({ error: "Login is required for checkout" });
    }

    // Phase 2-G Wave 3 (2-G.5) — validate per-line price_override metadata
    // before the transaction opens. Collects one entry per cart line (same
    // index) so the INSERT pass can stamp the audit columns without another
    // round-trip.
    const overridesByIndex = new Array(cartItems.length).fill(null);
    const anyOverride = cartItems.some((it) => it && it.price_override);
    if (anyOverride) {
      const flags = await getFeatureFlagsMap(req.tenantId);
      if (!flags.phase2g_price_override) {
        return res.status(503).json({
          error: "Feature disabled: phase2g_price_override",
          flag: "phase2g_price_override",
        });
      }
      const hasPerm =
        Array.isArray(req.employeePerms) &&
        (req.employeePerms.includes("all_access") ||
          req.employeePerms.includes("override_price"));
      for (let i = 0; i < cartItems.length; i++) {
        const ov = cartItems[i]?.price_override;
        if (!ov) continue;
        const originalPrice = Number(ov.original_price);
        if (!isFinite(originalPrice) || originalPrice < 0) {
          return res.status(400).json({ error: "price_override.original_price must be a non-negative number" });
        }
        const reasonId = ov.reason_id != null ? Number(ov.reason_id) : null;
        const approvalEventId =
          ov.approval_event_id != null ? Number(ov.approval_event_id) : null;

        if (!approvalEventId && !hasPerm) {
          return res.status(403).json({
            error: "Manager approval required for price override",
          });
        }

        let approvedBy = null;
        if (approvalEventId) {
          const { rows } = await db.query(
            `SELECT id, action_type, status, approved_by
               FROM approval_events
              WHERE id = $1`,
            [approvalEventId]
          );
          const ev = rows[0];
          if (!ev || ev.action_type !== "price_override" || ev.status !== "approved") {
            return res.status(400).json({ error: "Invalid approval_event_id for price override" });
          }
          approvedBy = ev.approved_by;
        } else {
          // Manager self-approving via their own session — record an event now
          // so the audit trail stays consistent.
          const ev = await recordApprovalEvent(db, {
            policyId: null,
            actionType: "price_override",
            referenceType: "sale_item_pending",
            referenceId: null,
            requestedBy: authenticatedEmployeeId,
            approvedBy: authenticatedEmployeeId,
            status: "approved",
            reason: "Self-approved by manager with override_price",
            metadata: {
              product_id: cartItems[i].original_product_id || cartItems[i].id || null,
              variant_id: cartItems[i].variant_id || null,
              original_price: originalPrice,
              new_price: Number(cartItems[i].price),
              reason_id: reasonId,
            },
            outletId: outlet_id ?? null,
          });
          overridesByIndex[i] = {
            originalPrice,
            reasonId,
            approvedBy: authenticatedEmployeeId,
            approvalEventId: ev.id,
          };
          continue;
        }

        overridesByIndex[i] = {
          originalPrice,
          reasonId,
          approvedBy,
          approvalEventId,
        };
      }
    }

    // Phase 2-G Wave 3 (2-G.6) — validate per-line serials before opening
    // the transaction. For every cart line whose product has
    // serial_required=true, the POST body must include `serials: number[]`
    // whose length === quantity. Each serial id must currently be
    // status='available' and match the line's product (+ variant when
    // applicable). A serial cannot be reused across two lines in the same
    // payload.
    const serialsByIndex = new Array(cartItems.length).fill(null);
    const productIds = Array.from(
      new Set(
        cartItems.map((x) => x.original_product_id || x.id).filter(Boolean),
      ),
    );
    let serialRequiredMap = new Map();
    if (productIds.length) {
      const { rows: pr } = await db.query(
        `SELECT id, serial_required FROM products WHERE id = ANY($1::int[])`,
        [productIds],
      );
      for (const row of pr) {
        serialRequiredMap.set(Number(row.id), row.serial_required === true);
      }
    }
    const seenSerialIds = new Set();
    for (let i = 0; i < cartItems.length; i++) {
      const item = cartItems[i];
      const productId = Number(item.original_product_id || item.id);
      const lineQty = Math.floor(Number(item.quantity || 0));
      const required = serialRequiredMap.get(productId) === true;
      const provided = Array.isArray(item.serials) ? item.serials.map(Number) : [];

      if (!required) {
        if (provided.length > 0) {
          return res.status(400).json({
            error: `Product ${productId} is not serialized; remove serials from this line`,
          });
        }
        continue;
      }
      if (provided.length !== lineQty) {
        return res.status(400).json({
          error: `Product ${productId} is serialized — provide exactly ${lineQty} serial id(s) on this line`,
        });
      }
      for (const sid of provided) {
        if (seenSerialIds.has(sid)) {
          return res.status(400).json({ error: `Serial id ${sid} used on multiple lines` });
        }
        seenSerialIds.add(sid);
      }
      const { rows: serialRows } = await db.query(
        `SELECT id, product_id, variant_id, status, warranty_months
           FROM product_serial_numbers WHERE id = ANY($1::int[])`,
        [provided],
      );
      if (serialRows.length !== provided.length) {
        return res.status(400).json({ error: "One or more serial ids not found" });
      }
      for (const sr of serialRows) {
        if (sr.status !== "available") {
          return res.status(409).json({
            error: `Serial ${sr.id} is not available (status=${sr.status})`,
          });
        }
        if (Number(sr.product_id) !== productId) {
          return res.status(400).json({
            error: `Serial ${sr.id} does not belong to product ${productId}`,
          });
        }
        if (item.variant_id && sr.variant_id && Number(sr.variant_id) !== Number(item.variant_id)) {
          return res.status(400).json({
            error: `Serial ${sr.id} does not belong to variant ${item.variant_id}`,
          });
        }
      }
      serialsByIndex[i] = serialRows.map((r) => ({
        id: Number(r.id),
        warranty_months: r.warranty_months != null ? Number(r.warranty_months) : null,
      }));
    }

    let activeShift;
    try {
      activeShift = await getActiveShiftForOutlet(outlet_id);
      if (!activeShift) {
        if (idempotency_key) {
          // Offline-queued sale: shift may have closed. Use most recent shift for this outlet.
          const { rows: [closedShift] } = await db.query(
            "SELECT id FROM cash_shifts WHERE outlet_id = $1 ORDER BY opened_at DESC LIMIT 1",
            [outlet_id]
          );
          if (closedShift) {
            activeShift = closedShift;
          } else {
            return res.status(400).json({ error: "No shift found for this outlet", code: "shift_not_open" });
          }
        } else {
          return res.status(400).json({
            error: "Cannot checkout because no open shift exists for this outlet",
            code: "shift_not_open",
          });
        }
      }

      // Tier 1.2 wholesale: field-rep orders skip the outlet-clock-in check.
      // Field reps don't clock in at a kiosk — they're on the road. Presence
      // of field_visit_id (resolved above) or field_visit_uuid in the body is
      // the signal that this sale came from the rep app, not the counter.
      const isFieldRepSale = !!(field_visit_id || field_visit_uuid);

      if (!isFieldRepSale && (!idempotency_key || activeShift.status === "open")) {
        // Only check attendance for real-time sales (not offline replays)
        const attendanceStatus = await getEmployeeCheckoutStatus(
          authenticatedEmployeeId,
          outlet_id,
        );
        if (attendanceStatus !== "clocked_in") {
          const message =
            attendanceStatus === "on_break"
              ? "Cannot checkout while on break. Clock back in first."
              : "Cannot checkout because the employee is not clocked in for this outlet";
          return res.status(400).json({
            error: message,
            code: "employee_not_clocked_in",
            attendance_status: attendanceStatus,
          });
        }
      }
    } catch (validationErr) {
      return res.status(500).json({ error: validationErr.message });
    }

    // Phase 2-G Wave 2 — customer-group + loyalty-tier auto-pricing.
    // Flag-gated. Off by default: behavior is identical to pre-wave-2. On:
    //   - phase2g_price_books: apply group.discount_percent pre-tax AND
    //     per-product price_list_items overrides scoped to the group.
    //   - phase2g_loyalty: apply tier.discount_percent pre-tax (Track B
    //     also writes loyalty_transactions ledger; this block only handles
    //     the discount side).
    // Discounts stack ADDITIVELY (10% group + 5% tier = 15%). Results are
    // returned in the response so the client can render the breakdown.
    let autoPricingBreakdown = { priceBookApplied: [], discountLines: [] };
    let autoDiscountValue = 0;
    // Hoisted so the post-commit loyalty ledger writer at the end of the
    // transaction block can see whether phase2g_loyalty was on for this sale.
    let loyaltyFlagOn = false;
    // Phase 2-G Wave 2 (2-G.2) — populated inside the transaction when
    // cart lines with products.is_gift_card_sku=true are sold; used
    // AFTER commit to enqueue the recipient email so a rolled-back sale
    // doesn't send a phantom code.
    let issuedCards = [];
    let giftCardsFlagOn = false;
    // F02 packages/passes — populated inside the transaction when a package
    // product line is sold (soldPackages) so a post-commit hook can react.
    let soldPackages = [];
    let packagesFlagOn = false;
    try {
      const { getFeatureFlagsMap } = require("../middleware/feature-flags");
      const flags = await getFeatureFlagsMap(req.tenantId);
      const pbOn = !!flags.phase2g_price_books;
      const loyaltyOn = !!flags.phase2g_loyalty;
      loyaltyFlagOn = loyaltyOn;
      giftCardsFlagOn = !!flags.phase2g_gift_cards;
      packagesFlagOn = !!flags.packages_passes;
      if ((pbOn || loyaltyOn) && customer_id) {
        const pricing = require("../services/pricing");
        const { group, tier } = await pricing.resolveCustomerPricing({
          db,
          customerId: customer_id,
        });
        if (pbOn && group) {
          const overrides = await pricing.resolveGroupPriceBookOverrides({
            db,
            groupId: group.id,
            cartItems,
          });
          autoPricingBreakdown.priceBookApplied =
            pricing.applyPriceBookOverrides(cartItems, overrides);
        }
        // Subtotal AFTER per-product overrides so group+tier % compose
        // against the post-override base (matches customer expectation).
        const preSubtotal = cartItems.reduce(
          (acc, item) => acc + Number(item.price) * Number(item.quantity),
          0,
        );
        const composed = pricing.composeAutoDiscountPercent({
          group,
          tier,
          applyGroup: pbOn,
          applyTier: loyaltyOn,
        });
        autoDiscountValue = (preSubtotal * composed.pct) / 100;
        autoPricingBreakdown.discountLines = composed.breakdown;
      }
    } catch (pricingErr) {
      // Never block a sale on pricing-service failure; fall back to the
      // pre-wave-2 path. Log for visibility.
      try { logger.warn?.({ err: pricingErr }, "auto-pricing skipped"); } catch {}
    }

    // 1. Calculate Expected Total (subtotal minus manual discount)
    const subtotal = cartItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );
    const discountValue =
      discount_type === "percent"
        ? (subtotal * parseFloat(discount_amount || 0)) / 100
        : parseFloat(discount_amount || 0);
    const totalAmount =
      subtotal - discountValue - autoDiscountValue - parseFloat(points_redeemed || 0);

    // Determine the actual payments to record
    let finalPayments = payments;
    let mainPaymentMethod = paymentMethod || "Cash";

    if (chargeToTreatmentFolio) {
      // Charge-to-plan bypasses payment entry — the sale amount is added
      // as a treatment folio line and settled later when the plan is closed.
      mainPaymentMethod = "charge_to_plan";
      finalPayments = [];
    } else if (chargeToFolio) {
      // Charge-to-room bypasses payment entry — the sale amount is added
      // as a folio line and settled later when the folio is closed.
      mainPaymentMethod = "charge_to_room";
      finalPayments = [];
    } else if (!finalPayments || finalPayments.length === 0) {
      finalPayments = [{ method: mainPaymentMethod, amount: totalAmount }];
    } else if (finalPayments.length > 1) {
      mainPaymentMethod = "Split";
    } else if (finalPayments.length === 1) {
      mainPaymentMethod = finalPayments[0].method;
    }

    // Blacklist check — reject sale if customer is blacklisted
    if (customer_id) {
      const { rows: [custRow] } = await db.query(
        "SELECT is_blacklisted, blacklist_reason FROM customers WHERE id = $1",
        [customer_id],
      );
      if (custRow && custRow.is_blacklisted) {
        return res.status(400).json({
          error: `Customer is blacklisted: ${custRow.blacklist_reason || "No reason provided"}`,
        });
      }
    }

    // B3 fix: Check wallet balance before allowing Wallet payment
    const walletPaymentsBefore = (finalPayments || []).filter(
      (p) => p.method === "Wallet",
    );
    if (customer_id && walletPaymentsBefore.length > 0) {
      const walletTotalNeeded = walletPaymentsBefore.reduce(
        (s, p) => s + p.amount,
        0,
      );
      try {
        const { rows: [walletRow] } = await db.query(
          "SELECT COALESCE(balance, 0) AS balance FROM customers WHERE id = $1",
          [customer_id]
        );
        const walletBalance = walletRow ? Number(walletRow.balance) : 0;
        if (walletTotalNeeded > walletBalance) {
          return res.status(400).json({
            error: `Insufficient wallet balance: required ${walletTotalNeeded}, available ${walletBalance}`,
            code: "insufficient_wallet",
          });
        }
      } catch (walletErr) {
        return res.status(500).json({ error: walletErr.message });
      }
    }

    // Tier 0.1 wholesale — Credit (on-account) tender pre-flight.
    //   Requires customer_id. Reads customer.credit_limit + credit_block_mode +
    //   payment_terms_days, sums unpaid customer_invoices.balance_due, and
    //   compares (outstanding + credit_amount) to credit_limit.
    //   mode='off'  → never block
    //   mode='warn' → proceed; include credit_warning in success response
    //   mode='hard' → 403 CREDIT_LIMIT_EXCEEDED unless caller has
    //                 override_credit_limit perm OR a valid manager_pin is
    //                 supplied (verifyManagerPin requires override_credit_limit).
    // Result captured in creditTender (used inside the transaction to create
    // the customer_invoices row and link it via sales.customer_invoice_id).
    const creditPayments = (finalPayments || []).filter((p) => p.method === "Credit");
    const creditTotal = creditPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    let creditTender = null;
    let creditWarning = null;
    // Tier 0.1 — captured after the AR invoice INSERT inside the transaction so
    // the response can surface the AR invoice number + due date to the receipt.
    let creditArInvoice = null;
    if (creditTotal > 0) {
      // Credit cannot overpay the sale. Other tenders (Cash, Card) tolerate
      // overpayment as "change due", but a Credit overpayment would inflate
      // the AR invoice and exaggerate the customer's exposure. Reject when
      // sum(non-credit) + creditTotal > totalAmount by more than rounding noise.
      const nonCreditTotal = (finalPayments || [])
        .filter((p) => p.method !== "Credit")
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      if (nonCreditTotal + creditTotal > Number(totalAmount) + 0.01) {
        return res.status(400).json({
          error:
            `Credit overpayment: tenders total ${(nonCreditTotal + creditTotal).toFixed(2)} ` +
            `exceeds sale total ${Number(totalAmount).toFixed(2)}.`,
          code: "CREDIT_OVERPAYMENT",
          credit_amount: creditTotal,
          non_credit_amount: nonCreditTotal,
          sale_total: Number(totalAmount),
        });
      }
      if (!customer_id) {
        return res.status(400).json({
          error: "Credit tender requires a customer to be selected",
          code: "CREDIT_REQUIRES_CUSTOMER",
        });
      }
      try {
        const { rows: [cust] } = await db.query(
          `SELECT id, credit_limit, credit_block_mode, payment_terms_days
           FROM customers WHERE id = $1`,
          [customer_id]
        );
        if (!cust) {
          return res.status(400).json({ error: "Customer not found" });
        }
        const limit = Number(cust.credit_limit || 0);
        const mode = cust.credit_block_mode || "warn";
        const termsDays = Number(cust.payment_terms_days || 0);

        // Sum unpaid AR. customer_invoices may not exist on very old tenants.
        let outstanding = 0;
        try {
          const { rows: [agg] } = await db.query(
            `SELECT COALESCE(SUM(balance_due), 0)::numeric AS outstanding
             FROM customer_invoices
             WHERE customer_id = $1
               AND status NOT IN ('paid', 'cancelled')`,
            [customer_id]
          );
          outstanding = Number(agg?.outstanding || 0);
        } catch (e) {
          if (!String(e.message || "").includes("does not exist")) throw e;
        }

        const newExposure = outstanding + creditTotal;
        const overLimit = limit > 0 && newExposure > limit;

        if (overLimit && mode !== "off") {
          const hasPermOverride =
            Array.isArray(req.employeePerms) &&
            (req.employeePerms.includes("all_access") ||
              req.employeePerms.includes("override_credit_limit"));

          if (mode === "hard" && !hasPermOverride) {
            // Try manager PIN. If absent or invalid → 403.
            if (!manager_pin) {
              return res.status(403).json({
                error: "Credit limit exceeded — manager PIN required",
                code: "CREDIT_LIMIT_EXCEEDED",
                limit,
                outstanding,
                attempted: creditTotal,
                deficit: newExposure - limit,
              });
            }
            try {
              await verifyManagerPin(db, String(manager_pin), {
                requiredPerm: "override_credit_limit",
                isImpersonating: req.isImpersonating === true,
              });
              // PIN verified — record approval event for the audit trail
              await recordApprovalEvent(db, {
                policyId: null,
                actionType: "credit_limit_override",
                referenceType: "sale_pending",
                referenceId: null,
                requestedBy: authenticatedEmployeeId,
                approvedBy: null, // verifyManagerPin returned ok; identity not surfaced
                status: "approved",
                reason: `Credit-limit override: outstanding ${outstanding}, this sale ${creditTotal}, limit ${limit}`,
                metadata: {
                  customer_id,
                  credit_limit: limit,
                  outstanding,
                  credit_amount: creditTotal,
                },
                outletId: outlet_id ?? null,
              }).catch(() => { /* audit record is best-effort */ });
            } catch (pinErr) {
              return res.status(pinErr.statusCode || 403).json({
                error: pinErr.message || "Manager PIN verification failed",
                code: "CREDIT_LIMIT_EXCEEDED",
                limit,
                outstanding,
                attempted: creditTotal,
                deficit: newExposure - limit,
              });
            }
          } else if (mode === "warn") {
            // Soft warning — proceed but tell the caller.
            creditWarning =
              `Credit limit exceeded. Outstanding: ${outstanding.toFixed(2)}, ` +
              `this sale: ${creditTotal.toFixed(2)}, limit: ${limit.toFixed(2)}.`;
          }
        }

        creditTender = {
          amount: creditTotal,
          payment_terms_days: termsDays,
        };
      } catch (creditErr) {
        return res.status(500).json({ error: creditErr.message });
      }
    }

    // Idempotency check — return early if this request was already processed
    if (idempotency_key) {
      try {
        const { rows: [existing] } = await db.query(
          "SELECT id, invoice_number FROM sales WHERE idempotency_key = $1",
          [idempotency_key]
        );
        if (existing) {
          return res.json({ success: true, duplicate: true, saleId: existing.id, invoiceNumber: existing.invoice_number });
        }
      } catch { /* ignore idempotency check errors */ }
    }

    // P8 (3.14) — Per-line tax snapshot resolution (read-only, before tx).
    // The cascade lives in services/tax-snapshot.js — shared with storefront
    // quotes, layaway settle, pay-at-table, quotation convert, and manual
    // orders so every sale writer resolves tax identically.
    const taxMode = (req.company && req.company.tax_mode) || "none";
    const taxSnapshot = await resolveTaxSnapshot(db, {
      items: cartItems.map((x) => ({
        productId: Number(x.original_product_id || x.id) || null,
        price: x.price,
        quantity: x.quantity,
      })),
      taxMode,
      taxInclusive:
        typeof tax_inclusive_in === "boolean" ? tax_inclusive_in : undefined,
      outletId: Number(outlet_id),
      tenantId: req.tenantId,
    });
    const taxInclusiveResolved = taxSnapshot.taxInclusive;
    const taxByIndex = taxSnapshot.lines;
    const taxTotalSnapshot = taxSnapshot.taxTotal;
    const subtotalSnapshot = taxSnapshot.subtotal;

    // Start Transaction Logic
    try {
      const saleId = await db.transaction(async (client) => {
        // Lock and check stock for each item (FOR UPDATE prevents TOCTOU race)
        // Pre-fetch bundle components for any bundle items
        // F01: resolve each line's consumption mode from the DB
        // (server-authoritative — never trust client-sent item.is_bundle). Kits
        // expand to components via the shared kit-engine; 'assembled'/'standard'
        // decrement their own stock. Component locking is stable-ordered inside
        // the engine so concurrent sales of overlapping kits can't deadlock.
        const kitMap = await kitEngine.loadKitMap(
          client,
          cartItems.map((it) => Number(it.original_product_id || it.id))
        );
        const kitInfoFor = (item) =>
          kitMap.get(Number(item.original_product_id || item.id));
        const isKit = (item) => kitInfoFor(item)?.bomType === "kit";
        // F07: which cart lines are batch-tracked — one batched lookup so a cart
        // of untracked SKUs pays zero extra queries (regression guarantee).
        const trackedMap = await batchStock.loadTrackedMap(
          client,
          cartItems.map((it) => Number(it.original_product_id || it.id))
        );
        const isTrackedLine = (item) =>
          trackedMap.get(Number(item.original_product_id || item.id)) === true;
        // Locked component decrements per cart line, reused in the deduct pass so
        // every row is locked+checked before any write.
        const kitDecrementsByIndex = {};

        // Non-inventory product types (services + F02 packages) have no stock
        // to gate — a package/service line rings up regardless of outlet_stock.
        // Only the availability guard is skipped; the (no-op) deduction below
        // is unaffected, so a service that DOES carry stock still behaves as
        // before.
        const nonInventoryProductIds = new Set();
        {
          const cartProductIds = Array.from(new Set(
            cartItems
              .filter((i) => !i.is_bundle && !i.variant_id)
              .map((i) => Number(i.original_product_id || i.id))
              .filter((n) => Number.isInteger(n) && n > 0),
          ));
          if (cartProductIds.length) {
            const { rows: niRows } = await client.query(
              `SELECT id FROM products
                WHERE id = ANY($1::int[]) AND product_type IN ('service','package')`,
              [cartProductIds],
            );
            for (const r of niRows) nonInventoryProductIds.add(Number(r.id));
          }
        }

        for (let ci = 0; ci < cartItems.length; ci++) {
          const item = cartItems[ci];
          if (isKit(item)) {
            const productId = item.original_product_id || item.id;
            kitDecrementsByIndex[ci] = await kitEngine.reserveComponents(client, {
              productId,
              outletId: outlet_id,
              saleQty: item.quantity,
              components: kitInfoFor(item).components,
            });
          } else {
            const variantId = item.variant_id || null;
            if (variantId) {
              // 2-G.1: per-outlet stock is the authoritative gate when a
              // variant_outlet_stock row exists; fall back to the rollup
              // (product_variants.stock) for variants that haven't been
              // backfilled for this outlet yet (pre-v65 tenants).
              const { rows: [vos] } = await client.query(
                `SELECT COALESCE(quantity, 0) AS available
                   FROM variant_outlet_stock
                  WHERE variant_id = $1 AND outlet_id = $2
                  FOR UPDATE`,
                [variantId, outlet_id]
              );
              if (vos) {
                if (vos.available < item.quantity) {
                  throw Object.assign(
                    new Error(`Insufficient stock for variant ${variantId} at this outlet`),
                    {
                      statusCode: 400,
                      code: "insufficient_stock",
                      product_id: item.id,
                      variant_id: variantId,
                      available: Number(vos.available),
                      requested: Number(item.quantity),
                    }
                  );
                }
              } else {
                const { rows: [row] } = await client.query(
                  `SELECT COALESCE(stock, 0) AS available
                     FROM product_variants WHERE id = $1 FOR UPDATE`,
                  [variantId]
                );
                if (!row || row.available < item.quantity) {
                  throw Object.assign(
                    new Error(`Insufficient stock for variant ${variantId}`),
                    {
                      statusCode: 400,
                      code: "insufficient_stock",
                      product_id: item.id,
                      variant_id: variantId,
                      available: Number(row?.available ?? 0),
                      requested: Number(item.quantity),
                    }
                  );
                }
              }
            } else {
              const productId = item.original_product_id || item.id;
              if (nonInventoryProductIds.has(Number(productId))) {
                continue; // service / package line — nothing to gate
              }
              const { rows: [row] } = await client.query(
                `SELECT COALESCE(quantity, 0) AS available
                 FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
                [productId, outlet_id]
              );
              if (!row || row.available < item.quantity) {
                throw Object.assign(
                  new Error(`Insufficient stock for product ${productId}`),
                  {
                    statusCode: 400,
                    code: "insufficient_stock",
                    product_id: productId,
                    available: Number(row?.available ?? 0),
                    requested: Number(item.quantity),
                  }
                );
              }
            }
          }
        }

        // 2. Insert into Sales Table
        const { rows: [saleRow] } = await client.query(
          "INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, points_earned, points_redeemed, notes, shift_id, idempotency_key, folio_id, treatment_folio_id, subtotal, tax_total, tax_inclusive, field_visit_id, appointment_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id",
          [
            totalAmount,
            mainPaymentMethod,
            outlet_id,
            authenticatedEmployeeId,
            customer_id || null,
            discountValue,
            discount_type,
            points_earned,
            points_redeemed,
            notes || null,
            activeShift.id,
            idempotency_key || null,
            chargeToFolio ? chargeToFolio.id : null,
            chargeToTreatmentFolio ? chargeToTreatmentFolio.id : null,
            subtotalSnapshot,
            taxTotalSnapshot,
            taxInclusiveResolved,
            field_visit_id || null,
            appointment_id ? Number(appointment_id) : null,
          ]
        );
        const newSaleId = saleRow.id;

        // Tier 1.3 wholesale schemes — persist applied promotions as audit
        // rows. Best-effort: schema may not have the table yet on tenants
        // that haven't run v93 (graceful skip via SAVEPOINT).
        if (Array.isArray(applied_promotions) && applied_promotions.length) {
          try {
            await client.query("SAVEPOINT sale_promo_audit");
            for (const ap of applied_promotions) {
              const promoId = Number(ap?.promotion_id);
              const discount = Number(ap?.discount);
              if (!Number.isFinite(promoId) || !Number.isFinite(discount) || discount <= 0) continue;
              await client.query(
                `INSERT INTO sale_promotion_applications
                   (sale_id, promotion_id, promotion_name_snapshot, promotion_type_snapshot,
                    qty_qualifying, discount_value, tier_snapshot)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  newSaleId,
                  promoId,
                  String(ap?.name || "").slice(0, 200),
                  String(ap?.type || "").slice(0, 50),
                  ap?.qty_qualifying != null ? Number(ap.qty_qualifying) : null,
                  discount,
                  ap?.tier ? JSON.stringify(ap.tier) : null,
                ],
              );
            }
            await client.query("RELEASE SAVEPOINT sale_promo_audit");
          } catch (err) {
            await client.query("ROLLBACK TO SAVEPOINT sale_promo_audit");
            // Don't fail the sale on audit failure — log and continue.
            // eslint-disable-next-line no-console
            console.warn(`[sales] sale_promotion_applications skipped: ${err.message}`);
          }
        }

        // 3. Loop through cart to insert Line Items AND deduct stock
        for (let cartIdx = 0; cartIdx < cartItems.length; cartIdx++) {
          const item = cartItems[cartIdx];
          // M5: gross_weight/tare_weight persist audit trail for weighted items.
          // Non-weighted items pass null/0 and behave identically to pre-M5.
          // 2-G.5: price_override_* columns are NULL unless an override was
          // validated in the pre-transaction pass (overridesByIndex).
          const ov = overridesByIndex[cartIdx];
          const taxLine = taxByIndex[cartIdx] || { rate: 0, amount: 0, hsCode: null };
          const { rows: [insertedLine] } = await client.query(
            `INSERT INTO sale_items
               (sale_id, product_id, variant_id, quantity, price_at_sale,
                cost_price_at_sale, gross_weight, tare_weight, staff_id, seat_number,
                price_override_amount, price_override_reason_id,
                price_override_approved_by, price_override_approved_at,
                price_override_approval_event_id,
                tax_rate_at_sale, tax_amount_at_sale, hs_code_at_sale)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             RETURNING id`,
            [
              newSaleId,
              item.original_product_id || item.id,
              item.variant_id || null,
              item.quantity,
              item.price,
              item.cost_price || 0,
              item.gross_weight != null ? Number(item.gross_weight) : null,
              item.tare_weight != null ? Number(item.tare_weight) : 0,
              // v49: service items (car wash, tailoring) can be assigned to staff.
              item.staff_id ? Number(item.staff_id) : null,
              // 2-R.8: seat_number carried from the draft_order item (dine-in
              // checks stamp this via SeatCoursePicker); retail carts pass null.
              item.seat_number != null ? Number(item.seat_number) : null,
              ov ? ov.originalPrice : null,
              ov ? ov.reasonId : null,
              ov ? ov.approvedBy : null,
              ov ? new Date() : null,
              ov ? ov.approvalEventId : null,
              // P8 (v83): per-line tax snapshot
              Number(taxLine.rate || 0),
              Number(taxLine.amount || 0),
              taxLine.hsCode || null,
            ]
          );
          const saleItemId = insertedLine.id;

          // 2-G.6: stamp each scanned serial — insert bridge row, flip status
          // to 'sold', populate warranty_start_date (today) + compute
          // warranty_end_date from the warranty_months snapshot. sale_id is
          // kept populated on product_serial_numbers as a deprecation cushion
          // until Phase 3 drops it.
          const serialList = serialsByIndex[cartIdx];
          if (serialList && serialList.length) {
            for (const sr of serialList) {
              await client.query(
                `INSERT INTO sale_item_serials (sale_item_id, serial_id)
                   VALUES ($1, $2)`,
                [saleItemId, sr.id],
              );
              const months = sr.warranty_months;
              await client.query(
                `UPDATE product_serial_numbers
                    SET status = 'sold',
                        sale_id = $1,
                        warranty_start_date = CURRENT_DATE,
                        warranty_end_date = CASE
                          WHEN $2::int IS NULL THEN NULL
                          ELSE CURRENT_DATE + ($2::int * INTERVAL '1 month')
                        END
                  WHERE id = $3`,
                [newSaleId, months, sr.id],
              );
            }
          }

          // F02 — redeem-at-checkout. A cart line flagged with
          // redeem_customer_package_id is "paid with package": the line rings
          // up at price 0 (client-sent) and a package_redemptions row is
          // written inside the sale transaction, so a rolled-back sale un-does
          // the redemption. Scope is validated against the line's service.
          if (packagesFlagOn && item.redeem_customer_package_id) {
            if (!customer_id) {
              throw Object.assign(
                new Error("Redeeming a package requires a customer on the sale"),
                { statusCode: 400 },
              );
            }
            const pkgService = require("../services/packages");
            const redeemProductId = Number(item.original_product_id || item.id);
            const bookingServiceId =
              await pkgService.resolveBookingServiceForProduct(client, redeemProductId);
            await pkgService.redeemPackage(client, {
              customerPackageId: Number(item.redeem_customer_package_id),
              customerId: customer_id,
              credits: 1,
              saleId: newSaleId,
              appointmentId: appointment_id ? Number(appointment_id) : null,
              bookingServiceId,
            });
          }

          // v45: stock columns are NUMERIC(10,3) — deduct the exact sold quantity,
          // no rounding. Weighted sales (e.g. 1.25 kg) deduct 1.25 from stock.
          const stockDeductQty = Number(item.quantity);

          const lineProductId = item.original_product_id || item.id;
          if (isKit(item)) {
            // Deduct the components locked + verified in the check pass above.
            await kitEngine.decrementComponents(client, {
              outletId: outlet_id,
              decrements: kitDecrementsByIndex[cartIdx] || [],
            });
            // F07: a kit holds no stock; consume batches PER COMPONENT (the engine
            // stays batch-agnostic — consumeBatches self-skips untracked components).
            for (const d of kitDecrementsByIndex[cartIdx] || []) {
              await batchStock.consumeBatches(client, {
                productId: d.component_product_id,
                variantId: d.component_variant_id || null,
                outletId: outlet_id,
                qty: d.needed,
                refType: "sale",
                refId: newSaleId,
              });
            }
          } else if (item.variant_id) {
            // 2-G.1: deduct per-variant outlet stock (upsert creates the row
            // if this variant hasn't been stocked at this outlet yet).
            // product_variants.stock stays in sync as a cross-outlet rollup
            // so legacy reads (and outlet-unaware callers) still work.
            await client.query(
              `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
                 VALUES ($1, $2, 0 - $3::numeric)
                 ON CONFLICT (variant_id, outlet_id)
                 DO UPDATE SET quantity = variant_outlet_stock.quantity - $3::numeric`,
              [item.variant_id, outlet_id, stockDeductQty]
            );
            await client.query(
              "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
              [stockDeductQty, item.variant_id]
            );
            await client.query(
              "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
              [stockDeductQty, lineProductId, outlet_id]
            );
            // F07: FEFO-consume batches for tracked SKUs, in the same tx that
            // just decremented outlet_stock under FOR UPDATE (drift-tolerant).
            if (isTrackedLine(item)) {
              await batchStock.consumeBatches(client, {
                productId: lineProductId,
                variantId: item.variant_id || null,
                outletId: outlet_id,
                qty: stockDeductQty,
                refType: "sale",
                refId: newSaleId,
                batchId: item.batch_id || null, // optional manual pick (roll/carcass)
              });
            }
          } else {
            await client.query(
              "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
              [stockDeductQty, item.id, outlet_id]
            );
            if (isTrackedLine(item)) {
              await batchStock.consumeBatches(client, {
                productId: lineProductId,
                outletId: outlet_id,
                qty: stockDeductQty,
                refType: "sale",
                refId: newSaleId,
                batchId: item.batch_id || null,
              });
            }
          }
        }

        // 4. Insert Payments (with gateway bridge for card payments)
        const paymentGateway = require("../services/payment-gateway");
        for (const payment of finalPayments) {
          let gatewayRef = null;
          if (payment.method === "Card" && paymentGateway.isEnabled()) {
            try {
              const result = await paymentGateway.processInlinePayment({
                amount: payment.amount,
                currency: "PKR",
                reference: `pos-sale-${newSaleId}`,
              });
              gatewayRef = result.gateway_ref;
            } catch (gwErr) {
              throw Object.assign(new Error("Card payment processing failed: " + gwErr.message), { statusCode: 402 });
            }
          }

          // Phase 2-G Wave 2 (2-G.2) — gift-card tender. Redeem the
          // card row inside this transaction; any failure (bad code,
          // insufficient balance, card depleted) throws with statusCode
          // and rolls the whole sale back.
          if (payment.method === "gift_card") {
            const code = String(payment.code || payment.reference || "").trim();
            const amt = Number(payment.amount);
            if (!code) {
              throw Object.assign(
                new Error("gift_card tender requires a code"),
                { statusCode: 400 },
              );
            }
            const { rows: [card] } = await client.query(
              `SELECT id, activation_status,
                      remaining_value::numeric AS remaining_value
                 FROM gift_cards WHERE code = $1 FOR UPDATE`,
              [code],
            );
            if (!card) {
              throw Object.assign(new Error("Gift card not found"), {
                statusCode: 404,
              });
            }
            if (card.activation_status !== "active") {
              throw Object.assign(
                new Error(`Gift card is ${card.activation_status}`),
                { statusCode: 400 },
              );
            }
            if (amt > Number(card.remaining_value)) {
              throw Object.assign(
                new Error(
                  `Gift card balance (${Number(card.remaining_value)}) < amount (${amt})`,
                ),
                { statusCode: 400 },
              );
            }
            const newRemaining = Number(card.remaining_value) - amt;
            const newStatus = newRemaining <= 0 ? "depleted" : "active";
            await client.query(
              `UPDATE gift_cards
                  SET remaining_value = $1,
                      activation_status = $2,
                      redeemed_at = COALESCE(redeemed_at, CASE WHEN $2 = 'depleted' THEN NOW() END)
                WHERE id = $3`,
              [newRemaining, newStatus, card.id],
            );
            await client.query(
              `INSERT INTO gift_card_transactions
                 (gift_card_id, type, amount, reference_type, reference_id, note)
               VALUES ($1, 'debit', $2, 'sale', $3, $4)`,
              [card.id, amt, newSaleId, `Redeemed on sale #${newSaleId}`],
            );
            gatewayRef = `giftcard:${code}`;
          }

          await client.query(
            "INSERT INTO sale_payments (sale_id, payment_method, amount, gateway_ref) VALUES ($1, $2, $3, $4)",
            [newSaleId, payment.method, payment.amount, gatewayRef]
          );
        }

        // Tier 0.1 wholesale — when the sale uses a Credit (on-account) tender,
        // create a matching customer_invoices row in the same transaction so
        // the AR balance reflects the new liability immediately. Linked via
        // sales.customer_invoice_id (v88) so refunds can route to credit_reversal.
        if (creditTender && customer_id) {
          // Compute due_date from payment_terms_days. Use CURRENT_DATE so the
          // date is in tenant timezone-naive form (DATE column).
          const termsDays = Number(creditTender.payment_terms_days || 0);
          const invoiceNumber = `INV-AR-${newSaleId}`;
          const { rows: [arInvoice] } = await client.query(
            `INSERT INTO customer_invoices
               (invoice_number, customer_id, outlet_id, employee_id, status,
                subtotal, tax_total, discount_amount, total_amount, balance_due,
                due_date, notes)
             VALUES ($1, $2, $3, $4, 'sent',
                     $5, $6, 0, $7, $7,
                     CURRENT_DATE + ($8::int) * INTERVAL '1 day',
                     $9)
             RETURNING id, invoice_number, due_date, total_amount`,
            [
              invoiceNumber,
              customer_id,
              outlet_id || null,
              authenticatedEmployeeId,
              Number(creditTender.amount),  // subtotal — for on-account sales we
              0,                            // record the full amount as subtotal
              Number(creditTender.amount),  // and put tax_total at 0; the real
              termsDays,                    // tax split lives on sale_items.
              `Auto-generated from POS sale #${newSaleId} (Credit tender)`,
            ]
          );
          await client.query(
            `UPDATE sales SET customer_invoice_id = $1 WHERE id = $2`,
            [arInvoice.id, newSaleId]
          );
          // Surface to /api/sales response so the POS receipt can render
          // the A/R invoice number + due date for credit sales.
          creditArInvoice = {
            id: arInvoice.id,
            invoice_number: arInvoice.invoice_number,
            due_date: arInvoice.due_date,
            total_amount: Number(arInvoice.total_amount),
            payment_terms_days: termsDays,
          };
        }

        // M9 — if this is a charge-to-room sale, attach it to the open folio.
        // Runs inside the sale transaction: if the folio write fails, the sale
        // rolls back too (cross-domain atomicity).
        if (chargeToFolio) {
          const roomService = require("../services/room-service");
          await roomService.attachSaleToFolio(client, {
            saleId: newSaleId,
            folioId: chargeToFolio.id,
            amount: totalAmount,
            description: `POS sale #${newSaleId}`,
            employeeId: authenticatedEmployeeId,
          });
        }

        // M10 — same pattern for treatment folios.
        if (chargeToTreatmentFolio) {
          const tpService = require("../services/treatment-plan-service");
          await client.query(
            `INSERT INTO treatment_folio_lines
               (folio_id, line_type, description, quantity, unit_price, line_total, sale_id, added_by)
             VALUES ($1, 'pos_sale', $2, 1, $3, $3, $4, $5)`,
            [
              chargeToTreatmentFolio.id,
              `POS sale #${newSaleId}`,
              totalAmount,
              newSaleId,
              authenticatedEmployeeId,
            ]
          );
          await tpService.recalcFolioTotals(client, chargeToTreatmentFolio.id);
        }

        // Update customer loyalty: tier-aware points + total_spend + auto-upgrade
        if (customer_id) {
          // Fetch customer's current tier multiplier (default 1.0 if no tier)
          const { rows: [custTier] } = await client.query(
            `SELECT lt.points_multiplier FROM customers c
             LEFT JOIN loyalty_tiers lt ON c.loyalty_tier_id = lt.id
             WHERE c.id = $1`,
            [customer_id]
          );
          const multiplier = Number(custTier?.points_multiplier) || 1.0;
          // Backend-authoritative: recalculate points_earned with tier multiplier
          const effectivePointsEarned = points_earned > 0
            ? Math.floor(points_earned * multiplier)
            : 0;

          if (effectivePointsEarned > 0 || points_redeemed > 0) {
            await client.query(
              "UPDATE customers SET loyalty_points = loyalty_points + $1 - $2 WHERE id = $3",
              [effectivePointsEarned, points_redeemed, customer_id]
            );
            // Update the sale row with the actual (multiplied) points_earned
            if (effectivePointsEarned !== points_earned) {
              await client.query(
                "UPDATE sales SET points_earned = $1 WHERE id = $2",
                [effectivePointsEarned, newSaleId]
              );
            }

            // Phase 2-G Wave 2 (2-G.3) — loyalty ledger writes. Only when
            // phase2g_loyalty is on, so pre-wave-2 tenants continue seeing
            // balance-only loyalty without an audit trail.
            if (loyaltyFlagOn) {
              if (effectivePointsEarned > 0) {
                await client.query(
                  `INSERT INTO loyalty_transactions
                     (customer_id, type, points, reference_type, reference_id, note)
                   VALUES ($1, 'earn', $2, 'sale', $3, $4)`,
                  [
                    customer_id,
                    effectivePointsEarned,
                    newSaleId,
                    `Earned on sale #${newSaleId}`,
                  ]
                );
              }
              if (Number(points_redeemed) > 0) {
                await client.query(
                  `INSERT INTO loyalty_transactions
                     (customer_id, type, points, reference_type, reference_id, note)
                   VALUES ($1, 'redeem', $2, 'sale', $3, $4)`,
                  [
                    customer_id,
                    Number(points_redeemed),
                    newSaleId,
                    `Redeemed on sale #${newSaleId}`,
                  ]
                );
              }
            }
          }

          // Update total_spend and auto-upgrade tier
          await client.query(
            "UPDATE customers SET total_spend = COALESCE(total_spend, 0) + $1 WHERE id = $2",
            [totalAmount, customer_id]
          );
          const { rows: [updated] } = await client.query(
            "SELECT COALESCE(total_spend, 0) AS total_spend FROM customers WHERE id = $1",
            [customer_id]
          );
          const newSpend = Number(updated.total_spend);
          // Find the highest tier the customer qualifies for
          const { rows: [bestTier] } = await client.query(
            "SELECT id FROM loyalty_tiers WHERE min_spend <= $1 AND is_active = true ORDER BY min_spend DESC LIMIT 1",
            [newSpend]
          );
          if (bestTier) {
            await client.query(
              "UPDATE customers SET loyalty_tier_id = $1 WHERE id = $2 AND (loyalty_tier_id IS NULL OR loyalty_tier_id != $1)",
              [bestTier.id, customer_id]
            );
          }
        }

        // Phase 2-G Wave 2 (2-G.2) — gift-card issue. For each cart
        // line whose product.is_gift_card_sku=true, generate one
        // gift_cards row per unit at face value = item.price. Written
        // inside the sale transaction so a rollback un-issues them.
        // Emails are enqueued AFTER commit (see post-commit block).
        if (giftCardsFlagOn && cartItems.length > 0) {
          const productIds = Array.from(
            new Set(
              cartItems
                .map((i) => Number(i.original_product_id || i.id))
                .filter((n) => Number.isInteger(n) && n > 0),
            ),
          );
          if (productIds.length > 0) {
            const { rows: gcProducts } = await client.query(
              `SELECT id, name FROM products
                WHERE id = ANY($1::int[]) AND is_gift_card_sku = true`,
              [productIds],
            );
            const gcSet = new Set(gcProducts.map((r) => r.id));
            if (gcSet.size > 0) {
              const crypto = require("crypto");
              for (const item of cartItems) {
                const productId = Number(item.original_product_id || item.id);
                if (!gcSet.has(productId)) continue;
                const unitPrice = Number(item.price);
                const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
                for (let i = 0; i < qty; i += 1) {
                  // 12-char uppercase hex — same entropy as the admin
                  // create route. The UNIQUE constraint on `code` will
                  // throw if we collide; at 2^60 entropy this is safe.
                  const code = crypto.randomBytes(6).toString("hex").toUpperCase();
                  const { rows: [cardRow] } = await client.query(
                    `INSERT INTO gift_cards
                       (code, initial_value, remaining_value, card_type,
                        activation_status, issued_to_customer_id,
                        issued_from_sale_id)
                     VALUES ($1, $2, $2, 'digital', 'active', $3, $4)
                     RETURNING id, code,
                               initial_value::numeric AS initial_value`,
                    [code, unitPrice, customer_id || null, newSaleId],
                  );
                  await client.query(
                    `INSERT INTO gift_card_transactions
                       (gift_card_id, type, amount, reference_type, reference_id, note)
                     VALUES ($1, 'credit', $2, 'sale', $3, 'Issued on sale')`,
                    [cardRow.id, unitPrice, newSaleId],
                  );
                  issuedCards.push({
                    id: cardRow.id,
                    code: cardRow.code,
                    initial_value: Number(cardRow.initial_value),
                    product_id: productId,
                  });
                }
              }
            }
          }
        }

        // F02 — sell-at-POS. For each cart line whose product backs a package
        // template, issue one customer_packages row per unit at sale commit
        // (mirrors the gift-card issue hook). Requires a customer — a package
        // has no owner without one, so an anonymous package line rolls the sale
        // back rather than silently dropping the entitlement.
        if (packagesFlagOn && cartItems.length > 0) {
          const pkgProductIds = Array.from(
            new Set(
              cartItems
                .map((i) => Number(i.original_product_id || i.id))
                .filter((n) => Number.isInteger(n) && n > 0),
            ),
          );
          if (pkgProductIds.length > 0) {
            const { rows: tpls } = await client.query(
              `SELECT id, product_id FROM package_templates
                WHERE product_id = ANY($1::int[]) AND is_active = true`,
              [pkgProductIds],
            );
            if (tpls.length > 0) {
              const byProduct = new Map(tpls.map((t) => [t.product_id, t.id]));
              const pkgService = require("../services/packages");
              for (const item of cartItems) {
                const pid = Number(item.original_product_id || item.id);
                const templateId = byProduct.get(pid);
                if (!templateId) continue;
                if (!customer_id) {
                  throw Object.assign(
                    new Error("Selling a package requires a customer on the sale"),
                    { statusCode: 400 },
                  );
                }
                const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
                for (let i = 0; i < qty; i += 1) {
                  const pkg = await pkgService.sellPackage(client, {
                    customerId: customer_id,
                    templateId,
                    saleId: newSaleId,
                  });
                  soldPackages.push(pkg);
                }
              }
            }
          }
        }

        // Debit wallet for any Wallet payments
        const walletPayments = finalPayments.filter(
          (p) => p.method === "Wallet",
        );
        if (customer_id && walletPayments.length > 0) {
          const walletTotal = walletPayments.reduce(
            (s, p) => s + p.amount,
            0,
          );
          await client.query(
            "UPDATE customers SET balance = COALESCE(balance, 0) - $1 WHERE id = $2",
            [walletTotal, customer_id]
          );
          await client.query(
            "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, reference_id, note) VALUES ($1, 'debit', $2, 'sale', $3, $4)",
            [customer_id, walletTotal, newSaleId, `Debit for Sale #${newSaleId}`]
          );
        }

        return newSaleId;
      });

      // Phase 2-G Wave 2 (2-G.2) — post-commit gift-card email. Only
      // fires when the sale persisted + there's a recipient email
      // (either on the customer record or passed explicitly). Fire-and-
      // forget: email failures never re-open a committed sale.
      if (issuedCards.length > 0) {
        (async () => {
          try {
            const { enqueueEmail } = require("../services/email");
            let recipientEmail = null;
            let recipientName = "there";
            if (customer_id) {
              const { rows: [c] } = await db.query(
                `SELECT name, email FROM customers WHERE id = $1`,
                [customer_id],
              );
              if (c) {
                recipientEmail = c.email || null;
                recipientName = c.name || recipientName;
              }
            }
            if (!recipientEmail) return; // No email on file; nothing to send.
            const { rows: [cp] } = await db.query(
              `SELECT company_name, currency_symbol FROM company_profile WHERE id = 1`,
            );
            for (const card of issuedCards) {
              await enqueueEmail(db, {
                to: recipientEmail,
                template: "gift_card_issued",
                data: {
                  storeName: cp?.company_name || "our store",
                  recipientName,
                  code: card.code,
                  initialValue: card.initial_value,
                  currencySymbol: cp?.currency_symbol || "PKR",
                  balanceUrl: req.tenantSlug
                    ? `${process.env.FRONTEND_URL || ""}/gift-card/${card.code}?tenant=${req.tenantSlug}`
                    : `${process.env.FRONTEND_URL || ""}/gift-card/${card.code}`,
                },
              });
            }
          } catch (emailErr) {
            try {
              logger.warn?.({ err: emailErr }, "gift-card email enqueue failed");
            } catch { /* ignore */ }
          }
        })();
      }

      // Post-commit: sync events, low stock notification, invoice assignment
      const syncChanges = cartItems.map((item) => ({
        product_id:
          item.original_product_id || item.product_id || item.id,
        variant_id: item.variant_id || null,
        outlet_id,
        delta: -1 * Number(item.quantity || 0),
        reason: "sale",
        reference_type: "sale",
        reference_id: saleId,
      }));
      enqueueInventorySyncEvents(syncChanges, {}, () => {});
      notifyLowStockForSale(cartItems, outlet_id);

      try {
        const invoiceNumber = await assignInvoiceNumberToSale(saleId, 1);

        // FBR Digital Invoicing — enqueue if enabled
        try {
          const { rows: [ff] } = await db.query(
            "SELECT enabled FROM feature_flags WHERE key = 'fbr_integration'"
          );
          if (ff?.enabled) {
            const { buildInvoicePayload, enqueueFbrInvoice } = require("../services/fbr");
            const { fetchCategoryIndexes } = require("../category-tree");
            const categoryTree = await fetchCategoryIndexes(db);
            const { rows: saleItems } = await db.query(
              `SELECT si.*, p.name as product_name, p.category_id
               FROM sale_items si LEFT JOIN products p ON si.product_id = p.id
               WHERE si.sale_id = $1`, [saleId]
            );
            const { rows: [cust] } = customer_id
              ? await db.query("SELECT name, ntn_cnic FROM customers WHERE id = $1", [customer_id])
              : { rows: [null] };
            const payload = buildInvoicePayload(
              { timestamp: new Date(), invoice_number: invoiceNumber },
              saleItems, req.company, cust, categoryTree
            );
            await enqueueFbrInvoice(db, { saleId, invoiceType: "sale", payload, tenantSlug: req.tenantSlug });
            await db.query("UPDATE sales SET fbr_status = 'pending' WHERE id = $1", [saleId]);
          }
        } catch (fbrErr) {
          logger.error({ err: fbrErr, saleId }, "FBR enqueue failed (non-blocking)");
        }

        // W17 — restaurant settle: flip the linked draft to completed and
        // mark the table session 'dirty' so the busser sees it on the floor
        // view and can clear it. Best-effort: failures don't block the sale
        // response. Only runs when the caller actually passed a draft id —
        // retail sales / walk-in tabs without a table session skip.
        if (draft_order_id) {
          db.query(
            "UPDATE draft_orders SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status IN ('open','claimed')",
            [draft_order_id]
          ).catch((err) => logger.error({ err, draft_order_id }, "[settle] draft_orders complete failed (non-blocking)"));
        }
        if (table_session_id) {
          db.query(
            "UPDATE restaurant_table_sessions SET status = 'dirty', updated_at = NOW() WHERE id = $1 AND status NOT IN ('closed','dirty')",
            [table_session_id]
          ).catch((err) => logger.error({ err, table_session_id }, "[settle] table_session dirty flip failed (non-blocking)"));
        }

        // F06 — checkout completes the linked appointment (backlink + status).
        // sale_id IS NULL guard: if two sales raced past the pre-check, only
        // the first one wins the link; the second keeps its own forward link
        // for audit but doesn't flip the appointment twice.
        if (appointment_id) {
          db.query(
            `UPDATE appointments SET sale_id = $1, status = 'completed', updated_at = NOW()
             WHERE id = $2 AND sale_id IS NULL`,
            [saleId, Number(appointment_id)]
          ).catch((err) => logger.error({ err, appointment_id, saleId }, "[f06] appointment completion failed (non-blocking)"));
        }

        // Phase 2.1 C1 — capture tip on this sale (restaurant flow). Fire-
        // and-forget; failure shouldn't block the sale response. Only runs
        // when the caller actually passed a tip — non-restaurant sales skip.
        // W24: surface failures to Sentry so silent drops (e.g. wrong-cased
        // tip_method) become observable instead of vanishing into Pino logs.
        if (Number(tip_amount) > 0 && tip_method) {
          const tipsService = require("../services/tips");
          tipsService
            .captureTipOnSale(db, {
              sale_id: saleId,
              draft_order_id: draft_order_id || null,
              tip_amount,
              tip_method,
              server_id: server_id || null,
            })
            .catch((err) => {
              logger.error({ err, saleId, tip_method, tip_amount }, "[tips] captureTipOnSale failed (non-blocking)");
              try {
                const Sentry = require("@sentry/node");
                Sentry.captureException(err, {
                  tags: { component: "tips", saleId: String(saleId) },
                  extra: { tip_method, tip_amount, server_id, draft_order_id },
                });
              } catch { /* Sentry not initialised in tests; ignore */ }
            });
        }

        // Auto-calculate commissions (fire-and-forget, don't block sale
        // response). F06 fix: the shared per-line engine attributes each
        // sale line to its staff_id (stylist/provider) and falls back to
        // the cashier — the old inline INSERT credited the cashier with
        // the whole sale, so salon color+cut commissions went to whoever
        // rang up the sale instead of the stylists on the lines.
        if (authenticatedEmployeeId) {
          const { calculateCommissionsForSale } = require("../services/commission-calc");
          calculateCommissionsForSale(db, saleId)
            .catch(err => console.error("[commission] auto-calc error:", err.message));
        }

        res.json({
          message: "Sale completed successfully",
          saleId,
          totalAmount,
          invoiceNumber: invoiceNumber || null,
          payments: finalPayments,
          // Phase 2-G Wave 2: expose auto-pricing breakdown so the receipt
          // can surface group + tier discount lines and price-book swaps.
          autoPricing: {
            autoDiscountValue,
            priceBookApplied: autoPricingBreakdown.priceBookApplied,
            discountLines: autoPricingBreakdown.discountLines,
          },
          // Phase 2-G Wave 2 (2-G.2): codes issued on this sale so the
          // POS can print them on the receipt + show them in the
          // confirmation modal.
          issuedGiftCards: issuedCards,
          // F02 — packages issued on this sale (id + remaining) so the POS can
          // confirm the new pass balance in the receipt/confirmation modal.
          soldPackages: soldPackages.map((p) => ({
            id: p.id,
            credits_total: p.credits_total,
            credits_remaining: p.credits_total - p.credits_used,
            expires_at: p.expires_at,
          })),
          // Tier 0.1 wholesale — non-blocking notice when a Credit-tender sale
          // proceeded past credit_limit under credit_block_mode='warn'.
          creditWarning,
          // Tier 0.1 wholesale — A/R invoice details for the on-account sale
          // (null on cash/card sales). POS receipt renders these so the buyer
          // sees their AR reference number and when the payment is due.
          arInvoice: creditArInvoice,
        });
      } catch (invErr) {
        res.status(500).json({
          error: "Sale committed but invoice finalization failed",
          saleId,
          details: invErr.message,
        });
      }
    } catch (err) {
      if (err.statusCode) {
        // 2-G.15 Day 4: insufficient_stock now carries `available` +
        // `product_id` so the POS can render the backorder/oversell modal
        // without a second roundtrip. Other statusCode errors keep the
        // original shape.
        const body = { error: err.message, code: err.code };
        if (err.code === "insufficient_stock") {
          if (err.available != null) body.available = err.available;
          if (err.product_id != null) body.product_id = err.product_id;
          if (err.variant_id != null) body.variant_id = err.variant_id;
          if (err.requested != null) body.requested = err.requested;
        }
        return res.status(err.statusCode).json(body);
      }
      res.status(500).json({ error: err.message || "Transaction failed" });
    }
  });
};
