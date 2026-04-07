module.exports = function registerHubRoutes(router, deps) {
  const { db, requirePerm, requireFeature } = deps;

  // GET /api/integrations/hub — all integration statuses
  router.get(
    "/hub",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        // Marketplace/channel integrations
        const { rows: integrations } = await db.query(
          "SELECT provider, display_name, category, is_active, last_sync_at, last_error, sync_enabled FROM integration_settings ORDER BY provider"
        );

        // Courier integrations
        const { rows: couriers } = await db.query(
          "SELECT id, name, adapter_key, enabled, api_key FROM courier_integrations ORDER BY name"
        );

        // Shopify connection
        const { rows: shopifyRows } = await db.query(
          "SELECT id, shop_domain, is_active, last_sync_at, last_error FROM shopify_connections WHERE is_active = true LIMIT 1"
        );

        const channels = integrations.map((i) => ({
          ...i,
          has_credentials: !!i.is_active,
        }));

        const courierList = couriers.map((c) => ({
          id: c.id,
          name: c.name,
          adapter_key: c.adapter_key,
          enabled: c.enabled,
          has_credentials: !!c.api_key,
        }));

        res.json({
          channels,
          couriers: courierList,
          shopify: shopifyRows[0] || null,
          woocommerce: integrations.find((i) => i.provider === "woocommerce") || null,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
