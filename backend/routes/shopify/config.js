module.exports = function registerShopifyConfigRoutes(app, deps) {
  const { db, requirePerm, encryptShopifySecret, maskSecret, getActiveShopifyConnection } = deps;

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
};
