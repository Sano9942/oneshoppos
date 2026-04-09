const { toUtcStart, toUtcEnd } = require("../utils/tz");
const logger = require("../services/logger");
const { validate } = require("../middleware/validate");
const { CreateReturnSchema } = require("../schemas/returns");

module.exports = function registerReturnsRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, createNotification, notifyLowStockForSale } = deps;

  function enqueueInventorySyncEvents(changes, context, cb) {
    try {
      const fn = deps.enqueueInventorySyncEvents;
      if (typeof fn === "function") return fn(changes, context, cb);
    } catch { /* ignore */ }
    if (typeof cb === "function") cb(null, { queued: 0, skipped: changes.length });
  }

// --- ROUTES: RETURNS ---

  /**
   * @swagger
   * /api/returns:
   *   post:
   *     summary: Create a return
   *     description: Process a sale return. Requires original_sale_id, total_refund, and refund_method. Restores stock to outlet and product variants.
   *     tags: [Returns]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [original_sale_id, total_refund, refund_method, items]
   *             properties:
   *               original_sale_id: { type: integer }
   *               total_refund: { type: number, format: double }
   *               refund_method: { type: string, enum: [cash, card, credit, store_credit] }
   *               reason: { type: string }
   *               items:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [product_id, quantity, refund_price]
   *                   properties:
   *                     product_id: { type: integer }
   *                     variant_id: { type: integer, nullable: true }
   *                     quantity: { type: integer }
   *                     refund_price: { type: number, format: double }
   *     responses:
   *       201:
   *         description: Return created
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   */
  // ── Return Quote (preflight check) ─────────────────────────────────────────
  app.post("/api/returns/quote", requirePerm("manage_orders"), async (req, res) => {
    const { original_sale_id, items } = req.body;
    try {
      // Find default return policy
      let policy = null;
      try {
        const { rows } = await db.query(
          "SELECT * FROM return_policies WHERE is_default = TRUE AND is_active = TRUE LIMIT 1"
        );
        policy = rows[0] || null;
      } catch (_) { /* table may not exist */ }

      // If no policy, allow by default
      if (!policy) {
        return res.json({
          eligible: true,
          policy_result: "allowed",
          reason: "No return policy configured",
          suggested_refund: null,
          restocking_fee: 0,
          allowed_refund_methods: ["cash", "card", "store_credit"],
        });
      }

      // Check time window
      let withinWindow = true;
      if (original_sale_id && policy.return_window_days) {
        const { rows: saleRows } = await db.query(
          'SELECT "timestamp" FROM sales WHERE id = $1',
          [original_sale_id]
        );
        if (saleRows[0]) {
          const saleDate = new Date(saleRows[0].timestamp);
          const daysSince = Math.floor((Date.now() - saleDate.getTime()) / 86400000);
          if (daysSince > policy.return_window_days) {
            withinWindow = false;
          }
        }
      }

      // Check receipt requirement
      const hasReceipt = !!original_sale_id;
      if (policy.receipt_required && !hasReceipt) {
        return res.json({
          eligible: false,
          policy_result: "approval_required",
          reason: "Receipt is required for returns under this policy",
          suggested_refund: null,
          restocking_fee: 0,
          allowed_refund_methods: policy.allowed_refund_methods || [],
        });
      }

      // Calculate suggested refund
      let suggestedRefund = 0;
      if (items && items.length > 0 && original_sale_id) {
        const { rows: saleItems } = await db.query(
          "SELECT product_id, variant_id, price, quantity FROM sale_items WHERE sale_id = $1",
          [original_sale_id]
        );
        for (const item of items) {
          const match = saleItems.find(s =>
            s.product_id === item.product_id &&
            (String(s.variant_id || "") === String(item.variant_id || ""))
          );
          if (match) {
            suggestedRefund += Number(match.price) * Number(item.quantity);
          }
        }
      }

      const restockingFee = Number(policy.restocking_fee_percent || 0) / 100 * suggestedRefund;
      const netRefund = Math.max(0, suggestedRefund - restockingFee);

      const policyResult = !withinWindow ? "approval_required" : "allowed";

      res.json({
        eligible: withinWindow,
        policy_result: policyResult,
        reason: !withinWindow ? `Return window of ${policy.return_window_days} days has expired` : null,
        suggested_refund: Math.round(netRefund * 100) / 100,
        restocking_fee: Math.round(restockingFee * 100) / 100,
        allowed_refund_methods: policy.allowed_refund_methods || [],
        policy_id: policy.id,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new return
  app.post("/api/returns", requirePerm("manage_orders"), validate(CreateReturnSchema), async (req, res) => {
    const {
      original_sale_id,
      web_order_id,
      outlet_id,
      employee_id,
      customer_id,
      total_refund,
      refund_method,
      reason,
      items,
      // Phase 2 optional fields
      policy_id,
      return_reason_id,
      processed_by_employee_id,
      approved_by_employee_id,
      approval_event_id,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Return must have items" });
    }
    if (!outlet_id) {
      return res
        .status(400)
        .json({ error: "Outlet ID is required for restocking" });
    }

    // B16 fix: validate each returned item against original sale
    if (original_sale_id) {
      try {
        const { rows: saleItems } = await db.query(
          `SELECT product_id, variant_id, SUM(quantity) AS sold_qty
           FROM sale_items WHERE sale_id = $1
           GROUP BY product_id, variant_id`,
          [original_sale_id],
        );
        if (!saleItems || saleItems.length === 0) {
          return res.status(400).json({ error: "Original sale not found or has no items" });
        }

        const soldMap = {};
        saleItems.forEach((r) => {
          const key = `${r.product_id}_${r.variant_id ?? "null"}`;
          soldMap[key] = Number(r.sold_qty);
        });

        for (const item of items) {
          const key = `${item.product_id}_${item.variant_id ?? "null"}`;
          if (!(key in soldMap)) {
            return res.status(400).json({
              error: item.variant_id
                ? `Variant ${item.variant_id} of product ${item.product_id} was not part of the original sale`
                : `Product ${item.product_id} was not part of the original sale`,
            });
          }
          if (item.quantity > soldMap[key]) {
            return res.status(400).json({
              error: `Return quantity ${item.quantity} exceeds sold quantity for this variant`,
            });
          }
        }
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Validate web_order_id when provided (web order return flow)
    if (web_order_id && !original_sale_id) {
      try {
        const { rows: woRows } = await db.query(
          "SELECT id FROM web_orders WHERE id = $1",
          [web_order_id],
        );
        if (!woRows.length) {
          return res.status(400).json({ error: "Web order not found" });
        }

        // Validate returned items against web order items
        const { rows: woItems } = await db.query(
          `SELECT product_id, variant_id, SUM(quantity) AS ordered_qty
           FROM web_order_items WHERE web_order_id = $1
           GROUP BY product_id, variant_id`,
          [web_order_id],
        );
        if (!woItems.length) {
          return res.status(400).json({ error: "Web order has no items" });
        }

        const orderedMap = {};
        woItems.forEach((r) => {
          const key = `${r.product_id}_${r.variant_id ?? "null"}`;
          orderedMap[key] = Number(r.ordered_qty);
        });

        for (const item of items) {
          const key = `${item.product_id}_${item.variant_id ?? "null"}`;
          if (!(key in orderedMap)) {
            return res.status(400).json({
              error: item.variant_id
                ? `Variant ${item.variant_id} of product ${item.product_id} was not part of the web order`
                : `Product ${item.product_id} was not part of the web order`,
            });
          }
          if (item.quantity > orderedMap[key]) {
            return res.status(400).json({
              error: `Return quantity ${item.quantity} exceeds ordered quantity for this item`,
            });
          }
        }
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    try {
      // Look up the open shift for this outlet
      const { rows: shiftRows } = await db.query(
        "SELECT id FROM cash_shifts WHERE outlet_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
        [outlet_id],
      );
      const shiftId = shiftRows.length ? shiftRows[0].id : null;

      const returnId = await db.transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO returns (original_sale_id, web_order_id, outlet_id, employee_id, customer_id, total_refund, refund_method, reason, shift_id,
           policy_id, return_reason_id, processed_by_employee_id, approved_by_employee_id, approval_event_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [
            original_sale_id || null,
            web_order_id || null,
            outlet_id,
            employee_id || null,
            customer_id || null,
            total_refund,
            refund_method,
            reason || null,
            shiftId,
            policy_id || null,
            return_reason_id || null,
            processed_by_employee_id || null,
            approved_by_employee_id || null,
            approval_event_id || null,
          ],
        );
        const retId = rows[0].id;

        for (const item of items) {
          await client.query(
            "INSERT INTO return_items (return_id, product_id, variant_id, quantity, refund_price) VALUES ($1, $2, $3, $4, $5)",
            [retId, item.product_id, item.variant_id || null, item.quantity, item.refund_price],
          );
          // Restock outlet_stock
          await client.query(
            `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
            [item.product_id, outlet_id, item.quantity, item.quantity],
          );
          // Restock variant stock if applicable
          if (item.variant_id) {
            await client.query(
              "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
              [item.quantity, item.variant_id],
            );
          }
        }

        return retId;
      });

      const syncChanges = items.map((item) => ({
        product_id: item.product_id,
        outlet_id,
        delta: Number(item.quantity || 0),
        reason: "return",
        reference_type: "return",
        reference_id: returnId,
      }));
      enqueueInventorySyncEvents(syncChanges, {}, () => {});

      // FBR Digital Invoicing — enqueue credit note if enabled
      try {
        const { rows: [ff] } = await db.query(
          "SELECT enabled FROM feature_flags WHERE key = 'fbr_integration'"
        );
        if (ff?.enabled) {
          const { buildCreditNotePayload, enqueueFbrInvoice } = require("../services/fbr");
          const { fetchCategoryIndexes } = require("../category-tree");
          const categoryTree = await fetchCategoryIndexes(db);
          const { rows: returnItems } = await db.query(
            `SELECT ri.*, p.name as product_name, p.category_id
             FROM return_items ri LEFT JOIN products p ON ri.product_id = p.id
             WHERE ri.return_id = $1`, [returnId]
          );
          const { rows: [cust] } = customer_id
            ? await db.query("SELECT name, ntn_cnic FROM customers WHERE id = $1", [customer_id])
            : { rows: [null] };
          const payload = buildCreditNotePayload(
            { id: returnId, timestamp: new Date() },
            returnItems, req.company, cust, categoryTree
          );
          await enqueueFbrInvoice(db, { returnId, invoiceType: "credit_note", payload, tenantSlug: req.tenantSlug });
          await db.query("UPDATE returns SET fbr_status = 'pending' WHERE id = $1", [returnId]);
        }
      } catch (fbrErr) {
        logger.error({ err: fbrErr, returnId }, "FBR return enqueue failed (non-blocking)");
      }

      res.json({
        message: "Return processed successfully",
        id: returnId,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all returns (with details)
  app.get("/api/returns", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { date_from, date_to } = req.query;
    const tz = req.company?.timezone || "UTC";
    const where = [];
    const params = [];
    let paramIdx = 1;

    if (date_from) {
      where.push(`r.timestamp >= $${paramIdx++}`);
      params.push(toUtcStart(date_from, tz));
    }
    if (date_to) {
      where.push(`r.timestamp < $${paramIdx++}`);
      params.push(toUtcEnd(date_to, tz));
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    const sql = `
    SELECT r.*,
           o.name as outlet_name,
           e.name as employee_name,
           c.name as customer_name,
           COUNT(ri.id) as item_count
    FROM returns r
    LEFT JOIN outlets o ON r.outlet_id = o.id
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN customers c ON r.customer_id = c.id
    LEFT JOIN return_items ri ON r.id = ri.return_id
    ${whereClause}
    GROUP BY r.id, o.name, e.name, c.name
    ORDER BY r.timestamp DESC
  `;

    try {
      const { rows } = await db.query(sql, params);
      res.json({ returns: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get a single return with items
  app.get("/api/returns/:id", requireAnyPerm(["view_reports", "all_access"]), async (req, res) => {
    const { id } = req.params;

    try {
      const { rows: returnRows } = await db.query(
        `SELECT r.*, o.name as outlet_name, e.name as employee_name, c.name as customer_name
       FROM returns r
       LEFT JOIN outlets o ON r.outlet_id = o.id
       LEFT JOIN employees e ON r.employee_id = e.id
       LEFT JOIN customers c ON r.customer_id = c.id
       WHERE r.id = $1`,
        [id],
      );
      if (!returnRows.length)
        return res.status(404).json({ error: "Return not found" });

      const { rows: items } = await db.query(
        `SELECT ri.*, p.name as product_name, p.barcode
       FROM return_items ri
       JOIN products p ON ri.product_id = p.id
       WHERE ri.return_id = $1`,
        [id],
      );
      res.json({ returnData: returnRows[0], items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Lookup web orders for return initiation
  app.get("/api/returns/lookup-web-order", requireAnyPerm(["manage_returns", "view_reports"]), async (req, res) => {
    const { q } = req.query;
    if (!q || !q.trim()) {
      return res.status(400).json({ error: "Search query is required" });
    }
    const search = q.trim();
    const likeTerm = `%${search}%`;

    try {
      const { rows } = await db.query(
        `SELECT wo.id, wo.external_order_id, wo.external_order_number,
                wo.customer_name_snapshot AS customer_name,
                wo.grand_total, wo.ordered_at, wo.source, wo.order_status,
                wo.delivery_method, wo.fulfillment_status
         FROM web_orders wo
         WHERE wo.external_order_id ILIKE $1
            OR wo.external_order_number ILIKE $1
            OR wo.public_order_token = $2
         LIMIT 10`,
        [likeTerm, search],
      );
      res.json({ orders: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
