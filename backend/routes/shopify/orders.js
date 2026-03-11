module.exports = function registerShopifyOrderRoutes(app, deps) {
  const {
    db, requirePerm,
    getActiveShopifyConnection, fetchRecentOrders,
    upsertWebOrderFromShopifyPayload, logShopifyEvent,
  } = deps;

  app.post(
    "/api/integrations/shopify/sync/pull-orders",
    requirePerm("manage_orders"),
    async (req, res) => {
      try {
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });

        const ordersList = await fetchRecentOrders(conn, 10);
        const realOrders = Array.isArray(ordersList) && ordersList.length > 0
          ? ordersList
          : [];

        if (realOrders.length === 0) {
          return res.json({
            message: "No recent orders found in Shopify",
            processed: 0,
            failed: 0,
          });
        }

        const { rows } = await db.query(
          `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
           VALUES ('inbound', 'manual_pull_orders', 'running', $1)
           RETURNING id`,
          [`Pull requested: ${realOrders.length} order(s)`]
        );
        const runId = rows[0].id;
        let processed = 0;
        let failed = 0;

        for (const orderPayload of realOrders) {
          const idemKey = `inbound_order_${String(orderPayload?.id || "")}`;
          try {
            const result = await upsertWebOrderFromShopifyPayload(orderPayload);
            await db.query(
              `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at)
               VALUES ('inbound', 'order', $1, 'processed', NULL, $2, NOW(), NOW())
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [idemKey, JSON.stringify({ run_id: runId, order_id: orderPayload?.id || null, web_order_id: result?.web_order_id || null })]
            );
            processed += 1;
          } catch (orderErr) {
            await db.query(
              `INSERT INTO external_sync_events (direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at)
               VALUES ('inbound', 'order', $1, 'failed', $2, $3, NOW(), NOW())
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [idemKey, String(orderErr.message || "Unknown error"), JSON.stringify({ run_id: runId, order_id: orderPayload?.id || null })]
            ).catch(() => {});
            failed += 1;
          }
        }

        await db.query(
          `UPDATE shopify_sync_runs
           SET finished_at = NOW(), status = $1, processed_count = $2, failed_count = $3
           WHERE id = $4`,
          [failed > 0 ? "completed_with_errors" : "completed", processed, failed, runId]
        ).catch(() => {});
        await db.query(
          `UPDATE shopify_connections
           SET last_sync_at = NOW(), last_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [failed > 0 ? "Some orders failed in pull run" : null, conn.id]
        ).catch(() => {});

        res.json({ message: "Order pull run completed", run_id: runId, processed, failed });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
