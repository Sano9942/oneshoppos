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
 *   PAYMENT_GATEWAY=sandbox|xpay|manual (default: manual)
 *   XPAY_API_KEY, XPAY_WEBHOOK_SECRET
 *   SANDBOX_WEBHOOK_SECRET (for sandbox adapter)
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

  /**
   * Process a refund against a previous transaction.
   * @param {Object} opts
   * @param {string} opts.transaction_id - Original transaction/gateway reference
   * @param {number} opts.amount - Refund amount
   * @param {string} [opts.reason] - Refund reason
   * @returns {Promise<{ refund_id: string, status: string }>}
   */
  async refund(opts) {
    throw new Error("Not implemented");
  }

  /**
   * Process an inline (non-redirect) payment — used for POS card payments.
   * @param {Object} opts
   * @param {number} opts.amount
   * @param {string} [opts.currency]
   * @param {string} opts.reference
   * @returns {Promise<{ gateway_ref: string, status: string }>}
   */
  async processInlinePayment(opts) {
    throw new Error("Inline payment not supported by this adapter");
  }

  /**
   * Tokenize a customer's payment instrument for future recurring charges.
   * Real implementation requires vendor-specific tokenization API support.
   * @param {Object} opts - { customerRef, last4 (optional) }
   * @returns {Promise<{ gateway_token: string, last4: string, brand: string }>}
   */
  async tokenize(opts) {
    throw new Error("Tokenization not supported by this adapter");
  }

  /**
   * Charge a previously-tokenized payment instrument (Item 22 — recurring
   * auto-charge). Wired by services/subscriptions.js processRenewal().
   * @param {Object} opts - { token, amount, currency, reference }
   * @returns {Promise<{ gateway_ref: string, status: string, amount: number }>}
   */
  async chargeSavedInstrument(opts) {
    throw new Error("Saved-instrument charge not supported by this adapter");
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

  async refund() {
    return { refund_id: null, status: "not_supported" };
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

// ── Sandbox Adapter (development/testing) ────────────────────────────

class SandboxAdapter extends BasePaymentAdapter {
  isEnabled() { return true; }

  async createCheckout({ amount, currency = "PKR", reference, description, returnUrl, cancelUrl }) {
    // Sandbox payment page is served by the backend at GET /api/sandbox/pay/:gatewayRef
    const backendUrl = process.env.APP_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const gatewayRef = `sandbox_${Date.now()}_${reference}`;
    logger.info({ amount, currency, reference, gatewayRef }, "Sandbox checkout created");
    return {
      checkout_url: `${backendUrl}/api/sandbox/pay/${encodeURIComponent(gatewayRef)}`,
      gateway_ref: gatewayRef,
    };
  }

  async verifyWebhook(headers, rawBody) {
    const secret = process.env.SANDBOX_WEBHOOK_SECRET;
    if (!secret) return { valid: false, error: "SANDBOX_WEBHOOK_SECRET not configured" };

    const crypto = require("crypto");
    const signature = headers["x-sandbox-signature"];
    if (!signature) return { valid: false, error: "Missing sandbox signature header" };

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (!valid) return { valid: false, error: "Invalid sandbox signature" };

    const payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

    return {
      valid: true,
      event_type: payload.event_type,
      transaction_id: payload.transaction_id,
      status: payload.status,
      amount: payload.amount,
      raw: payload,
    };
  }

  async refund({ transaction_id, amount, reason }) {
    const refundId = `sandbox_refund_${Date.now()}`;
    logger.info({ transaction_id, amount, reason, refundId }, "Sandbox refund processed");
    return { refund_id: refundId, status: "completed" };
  }

  async processInlinePayment({ amount, currency = "PKR", reference }) {
    const gatewayRef = `sandbox_inline_${Date.now()}_${reference}`;
    logger.info({ amount, currency, reference, gatewayRef }, "Sandbox inline payment processed");
    return { gateway_ref: gatewayRef, status: "completed" };
  }

  // Item 22 — saved-instrument tokenization for recurring auto-charge.
  // Real xPay tokenization is not yet wired (vendor confirms API needed);
  // sandbox provides a stand-in token so the renewal worker can be tested.
  async tokenize({ customerRef, last4 } = {}) {
    const token = `sbx_tok_${Buffer.from(
      `${customerRef || "anon"}-${Date.now()}-${Math.random()}`
    ).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
    logger.info({ token, customerRef }, "Sandbox tokenize");
    return {
      gateway_token: token,
      last4: last4 || "4242",
      brand: "VISA",
    };
  }

  async chargeSavedInstrument({ token, amount, currency = "PKR", reference }) {
    if (!token) throw new Error("token required");
    const gatewayRef = `sbx_chg_${Date.now()}_${reference || "ref"}`;
    logger.info({ token, amount, currency, reference, gatewayRef }, "Sandbox charge-saved");
    // Simulated decline: a token containing "FAIL" (case-insensitive) always
    // declines — lets the dunning worker + its tests drive the failure path.
    if (/fail/i.test(String(token))) {
      return { gateway_ref: gatewayRef, status: "failed", error: "simulated_decline" };
    }
    return { gateway_ref: gatewayRef, status: "completed", amount: Number(amount) };
  }
}

// ── Adapter Registry & Factory ────────────────────────────────────────

const ADAPTERS = {
  manual: ManualAdapter,
  xpay: XPayAdapter,
  sandbox: SandboxAdapter,
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

async function refund(opts) {
  const adapter = getPaymentAdapter();
  return adapter.refund(opts);
}

async function processInlinePayment(opts) {
  const adapter = getPaymentAdapter();
  return adapter.processInlinePayment(opts);
}

async function tokenize(opts) {
  const adapter = getPaymentAdapter();
  return adapter.tokenize(opts);
}

async function chargeSavedInstrument(opts) {
  const adapter = getPaymentAdapter();
  return adapter.chargeSavedInstrument(opts);
}

module.exports = {
  createCheckout,
  createInvoiceCheckout,
  verifyWebhook,
  isEnabled,
  refund,
  processInlinePayment,
  tokenize,
  chargeSavedInstrument,
  getPaymentAdapter,
  BasePaymentAdapter,
  ADAPTERS,
};
