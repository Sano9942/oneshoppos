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
  if (!secret) return { ok: true, reason: "no_secret_configured" };
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

module.exports = {
  baseRetryDelayMinutes,
  retryDelayMinutesWithJitter,
  evaluateWebhookTimestampWindow,
  isRetryableInventoryEventStatus,
  canApproveReconciliationRequest,
  buildWebhookIdempotencyKey,
  verifyWebhookSignature,
};
