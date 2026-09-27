module.exports = function registerShopifyConfigRoutes(app, deps) {
  const { db, requireAnyPerm, encryptShopifySecret, decryptShopifySecret, maskSecret, getActiveShopifyConnection } = deps;
  const { requestClientCredentialsToken } = require("../../shopify/client");

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
            // "app" = Dev Dashboard app (client ID + secret, 24-hour token renewed
            // automatically); "token" = a permanent admin-created Admin API token.
            auth_mode: conn.client_id ? "app" : "token",
            client_id: conn.client_id || null,
            access_token_expires_at: conn.access_token_expires_at || null,
            // An app's webhooks are signed with its client secret: show no part of it.
            webhook_secret_masked: conn.client_id ? null : maskSecret(conn.webhook_secret),
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
          client_id,
          client_secret,
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
          "SELECT access_token, client_id, client_secret FROM shopify_connections WHERE shop_domain = $1",
          [normalizedDomain]
        );
        const existing = existingRows[0];
        const tokenInput = String(access_token || "").trim();
        const clientIdInput = String(client_id || "").trim();
        const clientSecretInput = String(client_secret || "").trim();

        // Dev Dashboard app: a client ID was sent, or no token was sent and the
        // saved connection is already an app. An empty secret keeps the saved one.
        const appMode = Boolean(clientIdInput) || (!tokenInput && Boolean(existing?.client_id));
        let effectiveToken;
        let appFields = { client_id: null, client_secret: null, expires_at: null };
        if (appMode) {
          const appClientId = clientIdInput || existing.client_id;
          const appSecret = clientSecretInput ||
            (existing?.client_id === appClientId ? decryptShopifySecret(existing.client_secret) : "");
          if (!appSecret) {
            return res.status(400).json({ error: "Client secret is required for a new app connection" });
          }
          // Get the first token now: proves the ID + secret work before saving.
          let fresh;
          try {
            fresh = await requestClientCredentialsToken({
              shop_domain: normalizedDomain, client_id: appClientId, client_secret: appSecret,
            });
          } catch (err) {
            return res.status(400).json({ error: err.message });
          }
          effectiveToken = encryptShopifySecret(fresh.access_token);
          appFields = {
            client_id: appClientId,
            client_secret: encryptShopifySecret(appSecret),
            expires_at: fresh.expires_at,
          };
        } else {
          effectiveToken = tokenInput
            ? encryptShopifySecret(tokenInput)
            : existing?.access_token || null;
          if (!effectiveToken) {
            return res.status(400).json({
              error: "An Admin API access token, or an app's Client ID and Client secret, is required",
            });
          }
        }

        await db.transaction(async (client) => {
          await client.query("UPDATE shopify_connections SET is_active = false");
          await client.query(
            `INSERT INTO shopify_connections (
              shop_domain, access_token, api_version, webhook_secret, default_location_id, is_active, updated_at,
              client_id, client_secret, access_token_expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)
            ON CONFLICT(shop_domain) DO UPDATE SET
              access_token = EXCLUDED.access_token,
              api_version = EXCLUDED.api_version,
              webhook_secret = ${appMode ? "EXCLUDED.webhook_secret" : "COALESCE(EXCLUDED.webhook_secret, shopify_connections.webhook_secret)"},
              default_location_id = EXCLUDED.default_location_id,
              is_active = EXCLUDED.is_active,
              client_id = EXCLUDED.client_id,
              client_secret = EXCLUDED.client_secret,
              access_token_expires_at = EXCLUDED.access_token_expires_at,
              last_error = NULL,
              updated_at = NOW()`,
            [
              normalizedDomain,
              effectiveToken,
              String(api_version).trim(),
              webhook_secret ? encryptShopifySecret(String(webhook_secret)) : null,
              default_location_id ? String(default_location_id) : null,
              is_active ? true : false,
              appFields.client_id,
              appFields.client_secret,
              appFields.expires_at,
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
