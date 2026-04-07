module.exports = function registerGoogleMerchantRoutes(router, deps) {
  const { db, requirePerm, requireFeature, decryptSecret } = deps;
  const GoogleMerchantClient = require("../../services/marketplace/google-merchant");

  async function getGmcClient() {
    const { rows: [config] } = await db.query(
      "SELECT * FROM integration_settings WHERE provider = 'google_merchant' AND is_active = true"
    );
    if (!config) throw new Error("Google Merchant Center not connected");
    const configJson = config.config_json ? JSON.parse(config.config_json) : {};
    return new GoogleMerchantClient({
      oauth_token: config.oauth_token ? decryptSecret(config.oauth_token) : null,
      config_json: configJson,
    });
  }

  // POST /api/integrations/google-merchant/test
  router.post(
    "/google-merchant/test",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getGmcClient();
        const result = await client.testConnection();
        res.json(result);
      } catch (err) {
        res.json({ success: false, error: err.message });
      }
    }
  );

  // POST /api/integrations/google-merchant/sync-products
  router.post(
    "/google-merchant/sync-products",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getGmcClient();
        const { product_ids } = req.body || {};

        let whereClause = "WHERE is_active = true";
        const params = [];
        if (product_ids?.length) {
          whereClause += ` AND id = ANY($1)`;
          params.push(product_ids);
        }

        const { rows: products } = await db.query(
          `SELECT id, name, sku, barcode, price, description, stock FROM products ${whereClause} LIMIT 100`,
          params
        );

        const results = await client.syncProducts(products);

        // Update feed log
        for (const r of results.filter((r) => r.success && r.gmc_offer_id)) {
          await db.query(
            `INSERT INTO google_merchant_feed_log (product_id, gmc_offer_id, feed_status, last_pushed_at)
             VALUES ($1, $2, 'active', NOW())
             ON CONFLICT DO NOTHING`,
            [r.product_id, r.gmc_offer_id]
          );
        }

        await db.query(
          "UPDATE integration_settings SET last_sync_at = NOW() WHERE provider = 'google_merchant'"
        );

        res.json({
          synced: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          details: results,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/integrations/google-merchant/feed-status
  router.get(
    "/google-merchant/feed-status",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getGmcClient();
        const statuses = await client.checkFeedStatus();

        // Update local feed log
        for (const s of statuses) {
          const disapproval = s.disapproval_issues?.length
            ? JSON.stringify(s.disapproval_issues)
            : null;
          await db.query(
            `UPDATE google_merchant_feed_log
             SET feed_status = $1, disapproval_reason = $2, last_checked_at = NOW()
             WHERE gmc_offer_id = $3`,
            [s.status, disapproval, s.offer_id]
          );
        }

        res.json({ products: statuses });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
