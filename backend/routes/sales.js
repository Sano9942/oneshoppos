const { toUtcStart, toUtcEnd } = require("../utils/tz");
const logger = require("../services/logger");

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

      const { rows: items } = await db.query(
        `SELECT si.*, p.name as product_name, p.barcode
       FROM sale_items si JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = $1`,
        [id]
      );

      const { rows: payments } = await db.query(
        "SELECT * FROM sale_payments WHERE sale_id = $1",
        [id]
      );

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
            // Check if this item is a bundle — restore component stock instead
            const { rows: [prod] } = await client.query(
              "SELECT is_bundle FROM products WHERE id = $1",
              [item.product_id]
            );

            if (prod && prod.is_bundle) {
              const { rows: comps } = await client.query(
                "SELECT component_product_id, component_variant_id, quantity FROM product_bundles WHERE product_id = $1",
                [item.product_id]
              );
              for (const comp of comps) {
                const restoreQty = comp.quantity * item.quantity;
                await client.query(
                  `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
                   ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
                  [comp.component_product_id, sale.outlet_id, restoreQty, restoreQty]
                );
                if (comp.component_variant_id) {
                  await client.query(
                    `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
                    [restoreQty, comp.component_variant_id]
                  );
                }
              }
            } else {
              await client.query(
                `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)
                 ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
                [item.product_id, sale.outlet_id, item.quantity, item.quantity]
              );

              // Restore variant global stock if item has a variant
              if (item.variant_id) {
                await client.query(
                  `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
                  [item.quantity, item.variant_id]
                );
              }
            }
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
    } = req.body;

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

      if (!idempotency_key || activeShift.status === "open") {
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

    // 1. Calculate Expected Total (subtotal minus discount)
    const subtotal = cartItems.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );
    const discountValue =
      discount_type === "percent"
        ? (subtotal * parseFloat(discount_amount || 0)) / 100
        : parseFloat(discount_amount || 0);
    const totalAmount =
      subtotal - discountValue - parseFloat(points_redeemed || 0);

    // Determine the actual payments to record
    let finalPayments = payments;
    let mainPaymentMethod = paymentMethod || "Cash";

    if (!finalPayments || finalPayments.length === 0) {
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

    // Start Transaction Logic
    try {
      const saleId = await db.transaction(async (client) => {
        // Lock and check stock for each item (FOR UPDATE prevents TOCTOU race)
        // Pre-fetch bundle components for any bundle items
        const bundleComponentsMap = new Map();
        for (const item of cartItems) {
          if (item.is_bundle) {
            const productId = item.original_product_id || item.id;
            const { rows: comps } = await client.query(
              "SELECT component_product_id, component_variant_id, quantity FROM product_bundles WHERE product_id = $1",
              [productId]
            );
            bundleComponentsMap.set(productId, comps);
          }
        }

        for (const item of cartItems) {
          if (item.is_bundle) {
            // For bundles: lock and check each component's stock
            const productId = item.original_product_id || item.id;
            const comps = bundleComponentsMap.get(productId) || [];
            for (const comp of comps) {
              const neededQty = comp.quantity * item.quantity;
              if (comp.component_variant_id) {
                const { rows: [row] } = await client.query(
                  `SELECT COALESCE(stock, 0) AS available
                   FROM product_variants WHERE id = $1 FOR UPDATE`,
                  [comp.component_variant_id]
                );
                if (!row || row.available < neededQty) {
                  throw Object.assign(
                    new Error(`Insufficient stock for bundle component variant ${comp.component_variant_id}`),
                    { statusCode: 400, code: "insufficient_stock" }
                  );
                }
              } else {
                const { rows: [row] } = await client.query(
                  `SELECT COALESCE(quantity, 0) AS available
                   FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
                  [comp.component_product_id, outlet_id]
                );
                if (!row || row.available < neededQty) {
                  throw Object.assign(
                    new Error(`Insufficient stock for bundle component ${comp.component_product_id}`),
                    { statusCode: 400, code: "insufficient_stock" }
                  );
                }
              }
            }
          } else {
            const variantId = item.variant_id || null;
            if (variantId) {
              const { rows: [row] } = await client.query(
                `SELECT COALESCE(stock, 0) AS available
                 FROM product_variants WHERE id = $1 FOR UPDATE`,
                [variantId]
              );
              if (!row || row.available < item.quantity) {
                throw Object.assign(
                  new Error(`Insufficient stock for variant ${variantId}`),
                  { statusCode: 400, code: "insufficient_stock" }
                );
              }
            } else {
              const productId = item.original_product_id || item.id;
              const { rows: [row] } = await client.query(
                `SELECT COALESCE(quantity, 0) AS available
                 FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
                [productId, outlet_id]
              );
              if (!row || row.available < item.quantity) {
                throw Object.assign(
                  new Error(`Insufficient stock for product ${productId}`),
                  { statusCode: 400, code: "insufficient_stock" }
                );
              }
            }
          }
        }

        // 2. Insert into Sales Table
        const { rows: [saleRow] } = await client.query(
          "INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, points_earned, points_redeemed, notes, shift_id, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id",
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
          ]
        );
        const newSaleId = saleRow.id;

        // 3. Loop through cart to insert Line Items AND deduct stock
        for (const item of cartItems) {
          await client.query(
            "INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale, cost_price_at_sale) VALUES ($1, $2, $3, $4, $5, $6)",
            [
              newSaleId,
              item.original_product_id || item.id,
              item.variant_id || null,
              item.quantity,
              item.price,
              item.cost_price || 0,
            ]
          );

          if (item.is_bundle) {
            // Deduct stock from each component product, not the bundle itself
            const productId = item.original_product_id || item.id;
            const comps = bundleComponentsMap.get(productId) || [];
            for (const comp of comps) {
              const deductQty = comp.quantity * item.quantity;
              if (comp.component_variant_id) {
                await client.query(
                  "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
                  [deductQty, comp.component_variant_id]
                );
              }
              await client.query(
                "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
                [deductQty, comp.component_product_id, outlet_id]
              );
            }
          } else if (item.variant_id) {
            await client.query(
              "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
              [item.quantity, item.variant_id]
            );
            await client.query(
              "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
              [item.quantity, item.original_product_id || item.id, outlet_id]
            );
          } else {
            await client.query(
              "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
              [item.quantity, item.id, outlet_id]
            );
          }
        }

        // 4. Insert Payments
        for (const payment of finalPayments) {
          await client.query(
            "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES ($1, $2, $3)",
            [newSaleId, payment.method, payment.amount]
          );
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

        res.json({
          message: "Sale completed successfully",
          saleId,
          totalAmount,
          invoiceNumber: invoiceNumber || null,
          payments: finalPayments,
        });
      } catch (invErr) {
        res.status(500).json({
          error: "Sale committed but invoice finalization failed",
          saleId,
          details: invErr.message,
        });
      }
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      res.status(500).json({ error: err.message || "Transaction failed" });
    }
  });
};
