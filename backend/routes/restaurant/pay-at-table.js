// Phase 2-R.3 — Pay-at-table QR.
//
// Staff opens a payment session on an open dine-in check. We mint a token,
// generate a SanoPay sandbox checkout URL, and hand staff a QR code that
// points at /pay/:token on the frontend. The guest scans, sees the bill,
// picks a tip, and completes the sandbox flow. The sandbox webhook flips
// the session to 'paid', creates the sale row from the draft_order items
// (carrying seat_number from Wave A), closes the table session (→ 'dirty'),
// and marks the draft_order completed.
//
// Gating: requireMode('restaurant') + requireFeature('phase4_restaurant_pay_at_table').
// Retail tenants and restaurants without the flag see 503.

const crypto = require("crypto");
const { resolveTaxSnapshot } = require("../../services/tax-snapshot");

// Staff-facing routes (mounted AFTER tenant middleware).
module.exports = function registerPayAtTableRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");
  const { validate } = require("../../middleware/validate");
  const { paymentSessionCreateSchema } = require("../../schemas/pay-at-table");
  const paymentGateway = require("../../services/payment-gateway");
  const logger = require("../../services/logger").child({ component: "pay-at-table" });

  const staffGate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_pay_at_table"),
    requirePerm("manage_restaurant"),
  ];

  // ── Staff-initiated: create session ────────────────────────────────
  app.post(
    "/api/restaurant/checks/:id/payment-session",
    ...staffGate,
    validate(paymentSessionCreateSchema),
    async (req, res) => {
      try {
        const draftOrderId = Number(req.params.id);
        if (!Number.isInteger(draftOrderId) || draftOrderId <= 0) {
          return res.status(400).json({ error: "Invalid check id" });
        }
        const tipAmount = Number(req.body?.tip_amount || 0);

        // Load the draft_order + item subtotal net of comps/voids.
        const { rows: [draft] } = await deps.db.query(
          `SELECT d.id, d.outlet_id, d.status, d.order_context, d.table_session_id
           FROM draft_orders d
           WHERE d.id = $1`,
          [draftOrderId]
        );
        if (!draft) return res.status(404).json({ error: "Check not found" });
        if (draft.status !== "open" && draft.status !== "claimed") {
          return res.status(409).json({ error: `Check is ${draft.status}` });
        }

        // Refuse if any item on the check is now sold-out (Wave A constraint).
        const { rows: soldOutHits } = await deps.db.query(
          `SELECT doi.product_name
           FROM draft_order_items doi
           LEFT JOIN products p ON p.id = doi.product_id
           WHERE doi.draft_order_id = $1 AND p.is_sold_out = true`,
          [draftOrderId]
        );
        if (soldOutHits.length) {
          return res.status(422).json({
            error: `Cannot take payment — some items are now 86'd: ${soldOutHits.map(r => r.product_name).join(", ")}`,
          });
        }

        const itemsSubtotal = await computeCheckAmount(deps.db, draftOrderId);
        const totalAmount = Number((itemsSubtotal + tipAmount).toFixed(2));
        if (totalAmount <= 0) {
          return res.status(400).json({ error: "Check total is zero — nothing to collect" });
        }

        // Invalidate any prior pending session for this table_session so
        // the QR modal only ever presents one live token at a time.
        if (draft.table_session_id) {
          await deps.db.query(
            `UPDATE restaurant_payment_sessions
             SET status = 'expired', updated_at = NOW()
             WHERE table_session_id = $1 AND status = 'pending'`,
            [draft.table_session_id]
          );
        }

        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        // Ask the payment gateway to mint a sandbox intent. SandboxAdapter
        // returns a gateway_ref and a checkout_url that we carry through to
        // the public pay page.
        const gatewayRef = `sandbox_rest_${Date.now()}_${token.slice(0, 8)}`;
        let checkoutUrl = null;
        try {
          const adapter = paymentGateway.getPaymentAdapter("sandbox");
          const result = await adapter.createCheckout({
            amount: totalAmount,
            currency: "PKR",
            reference: `restaurant-${draftOrderId}`,
            description: `Table check #${draftOrderId}`,
            returnUrl: null,
            cancelUrl: null,
          });
          checkoutUrl = result.checkout_url;
        } catch (gwErr) {
          logger.error({ err: gwErr }, "Sandbox createCheckout failed — continuing with local flow");
        }

        const { rows: [session] } = await deps.db.query(
          `INSERT INTO restaurant_payment_sessions
            (draft_order_id, table_session_id, token, gateway, gateway_ref,
             amount, tip_amount, status, expires_at, created_by_employee_id)
           VALUES ($1, $2, $3, 'sandbox', $4, $5, $6, 'pending', $7, $8)
           RETURNING id, token, amount, tip_amount, expires_at`,
          [
            draftOrderId,
            draft.table_session_id || null,
            token,
            gatewayRef,
            itemsSubtotal,
            tipAmount,
            expiresAt.toISOString(),
            req.employee?.id || null,
          ]
        );

        const frontendBase = process.env.FRONTEND_URL || process.env.APP_PUBLIC_URL || "http://localhost:5173";
        const payUrl = `${frontendBase}/pay/${token}`;

        res.status(201).json({
          id: session.id,
          token: session.token,
          pay_url: payUrl,
          qr_url: payUrl,
          checkout_url: checkoutUrl,
          amount: Number(session.amount),
          tip_amount: Number(session.tip_amount),
          expires_at: session.expires_at,
          status: "pending",
        });
      } catch (err) {
        logger.error({ err }, "payment-session create failed");
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // ── Staff-initiated: poll session status ──────────────────────────
  app.get(
    "/api/restaurant/payment-sessions/:id/status",
    ...staffGate,
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid session id" });
        }
        const { rows: [row] } = await deps.db.query(
          `SELECT id, status, amount, tip_amount, paid_at, expires_at, sale_id
           FROM restaurant_payment_sessions WHERE id = $1`,
          [id]
        );
        if (!row) return res.status(404).json({ error: "Session not found" });
        res.json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

};

// Public-facing routes (mounted BEFORE tenant middleware).
module.exports.registerPublicPayAtTableRoutes = function registerPublicPayAtTableRoutes(app, deps) {
  const { webhookLimiter } = require("../../middleware/rate-limit");
  const { resolvePublicTenantDb } = require("../../services/public-tenant-context");
  const logger = require("../../services/logger").child({ component: "pay-at-table-public" });

  // ── Public: view bill ─────────────────────────────────────────────
  // No auth, no tenant middleware. Tenant resolved via ?tenant=<slug>
  // query. Rate-limited via webhookLimiter because this endpoint is the
  // primary target of scraping/brute-force attempts.
  app.get("/api/public/restaurant/pay/:token", webhookLimiter, async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const db = resolved.db;

      const { rows: [session] } = await db.query(
        `SELECT rps.id, rps.token, rps.draft_order_id, rps.amount, rps.tip_amount,
                rps.status, rps.expires_at, rps.gateway_ref,
                d.outlet_id
         FROM restaurant_payment_sessions rps
         LEFT JOIN draft_orders d ON d.id = rps.draft_order_id
         WHERE rps.token = $1`,
        [req.params.token]
      );
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.status !== "pending" && session.status !== "processing") {
        if (session.status === "paid") {
          return res.status(200).json({
            status: "paid",
            amount: Number(session.amount),
            tip_amount: Number(session.tip_amount),
          });
        }
        return res.status(410).json({ error: "This payment link has expired", status: session.status });
      }
      if (new Date(session.expires_at).getTime() < Date.now()) {
        return res.status(410).json({ error: "This payment link has expired", status: "expired" });
      }

      // Refuse if items went sold-out after the session was minted.
      const { rows: soldOut } = await db.query(
        `SELECT doi.product_name
         FROM draft_order_items doi
         LEFT JOIN products p ON p.id = doi.product_id
         WHERE doi.draft_order_id = $1 AND p.is_sold_out = true`,
        [session.draft_order_id]
      );
      if (soldOut.length) {
        return res.status(422).json({
          error: `Some items are no longer available: ${soldOut.map(r => r.product_name).join(", ")}`,
        });
      }

      const { rows: items } = await db.query(
        `SELECT id, product_name AS name, quantity, price, notes, seat_number
         FROM draft_order_items WHERE draft_order_id = $1 ORDER BY seat_number NULLS LAST, id`,
        [session.draft_order_id]
      );

      let tableLabel = null;
      try {
        const { rows: [tbl] } = await db.query(
          `SELECT rt.label FROM restaurant_table_sessions rts
           JOIN restaurant_tables rt ON rt.id = rts.table_id
           JOIN draft_orders d ON d.table_session_id = rts.id
           WHERE d.id = $1`,
          [session.draft_order_id]
        );
        tableLabel = tbl?.label || null;
      } catch { /* legacy tenant without sessions — ignore */ }

      const { rows: [profile] } = await db.query(
        `SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1`
      );

      res.json({
        token: session.token,
        status: session.status,
        amount: Number(session.amount),
        tip_amount: Number(session.tip_amount),
        expires_at: session.expires_at,
        items,
        table_label: tableLabel,
        company_name: profile?.company_name || null,
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
      });
    } catch (err) {
      logger.error({ err }, "public pay bill view failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Public: confirm — commits tip + routes to sandbox pay page ────
  app.post("/api/public/restaurant/pay/:token/confirm", webhookLimiter, async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const db = resolved.db;

      const { tip_amount } = req.body || {};
      const tipOverride = tip_amount != null ? Number(tip_amount) : null;
      if (tipOverride != null && (!Number.isFinite(tipOverride) || tipOverride < 0 || tipOverride > 100000)) {
        return res.status(400).json({ error: "Invalid tip amount" });
      }

      const { rows: [session] } = await db.query(
        `SELECT id, status, amount, tip_amount, expires_at, gateway_ref
         FROM restaurant_payment_sessions WHERE token = $1`,
        [req.params.token]
      );
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.status !== "pending") {
        return res.status(410).json({ error: "Session no longer pending", status: session.status });
      }
      if (new Date(session.expires_at).getTime() < Date.now()) {
        await db.query(
          `UPDATE restaurant_payment_sessions SET status='expired', updated_at=NOW() WHERE id=$1`,
          [session.id]
        );
        return res.status(410).json({ error: "Session expired" });
      }

      const finalTip = tipOverride != null ? tipOverride : Number(session.tip_amount || 0);
      await db.query(
        `UPDATE restaurant_payment_sessions
         SET status='processing', tip_amount=$2, updated_at=NOW()
         WHERE id=$1`,
        [session.id, finalTip]
      );

      // Point the guest at the sandbox payment page. The page's "Pay"
      // button fires /api/sandbox/simulate-webhook which routes to our
      // handleRestaurantPayWebhook via processWebhookEvent.
      const backendBase = process.env.APP_PUBLIC_BASE_URL ||
        `http://localhost:${process.env.PORT || 5000}`;
      const redirectUrl = `${backendBase}/api/sandbox/pay/${encodeURIComponent(session.gateway_ref)}`;

      res.json({ ok: true, redirect_url: redirectUrl });
    } catch (err) {
      logger.error({ err }, "public pay confirm failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });
};

// ── Shared helpers (exported for webhook reuse) ─────────────────────

async function computeCheckAmount(db, draftOrderId) {
  // Sum line items, then subtract any void/comp adjustments already
  // applied through 2-R.2 (Wave B). Discount adjustments are *not*
  // subtracted — those flow through the draft_order's own discount_total.
  const { rows: [sum] } = await db.query(
    `SELECT COALESCE(SUM(quantity * price), 0) AS total
     FROM draft_order_items WHERE draft_order_id = $1`,
    [draftOrderId]
  );
  let subtotal = Number(sum?.total || 0);

  try {
    const { rows: [adj] } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM sale_item_adjustments
       WHERE draft_order_id = $1 AND adjustment_type IN ('void','comp')`,
      [draftOrderId]
    );
    subtotal -= Number(adj?.total || 0);
  } catch (e) {
    // Table optional — pre-v59 tenants don't have it.
    if (!String(e.message || "").includes("does not exist")) throw e;
  }
  return Number(Math.max(0, subtotal).toFixed(2));
}

/**
 * Webhook handler for a sandbox payment linked to a restaurant check.
 * Creates the sale row from the draft_order_items, carrying seat_number
 * through (Wave A), marks the draft_order completed, and flips the
 * table session to 'dirty'.
 *
 * On failure: marks the session failed, leaves the check open so staff
 * can retry. Idempotent — if already paid, returns { ok: true } without
 * creating duplicates.
 */
async function handleRestaurantPayWebhook(db, { gatewayRef, status, eventType, raw }) {
  const _logger = require("../../services/logger").child({ component: "pay-at-table-webhook" });
  const { rows: [session] } = await db.query(
    `SELECT id, draft_order_id, table_session_id, amount, tip_amount, status, sale_id
     FROM restaurant_payment_sessions WHERE gateway_ref = $1`,
    [gatewayRef]
  );
  if (!session) return { matched: false };

  if (session.status === "paid") {
    _logger.info({ sessionId: session.id }, "pay-at-table webhook: already paid (idempotent)");
    return { matched: true, ok: true, message: "Already paid" };
  }

  const isPaid = status === "completed" || eventType === "payment.completed";
  const isFailed = status === "failed" || eventType === "payment.failed";
  const isCancelled = status === "cancelled" || eventType === "payment.cancelled";

  if (isPaid) {
    // Transactional: create sale, copy items (with seat_number), close
    // draft_order, flip table session, stamp session row.
    await db.transaction(async (client) => {
      const { rows: [draft] } = await client.query(
        `SELECT id, outlet_id, customer_id, created_by, table_session_id, order_context
         FROM draft_orders WHERE id = $1`,
        [session.draft_order_id]
      );
      if (!draft) throw new Error("Draft order missing");

      // Pick a shift — prefer the outlet's currently open shift, fall
      // back to the most recent one. Pay-at-table sales arrive during
      // service so the open shift is almost always available.
      const { rows: [shift] } = await client.query(
        `SELECT id FROM cash_shifts
         WHERE outlet_id = $1 AND status = 'open'
         ORDER BY opened_at DESC LIMIT 1`,
        [draft.outlet_id]
      );
      let shiftId = shift?.id || null;
      if (!shiftId) {
        const { rows: [recent] } = await client.query(
          `SELECT id FROM cash_shifts WHERE outlet_id = $1 ORDER BY opened_at DESC LIMIT 1`,
          [draft.outlet_id]
        );
        shiftId = recent?.id || null;
      }

      const totalAmount = Number(session.amount) + Number(session.tip_amount || 0);

      // Fetch the draft lines up front so the v83 tax snapshot can be
      // resolved before the sale row is written. cost_price_at_sale is
      // captured via a lookup so menu engineering (Wave C) still gets
      // accurate margins for these sales.
      const { rows: items } = await client.query(
        `SELECT doi.product_id, doi.variant_id, doi.quantity, doi.price,
                COALESCE(p.cost_price, 0) AS cost_price, doi.seat_number
         FROM draft_order_items doi
         LEFT JOIN products p ON p.id = doi.product_id
         WHERE doi.draft_order_id = $1`,
        [session.draft_order_id]
      );

      // v83 per-line tax snapshot — shared cascade (services/tax-snapshot).
      // Webhook context has no req/tenantId, so tax_mode comes straight from
      // company_profile and outlet tax profiles are skipped (falls back to
      // the product/category cascade).
      let taxMode = "none";
      try {
        const { rows: [cp] } = await client.query(
          "SELECT tax_mode FROM company_profile LIMIT 1"
        );
        if (cp?.tax_mode) taxMode = cp.tax_mode;
      } catch { /* not-yet-migrated tenant */ }
      const taxSnapshot = await resolveTaxSnapshot(client, {
        items: items.map((it) => ({
          productId: it.product_id,
          price: it.price,
          quantity: it.quantity,
        })),
        taxMode,
      });

      // sales has no tip_amount/draft_order_id/order_context columns —
      // tips flow through tip_captures; draft_order linkage is persisted
      // in the notes + the tip_captures row.
      const { rows: [saleRow] } = await client.query(
        `INSERT INTO sales
          (total_amount, payment_method, outlet_id, employee_id, customer_id,
           discount_amount, discount_type, notes, shift_id,
           subtotal, tax_total, tax_inclusive)
         VALUES ($1, 'card', $2, $3, $4, 0, 'fixed', $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          totalAmount,
          draft.outlet_id,
          draft.created_by,
          draft.customer_id || null,
          `Pay-at-table via SanoPay sandbox (session ${session.id}, draft_order ${session.draft_order_id})`,
          shiftId,
          taxSnapshot.subtotal,
          taxSnapshot.taxTotal,
          taxSnapshot.taxInclusive,
        ]
      );
      const saleId = saleRow.id;

      // Capture tip (Phase 2.1 C1 pattern). tip_captures is the ledger.
      if (Number(session.tip_amount || 0) > 0) {
        try {
          await client.query(
            `INSERT INTO tip_captures (sale_id, draft_order_id, outlet_id, server_id, tip_amount, tip_method)
             VALUES ($1, $2, $3, $4, $5, 'card')`,
            [saleId, session.draft_order_id, draft.outlet_id, null, Number(session.tip_amount)]
          );
        } catch (tipErr) {
          if (!String(tipErr.message || "").includes("does not exist")) throw tipErr;
        }
      }

      // Copy each draft_order_item into sale_items, carrying seat_number
      // (Wave A) and the per-line v83 tax snapshot resolved above.
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const taxLine = taxSnapshot.lines[i] || { rate: 0, amount: 0, hsCode: null };
        await client.query(
          `INSERT INTO sale_items
            (sale_id, product_id, variant_id, quantity, price_at_sale,
             cost_price_at_sale, seat_number,
             tax_rate_at_sale, tax_amount_at_sale, hs_code_at_sale)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [saleId, it.product_id, it.variant_id, it.quantity, it.price,
           it.cost_price, it.seat_number,
           Number(taxLine.rate || 0), Number(taxLine.amount || 0), taxLine.hsCode || null]
        );
      }

      // Mark the draft_order completed so the cart view reflects the sale.
      await client.query(
        `UPDATE draft_orders SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [session.draft_order_id]
      );

      // Flip the table session into 'dirty' so busser can pick it up.
      if (draft.table_session_id) {
        await client.query(
          `UPDATE restaurant_table_sessions
           SET status = 'dirty', closed_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status IN ('seated','ordering','served','check_requested','closed')`,
          [draft.table_session_id]
        );
      }

      await client.query(
        `UPDATE restaurant_payment_sessions
         SET status = 'paid', paid_at = NOW(), sale_id = $2,
             webhook_payload = $3, updated_at = NOW()
         WHERE id = $1`,
        [session.id, saleId, JSON.stringify(raw || {})]
      );
    });

    _logger.info({ sessionId: session.id, draftOrderId: session.draft_order_id },
      "pay-at-table payment confirmed — sale created");
    return { matched: true, ok: true };
  }

  if (isFailed || isCancelled) {
    await db.query(
      `UPDATE restaurant_payment_sessions
       SET status = $2, webhook_payload = $3, updated_at = NOW()
       WHERE id = $1`,
      [session.id, isFailed ? "failed" : "expired", JSON.stringify(raw || {})]
    );
    _logger.info({ sessionId: session.id, outcome: isFailed ? "failed" : "cancelled" },
      "pay-at-table payment did not complete");
    return { matched: true, ok: true };
  }

  return { matched: true, ok: true, message: "Event acknowledged" };
}

module.exports.computeCheckAmount = computeCheckAmount;
module.exports.handleRestaurantPayWebhook = handleRestaurantPayWebhook;
