module.exports = function registerDarazRoutes(router, deps) {
  const { db, requirePerm, requireFeature, decryptSecret } = deps;
  const DarazClient = require("../../services/marketplace/daraz-client");

  async function getDarazClient() {
    const { rows: [config] } = await db.query(
      "SELECT * FROM integration_settings WHERE provider = 'daraz' AND is_active = true"
    );
    if (!config) throw new Error("Daraz not connected");
    return new DarazClient({
      api_key: decryptSecret(config.api_key),
      api_secret: decryptSecret(config.api_secret),
      oauth_token: config.oauth_token ? decryptSecret(config.oauth_token) : null,
      store_url: config.store_url,
    });
  }

  // POST /api/integrations/daraz/test
  router.post(
    "/daraz/test",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();
        const result = await client.testConnection();
        res.json(result);
      } catch (err) {
        res.json({ success: false, error: err.message });
      }
    }
  );

  // POST /api/integrations/daraz/sync-products
  router.post(
    "/daraz/sync-products",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();
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

        for (const r of results.filter((r) => r.success && r.daraz_item_id)) {
          await db.query(
            `INSERT INTO daraz_product_map (product_id, daraz_item_id, last_synced_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (daraz_item_id) DO UPDATE SET last_synced_at = NOW()`,
            [r.product_id, r.daraz_item_id]
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

  // POST /api/integrations/daraz/pull-orders
  router.post(
    "/daraz/pull-orders",
    requirePerm("manage_orders"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();
        const { since } = req.body || {};
        const orders = await client.pullOrders(since);

        let imported = 0;
        let skipped = 0;

        for (const order of orders) {
          const { rows: existing } = await db.query(
            "SELECT id FROM daraz_order_map WHERE daraz_order_id = $1",
            [order.external_order_id]
          );
          if (existing.length > 0) { skipped++; continue; }

          const { rows: [webOrder] } = await db.query(
            `INSERT INTO web_orders (source, external_order_id, external_order_number, fulfillment_status, raw_payload, created_at)
             VALUES ('daraz', $1, $2, 'unfulfilled', $3, $4)
             RETURNING id`,
            [order.external_order_id, order.external_order_number, JSON.stringify(order), order.created_at || new Date()]
          );

          await db.query(
            `INSERT INTO daraz_order_map (web_order_id, daraz_order_id, daraz_order_number, daraz_status, last_synced_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [webOrder.id, order.external_order_id, order.external_order_number, order.status]
          );

          imported++;
        }

        await db.query(
          "UPDATE integration_settings SET last_sync_at = NOW() WHERE provider = 'daraz'"
        );

        res.json({ imported, skipped, total: orders.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/daraz/push-inventory
  router.post(
    "/daraz/push-inventory",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();

        const { rows: mapped } = await db.query(
          `SELECT dpm.daraz_sku, p.stock, p.sku
           FROM daraz_product_map dpm
           JOIN products p ON p.id = dpm.product_id
           WHERE dpm.daraz_sku IS NOT NULL`
        );

        if (mapped.length === 0) return res.json({ updated: 0, message: "No mapped products" });

        const updates = mapped.map((m) => ({
          sku: m.daraz_sku || m.sku,
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
