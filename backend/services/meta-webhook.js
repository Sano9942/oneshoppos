"use strict";

/**
 * Meta (Facebook/Instagram Commerce + WhatsApp Cloud API) webhook verification.
 *
 * SECRET SOURCE — the thing that makes this different from every other verifier
 * in this repo: Meta signs each delivery with the app secret of the Meta app the
 * tenant connected their Page/WABA to, and that app is OURS, not the tenant's.
 * The secret is therefore app-level (an env var), never a per-tenant
 * integration_settings row. That is what lets verification run BEFORE tenant
 * resolution — unlike services/aggregator-orders.js, whose secret is per-tenant
 * and so must route first, then verify.
 *
 * SIGNATURE CONTRACT (Meta Graph API — identical for both channels):
 *   header: x-hub-signature-256
 *   value:  "sha256=" + HEX HMAC-SHA256(app_secret, raw_request_body)
 *
 * Do NOT cross-wire this with the repo's two other raw-body verifiers — all
 * three differ in digest encoding and/or header, and reusing the wrong one
 * silently rejects every real webhook:
 *   - services/aggregator-orders.js → BASE64 digest, aggregator-specific headers
 *   - shopify/utils.js             → BASE64 digest, X-Shopify-Hmac-Sha256
 *
 * REPLAY: Meta sends no signed timestamp, so there is no replay window to
 * enforce here (the aggregator's replay guard is conditional for exactly this
 * reason). Authenticity rests on the signature; duplicate suppression rests on
 * the caller's own idempotency.
 */

const crypto = require("crypto");

const SIGNATURE_HEADER = "x-hub-signature-256";

/** Providers whose inbound webhooks Meta signs with our app secret. */
const META_PROVIDERS = ["facebook", "whatsapp"];

/**
 * The app secret used to verify a provider's webhooks.
 *
 * WhatsApp Business is commonly a separate Meta app from a Commerce app, so it
 * gets its own optional override; when unset it falls back to the shared secret
 * (the single-app setup).
 *
 * @returns {string|null} null when unconfigured — callers MUST treat null as
 *   "cannot verify" and fail closed, never as "skip verification".
 */
function resolveAppSecret(provider) {
  const shared = process.env.META_APP_SECRET || null;
  if (provider === "whatsapp") return process.env.WHATSAPP_APP_SECRET || shared;
  return shared;
}

/**
 * The GET-handshake verify token for a provider.
 * @returns {string|null} null when unconfigured.
 */
function resolveVerifyToken(provider) {
  const key = provider === "whatsapp"
    ? "WHATSAPP_WEBHOOK_VERIFY_TOKEN"
    : "META_WEBHOOK_VERIFY_TOKEN";
  return process.env[key] || null;
}

/**
 * Case-insensitive header read. Node lowercases inbound header names, so the
 * fast path covers the request case; the scan covers any caller that hands us a
 * hand-built headers object.
 */
function pickHeader(headers, name) {
  if (!headers) return null;
  let v = headers[name];
  if (v === undefined) {
    const target = name.toLowerCase();
    const key = Object.keys(headers).find((k) => k.toLowerCase() === target);
    if (key !== undefined) v = headers[key];
  }
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

/** Constant-time string compare that never throws on a length mismatch. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Verify the GET subscription handshake.
 *
 * Closes the `undefined === undefined` bypass this replaced: when the env var
 * was unset, the old comparison put `undefined` on the right, and a caller who
 * simply omitted hub.verify_token put `undefined` on the left — so the handshake
 * echoed the challenge to anyone. An unconfigured token now refuses.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyHandshake({ provider, mode, token }) {
  const expected = resolveVerifyToken(provider);
  if (!expected) return { ok: false, reason: "no_verify_token_configured" };
  if (mode !== "subscribe") return { ok: false, reason: "bad_mode" };
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing_token" };
  if (!safeEqual(expected, token)) return { ok: false, reason: "token_mismatch" };
  return { ok: true };
}

/**
 * Verify an inbound POST's x-hub-signature-256 against the raw request body.
 *
 * `rawBody` is the utf8 string captured by the express.json verify callback in
 * index.js for /api/webhooks/* — Meta signs the exact bytes it sent, so the
 * parsed body can never be re-serialized to reproduce them.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifySignature({ rawBody, headers, secret }) {
  const key = String(secret || "");
  if (!key) return { ok: false, reason: "no_app_secret_configured" };

  // Distinguish "body wasn't captured" from "body was empty" — hashing "" here
  // would reject every legitimate delivery with a misleading invalid_signature.
  if (typeof rawBody !== "string") return { ok: false, reason: "no_raw_body" };

  const provided = pickHeader(headers, SIGNATURE_HEADER);
  if (!provided) return { ok: false, reason: "missing_signature" };

  const match = /^sha256=([0-9a-f]{64})$/i.exec(String(provided).trim());
  if (!match) return { ok: false, reason: "malformed_signature" };

  const expected = crypto.createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
  if (!safeEqual(expected, match[1].toLowerCase())) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}

/** Test/helper mirror of what Meta sends. Not used in the request path. */
function signBody(rawBody, secret) {
  return `sha256=${crypto.createHmac("sha256", String(secret)).update(String(rawBody), "utf8").digest("hex")}`;
}

module.exports = {
  SIGNATURE_HEADER,
  META_PROVIDERS,
  resolveAppSecret,
  resolveVerifyToken,
  verifyHandshake,
  verifySignature,
  signBody,
};
