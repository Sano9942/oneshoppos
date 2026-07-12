module.exports = function registerShopifyConfigRoutes(app, deps) {
  const { db, requireAnyPerm, encryptShopifySecret, maskSecret, getActiveShopifyConnection } = deps;

  // PLAN-V2 Step 2: Shopify connection config is a credential surface —
  // manage_integrations delegate included; manage_inventory kept for the
  // existing Manager-facing Shopify settings page.
  app.get(
    "/api/integrations/shopify/config",
    requireAnyPerm(["manage_inventory", "manage_integrations"]),
    async (req, res) => {
      try {
        const conn = await getActiveShopifyConnection();
        if (!conn) {
          return res.json({ connected: false, config: null });
        }
        return res.json({
          connected: true,
          config: {
            id: conn.id,
            shop_domain: conn.shop_domain,
            api_version: conn.api_version,
            webhook_secret_masked: maskSecret(conn.webhook_secret),
            default_location_id: conn.default_location_id,
            is_active: conn.is_active === true,
            last_sync_at: conn.last_sync_at,
            last_error: conn.last_error,
          },
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/integrations/shopify/config",
    requireAnyPerm(["manage_inventory", "manage_integrations"]),
    async (req, res) => {
      try {
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

        const { rows: existingRows } = await db.query(
          "SELECT access_token FROM shopify_connections WHERE shop_domain = $1",
          [normalizedDomain]
        );
        const existing = existingRows[0];
        const tokenInput = String(access_token || "").trim();
        const effectiveToken = tokenInput
          ? encryptShopifySecret(tokenInput)
          : existing?.access_token || null;
        if (!effectiveToken) {
          return res.status(400).json({
            error: "access_token is required for first-time connection",
          });
        }

        await db.transaction(async (client) => {
          await client.query("UPDATE shopify_connections SET is_active = false");
          await client.query(
            `INSERT INTO shopify_connections (
              shop_domain, access_token, api_version, webhook_secret, default_location_id, is_active, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT(shop_domain) DO UPDATE SET
              access_token = EXCLUDED.access_token,
              api_version = EXCLUDED.api_version,
              webhook_secret = COALESCE(EXCLUDED.webhook_secret, shopify_connections.webhook_secret),
              default_location_id = EXCLUDED.default_location_id,
              is_active = EXCLUDED.is_active,
              updated_at = NOW()`,
            [
              normalizedDomain,
              effectiveToken,
              String(api_version).trim(),
              webhook_secret ? encryptShopifySecret(String(webhook_secret)) : null,
              default_location_id ? String(default_location_id) : null,
              is_active ? true : false,
            ]
          );
        });

        res.json({ message: "Shopify connection saved" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/integrations/shopify/disconnect",
    requireAnyPerm(["manage_inventory", "manage_integrations"]),
    async (req, res) => {
      try {
        const { rowCount } = await db.query(
          "UPDATE shopify_connections SET is_active = false, updated_at = NOW() WHERE is_active = true"
        );
        res.json({ message: "Shopify disconnected", updated: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
