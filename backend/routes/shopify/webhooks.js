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
    (req, res) => {
      const payload = req.body || {};
      const rawBody = req.rawBody || JSON.stringify(payload || {});
      const webhookId = req.headers["x-shopify-webhook-id"] || "";
      const hmacHeader = req.headers["x-shopify-hmac-sha256"] || "";
      const shopHeader = req.headers["x-shopify-shop-domain"] || "";
      const triggeredAtHeader = req.headers["x-shopify-triggered-at"] || "";
      const orderId = String(payload?.id || payload?.order_id || "");
      const idempotencyKey = buildWebhookIdempotencyKey({ webhookId, payload });

      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        if (
          shopHeader &&
          conn.shop_domain &&
          String(shopHeader).toLowerCase() !==
            String(conn.shop_domain).toLowerCase()
        ) {
          return res.status(403).json({ error: "Shop domain mismatch" });
        }

        const signatureCheck = verifyWebhookSignature({
          rawBody,
          providedHmac: hmacHeader,
          webhookSecret: conn.webhook_secret,
        });
        if (!signatureCheck.ok) {
          return res.status(401).json({
            error:
              signatureCheck.reason === "missing_signature"
                ? "Missing webhook signature"
                : "Invalid webhook signature",
          });
        }

        const replayWindow = evaluateWebhookTimestampWindow(
          triggeredAtHeader,
          Date.now(),
        );
        if (!replayWindow.ok) {
          logShopifyEvent("warn", "webhook_replay_window_reject", {
            reason: replayWindow.reason,
            age_ms: replayWindow.ageMs || null,
            webhook_id: webhookId || null,
            shop: shopHeader || null,
          });
          return res
            .status(401)
            .json({ error: "Webhook timestamp outside allowed replay window" });
        }

        db.get(
          "SELECT id FROM external_sync_events WHERE idempotency_key = ?",
          [idempotencyKey],
          (dupErr, dup) => {
            if (dupErr) return res.status(500).json({ error: dupErr.message });
            if (dup) {
              logShopifyEvent("info", "webhook_duplicate_ignored", {
                webhook_id: webhookId || null,
                idempotency_key: idempotencyKey,
              });
              return res.json({ success: true, duplicate: true });
            }

            upsertWebOrderFromShopifyPayload(payload, (orderErr, result) => {
              db.run(
                `INSERT INTO external_sync_events (
              direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at
            ) VALUES ('inbound', 'order', ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
                [
                  idempotencyKey,
                  orderErr ? "failed" : "processed",
                  orderErr ? String(orderErr.message || "Unknown error") : null,
                  JSON.stringify({
                    webhook_id: webhookId || null,
                    order_id: orderId || null,
                    web_order_id: result?.web_order_id || null,
                  }),
                ],
                (evtErr) => {
                  if (evtErr)
                    return res.status(500).json({ error: evtErr.message });
                  db.run(
                    `UPDATE shopify_connections
                 SET last_sync_at = datetime('now','localtime'),
                     last_error = ?,
                     updated_at = datetime('now','localtime')
                 WHERE id = ?`,
                    [
                      orderErr
                        ? String(
                            orderErr.message ||
                              "Webhook order processing failed",
                          )
                        : null,
                      conn.id,
                    ],
                  );
                  if (orderErr)
                    return res.status(500).json({ error: orderErr.message });
                  return res.json({
                    success: true,
                    web_order_id: result?.web_order_id || null,
                  });
                },
              );
            });
          },
        );
      });
    },
  );
};
