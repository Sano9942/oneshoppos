/**
 * Payment gateway adapter — class-based adapter pattern matching courier layer.
 *
 * Usage:
 *   const gateway = require("./payment-gateway");
 *   const { checkout_url, gateway_ref } = await gateway.createCheckout({ ... });
 *
 * Adding a new provider:
 *   1. Create a class extending BasePaymentAdapter
 *   2. Register it in the ADAPTERS map
 *   3. Set PAYMENT_GATEWAY env var to the adapter key
 *
 * Configuration via env vars:
 *   PAYMENT_GATEWAY=xpay|manual (default: manual)
 *   XPAY_API_KEY, XPAY_WEBHOOK_SECRET
 */

const logger = require("./logger").child({ component: "payment-gateway" });

// ── Base Adapter ──────────────────────────────────────────────────────

class BasePaymentAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  /** @returns {boolean} Whether this adapter can process payments */
  isEnabled() { return false; }

  /**
   * Create a hosted checkout session.
   * @param {Object} opts
   * @param {number} opts.amount
   * @param {string} opts.currency
   * @param {string} opts.reference
   * @param {string} opts.description
   * @param {string} opts.returnUrl
   * @param {string} opts.cancelUrl
   * @returns {Promise<{ checkout_url: string, gateway_ref: string }>}
   */
  async createCheckout(opts) {
    throw new Error("Not implemented");
  }

  /**
   * Verify a webhook signature and parse the payload.
   * @param {Object} headers
   * @param {string|Buffer} rawBody
   * @returns {Promise<{ valid: boolean, event_type?: string, transaction_id?: string, status?: string, amount?: number, raw?: Object, error?: string }>}
   */
  async verifyWebhook(headers, rawBody) {
    return { valid: false, error: "Not implemented" };
  }
}

// ── Manual Adapter (no gateway configured) ────────────────────────────

class ManualAdapter extends BasePaymentAdapter {
  isEnabled() { return false; }

  async createCheckout() {
    throw new Error("Online payments are not configured. Contact support to subscribe.");
  }

  async verifyWebhook() {
    return { valid: false, error: "No gateway configured" };
  }
}

// ── xPay Adapter ──────────────────────────────────────────────────────

class XPayAdapter extends BasePaymentAdapter {
  isEnabled() {
    return !!process.env.XPAY_API_KEY;
  }

  async createCheckout({ amount, currency = "PKR", reference, description, returnUrl, cancelUrl }) {
    const apiKey = process.env.XPAY_API_KEY;
    if (!apiKey) throw new Error("XPAY_API_KEY not configured");

    const res = await fetch("https://api.xpay.pk/v1/checkout/session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency,
        reference_id: String(reference),
        description,
        success_url: returnUrl,
        cancel_url: cancelUrl,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ status: res.status, body: err }, "xPay checkout creation failed");
      throw new Error(`xPay error: ${res.status}`);
    }

    const data = await res.json();
    return {
      checkout_url: data.checkout_url,
      gateway_ref: data.session_id,
    };
  }

  async verifyWebhook(headers, rawBody) {
    const secret = process.env.XPAY_WEBHOOK_SECRET;
    if (!secret) return { valid: false, error: "XPAY_WEBHOOK_SECRET not configured" };

    const crypto = require("crypto");
    const signature = headers["x-xpay-signature"];
    if (!signature) return { valid: false, error: "Missing signature header" };

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (!valid) return { valid: false, error: "Invalid signature" };

    const payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

    return {
      valid: true,
      event_type: payload.event_type || payload.event,
      transaction_id: payload.session_id || payload.transaction_id,
      status: payload.status,
      amount: payload.amount,
      raw: payload,
    };
  }
}

// ── Adapter Registry & Factory ────────────────────────────────────────

const ADAPTERS = {
  manual: ManualAdapter,
  xpay: XPayAdapter,
};

/**
 * Get a payment adapter instance by provider name.
 * @param {string} [providerName] - Provider key (defaults to PAYMENT_GATEWAY env var)
 * @returns {BasePaymentAdapter}
 */
function getPaymentAdapter(providerName) {
  const key = providerName || process.env.PAYMENT_GATEWAY || "manual";
  const AdapterClass = ADAPTERS[key] || ManualAdapter;
  return new AdapterClass();
}

// ── Backwards-compatible module API ───────────────────────────────────
// Existing callers (billing.js, customer-invoices.js, webhooks.js) use
// gateway.createCheckout(), gateway.verifyWebhook(), gateway.isEnabled()
// without needing to know about the adapter pattern.

async function createCheckout(opts) {
  const adapter = getPaymentAdapter();
  return adapter.createCheckout(opts);
}

async function createInvoiceCheckout({ invoiceId, amount, currency = "PKR", description, returnUrl, cancelUrl, linkToken }) {
  return createCheckout({
    amount,
    currency,
    reference: `inv-link-${linkToken}`,
    description: description || "Invoice payment",
    returnUrl,
    cancelUrl,
  });
}

async function verifyWebhook(gateway, headers, rawBody) {
  const adapter = getPaymentAdapter(gateway);
  return adapter.verifyWebhook(headers, rawBody);
}

function isEnabled() {
  const adapter = getPaymentAdapter();
  return adapter.isEnabled();
}

module.exports = {
  createCheckout,
  createInvoiceCheckout,
  verifyWebhook,
  isEnabled,
  getPaymentAdapter,
  BasePaymentAdapter,
  ADAPTERS,
};
