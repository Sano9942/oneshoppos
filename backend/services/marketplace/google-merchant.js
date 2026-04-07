const BaseMarketplace = require("./base-marketplace");

class GoogleMerchantClient extends BaseMarketplace {
  constructor(config) {
    super(config);
    this.accessToken = config.oauth_token;
    this.merchantId = config.config_json?.merchant_id;
    this.baseUrl = "https://shoppingcontent.googleapis.com/content/v2.1";
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
      throw new Error(err.error?.message || `Google API error: ${res.status}`);
    }
    return res.json();
  }

  async testConnection() {
    try {
      if (!this.merchantId) throw new Error("Merchant ID not configured");
      const data = await this._request(`/${this.merchantId}/accounts/${this.merchantId}`);
      return { success: true, name: data.name || "Connected" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async syncProducts(products) {
    if (!this.merchantId) throw new Error("Merchant ID not configured");

    const results = [];
    for (const product of products) {
      try {
        const offerId = product.sku || product.barcode || `SP-${product.id}`;
        const productData = {
          offerId,
          title: product.name,
          description: product.description || product.name,
          link: product.url || "",
          imageLink: product.image_url || "",
          contentLanguage: "en",
          targetCountry: "PK",
          channel: "online",
          availability: (product.stock || 0) > 0 ? "in_stock" : "out_of_stock",
          condition: "new",
          price: {
            value: String(product.price || 0),
            currency: "PKR",
          },
          brand: product.brand || "Unbranded",
        };

        await this._request(`/${this.merchantId}/products`, "POST", productData);
        results.push({ product_id: product.id, success: true, gmc_offer_id: offerId });
      } catch (err) {
        results.push({ product_id: product.id, success: false, error: err.message });
      }
    }
    return results;
  }

  async checkFeedStatus() {
    if (!this.merchantId) throw new Error("Merchant ID not configured");

    const data = await this._request(`/${this.merchantId}/productstatuses?maxResults=250`);
    return (data.resources || []).map((item) => ({
      offer_id: item.productId,
      title: item.title,
      status: item.destinationStatuses?.[0]?.status || "unknown",
      disapproval_issues: (item.itemLevelIssues || []).map((i) => ({
        code: i.code,
        description: i.description,
        detail: i.detail,
        resolution: i.resolution,
      })),
    }));
  }

  // Google Merchant doesn't process orders (sends traffic to your site)
  async pullOrders() { return []; }
  async pushInventory(updates) {
    // Update stock via product insert (upsert)
    if (!this.merchantId) throw new Error("Merchant ID not configured");
    for (const u of updates) {
      try {
        await this._request(`/${this.merchantId}/products`, "POST", {
          offerId: u.sku,
          availability: u.quantity > 0 ? "in_stock" : "out_of_stock",
          channel: "online",
          contentLanguage: "en",
          targetCountry: "PK",
        });
      } catch {
        // Individual failures are non-critical
      }
    }
    return { updated: updates.length };
  }
}

module.exports = GoogleMerchantClient;
