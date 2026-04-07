module.exports = function registerWhatsAppRoutes(router, deps) {
  const { db, requirePerm, requireFeature, decryptSecret } = deps;
  const WhatsAppClient = require("../../services/marketplace/whatsapp-client");

  async function getWhatsAppClient() {
    const { rows: [config] } = await db.query(
      "SELECT * FROM integration_settings WHERE provider = 'whatsapp' AND is_active = true"
    );
    if (!config) throw new Error("WhatsApp Business not connected");
    const configJson = config.config_json ? JSON.parse(config.config_json) : {};
    return new WhatsAppClient({
      api_key: config.api_key ? decryptSecret(config.api_key) : null,
      config_json: configJson,
    });
  }

  // POST /api/integrations/whatsapp/test
  router.post(
    "/whatsapp/test",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getWhatsAppClient();
        const result = await client.testConnection();
        res.json(result);
      } catch (err) {
        res.json({ success: false, error: err.message });
      }
    }
  );

  // POST /api/integrations/whatsapp/send-template — send order confirmation / tracking
  router.post(
    "/whatsapp/send-template",
    requirePerm("manage_orders"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getWhatsAppClient();
        const { phone, template, order_id, tracking_number, courier_name } = req.body;

        if (!phone) return res.status(400).json({ error: "Phone number required" });

        let result;
        if (template === "order_confirmation" && order_id) {
          const { rows: [order] } = await db.query("SELECT id, total FROM web_orders WHERE id = $1", [order_id]);
          if (!order) return res.status(404).json({ error: "Order not found" });
          result = await client.sendOrderConfirmation(phone, order);
        } else if (template === "shipping_update" && tracking_number) {
          result = await client.sendTrackingUpdate(phone, tracking_number, courier_name || "Courier");
        } else {
          return res.status(400).json({ error: "Invalid template or missing parameters" });
        }

        // Log message
        await db.query(
          `INSERT INTO whatsapp_messages (conversation_id, direction, message_type, content, wa_message_id, status)
           VALUES (
             (SELECT id FROM whatsapp_conversations WHERE phone_number = $1 LIMIT 1),
             'outbound', 'template', $2, $3, 'sent'
           )`,
          [phone, `template:${template}`, result.messages?.[0]?.id || null]
        );

        res.json({ sent: true, message_id: result.messages?.[0]?.id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/integrations/whatsapp/conversations
  router.get(
    "/whatsapp/conversations",
    requirePerm("manage_orders"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT wc.*, c.name AS customer_name,
                  (SELECT COUNT(*) FROM whatsapp_messages wm WHERE wm.conversation_id = wc.id) AS message_count
           FROM whatsapp_conversations wc
           LEFT JOIN customers c ON c.id = wc.customer_id
           ORDER BY wc.last_message_at DESC NULLS LAST
           LIMIT 50`
        );
        res.json({ conversations: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
