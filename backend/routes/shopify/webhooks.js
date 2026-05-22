module.exports = function registerShopifyWebhookRoutes(app, deps) {
  const {
    db, webhookLimiter,
    getActiveShopifyConnection, logShopifyEvent,
    buildWebhookIdempotencyKey, verifyWebhookSignature,
    evaluateWebhookTimestampWindow, upsertWebOrderFromShopifyPayload,
  } = deps;

  app.post(
    "/api/integrations/shopify/webhooks/orders-create",
    webhookLimiter,
    async (req, res) => {
      try {
        const payload = req.body || {};
        const rawBody = req.rawBody || JSON.stringify(payload || {});
        const webhookId = req.headers["x-shopify-webhook-id"] || "";
        const hmacHeader = req.headers["x-shopify-hmac-sha256"] || "";
        const shopHeader = req.headers["x-shopify-shop-domain"] || "";
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

        await db.query(
          `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at)
           VALUES ('inbound', 'order', $1, $2, $3, $4, NOW(), NOW())`,
          [
            idempotencyKey,
            orderErr ? "failed" : "processed",
            orderErr ? String(orderErr.message || "Unknown error") : null,
            JSON.stringify({
              webhook_id: webhookId || null,
              order_id: orderId || null,
              web_order_id: orderResult?.web_order_id || null,
            }),
          ]
        );

        await db.query(
          `UPDATE shopify_connections
           SET last_sync_at = NOW(), last_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [
            orderErr ? String(orderErr.message || "Webhook order processing failed") : null,
            conn.id,
          ]
        ).catch(() => {});

        if (orderErr) return res.status(500).json({ error: orderErr.message });
        return res.json({ success: true, web_order_id: orderResult?.web_order_id || null });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
