module.exports = function registerShopifyHealthRoutes(app, deps) {
  const {
    db,
    requirePerm,
    requireAnyPerm,
    getActiveShopifyConnection,
    verifyConnection,
    fetchShopifyLocations,
    fetchInventoryLevel,
  } = deps;

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
            "Use the same webhook secret configured in SanoPOS.",
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
};
