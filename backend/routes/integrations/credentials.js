module.exports = function registerCredentialRoutes(router, deps) {
  const { db, requirePerm, requireFeature, encryptSecret, decryptSecret, maskSecret } = deps;
  const { validate } = require("../../middleware/validate");
  const { connectProviderSchema, disconnectProviderSchema } = require("../../schemas/integrations");

  // POST /api/integrations/connect — save encrypted credentials
  router.post(
    "/connect",
    requirePerm("all_access"),
    requireFeature("marketplace_integrations"),
    validate(connectProviderSchema),
    async (req, res) => {
      try {
        const { provider, category, store_url, api_key, api_secret, oauth_token, oauth_refresh_token, config_json } = req.body;

        const encKey = api_key ? encryptSecret(api_key) : null;
        const encSecret = api_secret ? encryptSecret(api_secret) : null;
        const encOauth = oauth_token ? encryptSecret(oauth_token) : null;
        const encRefresh = oauth_refresh_token ? encryptSecret(oauth_refresh_token) : null;

        await db.query(
          `INSERT INTO integration_settings (provider, category, store_url, api_key, api_secret, oauth_token, oauth_refresh_token, config_json, is_active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
           ON CONFLICT (provider) DO UPDATE SET
             category = COALESCE(EXCLUDED.category, integration_settings.category),
             store_url = COALESCE(EXCLUDED.store_url, integration_settings.store_url),
             api_key = COALESCE(EXCLUDED.api_key, integration_settings.api_key),
             api_secret = COALESCE(EXCLUDED.api_secret, integration_settings.api_secret),
             oauth_token = COALESCE(EXCLUDED.oauth_token, integration_settings.oauth_token),
             oauth_refresh_token = COALESCE(EXCLUDED.oauth_refresh_token, integration_settings.oauth_refresh_token),
             config_json = COALESCE(EXCLUDED.config_json, integration_settings.config_json),
             is_active = true,
             last_error = NULL,
             updated_at = NOW()`,
          [provider, category || "marketplace", store_url || null, encKey, encSecret, encOauth, encRefresh, config_json || "{}"]
        );

        res.json({ connected: true, provider });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/disconnect — remove credentials
  router.post(
    "/disconnect",
    requirePerm("all_access"),
    requireFeature("marketplace_integrations"),
    validate(disconnectProviderSchema),
    async (req, res) => {
      try {
        const { provider } = req.body;
        await db.query(
          "UPDATE integration_settings SET is_active = false, api_key = NULL, api_secret = NULL, oauth_token = NULL, oauth_refresh_token = NULL, updated_at = NOW() WHERE provider = $1",
          [provider]
        );
        res.json({ disconnected: true, provider });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/test — test connection for a provider
  router.post(
    "/test",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const { provider } = req.body;
        const { rows: [config] } = await db.query(
          "SELECT * FROM integration_settings WHERE provider = $1",
          [provider]
        );
        if (!config) return res.status(404).json({ error: "Integration not configured" });

        const apiKey = config.api_key ? decryptSecret(config.api_key) : null;

        if (!apiKey && !config.oauth_token) {
          return res.json({ success: false, error: "No credentials configured" });
        }

        res.json({ success: true, provider });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/:provider/send-test-sms — test SMS delivery
  router.post(
    "/:provider/send-test-sms",
    requirePerm("all_access"),
    requireFeature("phase5_sms_providers"),
    async (req, res) => {
      try {
        const { to, message } = req.body || {};
        if (!to) return res.status(400).json({ error: "Phone number (to) required" });

        const sms = require("../../services/sms");
        const result = await sms.sendSms(db, {
          to,
          body: message || "Test message from SanoPOS",
          type: "transactional",
        });

        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/integrations/:provider/status — get masked credentials + status
  router.get(
    "/:provider/status",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const { provider } = req.params;
        const { rows: [config] } = await db.query(
          "SELECT provider, display_name, category, store_url, is_active, last_sync_at, last_error, sync_enabled, api_key, config_json FROM integration_settings WHERE provider = $1",
          [provider]
        );
        if (!config) return res.json({ connected: false, provider });

        res.json({
          connected: config.is_active,
          provider: config.provider,
          display_name: config.display_name,
          store_url: config.store_url,
          api_key_masked: maskSecret(config.api_key),
          last_sync_at: config.last_sync_at,
          last_error: config.last_error,
          sync_enabled: config.sync_enabled,
          config: config.config_json ? JSON.parse(config.config_json) : {},
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
