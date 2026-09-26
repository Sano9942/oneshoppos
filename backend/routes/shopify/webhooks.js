// Shopify sends the whole order on each of these topics; they all go through
// the same upsert + stock policy (One Toy Store pilot, blocker 1c/1d).
const ORDER_TOPICS = new Set([
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "orders/paid",
  "orders/fulfilled",
  "orders/partially_fulfilled",
]);

module.exports = function registerShopifyWebhookRoutes(app, deps) {
  const {
    db, webhookLimiter,
    getActiveShopifyConnection, logShopifyEvent,
    buildWebhookIdempotencyKey, verifyWebhookSignature,
    evaluateWebhookTimestampWindow, upsertWebOrderFromShopifyPayload,
  } = deps;

  // Shopify's call carries no SanoPOS login, so these routes must be served
  // BEFORE the tenant auth wall (1b). registerAllRoutes mounts
  // deps.shopifyWebhookRouter ahead of loadTenantAndPerms; the router
  // resolves the tenant from the URL and runs the handler in its DB context.
  const router = deps.shopifyWebhookRouter || app;
  const resolveTenant = deps.resolveShopifyWebhookTenant || ((req, res, next) => next());

  async function handleOrderWebhook(req, res) {
    try {
      const payload = req.body || {};
      const rawBody = req.rawBody || JSON.stringify(payload || {});
      const webhookId = req.headers["x-shopify-webhook-id"] || "";
      const hmacHeader = req.headers["x-shopify-hmac-sha256"] || "";
      const shopHeader = req.headers["x-shopify-shop-domain"] || "";
      const topicHeader = String(req.headers["x-shopify-topic"] || "").toLowerCase();
      const triggeredAtHeader = req.headers["x-shopify-triggered-at"] || "";
      const orderId = String(payload?.id || payload?.order_id || "");
      const idempotencyKey = buildWebhookIdempotencyKey({ webhookId, payload });

      const conn = await getActiveShopifyConnection();
      if (!conn)
        return res.status(400).json({ error: "No active Shopify connection" });

      if (
        shopHeader &&
        conn.shop_domain &&
        String(shopHeader).toLowerCase() !== String(conn.shop_domain).toLowerCase()
      ) {
        return res.status(403).json({ error: "Shop domain mismatch" });
      }

      const signatureCheck = verifyWebhookSignature({
        rawBody,
        providedHmac: hmacHeader,
        webhookSecret: conn.webhook_secret,
      });
      if (!signatureCheck.ok) {
        const errorMessage =
          signatureCheck.reason === "missing_signature"
            ? "Missing webhook signature"
            : signatureCheck.reason === "no_secret_configured"
              ? "Webhook secret not configured for this Shopify connection"
              : "Invalid webhook signature";
        return res.status(401).json({ error: errorMessage });
      }

      const replayWindow = evaluateWebhookTimestampWindow(triggeredAtHeader, Date.now());
      if (!replayWindow.ok) {
        logShopifyEvent("warn", "webhook_replay_window_reject", {
          reason: replayWindow.reason,
          age_ms: replayWindow.ageMs || null,
          webhook_id: webhookId || null,
          shop: shopHeader || null,
        });
        return res.status(401).json({ error: "Webhook timestamp outside allowed replay window" });
      }

      // A topic we don't act on: acknowledge so Shopify doesn't retry it.
      if (topicHeader && !ORDER_TOPICS.has(topicHeader)) {
        return res.json({ success: true, ignored: true, topic: topicHeader });
      }

      // Check for duplicate
      const { rows: dupRows } = await db.query(
        "SELECT id FROM external_sync_events WHERE idempotency_key = $1",
        [idempotencyKey]
      );
      if (dupRows.length > 0) {
        logShopifyEvent("info", "webhook_duplicate_ignored", {
          webhook_id: webhookId || null,
          idempotency_key: idempotencyKey,
        });
        return res.json({ success: true, duplicate: true });
      }

      // Process order
      let orderErr = null;
      let orderResult = null;
      try {
        orderResult = await upsertWebOrderFromShopifyPayload(payload);
      } catch (e) {
        orderErr = e;
      }

      // The order can be saved while its stock couldn't move (no outlet
      // mapping, unmatched lines). Record that on the event instead of
      // reporting a clean "processed" (1e).
      const policy = orderResult?.stock_policy || null;
      const policyProblem = policy?.error
        ? policy.error
        : policy?.unmatched?.length
          ? `Stock not moved for unmatched line(s): ${policy.unmatched.join(", ")}`
          : null;
      const status = orderErr ? "failed" : policy?.error ? "failed" : policyProblem ? "needs_attention" : "processed";
      const problem = orderErr ? String(orderErr.message || "Unknown error") : policyProblem;

      await db.query(
        `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at)
         VALUES ('inbound', 'order', $1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          idempotencyKey,
          status,
          problem,
          JSON.stringify({
            webhook_id: webhookId || null,
            topic: topicHeader || null,
            order_id: orderId || null,
            web_order_id: orderResult?.web_order_id || null,
            stock_policy: policy,
          }),
        ]
      );

      await db.query(
        `UPDATE shopify_connections
         SET last_sync_at = NOW(), last_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [problem, conn.id]
      ).catch(() => {});

      // Only a failure to store the order asks Shopify to retry. A stock
      // problem is on the order + event for staff; retrying won't fix it.
      if (orderErr) return res.status(500).json({ error: orderErr.message });
      return res.json({
        success: true,
        web_order_id: orderResult?.web_order_id || null,
        stock_policy: policy,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Per-shop address (what the setup screen gives out): the tenant slug in the
  // path tells a multi-tenant server whose order this is.
  router.post(
    "/api/integrations/shopify/webhooks/orders/:tenantSlug",
    webhookLimiter,
    resolveTenant,
    handleOrderWebhook,
  );
  // Original address — works single-tenant, or multi-tenant with ?tenant=<slug>.
  router.post(
    "/api/integrations/shopify/webhooks/orders-create",
    webhookLimiter,
    resolveTenant,
    handleOrderWebhook,
  );
};
