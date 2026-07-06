const BaseMarketplace = require("./base-marketplace");

/**
 * foodpanda POS-integration adapter (V03 food-service depth).
 *
 * foodpanda's POS integration API is **order-push first** (they POST each new
 * order to our webhook) with a menu/availability pull-and-push secondary
 * channel. So this adapter is modelled around the inbound webhook: the
 * `normalizeOrder` static is the real workhorse (payload → internal web_order
 * shape) and is exercised by routes/webhooks.js. The instance methods
 * (testConnection / pullOrders / pushInventory) are the outbound half and are
 * honest about what a tenant without live menu-API access actually gets — no
 * decorative green integration (completion plan 11's lesson).
 *
 * Config (from integration_settings, provider='foodpanda'):
 *   api_key        — foodpanda POS API bearer token (encrypted)
 *   webhook_secret — HMAC secret foodpanda signs callbacks with (encrypted)
 *   config_json    — { store_id | vendor_code, base_url?, menu_api? }
 *
 * Price rule: aggregator menus commonly carry a markup (+15% is typical). The
 * normalizer snapshots the price FROM THE PAYLOAD per line and never re-resolves
 * the local product price — otherwise the sale total won't match the foodpanda
 * payout and daily reconciliation breaks (V03 harden: price divergence).
 */
class FoodpandaClient extends BaseMarketplace {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.api_key || null;
    this.webhookSecret = config.webhook_secret || null;
    const cj = config.config_json || {};
    this.storeId = cj.store_id || cj.vendor_code || cj.vendor_id || null;
    this.baseUrl = cj.base_url || null; // menu/availability API base, if provisioned
    this.menuApi = cj.menu_api === true || cj.menu_api === "true";
  }

  async _request(path, method = "GET", body = null) {
    if (!this.baseUrl) throw new Error("foodpanda menu API base_url not configured");
    const opts = { method, headers: { Authorization: `Bearer ${this.apiKey}` } };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, opts);
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`foodpanda API ${res.status}: ${err.slice(0, 180)}`);
    }
    return res.json().catch(() => ({}));
  }

  /**
   * Honest connection status. foodpanda order-push works purely inbound (they
   * call our webhook), so a tenant is "connected for orders" as soon as a
   * store_id + webhook_secret are set — even with no outbound menu API.
   */
  async testConnection() {
    if (!this.storeId) {
      return { success: false, error: "No foodpanda store/vendor id configured" };
    }
    if (!this.webhookSecret) {
      return {
        success: false,
        error: "No webhook secret configured — inbound orders cannot be verified",
      };
    }
    // If a live menu API is provisioned, actually verify it; otherwise report
    // the real capability level (inbound orders only) rather than a fake green.
    if (this.baseUrl && this.menuApi) {
      try {
        await this._request(`/vendors/${encodeURIComponent(this.storeId)}`);
        return { success: true, mode: "webhook+menu_api", store_id: this.storeId };
      } catch (err) {
        return { success: true, mode: "webhook_only", store_id: this.storeId, menu_api_error: err.message };
      }
    }
    return {
      success: true,
      mode: "webhook_only",
      store_id: this.storeId,
      note: "Inbound order push active. Availability push is best-effort (no menu API provisioned).",
    };
  }

  /**
   * Polling fallback — foodpanda's primary delivery is webhook push, but if
   * their retries fail or the endpoint was down, a poll can backfill. Returns
   * [] honestly when no menu/order API is provisioned.
   */
  async pullOrders(since) {
    if (!this.baseUrl || !this.menuApi || !this.storeId) return [];
    const sinceIso = since ? new Date(since).toISOString() : null;
    const qs = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : "";
    const data = await this._request(`/vendors/${encodeURIComponent(this.storeId)}/orders${qs}`);
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    return orders.map((o) => FoodpandaClient.normalizeOrder(o));
  }

  /**
   * Availability push out — an 86'd item flips availability=false on foodpanda
   * so customers can't order what the kitchen has run out of. One-way,
   * best-effort. Returns { updated, skipped } honestly; if no menu API, nothing
   * is pushed and the caller logs the no-op.
   */
  async pushInventory(updates) {
    const list = Array.isArray(updates) ? updates : [];
    if (!this.baseUrl || !this.menuApi || !this.storeId) {
      return { updated: 0, skipped: list.length, reason: "no_menu_api" };
    }
    let updated = 0;
    let skipped = 0;
    for (const u of list) {
      const sku = u.sku || u.remote_code || (u.product_id != null ? `SP-${u.product_id}` : null);
      if (!sku) { skipped += 1; continue; }
      try {
        await this._request(
          `/vendors/${encodeURIComponent(this.storeId)}/products/${encodeURIComponent(sku)}/availability`,
          "PUT",
          { available: u.available !== false }
        );
        updated += 1;
      } catch {
        skipped += 1;
      }
    }
    return { updated, skipped };
  }

  // Menu push is not part of the V03 scope (menu is authored in foodpanda's
  // partner portal for most PK vendors). Honest no-op — never pretend to sync.
  async syncProducts() {
    return [];
  }

  /**
   * Normalize a foodpanda order-push payload into the internal web_order shape
   * consumed by services/aggregator-orders.js. Defensive against foodpanda's
   * evolving field names — tries several known aliases per field. Throws if the
   * payload has no resolvable order id (→ dead-letter at the caller).
   *
   * Returns:
   *   { source, external_order_id, external_order_number, store_id, currency,
   *     subtotal, tax_total, discount_total, grand_total, ordered_at,
   *     expedition_type, customer, items: [{ sku, title, qty, unit_price,
   *     line_total, notes }] }
   */
  static normalizeOrder(payload) {
    const p = payload || {};
    const externalId = String(
      p.token ?? p.code ?? p.orderId ?? p.order_id ?? p.id ?? ""
    ).trim();
    if (!externalId) {
      throw Object.assign(new Error("foodpanda payload has no order id"), {
        code: "malformed_payload",
      });
    }
    const price = p.price || p.totals || {};
    const num = (...cands) => {
      for (const c of cands) {
        const n = Number(c);
        if (Number.isFinite(n)) return n;
      }
      return 0;
    };
    const rawItems = Array.isArray(p.products)
      ? p.products
      : Array.isArray(p.items) ? p.items
      : Array.isArray(p.orderProducts) ? p.orderProducts : [];

    const items = rawItems.map((it) => {
      const qty = num(it.quantity, it.qty, 1) || 1;
      // Payload price wins — never re-resolve local price (reconciliation rule).
      const unit = num(it.paidPrice, it.unitPrice, it.unit_price, it.price);
      const toppings = Array.isArray(it.selectedToppings || it.variation || it.modifiers)
        ? (it.selectedToppings || it.variation || it.modifiers)
        : [];
      const toppingNote = toppings
        .map((t) => (typeof t === "string" ? t : (t?.name || t?.title || "")))
        .filter(Boolean)
        .join(", ");
      const notes = [it.comment || it.note || "", toppingNote]
        .filter(Boolean)
        .join(" | ");
      return {
        sku: it.remoteCode || it.remote_code || it.sku || it.vendorProductId || null,
        title: it.name || it.title || it.productName || "Item",
        qty,
        unit_price: unit,
        line_total: num(it.totalPrice, it.total_price, unit * qty),
        notes: notes || null,
      };
    });

    const customer = p.customer || {};
    return {
      source: "foodpanda",
      external_order_id: externalId,
      external_order_number: String(p.shortCode || p.short_code || p.orderCodeShort || externalId),
      store_id: String(
        p.vendor?.id ?? p.vendor?.code ?? p.vendorId ?? p.vendor_code ?? p.store_id ?? ""
      ) || null,
      currency: p.currency || price.currency || "PKR",
      subtotal: num(price.subTotal, price.subtotal, price.vatableTotal),
      tax_total: num(price.vatTotal, price.taxTotal, price.tax),
      discount_total: num(price.discountTotal, price.discount, 0),
      grand_total: num(price.grandTotal, price.totalPrice, price.total),
      ordered_at: p.createdAt || p.created_at || p.orderTime || new Date().toISOString(),
      expedition_type: String(p.expeditionType || p.expedition_type || "delivery").toLowerCase(),
      customer: {
        name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.name || null,
        phone: customer.mobilePhone || customer.phone || customer.mobile || null,
      },
      items,
    };
  }
}

module.exports = FoodpandaClient;
