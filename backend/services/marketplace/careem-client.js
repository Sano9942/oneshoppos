const BaseMarketplace = require("./base-marketplace");

/**
 * Careem Now adapter (V03 food-service depth) — the second aggregator behind the
 * same `delivery_aggregators` flag and the same normalized web_order pipeline as
 * foodpanda.
 *
 * STUB-HONEST: Careem Now's POS-integration API is partner-provisioned and we do
 * not have sandbox/live access. Rather than ship a decorative green integration
 * that silently does nothing (completion plan 11's P0 lesson), this adapter:
 *   - reports its true status in testConnection ("manual" until provisioned),
 *   - still fully normalizes an inbound Careem order payload IF one is wired
 *     (so the moment access lands, only credentials change — not the pipeline),
 *   - refuses to fake outbound menu/availability pushes it can't perform.
 *
 * The hub surfaces Careem as "manual" so a demo never claims automation that
 * isn't there.
 */
class CareemClient extends BaseMarketplace {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.api_key || null;
    this.webhookSecret = config.webhook_secret || null;
    const cj = config.config_json || {};
    this.storeId = cj.store_id || cj.branch_id || cj.outlet_code || null;
    this.baseUrl = cj.base_url || null;
    // Only true once a tenant genuinely has Careem POS API access provisioned.
    this.apiProvisioned = cj.api_provisioned === true || cj.api_provisioned === "true";
  }

  async testConnection() {
    if (!this.storeId || !this.webhookSecret) {
      return {
        success: false,
        mode: "manual",
        error: "Careem Now not configured — orders entered manually until POS API access is provisioned",
      };
    }
    if (!this.apiProvisioned || !this.baseUrl) {
      // Configured for inbound webhook, but be explicit that outbound automation
      // (menu/availability) is not available.
      return {
        success: true,
        mode: "webhook_only",
        store_id: this.storeId,
        note: "Inbound order push active. Outbound availability push unavailable (Careem POS API not provisioned).",
      };
    }
    try {
      const res = await fetch(`${this.baseUrl}/branches/${encodeURIComponent(this.storeId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok
        ? { success: true, mode: "webhook+api", store_id: this.storeId }
        : { success: true, mode: "webhook_only", store_id: this.storeId, api_error: `HTTP ${res.status}` };
    } catch (err) {
      return { success: true, mode: "webhook_only", store_id: this.storeId, api_error: err.message };
    }
  }

  // No polling API access — honest empty result, never a silent fabrication.
  async pullOrders() {
    return [];
  }

  // No menu API access — report the no-op rather than pretend availability synced.
  async pushInventory(updates) {
    const list = Array.isArray(updates) ? updates : [];
    return { updated: 0, skipped: list.length, reason: "no_menu_api" };
  }

  async syncProducts() {
    return [];
  }

  /**
   * Normalize a Careem Now order payload into the internal web_order shape.
   * Mirrors FoodpandaClient.normalizeOrder so both aggregators feed one
   * pipeline. Defensive field aliasing; throws on missing order id → dead-letter.
   */
  static normalizeOrder(payload) {
    const p = payload || {};
    const externalId = String(
      p.orderId ?? p.order_id ?? p.id ?? p.reference ?? ""
    ).trim();
    if (!externalId) {
      throw Object.assign(new Error("Careem payload has no order id"), {
        code: "malformed_payload",
      });
    }
    const price = p.price || p.totals || p.payment || {};
    const num = (...cands) => {
      for (const c of cands) {
        const n = Number(c);
        if (Number.isFinite(n)) return n;
      }
      return 0;
    };
    const rawItems = Array.isArray(p.items)
      ? p.items
      : Array.isArray(p.products) ? p.products
      : Array.isArray(p.orderItems) ? p.orderItems : [];

    const items = rawItems.map((it) => {
      const qty = num(it.quantity, it.qty, 1) || 1;
      const unit = num(it.unitPrice, it.unit_price, it.price, it.paidPrice);
      const mods = Array.isArray(it.modifiers || it.options)
        ? (it.modifiers || it.options)
        : [];
      const modNote = mods
        .map((m) => (typeof m === "string" ? m : (m?.name || m?.title || "")))
        .filter(Boolean)
        .join(", ");
      const notes = [it.notes || it.comment || "", modNote].filter(Boolean).join(" | ");
      return {
        sku: it.sku || it.itemCode || it.remote_code || null,
        title: it.name || it.title || "Item",
        qty,
        unit_price: unit,
        line_total: num(it.total, it.total_price, unit * qty),
        notes: notes || null,
      };
    });

    const customer = p.customer || {};
    return {
      source: "careem",
      external_order_id: externalId,
      external_order_number: String(p.orderCode || p.short_code || externalId),
      store_id: String(p.branchId ?? p.branch_id ?? p.store_id ?? p.outletCode ?? "") || null,
      currency: p.currency || price.currency || "PKR",
      subtotal: num(price.subtotal, price.subTotal),
      tax_total: num(price.tax, price.taxTotal, price.vat),
      discount_total: num(price.discount, price.discountTotal, 0),
      grand_total: num(price.total, price.grandTotal, price.amount),
      ordered_at: p.createdAt || p.created_at || p.orderTime || new Date().toISOString(),
      expedition_type: String(p.orderType || p.expedition_type || "delivery").toLowerCase(),
      customer: {
        name: customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null,
        phone: customer.phone || customer.mobile || null,
      },
      items,
    };
  }
}

module.exports = CareemClient;
