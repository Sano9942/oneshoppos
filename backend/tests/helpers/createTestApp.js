/**
 * createTestApp.js — Creates a fully wired Express app with an in-memory SQLite DB.
 *
 * Usage:
 *   const { createTestApp } = require('./createTestApp');
 *   const { app, db } = await createTestApp();
 *   // Use supertest(app) to make requests
 *   // db is the raw sqlite3.Database instance for direct queries/assertions
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const rateLimit = require("express-rate-limit");
const { seedSchema } = require("./seedSchema");
const { seedData } = require("./seedData");

// Stubs for Shopify functions (not tested here)
const shopifyStubs = {
  verifyConnection: () => Promise.resolve({ shop: "test.myshopify.com" }),
  fetchShopifyLocations: () => Promise.resolve([]),
  adjustShopifyInventory: () => Promise.resolve({}),
  fetchShopifyVariantCatalog: () => Promise.resolve([]),
  fetchShopifyProductsFull: () => Promise.resolve([]),
  fetchInventoryLevel: () => Promise.resolve(null),
  fetchInventoryLevelsBatch: () => Promise.resolve([]),
  fetchRecentOrders: () => Promise.resolve([]),
};

// Stubs for Shopify utils
const shopifyUtilStubs = {
  retryDelayMinutesWithJitter: () => 1,
  evaluateWebhookTimestampWindow: () => ({ withinWindow: true }),
  isRetryableInventoryEventStatus: () => false,
  canApproveReconciliationRequest: () => true,
  buildWebhookIdempotencyKey: () => "test-key",
  verifyWebhookSignature: () => true,
  encryptShopifySecret: (v) => v,
  decryptShopifySecret: (v) => v,
  logShopifyEvent: () => {},
};

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
  reports_profit_layer: false,
  reports_inventory_health_plus: false,
  reports_exceptions: false,
  reports_scheduled_exports: false,
};

const PERMISSION_RULES = [
  { methods: ["GET"], path: /^\/api\/reports(\/|$)/, anyPerms: ["view_reports", "manage_employees"] },
  { methods: ["GET"], path: /^\/api\/attendance(\/|$)/, anyPerms: ["view_reports", "manage_employees"] },
  { methods: ["PUT"], path: /^\/api\/attendance\/\d+$/, anyPerms: ["manage_employees"] },
  { methods: ["GET", "PUT"], path: /^\/api\/employees\/\d+\/attendance-config$/, anyPerms: ["manage_employees"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/categories(\/\d+)?$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/brands(\/\d+)?$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/products(\/\d+)?$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST"], path: /^\/api\/products\/bulk-import$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/attribute-sets(\/\d+)?$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/barcode-templates(\/\d+)?$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST"], path: /^\/api\/barcode-print-jobs$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST", "PUT"], path: /^\/api\/expenses(\/\d+)?$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/expense-categories(\/\d+)?$/, anyPerms: ["manage_inventory"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/outlets(\/\d+)?$/, anyPerms: ["manage_employees"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/receipt-templates(\/\d+)?$/, anyPerms: ["manage_employees"] },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/suppliers(\/\d+)?$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/supplier-returns$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/supplier-invoices\/\d+\/pay$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/returns$/, anyPerms: ["manage_orders"] },
  { methods: ["GET"], path: /^\/api\/approvals$/, anyPerms: ["manage_orders", "manage_employees"] },
  { methods: ["POST"], path: /^\/api\/purchase-orders\/\d+\/submit$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/purchase-orders\/\d+\/approve$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/transfers\/\d+\/submit$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/transfers\/\d+\/approve$/, anyPerms: ["manage_orders"] },
  { methods: ["POST", "DELETE"], path: /^\/api\/parked-sales(\/\d+)?$/, anyPerms: ["pos_park"] },
];

function createDb() {
  return new sqlite3.Database(":memory:");
}

function loadEmployeePerms(db) {
  return (req, res, next) => {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) {
      req.employeePerms = [];
      return next();
    }
    db.get("SELECT role_id FROM employees WHERE id = ?", [employeeId], (err, emp) => {
      if (err || !emp) {
        req.employeePerms = [];
        return next();
      }
      db.all("SELECT permission FROM role_permissions WHERE role_id = ?", [emp.role_id], (err2, rows) => {
        req.employeePerms = err2 ? [] : rows.map((r) => r.permission);
        next();
      });
    });
  };
}

function requirePerm(permission) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    if (perms.includes("all_access") || perms.includes(permission)) return next();
    return res.status(403).json({ error: "Forbidden: insufficient permissions" });
  };
}

function requireAnyPerm(permissions) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    if (perms.includes("all_access") || permissions.some((p) => perms.includes(p))) return next();
    return res.status(403).json({ error: "Forbidden: insufficient permissions" });
  };
}

function getFeatureFlagsMap(db, cb) {
  db.all("SELECT key, enabled FROM feature_flags", [], (err, rows) => {
    if (err) {
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

function requireFeature(db) {
  return (flagKey) => {
    return (req, res, next) => {
      getFeatureFlagsMap(db, (err, flags) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!flags[flagKey]) {
          return res.status(503).json({ error: `Feature disabled: ${flagKey}`, flag: flagKey });
        }
        next();
      });
    };
  };
}

function createNotification() {}
function notifyLowStockForSale() {}
function ensureDefaultRolePermissions() {}

const createTier4Router = require("../../routes/tier4");
const registerAllRoutes = require("../../routes/registerAllRoutes");

async function createTestApp(options = {}) {
  const db = options.db || createDb();
  await seedSchema(db);
  if (options.seed !== false) {
    await seedData(db);
  }

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // No rate limiters in tests (or very high limits)
  const noopLimiter = (req, res, next) => next();

  const tmpDir = path.resolve(__dirname, "../../uploads_test");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const prodUploadsDir = path.resolve(tmpDir, "products");
  if (!fs.existsSync(prodUploadsDir)) fs.mkdirSync(prodUploadsDir, { recursive: true });
  const companyUploadsDir = path.resolve(tmpDir, "company");
  if (!fs.existsSync(companyUploadsDir)) fs.mkdirSync(companyUploadsDir, { recursive: true });

  const runtimeState = { isRestoreInProgress: false };

  const deps = {
    db,
    fs,
    path,
    multer,
    sqlite3,
    requirePerm,
    requireAnyPerm,
    requireFeature: requireFeature(db),
    createNotification,
    notifyLowStockForSale,
    loadEmployeePerms: loadEmployeePerms(db),
    // Context Unification stubs: bypass enforcement in integration tests.
    // Tests that specifically need context enforcement should set req.context manually.
    resolveContext: (req, res, next) => {
      req.context = { companyId: null, outletId: null, scopeMode: null };
      next();
    },
    requireContextOutlet: (req, res, next) => next(),
    ensureDefaultRolePermissions,
    PERMISSION_RULES,
    DEFAULT_FEATURE_FLAGS,
    runtimeState,
    authLimiter: noopLimiter,
    webhookLimiter: noopLimiter,
    PRODUCT_UPLOADS_DIR: prodUploadsDir,
    COMPANY_UPLOADS_DIR: companyUploadsDir,
    UPLOADS_DIR: tmpDir,
    DB_PATH: ":memory:",
    SHOPIFY_MAX_RETRY_ATTEMPTS: 3,
    createTier4Router,
    ...shopifyStubs,
    ...shopifyUtilStubs,
  };

  registerAllRoutes(app, deps);

  return { app, db, deps, runtimeState };
}

// Helper to close db
function closeDb(db) {
  return new Promise((resolve) => {
    db.close(() => resolve());
  });
}

// Helper to query db
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

module.exports = { createTestApp, closeDb, createDb, dbAll, dbGet, dbRun };
