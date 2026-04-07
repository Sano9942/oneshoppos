const BaseMarketplace = require("./base-marketplace");

class MetaCommerceClient extends BaseMarketplace {
  constructor(config) {
    super(config);
    this.accessToken = config.oauth_token;
    this.catalogId = config.config_json?.catalog_id;
    this.commerceAccountId = config.config_json?.commerce_account_id;
    this.baseUrl = "https://graph.facebook.com/v19.0";
  }

  async _request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}access_token=${this.accessToken}`;

    const opts = { method, headers: {} };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(fullUrl, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Meta API error: ${res.status}`);
    }
    return res.json();
  }

  async testConnection() {
    try {
      const data = await this._request("/me?fields=id,name");
      return { success: true, name: data.name };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async syncProducts(products) {
    if (!this.catalogId) throw new Error("Catalog ID not configured");

    const results = [];
    for (const product of products) {
      try {
        const data = await this._request(`/${this.catalogId}/products`, "POST", {
          retailer_id: product.sku || product.barcode || `SP-${product.id}`,
          name: product.name,
          description: product.description || product.name,
          price: `${Math.round((product.price || 0) * 100)} PKR`,
          currency: "PKR",
          availability: (product.stock || 0) > 0 ? "in stock" : "out of stock",
          url: product.url || "",
          image_url: product.image_url || "",
          brand: product.brand || "",
        });
        results.push({ product_id: product.id, success: true, fb_product_id: data.id });
      } catch (err) {
        results.push({ product_id: product.id, success: false, error: err.message });
      }
    }
    return results;
  }

  async pullOrders(since) {
    if (!this.commerceAccountId) throw new Error("Commerce Account ID not configured");

    const sinceTs = since ? new Date(since).getTime() / 1000 : Date.now() / 1000 - 86400;
    const data = await this._request(
      `/${this.commerceAccountId}/orders?state=FB_PROCESSING&updated_after=${Math.floor(sinceTs)}&fields=id,order_status,created,channel,ship_by_date,items{id,product_name,quantity,price_per_unit,retailer_id}`
    );

    return (data.data || []).map((order) => ({
      external_order_id: order.id,
      external_order_number: order.id,
      status: order.order_status?.state || "pending",
      source: order.channel === "INSTAGRAM" ? "instagram" : "facebook",
      items: (order.items?.data || []).map((item) => ({
        name: item.product_name,
        quantity: Number(item.quantity || 1),
        price: Number(item.price_per_unit?.amount || 0) / 100,
        sku: item.retailer_id,
        fb_item_id: item.id,
      })),
      total: (order.items?.data || []).reduce((sum, i) => sum + (Number(i.price_per_unit?.amount || 0) / 100) * Number(i.quantity || 1), 0),
      created_at: order.created,
    }));
  }

  async pushInventory(updates) {
    if (!this.catalogId) throw new Error("Catalog ID not configured");

    const batch = updates.map((u) => ({
      method: "UPDATE",
      retailer_id: u.sku,
      data: { availability: u.quantity > 0 ? "in stock" : "out of stock", inventory: u.quantity },
    }));

    return this._request(`/${this.catalogId}/items_batch`, "POST", { requests: batch });
  }
}

module.exports = MetaCommerceClient;
