const express = require("express");
const cors = require("cors");
const db = require("./db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const sqlite3 = require("sqlite3").verbose();
const createTier4Router = require("./routes/tier4");
const registerAllRoutes = require("./routes/registerAllRoutes");
const {
  verifyConnection,
  fetchShopifyLocations,
  adjustShopifyInventory,
  fetchShopifyVariantCatalog,
  fetchShopifyProductsFull,
  fetchInventoryLevel,
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
const PORT = process.env.PORT || 5000;
const SHOPIFY_SECRET_ENC_PREFIX = "enc:v1";
const SHOPIFY_MAX_RETRY_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.SHOPIFY_MAX_RETRY_ATTEMPTS || "5", 10),
);
const DB_PATH = path.resolve(__dirname, "oneshop.db");
const UPLOADS_DIR = path.resolve(__dirname, "uploads");
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

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: (req) => isPosBurstPath(req.path || ""),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_WEBHOOK_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
});

// Middleware
app.use(cors());
app.use(
  express.json({
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
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(globalLimiter);

// --- PERMISSION MIDDLEWARE SCAFFOLD ---
// Reads optional x-employee-id header, attaches permissions to req.
// Routes can call requirePerm(perm) to enforce access. No behavior change
// on routes that don't use it — existing flows are untouched.

function loadEmployeePerms(req, res, next) {
  const employeeId = req.headers["x-employee-id"];
  if (!employeeId) {
    req.employeePerms = [];
    return next();
  }
  db.get(
    "SELECT role_id FROM employees WHERE id = ?",
    [employeeId],
    (err, emp) => {
      if (err || !emp) {
        req.employeePerms = [];
        return next();
      }
      db.all(
        "SELECT permission FROM role_permissions WHERE role_id = ?",
        [emp.role_id],
        (err2, rows) => {
          req.employeePerms = err2 ? [] : rows.map((r) => r.permission);
          next();
        },
      );
    },
  );
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

function ensureDefaultRolePermissions() {
  db.all("SELECT id, name FROM roles", [], (err, roles) => {
    if (err || !roles || roles.length === 0) return;
    const roleIdByName = {};
    roles.forEach((r) => {
      roleIdByName[r.name] = r.id;
    });

    db.serialize(() => {
      Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([roleName, perms]) => {
        const roleId = roleIdByName[roleName];
        if (!roleId) return;
        perms.forEach((perm) => {
          db.run(
            "INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)",
            [roleId, perm],
          );
        });
      });
    });
  });
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
};

function getFeatureFlagsMap(cb) {
  db.all("SELECT key, enabled FROM feature_flags", [], (err, rows) => {
    if (err) {
      // Keep legacy behavior if flags table isn't present yet.
      if (String(err.message || "").includes("no such table")) {
        return cb(null, { ...DEFAULT_FEATURE_FLAGS });
      }
      return cb(err);
    }

    const merged = { ...DEFAULT_FEATURE_FLAGS };
    for (const row of rows || []) {
      merged[row.key] = Number(row.enabled || 0) === 1;
    }
    cb(null, merged);
  });
}

function isFeatureEnabled(flagKey, cb) {
  getFeatureFlagsMap((err, flags) => {
    if (err) return cb(err);
    cb(null, Boolean(flags?.[flagKey]));
  });
}

function requireFeature(flagKey) {
  return (req, res, next) => {
    isFeatureEnabled(flagKey, (err, enabled) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!enabled) {
        return res.status(503).json({
          error: `Feature disabled: ${flagKey}`,
          flag: flagKey,
        });
      }
      next();
    });
  };
}

function createNotification(type, title, message, link) {
  db.run(
    "INSERT INTO notifications (type, title, message, link) VALUES (?, ?, ?, ?)",
    [type, title, message, link || null],
    () => {},
  );
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
  const placeholders = productIds.map(() => "?").join(",");
  db.all(
    `SELECT os.product_id, os.quantity, p.name
     FROM outlet_stock os
     JOIN products p ON p.id = os.product_id
     WHERE os.outlet_id = ? AND os.product_id IN (${placeholders}) AND COALESCE(os.quantity, 0) <= 10`,
    [outletId, ...productIds],
    (err, rows) => {
      if (err || !rows) return;
      rows.forEach((row) => {
        createNotification(
          "low_stock",
          "Low Stock Alert",
          `${row.name} has ${row.quantity} units left`,
          "/inventory",
        );
      });
    },
  );
}

const runtimeState = { isRestoreInProgress: false };

const { processPendingShopifyInventoryEvents } = registerAllRoutes(app, {
  db,
  fs,
  path,
  multer,
  sqlite3,
  requirePerm,
  requireAnyPerm,
  requireFeature,
  createNotification,
  notifyLowStockForSale,
  loadEmployeePerms,
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
        (route) =>
          route.method === target.method && route.path === target.path,
      ),
  );
  if (missing.length) {
    const summary = missing.map((m) => `${m.method} ${m.path}`).join(", ");
    throw new Error(
      `Critical route registration failed. Missing: ${summary}.`,
    );
  }
}

ensureCriticalRoutesRegistered(app);

// --- 3.6 Auto DB Backup (daily, 7-copy retention) ---
const BACKUP_DIR = path.resolve(__dirname, "backups");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function runAutoBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(BACKUP_DIR, `oneshop_backup_${ts}.db`);
  try {
    fs.copyFileSync(DB_PATH, dest);
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("oneshop_backup_"))
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

// ─── 3.7 Shopify Sync Queue Cleanup (30-day retention) ───────────────────────
function cleanupSyncEvents() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  db.run(
    "DELETE FROM external_sync_events WHERE created_at < ? AND status IN ('success', 'failed')",
    [cutoff],
    function (err) {
      if (err) console.error("[SyncCleanup] Error:", err.message);
      else if (this.changes > 0)
        console.log(`[SyncCleanup] Deleted ${this.changes} old sync events`);
    },
  );
}

runAutoBackup();
cleanupSyncEvents();
setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
setInterval(cleanupSyncEvents, 24 * 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const SHOPIFY_WORKER_DISABLED =
  String(process.env.SHOPIFY_SYNC_WORKER_DISABLED || "0") === "1";
if (!SHOPIFY_WORKER_DISABLED) {
  setInterval(() => {
    processPendingShopifyInventoryEvents(20, () => {});
  }, 30000);
}
