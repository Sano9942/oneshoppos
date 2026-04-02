/**
 * Rate limiting middleware — global, auth, and webhook limiters.
 */
const rateLimit = require("express-rate-limit");

const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";

const RATE_LIMIT_WINDOW_MS = Math.max(
  1000,
  Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
);
const RATE_LIMIT_GLOBAL_MAX = Math.max(
  1,
  Number(process.env.RATE_LIMIT_GLOBAL_MAX || 600),
);
const RATE_LIMIT_AUTH_MAX = Math.max(
  1,
  Number(process.env.RATE_LIMIT_AUTH_MAX || 20),
);
const RATE_LIMIT_WEBHOOK_MAX = Math.max(
  1,
  Number(process.env.RATE_LIMIT_WEBHOOK_MAX || 120),
);

function retryAfterSeconds(req, fallbackWindowMs) {
  const resetAt = req.rateLimit?.resetTime
    ? new Date(req.rateLimit.resetTime).getTime()
    : Date.now() + fallbackWindowMs;
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

function limitExceededHandler(req, res, _next, options) {
  const retryAfter = retryAfterSeconds(req, RATE_LIMIT_WINDOW_MS);
  res.set("Retry-After", String(retryAfter));
  return res.status(options.statusCode || 429).json({
    error: "Too many requests",
    retry_after_seconds: retryAfter,
  });
}

function isPosBurstPath(pathname) {
  return (
    pathname.startsWith("/api/sales") ||
    pathname.startsWith("/api/products/search") ||
    pathname.startsWith("/api/products/scan/") ||
    pathname.startsWith("/api/orders")
  );
}

function extractTenantKey(req) {
  if (!IS_MULTI_TENANT) return "st";
  return req.headers["x-tenant-slug"] || req.tenantSlug || "unknown";
}

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: (req) => isPosBurstPath(req.path || ""),
  keyGenerator: (req) => `${extractTenantKey(req)}:${req.ip}`,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => {
    if (!IS_MULTI_TENANT) return req.ip;
    const tenantKey = req.body?.store_code || req.headers["x-tenant-slug"] || "unknown";
    return `${tenantKey}:${req.ip}`;
  },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_WEBHOOK_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
});

module.exports = { globalLimiter, authLimiter, webhookLimiter };
