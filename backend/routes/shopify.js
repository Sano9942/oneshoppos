const { maskSecret: _maskSecret, getActiveShopifyConnection: _getActiveShopifyConnection } = require("../shopify/utils");

module.exports = function registerShopifyRoutes(app, deps) {
  const {
    db, requirePerm, requireAnyPerm, requireFeature,
    webhookLimiter, SHOPIFY_MAX_RETRY_ATTEMPTS,
    verifyConnection, fetchShopifyLocations, adjustShopifyInventory,
    fetchShopifyVariantCatalog, fetchShopifyProductsFull,
    fetchInventoryLevel, fetchInventoryLevelsBatch, fetchRecentOrders,
    retryDelayMinutesWithJitter, evaluateWebhookTimestampWindow,
    isRetryableInventoryEventStatus, canApproveReconciliationRequest,
    buildWebhookIdempotencyKey, verifyWebhookSignature,
    encryptShopifySecret, decryptShopifySecret, logShopifyEvent,
    createNotification, runtimeState,
    processPendingShopifyInventoryEvents, enqueueInventorySyncEvents
  } = deps;

  function maskSecret(secret) { return _maskSecret(secret, decryptShopifySecret); }
  function getActiveShopifyConnection(cb) { return _getActiveShopifyConnection(db, decryptShopifySecret, cb); }

// --- ROUTES: SHOPIFY CONNECTOR ---

  app.get(
    "/api/integrations/shopify/config",
    requirePerm("manage_inventory"),
    (req, res) => {
      getActiveShopifyConnection((err, conn) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!conn) {
          return res.json({
            connected: false,
            config: null,
          });
        }
        return res.json({
          connected: true,
          config: {
            id: conn.id,
            shop_domain: conn.shop_domain,
            api_version: conn.api_version,
            webhook_secret_masked: maskSecret(conn.webhook_secret),
            default_location_id: conn.default_location_id,
            is_active: Number(conn.is_active || 0) === 1,
            last_sync_at: conn.last_sync_at,
            last_error: conn.last_error,
          },
        });
      });
    },
  );

  app.put(
    "/api/integrations/shopify/config",
    requirePerm("manage_inventory"),
    (req, res) => {
      const {
        shop_domain,
        access_token,
        api_version = "2025-10",
        webhook_secret = null,
        default_location_id = null,
        is_active = true,
      } = req.body || {};
      if (!shop_domain) {
        return res.status(400).json({ error: "shop_domain is required" });
      }
      const normalizedDomain = String(shop_domain).trim().toLowerCase();
      db.get(
        "SELECT access_token FROM shopify_connections WHERE shop_domain = ?",
        [normalizedDomain],
        (selErr, existing) => {
          if (selErr) return res.status(500).json({ error: selErr.message });
          const tokenInput = String(access_token || "").trim();
          const effectiveToken = tokenInput
            ? encryptShopifySecret(tokenInput)
            : existing?.access_token || null;
          if (!effectiveToken) {
            return res.status(400).json({
              error: "access_token is required for first-time connection",
            });
          }

          db.serialize(() => {
            db.run("UPDATE shopify_connections SET is_active = 0");
            db.run(
              `INSERT INTO shopify_connections (
            shop_domain, access_token, api_version, webhook_secret, default_location_id, is_active, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
          ON CONFLICT(shop_domain) DO UPDATE SET
            access_token = excluded.access_token,
            api_version = excluded.api_version,
            webhook_secret = COALESCE(excluded.webhook_secret, shopify_connections.webhook_secret),
            default_location_id = excluded.default_location_id,
            is_active = excluded.is_active,
            updated_at = datetime('now','localtime')`,
              [
                normalizedDomain,
                effectiveToken,
                String(api_version).trim(),
                webhook_secret
                  ? encryptShopifySecret(String(webhook_secret))
                  : null,
                default_location_id ? String(default_location_id) : null,
                is_active ? 1 : 0,
              ],
              function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                  message: "Shopify connection saved",
                  id: this.lastID || null,
                });
              },
            );
          });
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/disconnect",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.run(
        "UPDATE shopify_connections SET is_active = 0, updated_at = datetime('now','localtime') WHERE is_active = 1",
        [],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Shopify disconnected",
            updated: this.changes || 0,
          });
        },
      );
    },
  );

  app.get(
    "/api/integrations/shopify/status",
    requireAnyPerm(["manage_inventory", "manage_orders"]),
    (req, res) => {
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        db.get(
          `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed,
              SUM(CASE WHEN status IN ('failed', 'dead_letter', 'failed_mapping') THEN 1 ELSE 0 END) as failed,
              SUM(CASE WHEN status IN ('pending', 'retry') THEN 1 ELSE 0 END) as pending
       FROM external_sync_events`,
          [],
          (evtErr, stats) => {
            if (evtErr) return res.status(500).json({ error: evtErr.message });
            db.get(
              `SELECT started_at, finished_at, status, processed_count, failed_count, direction, run_type
           FROM shopify_sync_runs
           ORDER BY id DESC
           LIMIT 1`,
              [],
              (runErr, lastRun) => {
                if (runErr)
                  return res.status(500).json({ error: runErr.message });
                db.get(
                  `SELECT
                 SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) as dead_letter,
                 SUM(CASE
                       WHEN status = 'retry'
                        AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now','localtime'))
                       THEN 1 ELSE 0 END) as retry_due,
                 SUM(CASE WHEN status IN ('pending','retry') THEN 1 ELSE 0 END) as backlog,
                 MIN(CASE WHEN status IN ('pending','retry') THEN created_at END) as oldest_backlog_at
               FROM external_sync_events
               WHERE direction = 'outbound'
                 AND entity_type = 'inventory'`,
                  [],
                  (opsErr, ops) => {
                    if (opsErr)
                      return res.status(500).json({ error: opsErr.message });
                    let oldestBacklogMinutes = null;
                    if (ops?.oldest_backlog_at) {
                      const oldestMs = Date.parse(
                        String(ops.oldest_backlog_at).replace(" ", "T"),
                      );
                      if (!Number.isNaN(oldestMs)) {
                        oldestBacklogMinutes = Math.max(
                          0,
                          Math.round((Date.now() - oldestMs) / 60000),
                        );
                      }
                    }
                    res.json({
                      connected: Boolean(conn),
                      shop_domain: conn?.shop_domain || null,
                      last_sync_at: conn?.last_sync_at || null,
                      last_error: conn?.last_error || null,
                      event_stats: {
                        total: stats?.total || 0,
                        processed: stats?.processed || 0,
                        failed: stats?.failed || 0,
                        pending: stats?.pending || 0,
                      },
                      queue_health: {
                        dead_letter: Number(ops?.dead_letter || 0),
                        retry_due: Number(ops?.retry_due || 0),
                        backlog: Number(ops?.backlog || 0),
                        oldest_backlog_minutes: oldestBacklogMinutes,
                      },
                      last_run: lastRun || null,
                    });
                  },
                );
              },
            );
          },
        );
      });
    },
  );

  app.post(
    "/api/integrations/shopify/verify",
    requirePerm("manage_inventory"),
    async (req, res) => {
      getActiveShopifyConnection(async (err, conn) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });
        try {
          const shop = await verifyConnection(conn);
          res.json({ ok: true, shop });
        } catch (e) {
          res
            .status(400)
            .json({ ok: false, error: e.message || "Verification failed" });
        }
      });
    },
  );

  app.post(
    "/api/integrations/shopify/live-validation",
    requirePerm("manage_inventory"),
    async (req, res) => {
      getActiveShopifyConnection(async (err, conn) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        try {
          const shop = await verifyConnection(conn);
          const locations = await fetchShopifyLocations(conn);

          db.all(
            `SELECT spm.product_id, spm.variant_id, spm.shopify_inventory_item_id, slm.shopify_location_id
         FROM shopify_product_map spm
         JOIN shopify_location_map slm
         WHERE spm.is_active = 1
           AND spm.shopify_inventory_item_id IS NOT NULL
         LIMIT 5`,
            [],
            async (mapErr, mappedRows) => {
              if (mapErr)
                return res.status(500).json({ error: mapErr.message });
              const sampleChecks = [];
              for (const row of mappedRows || []) {
                try {
                  const inv = await fetchInventoryLevel(
                    conn,
                    row.shopify_inventory_item_id,
                    row.shopify_location_id,
                  );
                  sampleChecks.push({
                    product_id: row.product_id,
                    variant_id: row.variant_id || null,
                    inventory_item_id: row.shopify_inventory_item_id,
                    location_id: row.shopify_location_id,
                    ok: true,
                    available: Number(inv?.available || 0),
                  });
                } catch (e) {
                  sampleChecks.push({
                    product_id: row.product_id,
                    variant_id: row.variant_id || null,
                    inventory_item_id: row.shopify_inventory_item_id,
                    location_id: row.shopify_location_id,
                    ok: false,
                    error: String(
                      e?.message || "Failed fetching inventory level",
                    ),
                  });
                }
              }
              const failedSamples = sampleChecks.filter((s) => !s.ok).length;
              return res.json({
                ok: failedSamples === 0,
                checked_at: new Date().toISOString(),
                checks: {
                  shop_connection: {
                    ok: true,
                    myshopify_domain: shop?.myshopifyDomain || null,
                    shop_name: shop?.name || null,
                  },
                  locations: {
                    ok: Array.isArray(locations),
                    count: Array.isArray(locations) ? locations.length : 0,
                  },
                  mapped_inventory_sample: {
                    ok: failedSamples === 0,
                    total: sampleChecks.length,
                    failed: failedSamples,
                    rows: sampleChecks,
                  },
                },
              });
            },
          );
        } catch (e) {
          return res
            .status(400)
            .json({ ok: false, error: e.message || "Live validation failed" });
        }
      });
    },
  );

  app.get(
    "/api/integrations/shopify/webhooks/setup",
    requirePerm("manage_inventory"),
    (req, res) => {
      getActiveShopifyConnection((err, conn) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        const configuredBase = String(process.env.APP_PUBLIC_BASE_URL || "")
          .trim()
          .replace(/\/+$/, "");
        const detectedBase = `${req.protocol}://${req.get("host")}`;
        const baseUrl = configuredBase || detectedBase;
        const endpoint = `${baseUrl}/api/integrations/shopify/webhooks/orders-create`;
        res.json({
          ok: true,
          base_url: baseUrl,
          callback_url: endpoint,
          shop_domain: conn.shop_domain || null,
          secret_configured: Boolean(conn.webhook_secret),
          required_topics: [
            "orders/create",
            "orders/updated",
            "orders/cancelled",
            "refunds/create",
          ],
          notes: [
            "Set webhook format to JSON.",
            "Use the same webhook secret configured in OneShopPOS.",
            "Use HTTPS callback URL reachable by Shopify.",
          ],
        });
      });
    },
  );

  app.get(
    "/api/integrations/shopify/uat-checklist",
    requireAnyPerm(["manage_inventory", "manage_orders"]),
    (req, res) => {
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        db.serialize(() => {
          db.get(
            "SELECT COUNT(*) as count FROM shopify_location_map",
            [],
            (locErr, locRow) => {
              if (locErr)
                return res.status(500).json({ error: locErr.message });
              db.get(
                "SELECT COUNT(*) as count FROM shopify_product_map WHERE is_active = 1",
                [],
                (mapErr, mapRow) => {
                  if (mapErr)
                    return res.status(500).json({ error: mapErr.message });
                  db.get(
                    `SELECT
               SUM(CASE WHEN direction='outbound' AND status='processed' THEN 1 ELSE 0 END) as outbound_processed,
               SUM(CASE WHEN direction='inbound' AND status='processed' THEN 1 ELSE 0 END) as inbound_processed,
               SUM(CASE WHEN status='dead_letter' THEN 1 ELSE 0 END) as dead_letter
             FROM external_sync_events`,
                    [],
                    (evtErr, ev) => {
                      if (evtErr)
                        return res.status(500).json({ error: evtErr.message });
                      const checklist = [
                        {
                          id: "connection",
                          label: "Active Shopify connection",
                          pass: Boolean(conn),
                        },
                        {
                          id: "location_mapping",
                          label: "At least one location mapping",
                          pass: Number(locRow?.count || 0) > 0,
                        },
                        {
                          id: "product_mapping",
                          label: "At least one active product mapping",
                          pass: Number(mapRow?.count || 0) > 0,
                        },
                        {
                          id: "outbound_processed",
                          label: "At least one outbound event processed",
                          pass: Number(ev?.outbound_processed || 0) > 0,
                        },
                        {
                          id: "inbound_processed",
                          label: "At least one inbound event processed",
                          pass: Number(ev?.inbound_processed || 0) > 0,
                        },
                        {
                          id: "dead_letter_zero",
                          label: "No dead-letter events",
                          pass: Number(ev?.dead_letter || 0) === 0,
                        },
                      ];
                      return res.json({
                        checked_at: new Date().toISOString(),
                        checklist,
                        stats: {
                          location_mappings: Number(locRow?.count || 0),
                          product_mappings: Number(mapRow?.count || 0),
                          outbound_processed: Number(
                            ev?.outbound_processed || 0,
                          ),
                          inbound_processed: Number(ev?.inbound_processed || 0),
                          dead_letter: Number(ev?.dead_letter || 0),
                        },
                      });
                    },
                  );
                },
              );
            },
          );
        });
      });
    },
  );

  app.get(
    "/api/integrations/shopify/locations/live",
    requirePerm("manage_inventory"),
    async (req, res) => {
      getActiveShopifyConnection(async (err, conn) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });
        try {
          const locations = await fetchShopifyLocations(conn);
          res.json({ locations });
        } catch (e) {
          res
            .status(400)
            .json({ error: e.message || "Failed to load Shopify locations" });
        }
      });
    },
  );

  app.get(
    "/api/integrations/shopify/events",
    requireAnyPerm(["manage_inventory", "manage_orders"]),
    (req, res) => {
      const limit = Math.min(
        200,
        Math.max(1, parseInt(req.query.limit || "50", 10)),
      );
      const { status, entity_type, direction, search } = req.query;
      const where = ["1=1"];
      const params = [];
      if (status) {
        where.push("status = ?");
        params.push(String(status));
      }
      if (entity_type) {
        where.push("entity_type = ?");
        params.push(String(entity_type));
      }
      if (direction) {
        where.push("direction = ?");
        params.push(String(direction));
      }
      if (search) {
        where.push(
          "(idempotency_key LIKE ? OR COALESCE(error_message,'') LIKE ?)",
        );
        params.push(`%${search}%`, `%${search}%`);
      }
      params.push(limit);
      db.all(
        `SELECT id, direction, entity_type, idempotency_key, status, error_message, attempt_count, next_retry_at, created_at, processed_at
     FROM external_sync_events
     WHERE ${where.join(" AND ")}
     ORDER BY id DESC
     LIMIT ?`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ events: rows || [] });
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/retry-event/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id } = req.params;
      db.get(
        `SELECT id, direction, entity_type, status
     FROM external_sync_events
     WHERE id = ?`,
        [id],
        (selErr, eventRow) => {
          if (selErr) return res.status(500).json({ error: selErr.message });
          if (!eventRow)
            return res.status(404).json({ error: "Event not found" });
          if (
            eventRow.direction !== "outbound" ||
            eventRow.entity_type !== "inventory"
          ) {
            return res
              .status(400)
              .json({ error: "Only outbound inventory events can be retried" });
          }
          if (!isRetryableInventoryEventStatus(eventRow.status)) {
            return res
              .status(400)
              .json({ error: "Event status is not retryable" });
          }

          db.run(
            `UPDATE external_sync_events
         SET status = 'pending',
             error_message = NULL,
             next_retry_at = datetime('now','localtime'),
             processed_at = NULL
         WHERE id = ?`,
            [id],
            function (updErr) {
              if (updErr)
                return res.status(500).json({ error: updErr.message });
              logShopifyEvent("info", "retry_single_queued", {
                event_id: Number(id),
                previous_status: eventRow.status,
              });
              res.json({ message: "Event queued for retry", id: Number(id) });
            },
          );
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/process-pending",
    requirePerm("manage_inventory"),
    (req, res) => {
      const limit = Math.min(
        100,
        Math.max(1, parseInt(req.body?.limit || "25", 10)),
      );
      db.run(
        `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
     VALUES ('outbound', 'process_pending_inventory', 'running', ?)`,
        [`Manual queue processing requested (limit ${limit})`],
        function (runErr) {
          if (runErr) return res.status(500).json({ error: runErr.message });
          const runId = this.lastID;
          processPendingShopifyInventoryEvents(limit, (err, result) => {
            const out = result || { processed: 0, failed: 0, skipped: 0 };
            db.run(
              `UPDATE shopify_sync_runs
           SET finished_at = datetime('now','localtime'),
               status = ?,
               processed_count = ?,
               failed_count = ?
           WHERE id = ?`,
              [
                out.failed > 0 ? "completed_with_errors" : "completed",
                out.processed || 0,
                out.failed || 0,
                runId,
              ],
            );
            if (err) return res.status(500).json({ error: err.message });
            res.json({ run_id: runId, ...out });
          });
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/retry-failed",
    requirePerm("manage_inventory"),
    (req, res) => {
      const limit = Math.min(
        500,
        Math.max(1, parseInt(req.body?.limit || "100", 10)),
      );
      db.run(
        `UPDATE external_sync_events
     SET status = 'pending',
         error_message = NULL,
         next_retry_at = datetime('now','localtime'),
         processed_at = NULL
     WHERE id IN (
       SELECT id FROM external_sync_events
       WHERE direction = 'outbound'
         AND entity_type = 'inventory'
         AND status IN ('failed', 'dead_letter', 'retry', 'failed_mapping')
       ORDER BY id ASC
       LIMIT ?
     )`,
        [limit],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          logShopifyEvent("info", "retry_bulk_queued", {
            queued: this.changes || 0,
            limit,
          });
          res.json({
            message: "Failed events queued for retry",
            queued: this.changes || 0,
          });
        },
      );
    },
  );

  app.post(
    "/api/integrations/shopify/sync/push-inventory",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { rows = [], process_now = true } = req.body || {};
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        db.serialize(() => {
          db.run(
            `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
         VALUES ('outbound', 'manual_push_inventory', 'running', ?)`,
            [
              rows.length > 0
                ? "Manual rows pushed"
                : "Dry-run push generated from local inventory",
            ],
            function (runErr) {
              if (runErr)
                return res.status(500).json({ error: runErr.message });
              const runId = this.lastID;
              const toPush = Array.isArray(rows) ? rows : [];
              enqueueInventorySyncEvents(
                toPush,
                {
                  reason: "manual_sync",
                  reference_type: "manual",
                  reference_id: runId,
                },
                (enqueueErr, enqueueResult) => {
                  if (enqueueErr) {
                    db.run(
                      `UPDATE shopify_sync_runs
                   SET finished_at = datetime('now','localtime'),
                       status = 'failed',
                       failed_count = 1,
                       notes = ?
                   WHERE id = ?`,
                      [enqueueErr.message, runId],
                    );
                    return res.status(500).json({ error: enqueueErr.message });
                  }

                  const queuedCount = enqueueResult?.queued || 0;
                  const finalizeRun = (processResult) => {
                    const processedCount = processResult?.processed || 0;
                    const failedCount = processResult?.failed || 0;
                    db.run(
                      `UPDATE shopify_sync_runs
                   SET finished_at = datetime('now','localtime'),
                       status = ?,
                       processed_count = ?,
                       failed_count = ?
                   WHERE id = ?`,
                      [
                        failedCount > 0 ? "completed_with_errors" : "completed",
                        processedCount,
                        failedCount,
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
                        failedCount > 0
                          ? `${failedCount} event(s) failed`
                          : null,
                        conn.id,
                      ],
                    );
                    return res.json({
                      message: "Inventory sync run completed",
                      run_id: runId,
                      queued: queuedCount,
                      processed: processedCount,
                      failed: failedCount,
                      skipped: processResult?.skipped || 0,
                    });
                  };

                  if (!process_now || queuedCount === 0) {
                    return finalizeRun({
                      processed: 0,
                      failed: 0,
                      skipped: enqueueResult?.skipped || 0,
                    });
                  }
                  processPendingShopifyInventoryEvents(
                    50,
                    (procErr, procResult) => {
                      if (procErr)
                        return res.status(500).json({ error: procErr.message });
                      return finalizeRun(procResult || {});
                    },
                  );
                },
              );
            },
          );
        });
      });
    },
  );

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

  // --- IMPORT: Pull products from Shopify into POS ---
  // Creates/updates products by barcode (upsert). Also creates product mappings.
  app.post(
    "/api/integrations/shopify/import/products",
    requirePerm("manage_inventory"),
    (req, res) => {
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        // Fetch all outlets to determine a default outlet for stock seeding
        db.all(
          "SELECT id FROM outlets ORDER BY id ASC LIMIT 1",
          [],
          (outErr, outRows) => {
            if (outErr) return res.status(500).json({ error: outErr.message });
            const defaultOutletId = outRows?.[0]?.id || null;

            // Fetch location mappings so we know which outlet maps to which Shopify location
            db.all(
              "SELECT outlet_id, shopify_location_id FROM shopify_location_map",
              [],
              (mapErr, locationMaps) => {
                if (mapErr)
                  return res.status(500).json({ error: mapErr.message });

                // Build a map: shopify_location_id -> outlet_id
                const locationToOutlet = {};
                (locationMaps || []).forEach((lm) => {
                  locationToOutlet[lm.shopify_location_id] = lm.outlet_id;
                });

                fetchShopifyProductsFull(conn, 10000)
                  .then((shopifyProducts) => {
                    if (!shopifyProducts || shopifyProducts.length === 0) {
                      return res.json({
                        created: 0,
                        updated: 0,
                        skipped: 0,
                        errors: [],
                      });
                    }

                    let created = 0;
                    let updated = 0;
                    let skipped = 0;
                    const errors = [];
                    let idx = 0;

                    const processNext = () => {
                      if (idx >= shopifyProducts.length) {
                        return res.json({ created, updated, skipped, errors });
                      }

                      const sp = shopifyProducts[idx];
                      idx += 1;

                      // Only import variants that have a barcode (needed for POS lookup)
                      const importableVariants = sp.variants.filter(
                        (v) => v.barcode && v.barcode.trim(),
                      );

                      if (importableVariants.length === 0) {
                        skipped += 1;
                        return processNext();
                      }

                      // Process each variant as a POS product (one product per barcode)
                      let vIdx = 0;
                      const processVariant = () => {
                        if (vIdx >= importableVariants.length)
                          return processNext();
                        const v = importableVariants[vIdx];
                        vIdx += 1;

                        const barcode = v.barcode.trim();
                        const name = sp.title || barcode;

                        // Check if product already exists
                        db.get(
                          "SELECT id FROM products WHERE barcode = ?",
                          [barcode],
                          (findErr, existing) => {
                            if (findErr) {
                              errors.push({ barcode, error: findErr.message });
                              return processVariant();
                            }

                            // Auto-create category from Shopify product_type, then run upsert
                            const productTypeName = (
                              sp.product_type || ""
                            ).trim();
                            const doUpsert = (categoryId) => {
                              db.run(
                                `INSERT INTO products (barcode, sku, name, price, compare_at_price, description_html, product_type, vendor, tags, status, cost_price, category_id, stock, unit)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pcs')
                             ON CONFLICT(barcode) DO UPDATE SET
                               sku = excluded.sku,
                               name = excluded.name,
                               price = excluded.price,
                               compare_at_price = excluded.compare_at_price,
                               description_html = excluded.description_html,
                               product_type = excluded.product_type,
                               vendor = excluded.vendor,
                               tags = excluded.tags,
                               status = excluded.status,
                               cost_price = CASE WHEN excluded.cost_price > 0 THEN excluded.cost_price ELSE products.cost_price END,
                               category_id = CASE WHEN excluded.category_id IS NOT NULL THEN excluded.category_id ELSE products.category_id END`,
                                [
                                  barcode,
                                  v.sku || null,
                                  name,
                                  v.price || 0,
                                  v.compare_at_price || 0,
                                  sp.description_html || null,
                                  sp.product_type || null,
                                  sp.vendor || null,
                                  sp.tags || null,
                                  sp.status || "active",
                                  v.cost_price || 0,
                                  categoryId,
                                ],
                                function (upsertErr) {
                                  if (upsertErr) {
                                    errors.push({
                                      barcode,
                                      error: upsertErr.message,
                                    });
                                    return processVariant();
                                  }

                                  const productId = existing
                                    ? existing.id
                                    : this.lastID;
                                  if (existing) updated += 1;
                                  else created += 1;

                                  // Upsert product mapping
                                  db.run(
                                    `INSERT INTO shopify_product_map (product_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at)
                                 VALUES (?, ?, ?, ?, 1, datetime('now','localtime'))
                                 ON CONFLICT(shopify_product_id, shopify_variant_id) DO UPDATE SET
                                   product_id = excluded.product_id,
                                   shopify_inventory_item_id = excluded.shopify_inventory_item_id,
                                   is_active = 1,
                                   last_verified_at = datetime('now','localtime')`,
                                    [
                                      productId,
                                      sp.shopify_product_id,
                                      v.shopify_variant_id,
                                      v.shopify_inventory_item_id,
                                    ],
                                  );

                                  // Seed outlet stock from Shopify inventory levels
                                  const levels = v.inventory_levels || [];
                                  if (levels.length === 0 && defaultOutletId) {
                                    db.run(
                                      `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                                   VALUES (?, ?, 0)
                                   ON CONFLICT(product_id, outlet_id) DO NOTHING`,
                                      [productId, defaultOutletId],
                                      () => processVariant(),
                                    );
                                    return;
                                  }

                                  let lIdx = 0;
                                  const processLevel = () => {
                                    if (lIdx >= levels.length)
                                      return processVariant();
                                    const lvl = levels[lIdx];
                                    lIdx += 1;
                                    const outletId =
                                      locationToOutlet[
                                        lvl.shopify_location_id
                                      ] || defaultOutletId;
                                    if (!outletId) return processLevel();
                                    db.run(
                                      `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                                   VALUES (?, ?, ?)
                                   ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = ?`,
                                      [
                                        productId,
                                        outletId,
                                        lvl.available,
                                        lvl.available,
                                      ],
                                      () => processLevel(),
                                    );
                                  };
                                  processLevel();
                                },
                              );
                            };

                            // Resolve category: upsert from Shopify product_type, then call doUpsert
                            if (productTypeName) {
                              db.run(
                                `INSERT INTO categories (name) VALUES (?)
                             ON CONFLICT(name) DO NOTHING`,
                                [productTypeName],
                                () => {
                                  db.get(
                                    "SELECT id FROM categories WHERE name = ? LIMIT 1",
                                    [productTypeName],
                                    (catErr, catRow) => {
                                      doUpsert(
                                        catErr || !catRow ? null : catRow.id,
                                      );
                                    },
                                  );
                                },
                              );
                            } else {
                              doUpsert(null);
                            }
                          },
                        );
                      };
                      processVariant();
                    };
                    processNext();
                  })
                  .catch((err) => {
                    res
                      .status(500)
                      .json({ error: `Shopify fetch failed: ${err.message}` });
                  });
              },
            );
          },
        );
      });
    },
  );

  // --- IMPORT: Sync inventory levels from Shopify into POS (mapped products only) ---
  // For every mapped product/location pair, SET the POS stock to Shopify's current quantity.
  app.post(
    "/api/integrations/shopify/import/inventory",
    requirePerm("manage_inventory"),
    (req, res) => {
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        // Load all active product mappings + location mappings
        db.all(
          `SELECT spm.product_id, spm.shopify_inventory_item_id,
                  slm.outlet_id, slm.shopify_location_id
           FROM shopify_product_map spm
           JOIN shopify_location_map slm ON 1=1
           WHERE spm.is_active = 1 AND spm.shopify_inventory_item_id IS NOT NULL AND spm.shopify_inventory_item_id != ''`,
          [],
          (mapErr, mappings) => {
            if (mapErr) return res.status(500).json({ error: mapErr.message });
            if (!mappings || mappings.length === 0) {
              return res.status(400).json({
                error:
                  "No active product+location mappings found. Map products and locations first.",
              });
            }

            let synced = 0;
            let failed = 0;
            const errors = [];
            let idx = 0;

            const processNext = () => {
              if (idx >= mappings.length) {
                return res.json({ synced, failed, errors });
              }

              const m = mappings[idx];
              idx += 1;

              fetchInventoryLevel(
                conn,
                m.shopify_inventory_item_id,
                m.shopify_location_id,
              )
                .then((lvl) => {
                  const qty = Number.isFinite(lvl.available)
                    ? lvl.available
                    : 0;
                  db.run(
                    `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                     VALUES (?, ?, ?)
                     ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = ?`,
                    [m.product_id, m.outlet_id, qty, qty],
                    (stockErr) => {
                      if (stockErr) {
                        failed += 1;
                        errors.push({
                          product_id: m.product_id,
                          outlet_id: m.outlet_id,
                          error: stockErr.message,
                        });
                      } else {
                        synced += 1;
                      }
                      processNext();
                    },
                  );
                })
                .catch((fetchErr) => {
                  failed += 1;
                  errors.push({
                    product_id: m.product_id,
                    outlet_id: m.outlet_id,
                    error: fetchErr.message,
                  });
                  processNext();
                });
            };
            processNext();
          },
        );
      });
    },
  );

  // Delete all products that were imported from Shopify (have a shopify_product_map entry).
  // Also clears their dependent rows: shopify_product_map, outlet_stock, product_variants,
  // stock_adjustments. Temporarily disables FK enforcement so products with historic
  // sale_items are not blocked (sale history is preserved with a NULL product_id).
  app.delete(
    "/api/integrations/shopify/import/products",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.all(
        "SELECT DISTINCT product_id FROM shopify_product_map WHERE product_id IS NOT NULL",
        [],
        (listErr, rows) => {
          if (listErr) return res.status(500).json({ error: listErr.message });
          const productIds = rows.map((r) => r.product_id).filter(Boolean);
          if (productIds.length === 0) {
            return res.json({
              deleted: 0,
              message: "No Shopify-imported products found.",
            });
          }
          // SQLite has a 999-parameter limit; chunk into batches of 400
          const CHUNK = 400;
          const chunks = [];
          for (let i = 0; i < productIds.length; i += CHUNK) {
            chunks.push(productIds.slice(i, i + CHUNK));
          }
          let totalDeleted = 0;
          let chunkIdx = 0;

          // Disable FK enforcement for this operation so historic sale_items
          // that reference these products don't block the delete.
          db.run("PRAGMA foreign_keys = OFF", (fkOffErr) => {
            if (fkOffErr)
              return res.status(500).json({ error: fkOffErr.message });

            const finish = (err) => {
              // Always re-enable FK enforcement before responding
              db.run("PRAGMA foreign_keys = ON", () => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                  deleted: totalDeleted,
                  message: `Deleted ${totalDeleted} Shopify-imported product(s).`,
                });
              });
            };

            const processChunk = () => {
              if (chunkIdx >= chunks.length) return finish(null);
              const ids = chunks[chunkIdx];
              chunkIdx += 1;
              const ph = ids.map(() => "?").join(",");
              db.run(
                `DELETE FROM shopify_product_map WHERE product_id IN (${ph})`,
                ids,
                (e1) => {
                  if (e1) return finish(e1);
                  db.run(
                    `DELETE FROM outlet_stock WHERE product_id IN (${ph})`,
                    ids,
                    (e2) => {
                      if (e2) return finish(e2);
                      db.run(
                        `DELETE FROM product_variants WHERE product_id IN (${ph})`,
                        ids,
                        (e3) => {
                          if (e3) return finish(e3);
                          db.run(
                            `DELETE FROM stock_adjustments WHERE product_id IN (${ph})`,
                            ids,
                            (e4) => {
                              if (e4) return finish(e4);
                              db.run(
                                `DELETE FROM products WHERE id IN (${ph})`,
                                ids,
                                function (e5) {
                                  if (e5) return finish(e5);
                                  totalDeleted += this.changes || 0;
                                  processChunk();
                                },
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              );
            };
            processChunk();
          });
        },
      );
    },
  );

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

  // --- ROUTES: INTERNAL SHOPIFY MAPPINGS ---

  app.get(
    "/api/integrations/mappings/products",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.all(
        `SELECT spm.*, p.name as product_name, pv.sku as variant_sku
     FROM shopify_product_map spm
     LEFT JOIN products p ON p.id = spm.product_id
     LEFT JOIN product_variants pv ON pv.id = spm.variant_id
     ORDER BY spm.id DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ mappings: rows || [] });
        },
      );
    },
  );

  app.put(
    "/api/integrations/mappings/products/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id } = req.params;
      const {
        product_id,
        variant_id,
        shopify_product_id,
        shopify_variant_id,
        shopify_inventory_item_id,
        is_active,
      } = req.body || {};
      db.run(
        `INSERT INTO shopify_product_map (
      id, product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(id) DO UPDATE SET
      product_id = excluded.product_id,
      variant_id = excluded.variant_id,
      shopify_product_id = excluded.shopify_product_id,
      shopify_variant_id = excluded.shopify_variant_id,
      shopify_inventory_item_id = excluded.shopify_inventory_item_id,
      is_active = excluded.is_active,
      last_verified_at = datetime('now','localtime')`,
        [
          parseInt(id),
          product_id || null,
          variant_id || null,
          shopify_product_id || null,
          shopify_variant_id || null,
          shopify_inventory_item_id || null,
          is_active !== undefined ? (is_active ? 1 : 0) : 1,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Product mapping saved" });
        },
      );
    },
  );

  app.post(
    "/api/integrations/mappings/products/auto",
    requirePerm("manage_inventory"),
    (req, res) => {
      // Placeholder for later Shopify-aware auto-map.
      // For pre-integration phase, return local products/variants candidates.
      db.all(
        `SELECT p.id as product_id, p.name, p.barcode, pv.id as variant_id, pv.sku
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id
     ORDER BY p.name ASC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            candidates: rows || [],
            message: "Auto-map candidates generated",
          });
        },
      );
    },
  );

  app.post(
    "/api/integrations/mappings/products/auto-live",
    requirePerm("manage_inventory"),
    (req, res) => {
      const limit = Math.min(
        10000,
        Math.max(1, parseInt(req.body?.limit || "500", 10)),
      );
      getActiveShopifyConnection(async (connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        try {
          const remoteVariants = await fetchShopifyVariantCatalog(conn, limit);
          db.all(
            `SELECT p.id as product_id,
                p.name as product_name,
                p.barcode as product_barcode,
                pv.id as variant_id,
                pv.sku as variant_sku,
                NULL as variant_barcode
         FROM products p
         LEFT JOIN product_variants pv ON pv.product_id = p.id`,
            [],
            (localErr, localRows) => {
              if (localErr)
                return res.status(500).json({ error: localErr.message });
              db.all(
                `SELECT product_id,
                    COALESCE(variant_id, -1) AS variant_key,
                    shopify_variant_id
             FROM shopify_product_map
             WHERE is_active = 1`,
                [],
                (mappedErr, mappedRows) => {
                  if (mappedErr)
                    return res.status(500).json({ error: mappedErr.message });

                  const existingLocalMap = new Map();
                  for (const row of mappedRows || []) {
                    existingLocalMap.set(
                      `${row.product_id}:${row.variant_key}`,
                      row.shopify_variant_id || "",
                    );
                  }

                  const byBarcode = new Map();
                  const bySku = new Map();
                  for (const rv of remoteVariants) {
                    const b = String(rv.barcode || "")
                      .trim()
                      .toLowerCase();
                    const s = String(rv.sku || "")
                      .trim()
                      .toLowerCase();
                    if (b && !byBarcode.has(b)) byBarcode.set(b, rv);
                    if (s && !bySku.has(s)) bySku.set(s, rv);
                  }

                  const suggestions = [];
                  for (const lr of localRows || []) {
                    const localBarcode = String(
                      lr.variant_barcode || lr.product_barcode || "",
                    )
                      .trim()
                      .toLowerCase();
                    const localSku = String(lr.variant_sku || "")
                      .trim()
                      .toLowerCase();

                    let match = null;
                    let confidence = "";
                    if (localBarcode && byBarcode.has(localBarcode)) {
                      match = byBarcode.get(localBarcode);
                      confidence = "exact_barcode";
                    } else if (localSku && bySku.has(localSku)) {
                      match = bySku.get(localSku);
                      confidence = "exact_sku";
                    }
                    if (!match) continue;

                    const localKey = `${lr.product_id}:${lr.variant_id || -1}`;
                    const mappedShopifyVariantId =
                      existingLocalMap.get(localKey) || "";
                    if (
                      mappedShopifyVariantId &&
                      mappedShopifyVariantId === String(match.variant_id || "")
                    ) {
                      continue;
                    }

                    suggestions.push({
                      product_id: lr.product_id,
                      product_name: lr.product_name,
                      variant_id: lr.variant_id || null,
                      local_sku: lr.variant_sku || null,
                      local_barcode:
                        lr.variant_barcode || lr.product_barcode || null,
                      shopify_product_id: match.product_id || null,
                      shopify_variant_id: match.variant_id || null,
                      shopify_inventory_item_id:
                        match.inventory_item_id || null,
                      shopify_title:
                        match.display_name || match.product_title || null,
                      confidence,
                    });
                  }

                  return res.json({
                    message: "Live mapping suggestions generated",
                    remote_count: remoteVariants.length,
                    suggestion_count: suggestions.length,
                    suggestions,
                  });
                },
              );
            },
          );
        } catch (e) {
          return res
            .status(400)
            .json({ error: e.message || "Failed to generate live mappings" });
        }
      });
    },
  );

  app.post(
    "/api/integrations/mappings/products/apply-suggestions",
    requirePerm("manage_inventory"),
    (req, res) => {
      const suggestions = Array.isArray(req.body?.suggestions)
        ? req.body.suggestions
        : [];
      if (suggestions.length === 0) {
        return res.status(400).json({ error: "suggestions array is required" });
      }

      let idx = 0;
      let applied = 0;
      let skipped = 0;
      const conflicts = [];

      const next = () => {
        if (idx >= suggestions.length) {
          return res.json({
            message: "Suggestions processed",
            total: suggestions.length,
            applied,
            skipped,
            conflicts,
          });
        }

        const s = suggestions[idx];
        idx += 1;
        const productId = s.product_id ? Number(s.product_id) : null;
        const variantId = s.variant_id ? Number(s.variant_id) : null;
        const shopifyProductId = s.shopify_product_id || null;
        const shopifyVariantId = s.shopify_variant_id || null;
        const shopifyInventoryItemId = s.shopify_inventory_item_id || null;

        if (!productId || !shopifyVariantId) {
          skipped += 1;
          return next();
        }

        db.get(
          `SELECT id, product_id, variant_id
       FROM shopify_product_map
       WHERE shopify_variant_id = ?
         AND (
           product_id != ?
           OR COALESCE(variant_id, -1) != COALESCE(?, -1)
         )
       LIMIT 1`,
          [shopifyVariantId, productId, variantId],
          (confErr, conflict) => {
            if (confErr) {
              skipped += 1;
              conflicts.push({
                product_id: productId,
                variant_id: variantId,
                shopify_variant_id: shopifyVariantId,
                reason: confErr.message,
              });
              return next();
            }
            if (conflict) {
              skipped += 1;
              conflicts.push({
                product_id: productId,
                variant_id: variantId,
                shopify_variant_id: shopifyVariantId,
                reason: `Already mapped to local product ${conflict.product_id}/${conflict.variant_id || "no-variant"}`,
              });
              return next();
            }

            db.get(
              `SELECT id
           FROM shopify_product_map
           WHERE product_id = ?
             AND COALESCE(variant_id, -1) = COALESCE(?, -1)
           LIMIT 1`,
              [productId, variantId],
              (localErr, localExisting) => {
                if (localErr) {
                  skipped += 1;
                  conflicts.push({
                    product_id: productId,
                    variant_id: variantId,
                    shopify_variant_id: shopifyVariantId,
                    reason: localErr.message,
                  });
                  return next();
                }

                if (localExisting?.id) {
                  db.run(
                    `UPDATE shopify_product_map
                 SET shopify_product_id = ?,
                     shopify_variant_id = ?,
                     shopify_inventory_item_id = ?,
                     is_active = 1,
                     last_verified_at = datetime('now','localtime')
                 WHERE id = ?`,
                    [
                      shopifyProductId,
                      shopifyVariantId,
                      shopifyInventoryItemId,
                      localExisting.id,
                    ],
                    (upErr) => {
                      if (upErr) {
                        skipped += 1;
                        conflicts.push({
                          product_id: productId,
                          variant_id: variantId,
                          shopify_variant_id: shopifyVariantId,
                          reason: upErr.message,
                        });
                      } else {
                        applied += 1;
                      }
                      return next();
                    },
                  );
                  return;
                }

                db.run(
                  `INSERT INTO shopify_product_map (
                 product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at
               ) VALUES (?, ?, ?, ?, ?, 1, datetime('now','localtime'))`,
                  [
                    productId,
                    variantId,
                    shopifyProductId,
                    shopifyVariantId,
                    shopifyInventoryItemId,
                  ],
                  (insErr) => {
                    if (insErr) {
                      skipped += 1;
                      conflicts.push({
                        product_id: productId,
                        variant_id: variantId,
                        shopify_variant_id: shopifyVariantId,
                        reason: insErr.message,
                      });
                    } else {
                      applied += 1;
                    }
                    return next();
                  },
                );
              },
            );
          },
        );
      };

      next();
    },
  );

  app.get(
    "/api/integrations/mappings/locations",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.all(
        `SELECT slm.*, o.name as outlet_name
     FROM shopify_location_map slm
     LEFT JOIN outlets o ON o.id = slm.outlet_id
     ORDER BY o.name ASC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ mappings: rows || [] });
        },
      );
    },
  );

  app.put(
    "/api/integrations/mappings/locations/:outletId",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { outletId } = req.params;
      const { shopify_location_id, shopify_location_name } = req.body || {};
      if (!shopify_location_id) {
        return res
          .status(400)
          .json({ error: "shopify_location_id is required" });
      }
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          "DELETE FROM shopify_location_map WHERE outlet_id = ?",
          [outletId],
          function (deleteErr) {
            if (deleteErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: deleteErr.message });
            }
            const replaced_count = this.changes || 0;
            db.run(
              `INSERT INTO shopify_location_map (outlet_id, shopify_location_id, shopify_location_name)
         VALUES (?, ?, ?)`,
              [
                outletId,
                String(shopify_location_id),
                shopify_location_name || null,
              ],
              function (insertErr) {
                if (insertErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: insertErr.message });
                }
                db.run("COMMIT", (commitErr) => {
                  if (commitErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: commitErr.message });
                  }
                  res.json({
                    message: "Location mapping saved",
                    replaced_count,
                  });
                });
              },
            );
          },
        );
      });
    },
  );

  app.get(
    "/api/integrations/mappings/customers",
    requirePerm("manage_orders"),
    (req, res) => {
      db.all(
        `SELECT scm.*, c.name as customer_name, c.mobile, c.email
     FROM shopify_customer_map scm
     LEFT JOIN customers c ON c.id = scm.customer_id
     ORDER BY scm.id DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ mappings: rows || [] });
        },
      );
    },
  );

  app.put(
    "/api/integrations/mappings/customers/:customerId",
    requirePerm("manage_orders"),
    (req, res) => {
      const { customerId } = req.params;
      const { shopify_customer_id } = req.body || {};
      if (!shopify_customer_id) {
        return res
          .status(400)
          .json({ error: "shopify_customer_id is required" });
      }
      db.run(
        `INSERT INTO shopify_customer_map (customer_id, shopify_customer_id, last_synced_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(shopify_customer_id) DO UPDATE SET
      customer_id = excluded.customer_id,
      last_synced_at = datetime('now','localtime')`,
        [customerId, String(shopify_customer_id)],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Customer mapping saved" });
        },
      );
    },
  );
};
