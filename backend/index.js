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
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const db = require("./db-pg");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const requestId = require("./middleware/request-id");
const alerting = require("./services/alerting");
const registerAllRoutes = require("./routes/registerAllRoutes");

// Extracted modules
const { globalLimiter, authLimiter, webhookLimiter } = require("./middleware/rate-limit");
const tenantAuth = require("./middleware/tenant-auth");
const { requirePerm, requireAnyPerm, requireContextOutlet, PERMISSION_RULES, DEFAULT_ROLE_PERMISSIONS, ensureDefaultRolePermissions } = require("./middleware/permissions");
const featureFlags = require("./middleware/feature-flags");
const { encryptShopifySecret, decryptShopifySecret, logShopifyEvent } = require("./shopify/crypto");
const { startAll: startWorkers } = require("./boot/workers");

// Shopify client + utils
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

// ─── Multi-tenant init ──────────────────────────────────────────────────────
const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";
let asyncStore, createDbProxy, dbProxy, tenantDbManager;
if (IS_MULTI_TENANT) {
  const proxyMod = require("./tenant-db-proxy-pg");
  asyncStore = proxyMod.asyncStore;
  createDbProxy = proxyMod.createDbProxy;
  dbProxy = createDbProxy();
  tenantDbManager = require("./tenant-db-manager-pg");
  tenantDbManager.init(db);
  const masterDbPgBoot = require("./master-db-pg");
  masterDbPgBoot.init(db);
}

// Initialize extracted modules with shared deps
const mtDeps = { db, IS_MULTI_TENANT, dbProxy, tenantDbManager, asyncStore };
tenantAuth.init(mtDeps);
featureFlags.init(mtDeps);

// ─── Express app + middleware chain ─────────────────────────────────────────
const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
const PORT = process.env.PORT || 5000;
const SHOPIFY_MAX_RETRY_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.SHOPIFY_MAX_RETRY_ATTEMPTS || "5", 10),
);
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.resolve(DATA_DIR, "sanopos.db");
const UPLOADS_DIR = path.resolve(DATA_DIR, "uploads");
const PRODUCT_UPLOADS_DIR = path.resolve(UPLOADS_DIR, "products");
const COMPANY_UPLOADS_DIR = path.resolve(UPLOADS_DIR, "company");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PRODUCT_UPLOADS_DIR))
  fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(COMPANY_UPLOADS_DIR))
  fs.mkdirSync(COMPANY_UPLOADS_DIR, { recursive: true });

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
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
        (req.originalUrl.includes("/api/integrations/shopify/webhooks/") ||
         req.originalUrl.startsWith("/api/webhooks/"))
      ) {
        req.rawBody = buf.toString("utf8");
      }
    },
  }),
);
// Catch malformed JSON bodies (bots/scanners) — return 400 instead of bubbling to Sentry
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  next(err);
});
// Single-tenant static file serving (fallback for MT mode when no tenant context)
app.use("/uploads", express.static(UPLOADS_DIR));

// R2 proxy — serves /r2/<key> by streaming from Cloudflare R2
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
app.use(compression());
app.use(cookieParser());
app.use(globalLimiter);
app.use(requestId);

// ─── Route registration ─────────────────────────────────────────────────────
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
    invalidateFeatureFlagCache: featureFlags.invalidateFeatureFlagCache,
    multer,
    requirePerm,
    requireAnyPerm,
    requireFeature: featureFlags.requireFeature,
    requirePlanLimit,
    requireActiveSubscription,
    createNotification: featureFlags.createNotification,
    notifyLowStockForSale: featureFlags.notifyLowStockForSale,
    loadEmployeePerms: tenantAuth.loadEmployeePerms,
    loadTenantAndPerms: tenantAuth.loadTenantAndPerms,
    resolveTenant: tenantAuth.resolveTenant,
    loadCompanyProfile: tenantAuth.loadCompanyProfile,
    resolveContext: tenantAuth.resolveContext,
    requireContextOutlet,
    ensureDefaultRolePermissions,
    PERMISSION_RULES,
    DEFAULT_FEATURE_FLAGS: featureFlags.DEFAULT_FEATURE_FLAGS,
    runtimeState,
    authLimiter,
    webhookLimiter,
    PRODUCT_UPLOADS_DIR,
    COMPANY_UPLOADS_DIR,
    UPLOADS_DIR,
    DB_PATH,
    SHOPIFY_MAX_RETRY_ATTEMPTS,
    verifyConnection,
    fetchShopifyLocations,
    adjustShopifyInventory,
    fetchShopifyVariantCatalog,
    fetchShopifyProductsFull,
    fetchInventoryLevel,
    fetchInventoryLevelsBatch,
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

// ─── Global error handler ───────────────────────────────────────────────────
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

// ─── Critical route verification ────────────────────────────────────────────
function ensureCriticalRoutesRegistered(appInstance) {
  const required = [
    { method: "POST", path: "/api/products/bulk-import" },
    { method: "POST", path: "/api/products/bulk-delete" },
    { method: "POST", path: "/api/products/bulk-status" },
    { method: "DELETE", path: "/api/integrations/shopify/import/products" },
  ];
  const stack = appInstance?.router?.stack || [];
  const registered = stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods || {}).map((method) => ({
        method: method.toUpperCase(),
        path: layer.route.path,
      })),
    );
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

// ─── Startup assertions ────────────────────────────────────────────────────
if (!process.env.ADMIN_ALLOWED_IPS) {
  const msg = "ADMIN_ALLOWED_IPS is not set — super-admin routes (impersonation, backups, tenant management) are accessible from ANY IP";
  if (process.env.NODE_ENV === "production") {
    console.error(`[SECURITY] ${msg}`);
  } else {
    console.warn(`[SECURITY] ${msg}`);
  }
}

// ─── Start server + workers ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

startWorkers({
  db,
  IS_MULTI_TENANT,
  tenantDbManager,
  asyncStore,
  DATA_DIR,
  DB_PATH,
  processPendingShopifyInventoryEvents,
  processPendingReportSchedules,
});
