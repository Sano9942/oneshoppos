module.exports = function registerHubRoutes(router, deps) {
  const { db, requirePerm, requireFeature } = deps;

  // GET /api/integrations/hub — all integration statuses
  router.get(
    "/hub",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        // All integrations from integration_settings
        const { rows: integrations } = await db.query(
          "SELECT provider, display_name, category, is_active, last_sync_at, last_error, sync_enabled FROM integration_settings ORDER BY provider"
        );

        // Courier integrations with capability flags
        const { rows: couriers } = await db.query(
          `SELECT id, name, adapter_key, enabled, api_key, flat_shipping_rate,
                  supports_booking, supports_tracking, supports_cancellation, supports_labels,
                  provider_category, last_healthcheck_at, last_healthcheck_status
             FROM courier_integrations ORDER BY name`
        );

        // Shopify connection
        const { rows: shopifyRows } = await db.query(
          "SELECT id, shop_domain, is_active, last_sync_at, last_error FROM shopify_connections WHERE is_active = true LIMIT 1"
        );

        // Split integrations by category
        const channels = [];
        const paymentProviders = [];
        const smsProviders = [];

        for (const i of integrations) {
          const entry = { ...i, has_credentials: !!i.is_active };
          if (i.category === "payment") {
            paymentProviders.push(entry);
          } else if (i.category === "sms" || i.category === "messaging_sms") {
            smsProviders.push(entry);
          } else {
            channels.push(entry);
          }
        }

        const courierList = couriers.map((c) => ({
          id: c.id,
          name: c.name,
          adapter_key: c.adapter_key,
          enabled: c.enabled,
          has_credentials: !!c.api_key,
          flat_shipping_rate: c.flat_shipping_rate ? Number(c.flat_shipping_rate) : null,
          supports_booking: c.supports_booking || false,
          supports_tracking: c.supports_tracking || false,
          supports_cancellation: c.supports_cancellation || false,
          supports_labels: c.supports_labels || false,
          provider_category: c.provider_category || "domestic",
          last_healthcheck_at: c.last_healthcheck_at,
          last_healthcheck_status: c.last_healthcheck_status,
        }));

        res.json({
          channels,
          couriers: courierList,
          payment_providers: paymentProviders,
          sms_providers: smsProviders,
          shopify: shopifyRows[0] || null,
          woocommerce: integrations.find((i) => i.provider === "woocommerce") || null,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
