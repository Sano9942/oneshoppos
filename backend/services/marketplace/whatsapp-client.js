const BaseMarketplace = require("./base-marketplace");

class WhatsAppClient extends BaseMarketplace {
  constructor(config) {
    super(config);
    this.accessToken = config.api_key;
    this.phoneNumberId = config.config_json?.phone_number_id;
    this.businessAccountId = config.config_json?.business_account_id;
    this.baseUrl = "https://graph.facebook.com/v19.0";
  }

  async _request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const opts = {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `WhatsApp API error: ${res.status}`);
    }
    return res.json();
  }

  async testConnection() {
    try {
      if (!this.phoneNumberId) throw new Error("Phone Number ID not configured");
      const data = await this._request(`/${this.phoneNumberId}?fields=verified_name,display_phone_number`);
      return { success: true, phone: data.display_phone_number, name: data.verified_name };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async sendTemplate(to, templateName, languageCode = "en", components = []) {
    if (!this.phoneNumberId) throw new Error("Phone Number ID not configured");

    return this._request(`/${this.phoneNumberId}/messages`, "POST", {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    });
  }

  async sendTextMessage(to, text) {
    if (!this.phoneNumberId) throw new Error("Phone Number ID not configured");

    return this._request(`/${this.phoneNumberId}/messages`, "POST", {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    });
  }

  async sendOrderConfirmation(to, order) {
    return this.sendTemplate(to, "order_confirmation", "en", [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(order.id) },
          { type: "text", text: `PKR ${Number(order.total || 0).toLocaleString()}` },
        ],
      },
    ]);
  }

  async sendTrackingUpdate(to, trackingNumber, courierName) {
    return this.sendTemplate(to, "shipping_update", "en", [
      {
        type: "body",
        parameters: [
          { type: "text", text: trackingNumber },
          { type: "text", text: courierName },
        ],
      },
    ]);
  }

  // These are not applicable for WhatsApp (not a marketplace)
  async syncProducts() { return []; }
  async pullOrders() { return []; }
  async pushInventory() { return { updated: 0 }; }
}

module.exports = WhatsAppClient;
