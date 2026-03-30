/**
 * Payment gateway adapter — abstracts xPay/Stripe/manual behind one interface.
 *
 * Usage:
 *   const gateway = require("./payment-gateway");
 *   const { checkout_url, gateway_ref } = await gateway.createCheckout({ ... });
 *
 * Configuration via env vars:
 *   PAYMENT_GATEWAY=xpay|stripe|manual (default: manual)
 *   XPAY_API_KEY, XPAY_WEBHOOK_SECRET
 */

const logger = require("./logger").child({ component: "payment-gateway" });

// ── Gateway Interface ─────────────────────────────────────────────────

/**
 * Create a hosted checkout session.
 * @param {Object} opts
 * @param {number} opts.amount - Amount in smallest currency unit (e.g. PKR whole number)
 * @param {string} opts.currency - Currency code (default PKR)
 * @param {string} opts.reference - Internal reference (payment_intents.id)
 * @param {string} opts.description - Human-readable description
 * @param {string} opts.returnUrl - URL to redirect after payment
 * @param {string} opts.cancelUrl - URL to redirect on cancel
 * @returns {Promise<{ checkout_url: string, gateway_ref: string }>}
 */
async function createCheckout({ amount, currency = "PKR", reference, description, returnUrl, cancelUrl }) {
  const gw = process.env.PAYMENT_GATEWAY || "manual";

  if (gw === "xpay") {
    return xpayCreateCheckout({ amount, currency, reference, description, returnUrl, cancelUrl });
  }

  // Manual mode — no gateway, no checkout URL
  throw new Error("Online payments are not configured. Contact support to subscribe.");
}

/**
 * Verify a webhook signature and parse the payload.
 * @param {string} gateway - Gateway name (e.g. "xpay")
 * @param {Object} headers - Request headers
 * @param {string|Buffer} rawBody - Raw request body
 * @returns {Promise<{ valid: boolean, event_type: string, transaction_id: string, status: string, amount: number, raw: Object }>}
 */
async function verifyWebhook(gateway, headers, rawBody) {
  if (gateway === "xpay") {
    return xpayVerifyWebhook(headers, rawBody);
  }
  return { valid: false, error: "Unknown gateway" };
}

/**
 * Check if online payments are enabled.
 * @returns {boolean}
 */
function isEnabled() {
  const gw = process.env.PAYMENT_GATEWAY || "manual";
  return gw !== "manual";
}

// ── xPay Adapter ──────────────────────────────────────────────────────

async function xpayCreateCheckout({ amount, currency, reference, description, returnUrl, cancelUrl }) {
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

async function xpayVerifyWebhook(headers, rawBody) {
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

module.exports = { createCheckout, verifyWebhook, isEnabled };
