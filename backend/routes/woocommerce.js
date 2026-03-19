module.exports = function mountWooCommerceRoutes(app, deps) {
  const db = deps.db;
  const { requirePerm } = deps;

  // Helper to make WooCommerce API calls
  async function wooFetch(storeUrl, consumerKey, consumerSecret, endpoint) {
    const url = `${storeUrl}/wp-json/wc/v3/${endpoint}`;
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
      "base64",
    );
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`WooCommerce API error: ${res.status}`);
    return res.json();
  }

  // GET /api/integrations/woocommerce/status — check connection
  app.get(
    "/api/integrations/woocommerce/status",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const {
          rows: [config],
        } = await db.query(
          "SELECT * FROM integration_settings WHERE provider = 'woocommerce' LIMIT 1",
        );
        if (!config) return res.json({ connected: false });

        // Test connection
        try {
          await wooFetch(
            config.store_url,
            config.api_key,
            config.api_secret,
            "system_status",
          );
          res.json({ connected: true, store_url: config.store_url });
        } catch {
          res.json({ connected: false, error: "Connection failed" });
        }
      } catch {
        res.json({ connected: false });
      }
    },
  );

  // POST /api/integrations/woocommerce/connect — save credentials
  app.post(
    "/api/integrations/woocommerce/connect",
    requirePerm("all_access"),
    async (req, res) => {
      const { store_url, consumer_key, consumer_secret } = req.body || {};
      if (!store_url || !consumer_key || !consumer_secret) {
        return res.status(400).json({ error: "All fields required" });
      }

      // Test connection first
      try {
        await wooFetch(
          store_url,
          consumer_key,
          consumer_secret,
          "system_status",
        );
      } catch {
        return res.status(400).json({
          error:
            "Could not connect to WooCommerce store. Check credentials.",
        });
      }

      await db.query(
        `INSERT INTO integration_settings (provider, store_url, api_key, api_secret)
       VALUES ('woocommerce', $1, $2, $3)
       ON CONFLICT (provider) DO UPDATE SET store_url = $1, api_key = $2, api_secret = $3, updated_at = NOW()`,
        [store_url.replace(/\/$/, ""), consumer_key, consumer_secret],
      );
      res.json({ ok: true });
    },
  );

  // POST /api/integrations/woocommerce/disconnect
  app.post(
    "/api/integrations/woocommerce/disconnect",
    requirePerm("all_access"),
    async (req, res) => {
      await db.query(
        "DELETE FROM integration_settings WHERE provider = 'woocommerce'",
      );
      res.json({ ok: true });
    },
  );

  // POST /api/integrations/woocommerce/import-products — import products from WooCommerce
  app.post(
    "/api/integrations/woocommerce/import-products",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const {
          rows: [config],
        } = await db.query(
          "SELECT * FROM integration_settings WHERE provider = 'woocommerce' LIMIT 1",
        );
        if (!config)
          return res.status(400).json({ error: "WooCommerce not connected" });

        let page = 1;
        let imported = 0;
        let updated = 0;
        let hasMore = true;

        while (hasMore) {
          const products = await wooFetch(
            config.store_url,
            config.api_key,
            config.api_secret,
            `products?per_page=100&page=${page}`,
          );
          if (!products.length) {
            hasMore = false;
            break;
          }

          for (const wp of products) {
            // Check if product exists by SKU
            const {
              rows: [existing],
            } = await db.query(
              "SELECT id FROM products WHERE sku = $1 AND deleted_at IS NULL",
              [wp.sku || `woo-${wp.id}`],
            );

            if (existing) {
              await db.query(
                "UPDATE products SET name = $1, selling_price = $2, cost_price = $3 WHERE id = $4",
                [
                  wp.name,
                  Number(wp.price || 0),
                  Number(wp.regular_price || 0),
                  existing.id,
                ],
              );
              updated++;
            } else {
              await db.query(
                `INSERT INTO products (name, sku, barcode, selling_price, cost_price)
               VALUES ($1, $2, $3, $4, $5)`,
                [
                  wp.name,
                  wp.sku || `woo-${wp.id}`,
                  wp.sku || "",
                  Number(wp.price || 0),
                  Number(wp.regular_price || 0),
                ],
              );
              imported++;
            }
          }
          page++;
          if (products.length < 100) hasMore = false;
        }

        res.json({ imported, updated });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /api/integrations/woocommerce/sync-stock — push stock to WooCommerce
  app.post(
    "/api/integrations/woocommerce/sync-stock",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const {
          rows: [config],
        } = await db.query(
          "SELECT * FROM integration_settings WHERE provider = 'woocommerce' LIMIT 1",
        );
        if (!config)
          return res.status(400).json({ error: "WooCommerce not connected" });

        // Get products with SKU (which maps to WooCommerce)
        const { rows: products } = await db.query(
          `SELECT p.sku, COALESCE(SUM(os.quantity), 0) as total_stock
         FROM products p
         LEFT JOIN outlet_stock os ON p.id = os.product_id
         WHERE p.sku IS NOT NULL AND p.sku != '' AND p.deleted_at IS NULL
         GROUP BY p.sku`,
        );

        let synced = 0;
        for (const p of products) {
          try {
            // Find WooCommerce product by SKU
            const wooProducts = await wooFetch(
              config.store_url,
              config.api_key,
              config.api_secret,
              `products?sku=${encodeURIComponent(p.sku)}`,
            );
            if (wooProducts.length) {
              const wooId = wooProducts[0].id;
              const url = `${config.store_url}/wp-json/wc/v3/products/${wooId}`;
              const authStr = Buffer.from(
                `${config.api_key}:${config.api_secret}`,
              ).toString("base64");
              await fetch(url, {
                method: "PUT",
                headers: {
                  Authorization: `Basic ${authStr}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  stock_quantity: Number(p.total_stock),
                  manage_stock: true,
                }),
              });
              synced++;
            }
          } catch {
            /* skip individual failures */
          }
        }

        res.json({ synced });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
