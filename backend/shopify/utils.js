const crypto = require("crypto");

function baseRetryDelayMinutes(attemptCount) {
  const attempt = Math.max(1, Number(attemptCount || 1));
  if (attempt <= 1) return 1;
  if (attempt === 2) return 5;
  if (attempt === 3) return 15;
  if (attempt === 4) return 60;
  return 240;
}

function retryDelayMinutesWithJitter(attemptCount, randomFn = Math.random) {
  const base = baseRetryDelayMinutes(attemptCount);
  const jitterMax = base >= 60 ? 5 : base >= 15 ? 2 : 1;
  const jitter = Math.floor(
    (typeof randomFn === "function" ? randomFn() : Math.random()) *
      (jitterMax + 1),
  );
  return base + jitter;
}

function evaluateWebhookTimestampWindow(
  triggeredAtHeader,
  nowMs = Date.now(),
  maxAgeMs = 10 * 60 * 1000,
  futureSkewMs = 5 * 60 * 1000,
) {
  if (!triggeredAtHeader) {
    return { ok: true, reason: "missing_timestamp" };
  }
  const ts = Date.parse(String(triggeredAtHeader));
  if (Number.isNaN(ts)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  const ageMs = nowMs - ts;
  if (ageMs > maxAgeMs || ageMs < -futureSkewMs) {
    return { ok: false, reason: "outside_window", ageMs };
  }
  return { ok: true, ageMs };
}

function normalizeRetryableStatus(status) {
  return String(status || "").toLowerCase();
}

function isRetryableInventoryEventStatus(status) {
  return ["failed", "dead_letter", "retry", "failed_mapping"].includes(
    normalizeRetryableStatus(status),
  );
}

function canApproveReconciliationRequest({
  requesterEmployeeId,
  approverEmployeeId,
}) {
  const requester = Number(requesterEmployeeId || 0) || null;
  const approver = Number(approverEmployeeId || 0) || null;
  if (!requester || !approver) return false;
  return requester !== approver;
}

function buildWebhookIdempotencyKey({
  webhookId,
  payload = {},
  nowMs = Date.now(),
}) {
  const hookId = String(webhookId || "").trim();
  if (hookId) return `shopify_webhook_${hookId}`;
  const orderId = String(payload?.id || payload?.order_id || "").trim();
  const stamp = payload?.updated_at || payload?.created_at || nowMs;
  return `shopify_webhook_order_${orderId}_${stamp}`;
}

function verifyWebhookSignature({ rawBody, providedHmac, webhookSecret }) {
  const secret = String(webhookSecret || "");
  if (!secret) return { ok: false, reason: "no_secret_configured" };
  const provided = String(providedHmac || "");
  if (!provided) return { ok: false, reason: "missing_signature" };
  const expected = crypto
    .createHmac("sha256", secret)
    .update(String(rawBody || ""), "utf8")
    .digest("base64");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");
  if (left.length !== right.length)
    return { ok: false, reason: "invalid_signature" };
  if (!crypto.timingSafeEqual(left, right))
    return { ok: false, reason: "invalid_signature" };
  return { ok: true, expected };
}

// Returns a masked preview of a Shopify secret (first4...last4).
// decryptFn is injected so this module stays free of DB/crypto deps.
function maskSecret(secret, decryptFn) {
  let value = String(secret || "");
  if (typeof decryptFn === "function") {
    try { value = decryptFn(value); } catch { /* keep raw on decrypt failure */ }
  }
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// A Dev Dashboard app's token lasts 24 hours; renew it once less than this is left.
const TOKEN_RENEW_MARGIN_MS = 60 * 60 * 1000;
// One renewal at a time per store and app, however many callers ask at once.
const tokenRenewals = new Map();

// Fetches the single active Shopify connection row and decrypts secrets.
// db and decryptFn are injected to keep this module free of direct DB imports.
// For a Dev Dashboard app connection (client_id set) the 24-hour access token is
// renewed here before it runs out, so every caller gets a usable token. A failed
// renewal never throws: it's recorded in last_error and the old token is tried.
async function getActiveShopifyConnection(db, decryptFn) {
  const { rows } = await db.query(
    "SELECT * FROM shopify_connections WHERE is_active = true ORDER BY id DESC LIMIT 1"
  );
  const row = rows[0] || null;
  if (!row) return null;
  const conn = {
    ...row,
    access_token: decryptFn(row.access_token),
    webhook_secret: decryptFn(row.webhook_secret),
  };
  if (!row.client_id || !row.client_secret) return conn;

  conn.client_secret = decryptFn(row.client_secret);
  // A Dev Dashboard app signs its webhooks with the client secret.
  if (!conn.webhook_secret) conn.webhook_secret = conn.client_secret;

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (conn.access_token && expiresAt - Date.now() > TOKEN_RENEW_MARGIN_MS) return conn;

  const key = `${row.shop_domain}|${row.client_id}`;
  let renewal = tokenRenewals.get(key);
  if (!renewal) {
    renewal = renewConnectionToken(db, row.id, conn).finally(() => tokenRenewals.delete(key));
    tokenRenewals.set(key, renewal);
  }
  const fresh = await renewal;
  if (fresh) {
    conn.access_token = fresh.access_token;
    conn.access_token_expires_at = fresh.expires_at;
  }
  return conn;
}

async function renewConnectionToken(db, connectionId, conn) {
  const { requestClientCredentialsToken } = require("./client");
  const { encryptShopifySecret, logShopifyEvent } = require("./crypto");
  try {
    const fresh = await requestClientCredentialsToken(conn);
    await db.query(
      "UPDATE shopify_connections SET access_token = $1, access_token_expires_at = $2, updated_at = NOW() WHERE id = $3",
      [encryptShopifySecret(fresh.access_token), fresh.expires_at, connectionId]
    );
    return fresh;
  } catch (err) {
    logShopifyEvent("error", "access_token_renewal_failed", { shop: conn.shop_domain, error: err.message });
    try {
      await db.query("UPDATE shopify_connections SET last_error = $1 WHERE id = $2", [err.message, connectionId]);
    } catch {
      // recording the error must not break the caller
    }
    return null;
  }
}

module.exports = {
  baseRetryDelayMinutes,
  retryDelayMinutesWithJitter,
  evaluateWebhookTimestampWindow,
  isRetryableInventoryEventStatus,
  canApproveReconciliationRequest,
  buildWebhookIdempotencyKey,
  verifyWebhookSignature,
  maskSecret,
  getActiveShopifyConnection,
};
