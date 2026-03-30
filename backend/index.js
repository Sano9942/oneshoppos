require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const Sentry = require("@sentry/node");
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0, // No tracing — we use our own request timing
  });
}
const express = require("express");
const compression = require("compression");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const db = process.env.DATABASE_URL ? require("./db-pg") : require("./db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const requestId = require("./middleware/request-id");
const alerting = require("./services/alerting");
const createTier4Router = require("./routes/tier4");
const registerAllRoutes = require("./routes/registerAllRoutes");

// Multi-tenant imports (lazy-used when MULTI_TENANT=1)
const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";
const HAS_POSTGRES = !!process.env.DATABASE_URL;
let asyncStore, createDbProxy, dbProxy, tenantDbManager;
if (IS_MULTI_TENANT) {
  if (HAS_POSTGRES) {
    // Postgres schema-switching mode
    const proxyMod = require("./tenant-db-proxy-pg");
    asyncStore = proxyMod.asyncStore;
    createDbProxy = proxyMod.createDbProxy;
    dbProxy = createDbProxy();
    tenantDbManager = require("./tenant-db-manager-pg");
    tenantDbManager.init(db);
    // Initialize master DB so getTenantBySlug/query work globally
    const masterDbPgBoot = require("./master-db-pg");
    masterDbPgBoot.init(db);
  } else {
    // Legacy SQLite file-pool mode
    const proxyMod = require("./tenant-db-proxy");
    asyncStore = proxyMod.asyncStore;
    createDbProxy = proxyMod.createDbProxy;
    dbProxy = createDbProxy();
    tenantDbManager = require("./tenant-db-manager");
  }
}
const {
  verifyConnection,
  fetchShopifyLocations,
  adjustShopifyInventory,
  fetchShopifyVariantCatalog,
  fetchShopifyProductsFull,
  fetchInventoryLevel,
  fetchInventoryLevelsBatch,
  fetchRecentOrders,
} = require("./shopify/client");
const {
  retryDelayMinutesWithJitter,
  evaluateWebhookTimestampWindow,
  isRetryableInventoryEventStatus,
  canApproveReconciliationRequest,
  buildWebhookIdempotencyKey,
  verifyWebhookSignature,
} = require("./shopify/utils");
require("dotenv").config();

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
const PORT = process.env.PORT || 5000;
const SHOPIFY_SECRET_ENC_PREFIX = "enc:v1";
const SHOPIFY_MAX_RETRY_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.SHOPIFY_MAX_RETRY_ATTEMPTS || "5", 10),
);
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.resolve(DATA_DIR, "sanopos.db");
const UPLOADS_DIR = path.resolve(DATA_DIR, "uploads");
const PRODUCT_UPLOADS_DIR = path.resolve(UPLOADS_DIR, "products");
const COMPANY_UPLOADS_DIR = path.resolve(UPLOADS_DIR, "company");
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

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PRODUCT_UPLOADS_DIR))
  fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(COMPANY_UPLOADS_DIR))
  fs.mkdirSync(COMPANY_UPLOADS_DIR, { recursive: true });

function getShopifySecretKeyBuffer() {
  const raw = String(process.env.SHOPIFY_SECRET_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {
    // ignore parse issues
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function encryptShopifySecret(plainText) {
  const value = String(plainText || "");
  if (!value) return "";
  const key = getShopifySecretKeyBuffer();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${SHOPIFY_SECRET_ENC_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptShopifySecret(storedText) {
  const stored = String(storedText || "");
  if (!stored) return "";
  if (!stored.startsWith(`${SHOPIFY_SECRET_ENC_PREFIX}:`)) return stored;
  const key = getShopifySecretKeyBuffer();
  if (!key) {
    throw new Error(
      "SHOPIFY_SECRET_KEY is required to decrypt Shopify secrets",
    );
  }
  const parts = stored.split(":");
  if (parts.length !== 5)
    throw new Error("Invalid encrypted Shopify secret format");
  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const encrypted = Buffer.from(parts[4], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function logShopifyEvent(level, event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    area: "shopify_connector",
    event,
    ...details,
  };
  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  logger(JSON.stringify(payload));
}

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

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : "http://localhost:5173",
  credentials: true,
}));
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      if (
        req.originalUrl &&
        req.originalUrl.includes("/api/integrations/shopify/webhooks/")
      ) {
        req.rawBody = buf.toString("utf8");
      }
    },
  }),
); // Parse JSON bodies
// Single-tenant static file serving (fallback for MT mode when no tenant context)
app.use("/uploads", express.static(UPLOADS_DIR));

// R2 proxy — serves /r2/<key> by streaming from Cloudflare R2
// Only used when R2_PUBLIC_URL is not set (i.e. no public bucket / custom domain)
if (!process.env.R2_PUBLIC_URL) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const { r2, bucket } = require("./utils/r2");
  app.get("/r2/*key", async (req, res) => {
    const key = req.params.key;
    try {
      const data = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      res.setHeader("Content-Type", data.ContentType || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000");
      data.Body.pipe(res);
    } catch (err) {
      res.status(404).json({ error: "Not found" });
    }
  });
}
app.use(compression());   // Gzip/deflate API responses (~70% smaller)
app.use(cookieParser()); // Parse cookies (needed for JWT refresh token httpOnly cookie)
app.use(globalLimiter);
app.use(requestId);         // Structured logging + X-Request-Id header

// --- PERMISSION MIDDLEWARE SCAFFOLD ---
// Reads optional x-employee-id header, attaches permissions to req.
// Routes can call requirePerm(perm) to enforce access. No behavior change
// on routes that don't use it — existing flows are untouched.

async function loadEmployeePerms(req, res, next) {
  const employeeId = req.headers["x-employee-id"];
  const parsed = parseInt(employeeId, 10);
  if (employeeId !== undefined && (isNaN(parsed) || parsed <= 0 || parsed > 999999)) {
    return res.status(400).json({ error: "Invalid employee ID header" });
  }
  if (!employeeId) {
    req.employeePerms = [];
    return next();
  }
  try {
    const { rows: [emp] } = await db.query(
      "SELECT role_id FROM employees WHERE id = $1", [employeeId]
    );
    if (!emp) {
      req.employeePerms = [];
      return next();
    }
    const { rows } = await db.query(
      "SELECT permission FROM role_permissions WHERE role_id = $1", [emp.role_id]
    );
    req.employeePerms = rows.map((r) => r.permission);
  } catch {
    req.employeePerms = [];
  }
  next();
}

// JWT auth middleware (Phase 2) — used when MULTI_TENANT=1.
// Verifies Bearer token, sets req.tenantId / req.employee / req.tokenScope,
// bridges x-employee-id for downstream compatibility, then loads permissions from DB.
// Falls through to loadEmployeePerms when MULTI_TENANT is not "1".
const KIOSK_ALLOWED_PATHS = [
  /^\/api\/attendance\/pin-/,
  /^\/api\/auth\//,
];

async function loadTenantAndPerms(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.employeePerms = [];
    return next();
  }

  try {
    const { verifyAccessToken } = require("./jwt-auth");
    const decoded = verifyAccessToken(authHeader.slice(7), process.env.JWT_SECRET);

    req.tenantId = decoded.tid;
    req.employee = { id: decoded.eid, role_id: decoded.rid };
    req.tokenScope = decoded.scope || "full";
    req.isImpersonating = !!decoded.impersonating;
    if (decoded.impersonating && decoded.realIdentity) {
      req.impersonatedBy = decoded.realIdentity;
    }

    // Bridge: set x-employee-id header so downstream code that reads it still works
    req.headers["x-employee-id"] = String(decoded.eid);

    // Set outlet context from JWT claim
    if (decoded.oid) {
      req.context = req.context || {};
      req.context.outletId = decoded.oid;
      // Also bridge as header for resolveContext
      if (!req.headers["x-outlet-id"]) {
        req.headers["x-outlet-id"] = String(decoded.oid);
      }
    }

    // Kiosk scope: restrict to attendance PIN endpoints only
    if (req.tokenScope === "kiosk" && !KIOSK_ALLOWED_PATHS.some(rx => rx.test(req.path))) {
      return res.status(403).json({ error: "Kiosk scope: access denied", code: "KIOSK_RESTRICTED" });
    }

    // Load permissions — in MT mode, query the tenant's DB directly
    const permDb = IS_MULTI_TENANT
      ? await tenantDbManager.getDb(decoded.tid)
      : db;

    // Token revocation checks (jti-based + blanket revocation)
    try {
      if (decoded.jti) {
        const { rows: [revoked] } = await permDb.query(
          "SELECT 1 FROM revoked_tokens WHERE token_jti = $1", [decoded.jti]
        );
        if (revoked) {
          return res.status(401).json({ error: "Token revoked", code: "TOKEN_REVOKED" });
        }
      }

      const { rows: [empRevoke] } = await permDb.query(
        "SELECT tokens_revoked_before FROM employees WHERE id = $1", [decoded.eid]
      );
      if (empRevoke && empRevoke.tokens_revoked_before && decoded.iat < Date.parse(empRevoke.tokens_revoked_before) / 1000) {
        return res.status(401).json({ error: "All sessions revoked", code: "ALL_SESSIONS_REVOKED" });
      }
    } catch {
      // table/column may not exist yet — skip revocation checks
    }

    // Load permissions
    try {
      const { rows: [emp] } = await permDb.query(
        "SELECT role_id, name FROM employees WHERE id = $1", [decoded.eid]
      );
      if (!emp) {
        req.employeePerms = [];
        return next();
      }
      req.employee.name = emp.name;
      if (req.isImpersonating) {
        req.employee.name = (emp.name || "Admin") + " (impersonated by Super-Admin)";
      }
      const { rows } = await permDb.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1", [emp.role_id]
      );
      req.employeePerms = rows.map(r => r.permission);
    } catch {
      req.employeePerms = [];
    }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    // No token or invalid token — clear perms and continue (unauthenticated)
    req.employeePerms = [];
    next();
  }
}

/**
 * resolveTenant — middleware that wraps each request in an AsyncLocalStorage
 * context pointing to the correct tenant's DB. Must run AFTER loadTenantAndPerms
 * (which sets req.tenantId from the JWT). Only active when MULTI_TENANT=1.
 *
 * Also sets req.tenantDir and req.tenantSlug for upload-aware route handlers.
 */
async function resolveTenant(req, res, next) {
  if (!IS_MULTI_TENANT) return next();

  // For unauthenticated requests (no JWT → no tenantId), allow resolution via
  // ?tenant=<slug> query param — used by kiosk and other pre-auth pages.
  let resolvedTenantId = req.tenantId;
  if (!resolvedTenantId && HAS_POSTGRES && req.query.tenant) {
    try {
      const masterMod = require("./master-db-pg");
      const tenant = await masterMod.getTenantBySlug(req.query.tenant);
      if (tenant) resolvedTenantId = tenant.id;
    } catch {
      // ignore — will fall through to next() below
    }
  }

  if (!resolvedTenantId) return next();

  try {
    const tenantDb = await tenantDbManager.getDb(resolvedTenantId);

    // Look up tenant slug for file paths
    const masterMod = HAS_POSTGRES ? require("./master-db-pg") : require("./master-db");
    const tenant = HAS_POSTGRES
      ? await masterMod.getTenantById(resolvedTenantId)
      : await new Promise((resolve, reject) => {
          masterMod.getMasterDb().get("SELECT * FROM tenants WHERE id = ?", [req.tenantId], (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
          });
        });
    if (!tenant) {
      return res.status(403).json({ error: "Tenant not found.", code: "TENANT_NOT_FOUND" });
    }

    req.tenantSlug = tenant.slug;
    req.tenantDir = path.join(__dirname, "tenants", `t_${tenant.slug}`);

    // Wrap the rest of the request chain in AsyncLocalStorage context
    asyncStore.run({ db: tenantDb }, () => next());
  } catch (err) {
    // Tenant suspended or DB missing
    if (err.message && err.message.includes("is suspended")) {
      return res.status(403).json({ error: "Account suspended. Contact support.", code: "TENANT_SUSPENDED" });
    }
    if (err.message && err.message.includes("is deleted")) {
      return res.status(403).json({ error: "Account not found.", code: "TENANT_DELETED" });
    }
    console.error("[resolveTenant]", err.message);
    return res.status(500).json({ error: "Failed to resolve tenant database" });
  }
}

function requirePerm(permission) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    if (perms.includes("all_access") || perms.includes(permission)) {
      return next();
    }
    return res
      .status(403)
      .json({ error: "Forbidden: insufficient permissions" });
  };
}

// Helper: resolve the correct DB for tenant-scoped queries in middleware.
// In MT mode, use the proxy ONLY when ALS context exists (req.tenantId is set).
// Health checks, admin routes, and pre-auth routes have no tenant context — use raw db.
function _getCompanyDb(req) {
  if (IS_MULTI_TENANT && req && req.tenantId) return dbProxy;
  return db;
}

// Company profile cache — per-tenant Map (MT-safe). Single-tenant uses "_default" key.
// Provides req.company.timezone (and other profile fields) to all route handlers.
const _companyCache = new Map(); // key: tenantId|"_default", value: { profile, lastCheck }
const COMPANY_CACHE_MS = 5 * 60 * 1000; // 5 min

// Eager startup load — only in single-tenant mode (MT loads lazily per-tenant)
if (!IS_MULTI_TENANT) {
  (async () => {
    try {
      const { rows: [row] } = await db.query("SELECT * FROM company_profile WHERE id = 1");
      if (row) {
        _companyCache.set("_default", { profile: row, lastCheck: Date.now() });
        // If setup not yet complete, generate a one-time token and log the setup URL
        if (!row.setup_complete) {
          const setupToken = crypto.randomBytes(32).toString("hex");
          await db.query("UPDATE company_profile SET setup_token = $1 WHERE id = 1", [setupToken]);
          _companyCache.set("_default", { profile: { ...row, setup_token: setupToken }, lastCheck: Date.now() });
          const PORT_FOR_LOG = process.env.PORT || 5000;
          console.log(`\n===== SETUP URL: http://localhost:${PORT_FOR_LOG}/setup?token=${setupToken} =====\n`);
        }
      } else {
        _companyCache.set("_default", { profile: { timezone: "UTC" }, lastCheck: Date.now() });
      }
    } catch (err) {
      console.error("[loadCompanyProfile startup]", err.message);
      _companyCache.set("_default", { profile: { timezone: "UTC" }, lastCheck: Date.now() });
    }
  })();
}

function loadCompanyProfile(req, res, next) {
  const cacheKey = IS_MULTI_TENANT ? (req.tenantId || "_default") : "_default";
  const entry = _companyCache.get(cacheKey) || { profile: { timezone: "UTC" }, lastCheck: 0 };
  const now = Date.now();

  if (now - entry.lastCheck > COMPANY_CACHE_MS) {
    entry.lastCheck = now; // prevent multiple concurrent refreshes
    _companyCache.set(cacheKey, entry);
    _getCompanyDb(req).query("SELECT * FROM company_profile WHERE id = 1").then(({ rows: [row] }) => {
      if (row) {
        entry.profile = row;
        _companyCache.set(cacheKey, entry);
      }
    }).catch(() => {});
  }
  req.company = entry.profile;

  // Setup gate: if setup_complete = false, block all routes except /api/setup and /api/health.
  // In MT mode, only apply the gate when a tenant context is established (req.tenantId set).
  // Pre-auth requests (login, refresh) have no tenant context yet and must not be blocked.
  if (
    entry.profile &&
    !entry.profile.setup_complete &&
    !req.path.startsWith("/api/setup") &&
    !req.path.startsWith("/api/health") &&
    (!IS_MULTI_TENANT || req.tenantId)
  ) {
    return res.status(503).json({ error: "Setup required", code: "SETUP_REQUIRED" });
  }

  next();
}

// Context resolver — reads context headers, optionally enforces when flag is on.
// Exempt paths: auth, context bootstrap, feature-flags, kiosk attendance PIN endpoints.
const CONTEXT_EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/context\//,
  /^\/api\/feature-flags/,
  /^\/api\/attendance\/pin-/,
  /^\/api\/roles\/\d+\/permissions/,
  /^\/api\/outlets$/,
];
// Context enforcement flag cache — per-tenant Map (MT-safe). Single-tenant uses "_default" key.
const _contextFlagCache = new Map(); // key: tenantId|"_default", value: { enforced, loaded, lastCheck }
const CONTEXT_FLAG_CACHE_MS = 30000; // re-check every 30s

// Eagerly load flag on startup — only in single-tenant mode
if (!IS_MULTI_TENANT) {
  (async () => {
    try {
      const { rows: [row] } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'"
      );
      _contextFlagCache.set("_default", {
        enforced: row ? row.enabled === true : false,
        loaded: true,
        lastCheck: Date.now(),
      });
    } catch {
      _contextFlagCache.set("_default", { enforced: false, loaded: true, lastCheck: Date.now() });
    }
  })();
}

function resolveContext(req, res, next) {
  req.context = { companyId: null, outletId: null, scopeMode: null };
  const companyId = req.headers["x-company-id"];
  const outletId = req.headers["x-outlet-id"];
  const scopeMode = req.headers["x-scope-mode"];
  if (companyId) req.context.companyId = Number(companyId);
  if (outletId) req.context.outletId = Number(outletId);
  if (scopeMode) req.context.scopeMode = scopeMode;

  // Per-tenant flag lookup
  const cacheKey = IS_MULTI_TENANT ? (req.tenantId || "_default") : "_default";
  let flagEntry = _contextFlagCache.get(cacheKey);
  const now = Date.now();

  if (!flagEntry || (now - flagEntry.lastCheck > CONTEXT_FLAG_CACHE_MS)) {
    const newEntry = flagEntry || { enforced: false, loaded: false, lastCheck: now };
    newEntry.lastCheck = now;
    _contextFlagCache.set(cacheKey, newEntry);
    _getCompanyDb(req).query("SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'")
      .then(({ rows: [row] }) => {
        if (row) newEntry.enforced = row.enabled === true;
        newEntry.loaded = true;
      })
      .catch(() => { newEntry.loaded = true; });
    flagEntry = newEntry;
  }

  // Enforce: reject API requests missing context headers (when flag is on)
  if (flagEntry.loaded && flagEntry.enforced && req.path.startsWith("/api/")) {
    const exempt = CONTEXT_EXEMPT_PATHS.some((rx) => rx.test(req.path));
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    // If no employee identity is attached yet, defer context enforcement to
    // route-level auth/permission checks to avoid bootstrap races.
    if (!exempt && !employeeId) return next();
    // Admins (all_access) are exempt from outlet requirement.
    // This avoids false "Context required" blocks if scope-mode headers are missing
    // during refresh or partial client bootstraps.
    const perms = req.employeePerms || [];
    const isAdmin = perms.includes("all_access");
    if (!exempt && !outletId && !isAdmin) {
      return res.status(428).json({
        error: "Context required: select a branch before using this feature.",
        code: "CONTEXT_REQUIRED",
      });
    }
  }

  next();
}

// Helper middleware: injects req.context.outletId into req.query.outlet_id
// so existing route code that filters by outlet_id becomes context-aware.
function requireContextOutlet(req, res, next) {
  if (req.context?.outletId && !req.query.outlet_id) {
    req.query.outlet_id = String(req.context.outletId);
  }
  next();
}

function requireAnyPerm(permissions) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    const allowed =
      perms.includes("all_access") ||
      permissions.some((p) => perms.includes(p));
    if (allowed) return next();
    return res
      .status(403)
      .json({ error: "Forbidden: insufficient permissions" });
  };
}

const DEFAULT_ROLE_PERMISSIONS = {
  Administrator: ["all_access"],
  Manager: [
    "manage_inventory",
    "manage_orders",
    "view_reports",
    "manage_employees",
    "pos_discount",
    "void_sales",
    "pos_park",
    "pos_void",
  ],
  Cashier: ["view_reports", "pos_discount", "pos_park"],
};

async function ensureDefaultRolePermissions() {
  try {
    const { rows: roles } = await db.query("SELECT id, name FROM roles");
    if (!roles?.length) return;
    for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const roleId = roles.find(r => r.name === roleName)?.id;
      if (!roleId) continue;
      for (const perm of perms) {
        await db.query(
          "INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [roleId, perm]
        );
      }
    }
  } catch (err) {
    console.error("[ensureDefaultRolePermissions]", err.message);
  }
}

const PERMISSION_RULES = [
  // Reporting and analytics
  {
    methods: ["GET"],
    path: /^\/api\/reports(\/|$)/,
    anyPerms: ["view_reports", "manage_employees"],
  },
  {
    methods: ["GET"],
    path: /^\/api\/attendance(\/|$)/,
    anyPerms: ["view_reports", "manage_employees"],
  },
  // Attendance manual edit (manager write)
  {
    methods: ["PUT"],
    path: /^\/api\/attendance\/\d+$/,
    anyPerms: ["manage_employees"],
  },
  // Attendance config on employee record
  {
    methods: ["GET", "PUT"],
    path: /^\/api\/employees\/\d+\/attendance-config$/,
    anyPerms: ["manage_employees"],
  },
  // Note: POST /api/attendance/pin-* endpoints are intentionally ungated
  // (kiosk actions — the employee PIN is the authentication)

  // Setup/config mutation
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/categories(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/brands(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/products(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/products\/bulk-import$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/attribute-sets(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/barcode-templates(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/barcode-print-jobs$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT"],
    path: /^\/api\/expenses(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/expense-categories(\/\d+)?$/,
    anyPerms: ["manage_inventory"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/outlets(\/\d+)?$/,
    anyPerms: ["manage_employees"],
  },
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/receipt-templates(\/\d+)?$/,
    anyPerms: ["manage_employees"],
  },

  // Orders/procurement mutation
  {
    methods: ["POST", "PUT", "DELETE"],
    path: /^\/api\/suppliers(\/\d+)?$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/supplier-returns$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/supplier-invoices\/\d+\/pay$/,
    anyPerms: ["manage_orders"],
  },
  { methods: ["POST"], path: /^\/api\/returns$/, anyPerms: ["manage_orders"] },

  // Approval workflow
  {
    methods: ["GET"],
    path: /^\/api\/approvals$/,
    anyPerms: ["manage_orders", "manage_employees"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/purchase-orders\/\d+\/submit$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/purchase-orders\/\d+\/approve$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/transfers\/\d+\/submit$/,
    anyPerms: ["manage_orders"],
  },
  {
    methods: ["POST"],
    path: /^\/api\/transfers\/\d+\/approve$/,
    anyPerms: ["manage_orders"],
  },

  // POS-specific restricted flows
  {
    methods: ["POST", "DELETE"],
    path: /^\/api\/parked-sales(\/\d+)?$/,
    anyPerms: ["pos_park"],
  },
];

const DEFAULT_FEATURE_FLAGS = {
  backup_restore: true,
  e_invoicing_export: true,
  supplier_payables: true,
  approvals: true,
  notifications: true,
  accounting_core: true,
  crm_quotations: true,
  advanced_hr: true,
  multi_company: true,
  ui_redesign_enabled: true,
  ui_redesign_inventory: true,
  ui_redesign_orders: false,
  ui_redesign_pos: false,
  ui_redesign_reports: false,
  ui_redesign_admin: false,
  ui_redesign_customers: false,
  ui_redesign_sales_history: false,
  ui_redesign_cash_management: false,
  ui_redesign_returns: false,
  ui_redesign_categories: false,
  ui_redesign_brands: false,
  ui_redesign_taxes: false,
  ui_redesign_attribute_sets: false,
  ui_redesign_stock_adjustments: false,
  ui_redesign_transfers: false,
  ui_redesign_returned_stock: false,
  ui_redesign_suppliers: false,
  ui_redesign_purchase_orders: false,
  ui_redesign_supplier_payables: false,
  ui_redesign_promotions: false,
  ui_redesign_expenses: false,
  reports_enhanced_filters: false,
  reports_profit_layer: false,
  reports_inventory_health_plus: false,
  reports_exceptions: false,
  reports_scheduled_exports: false,
  context_selection_required: false,
  context_header_enforced: false,
  kiosk_context_locked: false,
};

// Per-tenant feature flag cache: Map<tenantId|"_default", { flags, timestamp }>
const _featureFlagCache = new Map();
const FEATURE_FLAG_CACHE_MS = 60_000; // 60s TTL

async function getFeatureFlagsMap(tenantId) {
  const cacheKey = tenantId || "_default";
  const cached = _featureFlagCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < FEATURE_FLAG_CACHE_MS) {
    return { ...cached.flags };
  }
  try {
    let flagDb = db;
    if (IS_MULTI_TENANT && tenantId && tenantDbManager) {
      try { flagDb = await tenantDbManager.getDb(tenantId); } catch { /* fall back to db */ }
    }
    const { rows } = await flagDb.query("SELECT key, enabled FROM feature_flags");
    const merged = { ...DEFAULT_FEATURE_FLAGS };
    for (const row of rows || []) {
      merged[row.key] = row.enabled === true;
    }
    _featureFlagCache.set(cacheKey, { flags: merged, timestamp: now });
    return merged;
  } catch (err) {
    if (String(err.message || "").includes("does not exist")) {
      return { ...DEFAULT_FEATURE_FLAGS };
    }
    throw err;
  }
}

function invalidateFeatureFlagCache(tenantId) {
  if (tenantId) {
    _featureFlagCache.delete(tenantId);
  } else {
    _featureFlagCache.clear();
  }
}

function requireFeature(flagKey) {
  return async (req, res, next) => {
    try {
      const flags = await getFeatureFlagsMap(req.tenantId);
      if (!flags[flagKey]) {
        return res.status(503).json({
          error: `Feature disabled: ${flagKey}`,
          flag: flagKey,
        });
      }
      next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

const _notifDb = IS_MULTI_TENANT ? dbProxy : db;

function createNotification(type, title, message, link) {
  _notifDb.query(
    "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
    [type, title, message, link || null]
  ).catch(() => {});
}

function notifyLowStockForSale(cartItems, outletId) {
  const productIds = [
    ...new Set(
      (cartItems || [])
        .map((i) => Number(i.original_product_id || i.product_id || i.id))
        .filter(Boolean),
    ),
  ];
  if (!productIds.length || !outletId) return;
  const placeholders = productIds.map((_, i) => "$" + (i + 2)).join(",");
  _notifDb.query(
    `SELECT os.product_id, os.quantity, p.name
     FROM outlet_stock os
     JOIN products p ON p.id = os.product_id
     WHERE os.outlet_id = $1 AND os.product_id IN (${placeholders}) AND COALESCE(os.quantity, 0) <= 10`,
    [outletId, ...productIds]
  ).then(({ rows }) => {
    if (!rows) return;
    rows.forEach((row) => {
      createNotification(
        "low_stock",
        "Low Stock Alert",
        `${row.name} has ${row.quantity} units left`,
        "/inventory",
      );
    });
  }).catch(() => {});
}

const runtimeState = { isRestoreInProgress: false };

const { requirePlanLimit, requireActiveSubscription, PLAN_DEFAULTS } = require("./middleware/plan-limits");

// Mount admin routes BEFORE tenant middleware — admin endpoints use master.db directly
const registerAdminRoutes = require("./routes/admin");
registerAdminRoutes(app, { authLimiter });

const { processPendingShopifyInventoryEvents, processPendingReportSchedules } =
  registerAllRoutes(app, {
    db: IS_MULTI_TENANT ? dbProxy : db,
    fs,
    path,
    invalidateFeatureFlagCache,
    multer,
    requirePerm,
    requireAnyPerm,
    requireFeature,
    requirePlanLimit,
    requireActiveSubscription,
    createNotification,
    notifyLowStockForSale,
    loadEmployeePerms,
    loadTenantAndPerms,
    resolveTenant,
    loadCompanyProfile,
    resolveContext,
    requireContextOutlet,
    ensureDefaultRolePermissions,
    PERMISSION_RULES,
    DEFAULT_FEATURE_FLAGS,
    runtimeState,
    authLimiter,
    webhookLimiter,
    PRODUCT_UPLOADS_DIR,
    COMPANY_UPLOADS_DIR,
    UPLOADS_DIR,
    DB_PATH,
    SHOPIFY_MAX_RETRY_ATTEMPTS,
    createTier4Router,
    verifyConnection,
    fetchShopifyLocations,
    adjustShopifyInventory,
    fetchShopifyVariantCatalog,
    fetchShopifyProductsFull,
    fetchInventoryLevel,
    fetchRecentOrders,
    retryDelayMinutesWithJitter,
    evaluateWebhookTimestampWindow,
    isRetryableInventoryEventStatus,
    canApproveReconciliationRequest,
    buildWebhookIdempotencyKey,
    verifyWebhookSignature,
    encryptShopifySecret,
    decryptShopifySecret,
    logShopifyEvent,
  });

// Global error handler — catches unhandled route errors
app.use((err, req, res, _next) => {
  const reqId = req.id || "unknown";
  if (req.log) {
    req.log.error({ err, reqId }, "Unhandled route error");
  } else {
    console.error("Unhandled route error:", err);
  }
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, {
      tags: { tenantSlug: req.tenantSlug, reqId },
      user: { id: req.employee?.id, username: req.employee?.name },
    });
  }
  alerting.recordError({ tenant: req.tenantSlug, message: err.message, reqId }).catch(() => {});
  res.status(err.status || 500).json({ error: err.message || "Internal server error", reqId });
});

function collectRegisteredRoutes(appInstance) {
  const stack = appInstance?.router?.stack || [];
  return stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods || {}).map((method) => ({
        method: method.toUpperCase(),
        path: layer.route.path,
      })),
    );
}

function ensureCriticalRoutesRegistered(appInstance) {
  const required = [
    { method: "POST", path: "/api/products/bulk-import" },
    { method: "POST", path: "/api/products/bulk-delete" },
    { method: "POST", path: "/api/products/bulk-status" },
    { method: "DELETE", path: "/api/integrations/shopify/import/products" },
  ];
  const registered = collectRegisteredRoutes(appInstance);
  const missing = required.filter(
    (target) =>
      !registered.some(
        (route) => route.method === target.method && route.path === target.path,
      ),
  );
  if (missing.length) {
    const summary = missing.map((m) => `${m.method} ${m.path}`).join(", ");
    throw new Error(`Critical route registration failed. Missing: ${summary}.`);
  }
}

ensureCriticalRoutesRegistered(app);

// --- 3.6 Auto DB Backup (daily, 7-copy retention) ---
const BACKUP_DIR = path.resolve(DATA_DIR, "backups");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function runAutoBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(BACKUP_DIR, `sanopos_backup_${ts}.db`);
  try {
    fs.copyFileSync(DB_PATH, dest);
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("sanopos_backup_"))
      .sort();
    if (files.length > 7) {
      files
        .slice(0, files.length - 7)
        .forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    }
    console.log(`[AutoBackup] Saved → ${dest}`);
  } catch (e) {
    console.error("[AutoBackup] Failed:", e.message);
  }
}

// Helper: run a function for each active tenant (or once for single-tenant)
async function forEachActiveTenant(label, fn) {
  if (!IS_MULTI_TENANT || !tenantDbManager) {
    try {
      await fn(db, null);
    } catch (err) {
      console.error(`[${label}]`, err.message);
    }
    return;
  }
  try {
    const masterMod = require("./master-db-pg");
    const { rows: tenants } = await masterMod.query(
      "SELECT id, slug FROM tenants WHERE status = 'active'"
    );
    for (const tenant of tenants) {
      try {
        const tenantDb = await tenantDbManager.getDb(tenant.id);
        await fn(tenantDb, tenant);
      } catch (err) {
        console.error(`[${label}] tenant ${tenant.slug}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[${label}] Error loading tenants:`, err.message);
  }
}

// ─── 3.7 Shopify Sync Queue Cleanup (30-day retention) ───────────────────────
async function cleanupSyncEvents() {
  await forEachActiveTenant("SyncCleanup", async (tenantDb) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { rowCount } = await tenantDb.query(
      "DELETE FROM external_sync_events WHERE created_at < $1 AND status IN ('success', 'failed')",
      [cutoff]
    );
    if (rowCount > 0) console.log(`[SyncCleanup] Deleted ${rowCount} old sync events`);
  });
}

async function cleanupReportScheduleArtifacts() {
  const runsRetentionDays = Math.max(1, Number(process.env.REPORT_RUNS_RETENTION_DAYS || 45));
  const deliveryRetentionDays = Math.max(1, Number(process.env.REPORT_DELIVERY_RETENTION_DAYS || 60));
  const filesRetentionDays = Math.max(1, Number(process.env.REPORT_EXPORT_FILES_RETENTION_DAYS || 30));
  const runsCutoff = new Date(Date.now() - runsRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deliveryCutoff = new Date(Date.now() - deliveryRetentionDays * 24 * 60 * 60 * 1000).toISOString();

  await forEachActiveTenant("ReportCleanup", async (tenantDb) => {
    try {
      const { rowCount: runsDeleted } = await tenantDb.query(
        "DELETE FROM report_schedule_runs WHERE COALESCE(run_finished_at, run_started_at) < $1::timestamptz",
        [runsCutoff]
      );
      if (runsDeleted > 0) console.log(`[ReportCleanup] Deleted ${runsDeleted} old schedule runs`);
    } catch (err) {
      console.error("[ReportCleanup] run cleanup error:", err.message);
    }
    try {
      const { rowCount: deliveryDeleted } = await tenantDb.query(
        "DELETE FROM report_delivery_log WHERE created_at < $1::timestamptz",
        [deliveryCutoff]
      );
      if (deliveryDeleted > 0) console.log(`[ReportCleanup] Deleted ${deliveryDeleted} old delivery logs`);
    } catch (err) {
      console.error("[ReportCleanup] delivery cleanup error:", err.message);
    }
  });

  // File cleanup is global (export files are not tenant-scoped)
  const exportsDir = path.resolve(__dirname, "exports", "reports");
  const filesCutoffMs = Date.now() - filesRetentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(exportsDir)) return;
  let deleted = 0;
  for (const fileName of fs.readdirSync(exportsDir)) {
    const filePath = path.join(exportsDir, fileName);
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) continue;
      if (st.mtimeMs < filesCutoffMs) { fs.unlinkSync(filePath); deleted += 1; }
    } catch (e) {
      console.error("[ReportCleanup] file cleanup error:", e.message);
    }
  }
  if (deleted > 0) console.log(`[ReportCleanup] Deleted ${deleted} old export files`);
}

// F2: Close stale attendance sessions from previous days (runs on boot + daily)
async function closeStaleAttendanceSessions() {
  await forEachActiveTenant("StaleSessionCleanup", async (tenantDb) => {
    await tenantDb.query(
      `UPDATE attendance_sessions
       SET session_end = session_start, session_type = 'auto_closed'
       WHERE session_end IS NULL AND session_start::date < CURRENT_DATE`
    );
  });
}

// Auto backup only runs in SQLite mode (Postgres uses pg_dump/Supabase backups)
if (!process.env.DATABASE_URL) {
  runAutoBackup();
  setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
}
cleanupSyncEvents().catch(e => console.error("[SyncCleanup]", e.message));
cleanupReportScheduleArtifacts().catch(e => console.error("[ReportCleanup]", e.message));
setInterval(() => cleanupSyncEvents().catch(e => console.error("[SyncCleanup]", e.message)), 24 * 60 * 60 * 1000);
setInterval(() => cleanupReportScheduleArtifacts().catch(e => console.error("[ReportCleanup]", e.message)), 24 * 60 * 60 * 1000);
closeStaleAttendanceSessions().catch(e => console.error("Stale session cleanup error:", e.message));
setInterval(() => closeStaleAttendanceSessions().catch(e => console.error("Stale session cleanup error:", e.message)), 24 * 60 * 60 * 1000);

// Dead tenant cleanup — remove tenants that signed up but never completed setup after 7 days
if (IS_MULTI_TENANT) {
  const { cleanupDeadTenants } = require("./jobs/cleanup-dead-tenants");
  cleanupDeadTenants().catch(e => console.error("[DeadTenantCleanup]", e.message));
  setInterval(() => cleanupDeadTenants().catch(e => console.error("[DeadTenantCleanup]", e.message)), 24 * 60 * 60 * 1000);
}

// Health check is now registered early in registerAllRoutes.js (before auth middleware)


// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const SHOPIFY_WORKER_DISABLED =
  String(process.env.SHOPIFY_SYNC_WORKER_DISABLED || "0") === "1";
if (!SHOPIFY_WORKER_DISABLED) {
  setInterval(async () => {
    if (!IS_MULTI_TENANT || !tenantDbManager) {
      processPendingShopifyInventoryEvents(20, () => {});
      return;
    }
    try {
      const masterMod = require("./master-db-pg");
      const { rows: tenants } = await masterMod.query("SELECT id, slug FROM tenants WHERE status = 'active'");
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          await asyncStore.run({ db: tenantDb }, async () => {
            await processPendingShopifyInventoryEvents(20, () => {});
          });
        } catch (err) {
          console.error(`[ShopifyWorker] tenant ${tenant.slug}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[ShopifyWorker] Error loading tenants:", err.message);
    }
  }, 30000);
}

const REPORT_SCHEDULE_WORKER_DISABLED =
  String(process.env.REPORT_SCHEDULE_WORKER_DISABLED || "0") === "1";
if (!REPORT_SCHEDULE_WORKER_DISABLED) {
  setInterval(async () => {
    if (!IS_MULTI_TENANT || !tenantDbManager) {
      processPendingReportSchedules(5, () => {});
      return;
    }
    try {
      const masterMod = require("./master-db-pg");
      const { rows: tenants } = await masterMod.query("SELECT id, slug FROM tenants WHERE status = 'active'");
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          await asyncStore.run({ db: tenantDb }, async () => {
            await processPendingReportSchedules(5, () => {});
          });
        } catch (err) {
          console.error(`[ReportScheduler] tenant ${tenant.slug}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[ReportScheduler] Error loading tenants:", err.message);
    }
  }, 60000);
}

// FBR Worker — inline mode (runs in same process as Express)
if (String(process.env.FBR_WORKER_ENABLED || "0") === "1") {
  const { startFbrWorker } = require("./workers/fbr-worker");
  startFbrWorker(db);
}

// Email Worker — processes email_queue + daily billing checks
if (String(process.env.EMAIL_WORKER_ENABLED || "0") === "1") {
  const { startEmailWorker } = require("./workers/email-worker");
  startEmailWorker(db);
}
