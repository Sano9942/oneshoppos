module.exports = function registerFacebookRoutes(router, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature, decryptSecret } = deps;
  const MetaCommerceClient = require("../../services/marketplace/meta-commerce");

  async function getMetaClient() {
    const { rows: [config] } = await db.query(
      "SELECT * FROM integration_settings WHERE provider = 'facebook' AND is_active = true"
    );
    if (!config) throw new Error("Facebook/Instagram not connected");
    const configJson = config.config_json ? JSON.parse(config.config_json) : {};
    return new MetaCommerceClient({
      oauth_token: config.oauth_token ? decryptSecret(config.oauth_token) : null,
      config_json: configJson,
    });
  }

  // POST /api/integrations/facebook/test
  router.post(
    "/facebook/test",
    // PLAN-V2 Step 2: config-surface test — manage_integrations delegate included.
    requireAnyPerm(["manage_inventory", "manage_integrations"]),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getMetaClient();
        const result = await client.testConnection();
        res.json(result);
      } catch (err) {
        res.json({ success: false, error: err.message });
      }
    }
  );

  // POST /api/integrations/facebook/sync-products
  router.post(
    "/facebook/sync-products",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getMetaClient();
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

        for (const r of results.filter((r) => r.success && r.fb_product_id)) {
          await db.query(
            `INSERT INTO facebook_product_map (product_id, fb_product_id, last_synced_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (fb_product_id) DO UPDATE SET last_synced_at = NOW()`,
            [r.product_id, r.fb_product_id]
          );
        }

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

  // POST /api/integrations/facebook/pull-orders
  router.post(
    "/facebook/pull-orders",
    requirePerm("manage_orders"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getMetaClient();
        const { since } = req.body || {};
        const orders = await client.pullOrders(since);

        let imported = 0;
        let skipped = 0;

        for (const order of orders) {
          const { rows: existing } = await db.query(
            "SELECT id FROM facebook_order_map WHERE fb_order_id = $1",
            [order.external_order_id]
          );
          if (existing.length > 0) { skipped++; continue; }

          const { rows: [webOrder] } = await db.query(
            `INSERT INTO web_orders (source, external_order_id, external_order_number, fulfillment_status, raw_payload, created_at)
             VALUES ($1, $2, $3, 'unfulfilled', $4, $5)
             RETURNING id`,
            [order.source || "facebook", order.external_order_id, order.external_order_number, JSON.stringify(order), order.created_at || new Date()]
          );

          await db.query(
            `INSERT INTO facebook_order_map (web_order_id, fb_order_id, source, fb_status, last_synced_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [webOrder.id, order.external_order_id, order.source || "facebook", order.status]
          );

          imported++;
        }

        await db.query(
          "UPDATE integration_settings SET last_sync_at = NOW() WHERE provider = 'facebook'"
        );

        res.json({ imported, skipped, total: orders.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/facebook/push-inventory
  router.post(
    "/facebook/push-inventory",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getMetaClient();

        const { rows: mapped } = await db.query(
          `SELECT fpm.fb_product_id, p.stock, p.sku
           FROM facebook_product_map fpm
           JOIN products p ON p.id = fpm.product_id`
        );

        if (mapped.length === 0) return res.json({ updated: 0, message: "No mapped products" });

        const updates = mapped.map((m) => ({
          sku: m.sku,
          quantity: m.stock || 0,
        }));

        await client.pushInventory(updates);

        res.json({ updated: updates.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
