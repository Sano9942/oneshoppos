module.exports = function registerShopifyOrderRoutes(app, deps) {
  const {
    db, requirePerm,
    getActiveShopifyConnection, fetchRecentOrders,
    upsertWebOrderFromShopifyPayload, logShopifyEvent,
  } = deps;

  app.post(
    "/api/integrations/shopify/sync/pull-orders",
    requirePerm("manage_orders"),
    (req, res) => {
      const { orders = [] } = req.body || {};
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        fetchRecentOrders(conn, 10)
          .then((ordersList) => {
            const realOrders =
              Array.isArray(ordersList) && ordersList.length > 0
                ? ordersList
                : [];

            if (realOrders.length === 0) {
              return res.json({
                message: "No recent orders found in Shopify",
                processed: 0,
                failed: 0,
              });
            }

            db.run(
              `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
         VALUES ('inbound', 'manual_pull_orders', 'running', ?)`,
              [`Pull requested: ${realOrders.length} order(s)`],
              function (runErr) {
                if (runErr)
                  return res.status(500).json({ error: runErr.message });
                const runId = this.lastID;
                let idx = 0;
                let processed = 0;
                let failed = 0;

                const next = () => {
                  if (idx >= realOrders.length) {
                    db.run(
                      `UPDATE shopify_sync_runs
                 SET finished_at = datetime('now','localtime'),
                     status = ?,
                     processed_count = ?,
                     failed_count = ?
                 WHERE id = ?`,
                      [
                        failed > 0 ? "completed_with_errors" : "completed",
                        processed,
                        failed,
                        runId,
                      ],
                    );
                    db.run(
                      `UPDATE shopify_connections
                 SET last_sync_at = datetime('now','localtime'),
                     last_error = ?,
                     updated_at = datetime('now','localtime')
                 WHERE id = ?`,
                      [
                        failed > 0 ? "Some orders failed in pull run" : null,
                        conn.id,
                      ],
                    );
                    return res.json({
                      message: "Order pull run completed",
                      run_id: runId,
                      processed,
                      failed,
                    });
                  }

                  const orderPayload = realOrders[idx];
                  idx += 1;
                  upsertWebOrderFromShopifyPayload(
                    orderPayload,
                    (orderErr, result) => {
                      const idemKey = `inbound_order_${String(orderPayload?.id || "")}`;
                      db.run(
                        `INSERT OR IGNORE INTO external_sync_events (
                   direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at
                 ) VALUES ('inbound', 'order', ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
                        [
                          idemKey,
                          orderErr ? "failed" : "processed",
                          orderErr
                            ? String(orderErr.message || "Unknown error")
                            : null,
                          JSON.stringify({
                            run_id: runId,
                            order_id: orderPayload?.id || null,
                            web_order_id: result?.web_order_id || null,
                          }),
                        ],
                        () => {
                          if (orderErr) failed += 1;
                          else processed += 1;
                          next();
                        },
                      );
                    },
                  );
                };
                next();
              },
            );
          })
          .catch((err) => {
            res.status(500).json({
              error: `Failed to fetch orders from Shopify: ${err.message}`,
            });
          });
      });
    },
  );
};
