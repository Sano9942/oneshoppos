const { toUtcStart, toUtcEnd } = require("../utils/tz");
const logger = require("../services/logger");
const { validate } = require("../middleware/validate");
const { CreateReturnSchema } = require("../schemas/returns");
const kitEngine = require("../services/kit-engine");
const { getFeatureFlagsMap } = require("../middleware/feature-flags");
const { verifyManagerPin } = require("../services/manager-pin");
const { recordApprovalEvent } = require("../services/approval-policy");

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
      // 2-G.15 Day 3: client-supplied idempotency key prevents accidental
      // double-submit (network retry, double click) from creating two refunds
      // for the same sale. Legacy callers that omit this keep working.
      idempotency_key,
    } = req.body;

    // 2-G.15 Day 3: pre-flight idempotency check — if the same sale already
    // has a return with this key, return 409 with the existing return's ref
    // so the client can show a collision modal instead of silently creating
    // a duplicate refund.
    if (idempotency_key && original_sale_id) {
      try {
        const { rows: dupRows } = await db.query(
          `SELECT r.id, r.timestamp, r.total_refund, r.employee_id,
                  e.name AS employee_name
             FROM returns r
             LEFT JOIN employees e ON e.id = r.employee_id
            WHERE r.original_sale_id = $1 AND r.idempotency_key = $2
            LIMIT 1`,
          [original_sale_id, idempotency_key],
        );
        if (dupRows.length) {
          const dup = dupRows[0];
          return res.status(409).json({
            error: "Return already processed for this sale with the same idempotency key",
            code: "duplicate_return",
            existing: {
              id: dup.id,
              timestamp: dup.timestamp,
              total_refund: Number(dup.total_refund),
              employee_id: dup.employee_id,
              employee_name: dup.employee_name,
            },
          });
        }
      } catch (err) {
        logger.error({ err }, "2-G.15 idempotency pre-check failed");
      }
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Return must have items" });
    }
    if (!outlet_id) {
      return res
        .status(400)
        .json({ error: "Outlet ID is required for restocking" });
    }

    // B16 fix: validate each returned item against original sale.
    // F1 (Apr 28 2026): subtract qty already returned for this sale so a
    // partially-refunded sale can't be refunded a second time at full qty.
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

        const { rows: priorReturned } = await db.query(
          `SELECT ri.product_id, ri.variant_id, SUM(ri.quantity) AS refunded_qty
           FROM return_items ri
           JOIN returns r ON r.id = ri.return_id
           WHERE r.original_sale_id = $1
           GROUP BY ri.product_id, ri.variant_id`,
          [original_sale_id],
        );

        const remainingMap = {};
        saleItems.forEach((r) => {
          const key = `${r.product_id}_${r.variant_id ?? "null"}`;
          remainingMap[key] = Number(r.sold_qty);
        });
        priorReturned.forEach((r) => {
          const key = `${r.product_id}_${r.variant_id ?? "null"}`;
          if (key in remainingMap) {
            remainingMap[key] -= Number(r.refunded_qty);
          }
        });

        for (const item of items) {
          const key = `${item.product_id}_${item.variant_id ?? "null"}`;
          if (!(key in remainingMap)) {
            return res.status(400).json({
              error: item.variant_id
                ? `Variant ${item.variant_id} of product ${item.product_id} was not part of the original sale`
                : `Product ${item.product_id} was not part of the original sale`,
            });
          }
          const remaining = remainingMap[key];
          if (remaining <= 0) {
            return res.status(400).json({
              error: item.variant_id
                ? `Variant ${item.variant_id} of product ${item.product_id} has already been fully refunded for this sale`
                : `Product ${item.product_id} has already been fully refunded for this sale`,
            });
          }
          if (item.quantity > remaining) {
            return res.status(400).json({
              error: `Cannot refund ${item.quantity} units of product ${item.product_id}; only ${remaining} remaining (the rest was already refunded against this sale)`,
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

    // 2-G.7: resolve per-line restock feature flag once (gate before tx to
    // keep the transaction tight). When off, per-line restock_flag /
    // reason_code_id inputs are ignored — every line restocks as before.
    // Same pass reads phase2g_risk_controls so 2-G.17 can enforce the refund
    // threshold before any DB write.
    let perLineRestockEnabled = false;
    let riskControlsEnabled = false;
    let packagesFlagOn = false;
    try {
      const flags = await getFeatureFlagsMap(req.tenantId);
      perLineRestockEnabled = !!flags.phase2g_per_line_restock;
      riskControlsEnabled = !!flags.phase2g_risk_controls;
      packagesFlagOn = !!flags.packages_passes;
    } catch { /* flag fetch failure → fall back to legacy behavior */ }

    // F02 — refunding a package sale line. A package can be refunded only while
    // it is untouched: any redemption means value has been consumed, so we block
    // the refund with a clear error rather than clawing credits back. The pre-
    // flight runs BEFORE the transaction so we 400 cleanly instead of rolling a
    // partially-built return back. The in-tx loop flips the untouched row to
    // 'refunded'. Matched by (sale_id, package_template.product_id).
    let refundablePackageRows = []; // [{ id, product_id }]
    if (packagesFlagOn && original_sale_id && Array.isArray(items) && items.length) {
      const prodIds = Array.from(new Set(items.map((i) => Number(i.product_id)).filter(Boolean)));
      if (prodIds.length) {
        const { rows: pkgRows } = await db.query(
          `SELECT cp.id, cp.credits_used, pt.product_id
             FROM customer_packages cp
             JOIN package_templates pt ON pt.id = cp.package_template_id
            WHERE cp.sale_id = $1 AND pt.product_id = ANY($2::int[])
              AND cp.status <> 'refunded'`,
          [original_sale_id, prodIds],
        );
        for (const r of pkgRows) {
          if (Number(r.credits_used) > 0) {
            return res.status(400).json({
              error: "Cannot refund a package that has already been used — reverse the redemptions first",
              code: "package_partially_used",
            });
          }
          refundablePackageRows.push({ id: r.id, product_id: r.product_id });
        }
      }
    }

    // 2-G.17: if risk controls are on AND the refund exceeds the tenant's
    // configured threshold, the caller must supply a valid manager PIN. We
    // record an approval_event and pin its id on the return below so the
    // audit trail survives.
    let resolvedApprovalEventId = approval_event_id || null;
    if (riskControlsEnabled) {
      try {
        const { rows: thrRows } = await db.query(
          "SELECT refund_approval_threshold FROM risk_controls_config WHERE id = 1",
        );
        const threshold = Number(thrRows[0]?.refund_approval_threshold || 0);
        if (threshold > 0 && Number(total_refund) > threshold) {
          const managerPin = req.body?.manager_pin;
          if (!managerPin) {
            return res.status(403).json({
              error: "Manager PIN required — refund exceeds tenant threshold",
              code: "manager_pin_required",
              threshold,
            });
          }
          try {
            const manager = await verifyManagerPin(db, String(managerPin), {
              requiredPerm: "override_refund",
              isImpersonating: req.isImpersonating === true,
            });
            const event = await recordApprovalEvent(db, {
              policyId: null,
              actionType: "refund_threshold_override",
              referenceType: "return",
              referenceId: null,
              requestedBy: Number(req.employee?.id || req.headers["x-employee-id"] || 0) || null,
              approvedBy: manager.employee_id,
              status: "approved",
              reason: `Refund of ${total_refund} exceeded threshold of ${threshold}`,
              metadata: { refund_amount: Number(total_refund), threshold },
              outletId: outlet_id || null,
            });
            resolvedApprovalEventId = event.id;
          } catch (pinErr) {
            const status = pinErr.statusCode || 403;
            return res.status(status).json({ error: pinErr.message });
          }
        }
      } catch (err) {
        logger.error({ err }, "2-G.17 threshold lookup failed");
      }
    }

    // 2-G.7: if the feature is on, validate that any scrapped line carries a
    // reason code. We reject up-front (before any DB work) so the caller gets
    // a clean 400 instead of a mid-transaction abort.
    if (perLineRestockEnabled) {
      for (const item of items) {
        if (item.restock_flag === false && !item.reason_code_id) {
          return res.status(400).json({
            error: "reason_code_id is required when restock_flag=false (shrinkage requires a reason)",
          });
        }
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
           policy_id, return_reason_id, processed_by_employee_id, approved_by_employee_id, approval_event_id, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
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
            resolvedApprovalEventId,
            idempotency_key || null,
          ],
        );
        const retId = rows[0].id;

        for (const item of items) {
          // 2-G.7: resolve per-line restock + reason code. Flag-off paths
          // always restock (legacy behavior) and don't persist reason_code_id.
          // Flag-on paths honor incoming values; reason_code_id falls back to
          // the return-level return_reason_id so the line always has a reason
          // when scrapped (checked earlier before this transaction).
          const effectiveRestock = perLineRestockEnabled
            ? item.restock_flag !== false
            : true;
          const effectiveReasonCodeId = perLineRestockEnabled
            ? (item.reason_code_id || return_reason_id || null)
            : null;

          await client.query(
            `INSERT INTO return_items (return_id, product_id, variant_id, quantity, refund_price, restock_flag, reason_code_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              retId,
              item.product_id,
              item.variant_id || null,
              item.quantity,
              item.refund_price,
              effectiveRestock,
              effectiveReasonCodeId,
            ],
          );

          // F02 — flip the matching untouched package to 'refunded'. Guarded
          // in the pre-flight above (zero redemptions), so this only voids the
          // entitlement; there is no stock to restore for a package line.
          if (packagesFlagOn && refundablePackageRows.length) {
            const match = refundablePackageRows.filter((p) => p.product_id === Number(item.product_id));
            for (const p of match) {
              await client.query(
                "UPDATE customer_packages SET status = 'refunded' WHERE id = $1 AND status <> 'refunded'",
                [p.id],
              );
            }
          }

          // 2-G.7: only increment stock counters when restock=true. Scrapped
          // units fall through to shrinkage (captured separately in the
          // returns-by-reason report + inventory/shrinkage variance).
          if (effectiveRestock) {
            // F01: returning a kit restocks its COMPONENTS (the kit holds no
            // stock of its own), mirroring the sale-time component decrement.
            if ((await kitEngine.getBomType(client, item.product_id)) === "kit") {
              await kitEngine.restockComponents(client, {
                productId: item.product_id,
                outletId: outlet_id,
                qty: Number(item.quantity),
              });
            } else {
              // Restock outlet_stock
              await client.query(
                `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                 VALUES ($1, $2, $3)
                 ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
                [item.product_id, outlet_id, item.quantity, item.quantity],
              );
              // Restock variant stock if applicable.
              // 2-G.1: also restock per-variant outlet stock. Keeping the legacy
              // product_variants.stock column in sync preserves reads that aren't
              // outlet-aware (reports, barcode scans with no outlet context).
              if (item.variant_id) {
                await client.query(
                  "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
                  [item.quantity, item.variant_id],
                );
                await client.query(
                  `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (variant_id, outlet_id)
                     DO UPDATE SET quantity = variant_outlet_stock.quantity + $3`,
                  [item.variant_id, outlet_id, item.quantity],
                );
              }
            }
          }

          // 2-G.6: flip serial status. Warranty-claim items go to
          // 'warranty_claim' so they're not re-sold through POS; standard
          // returns go to 'returned' (admin can manually flip to 'available'
          // after inspection). sale_item_serials bridge rows stay intact for
          // audit — this unit's full history is traceable through the
          // original sale even after the serial status changes.
          if (Array.isArray(item.serials) && item.serials.length > 0) {
            const serialIds = item.serials.map(Number).filter(Boolean);
            const newStatus = item.warranty_claim === true ? "warranty_claim" : "returned";
            if (serialIds.length) {
              await client.query(
                `UPDATE product_serial_numbers
                    SET status = $1
                  WHERE id = ANY($2::int[])`,
                [newStatus, serialIds],
              );
            }
          }
        }

        // Tier 0.1 wholesale — refund_method='credit_reversal' reduces the
        // linked customer_invoices.balance_due instead of paying cash back.
        // Only valid when the original sale was a Credit-tender sale (has
        // sales.customer_invoice_id set by v88). Idempotent against the
        // invoice: if balance_due goes to 0, mark invoice paid.
        if (refund_method === "credit_reversal" && original_sale_id) {
          const { rows: [linkedSale] } = await client.query(
            "SELECT customer_invoice_id FROM sales WHERE id = $1",
            [original_sale_id]
          );
          if (!linkedSale?.customer_invoice_id) {
            throw Object.assign(
              new Error("credit_reversal requires the original sale to have a linked customer invoice (Credit tender)"),
              { statusCode: 400 }
            );
          }
          const { rows: [inv] } = await client.query(
            `SELECT id, balance_due::numeric AS balance_due, total_amount::numeric AS total_amount, amount_paid::numeric AS amount_paid
             FROM customer_invoices
             WHERE id = $1
             FOR UPDATE`,
            [linkedSale.customer_invoice_id]
          );
          if (!inv) {
            throw Object.assign(new Error("Linked customer invoice not found"), { statusCode: 400 });
          }
          const refund = Number(total_refund);
          const newBalance = Math.max(0, Number(inv.balance_due) - refund);
          // Refund reduces what the customer owes. Mirror it as a negative
          // amount_paid delta so total_amount = amount_paid + balance_due stays
          // honest. (For a partial refund, balance_due drops; total_amount
          // remains the original sale amount — the discrepancy is captured
          // by the returns row itself.)
          const newStatus = newBalance === 0 ? "paid" : inv.status || "sent";
          await client.query(
            `UPDATE customer_invoices
               SET balance_due = $1,
                   status      = $2,
                   updated_at  = NOW()
             WHERE id = $3`,
            [newBalance, newStatus, inv.id]
          );
          // Mirror the credit reversal as a payment row so the customer
          // statement ledger (Tier 0.4) reconciles. Without this, the
          // invoice balance silently drops with no corresponding entry.
          await client.query(
            `INSERT INTO customer_invoice_payments
               (invoice_id, amount, payment_method, payment_type, reference, recorded_by)
             VALUES ($1, $2, 'credit_reversal', 'credit_reversal', $3, $4)`,
            [inv.id, refund, `RET-${retId}`, employee_id || null]
          );
        }

        return retId;
      });

      // Process gateway refund for card returns
      if (refund_method === "card" && original_sale_id) {
        const paymentGateway = require("../services/payment-gateway");
        if (paymentGateway.isEnabled()) {
          try {
            const { rows: [cardPayment] } = await db.query(
              "SELECT gateway_ref FROM sale_payments WHERE sale_id = $1 AND payment_method = 'Card' AND gateway_ref IS NOT NULL LIMIT 1",
              [original_sale_id]
            );
            if (cardPayment?.gateway_ref) {
              const result = await paymentGateway.refund({
                transaction_id: cardPayment.gateway_ref,
                amount: total_refund,
                reason: reason || "customer_return",
              });
              await db.query(
                "UPDATE returns SET gateway_refund_ref = $1 WHERE id = $2",
                [result.refund_id, returnId]
              );
              logger.info({ returnId, refundId: result.refund_id }, "Gateway refund processed");
            } else {
              logger.warn({ returnId, original_sale_id }, "Card refund requested but no gateway_ref on original sale — recording as offline refund");
            }
          } catch (refundErr) {
            logger.error({ err: refundErr, returnId }, "Gateway refund failed — return recorded but refund pending");
          }
        }
      }

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

      // Reverse pending/approved commissions for the original sale
      if (original_sale_id) {
        db.query(
          `UPDATE commission_earnings SET status = 'reversed', reversed_at = NOW(), reversal_reason = 'Sale returned'
           WHERE sale_id = $1 AND status IN ('pending','approved')`,
          [original_sale_id]
        ).catch(err => console.error("[commission] return reversal error:", err.message));
      }

      res.json({
        message: "Return processed successfully",
        id: returnId,
      });
    } catch (err) {
      // 2-G.15 Day 3: race-condition fallback — if two concurrent requests
      // sneak past the pre-flight check, the partial unique index raises
      // 23505. Return 409 so the client can show the collision modal.
      if (err && err.code === "23505" && idempotency_key && original_sale_id) {
        try {
          const { rows: dupRows } = await db.query(
            `SELECT r.id, r.timestamp, r.total_refund, r.employee_id,
                    e.name AS employee_name
               FROM returns r
               LEFT JOIN employees e ON e.id = r.employee_id
              WHERE r.original_sale_id = $1 AND r.idempotency_key = $2
              LIMIT 1`,
            [original_sale_id, idempotency_key],
          );
          if (dupRows.length) {
            const dup = dupRows[0];
            return res.status(409).json({
              error: "Return already processed for this sale with the same idempotency key",
              code: "duplicate_return",
              existing: {
                id: dup.id,
                timestamp: dup.timestamp,
                total_refund: Number(dup.total_refund),
                employee_id: dup.employee_id,
                employee_name: dup.employee_name,
              },
            });
          }
        } catch { /* fall through to generic 500 */ }
      }
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

  // Lookup web orders for return initiation
  // NOTE: Must be registered BEFORE /:id so Express doesn't match "lookup-web-order" as an id.
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

};
