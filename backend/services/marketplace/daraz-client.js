const crypto = require("crypto");
const BaseMarketplace = require("./base-marketplace");

class DarazClient extends BaseMarketplace {
  constructor(config) {
    super(config);
    this.baseUrl = config.store_url || "https://api.daraz.pk/rest";
    this.appKey = config.api_key;
    this.appSecret = config.api_secret;
    this.accessToken = config.oauth_token;
  }

  // Lazada Open Platform signature
  _sign(apiPath, params) {
    const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
    const signStr = apiPath + sorted;
    return crypto.createHmac("sha256", this.appSecret).update(signStr).digest("hex").toUpperCase();
  }

  async _request(apiPath, params = {}) {
    const commonParams = {
      app_key: this.appKey,
      timestamp: Date.now(),
      sign_method: "sha256",
      access_token: this.accessToken || "",
      ...params,
    };
    commonParams.sign = this._sign(apiPath, commonParams);

    const qs = Object.entries(commonParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const url = `${this.baseUrl}${apiPath}?${qs}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Daraz API error: ${res.status}`);
    const data = await res.json();

    if (data.code && data.code !== "0") {
      throw new Error(data.message || `Daraz error: ${data.code}`);
    }
    return data;
  }

  async testConnection() {
    try {
      const data = await this._request("/seller/get");
      return { success: true, seller: data.data?.name || "Connected" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async pullOrders(since) {
    const params = {
      created_after: since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      sort_by: "created_at",
      sort_direction: "ASC",
      limit: 100,
      offset: 0,
    };

    const data = await this._request("/orders/get", params);
    const orders = data.data?.orders || [];

    const results = [];
    for (const order of orders) {
      const itemData = await this._request("/order/items/get", { order_id: order.order_id });
      results.push({
        external_order_id: String(order.order_id),
        external_order_number: order.order_number,
        status: order.statuses?.[0] || "pending",
        customer: {
          name: `${order.address_shipping?.first_name || ""} ${order.address_shipping?.last_name || ""}`.trim(),
          phone: order.address_shipping?.phone,
          address: order.address_shipping?.address1,
          city: order.address_shipping?.city,
        },
        items: (itemData.data || []).map((item) => ({
          sku: item.sku,
          name: item.name,
          quantity: Number(item.quantity || 1),
          price: Number(item.item_price || 0),
          daraz_item_id: String(item.order_item_id),
        })),
        total: Number(order.price || 0),
        payment_method: order.payment_method,
        created_at: order.created_at,
      });
    }

    return results;
  }

  async syncProducts(products) {
    const results = [];
    for (const product of products) {
      try {
        const payload = JSON.stringify({
          Request: {
            Product: {
              PrimaryCategory: product.category_id || 1,
              SPUId: "",
              AssociatedSku: "",
              Skus: {
                Sku: [{
                  SellerSku: product.sku || product.barcode || `SP-${product.id}`,
                  quantity: product.stock || 0,
                  price: product.price,
                  special_price: product.sale_price || product.price,
                  package_weight: product.weight || "0.5",
                  package_length: "10",
                  package_width: "10",
                  package_height: "10",
                }],
              },
              Attributes: {
                name: product.name,
                description: product.description || product.name,
                brand: product.brand || "Unbranded",
              },
            },
          },
        });

        const data = await this._request("/product/create", { payload });
        results.push({ product_id: product.id, success: true, daraz_item_id: data.data?.item_id });
      } catch (err) {
        results.push({ product_id: product.id, success: false, error: err.message });
      }
    }
    return results;
  }

  async pushInventory(updates) {
    const skuPayload = updates.map((u) => ({
      SellerSku: u.sku,
      Quantity: u.quantity,
    }));

    const payload = JSON.stringify({
      Request: { Product: { Skus: { Sku: skuPayload } } },
    });

    return this._request("/product/stock/sellable/update", { payload });
  }
}

module.exports = DarazClient;
