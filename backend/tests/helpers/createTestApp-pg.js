/**
 * createTestApp-pg.js — Creates a fully wired Express app with an isolated Postgres schema.
 *
 * Usage:
 *   const { createTestApp, closeTestApp } = require('./createTestApp-pg');
 *   const { app, db, cleanup } = await createTestApp();
 *   // Use supertest(app) to make requests
 *   // db.query(sql, params) for direct queries/assertions
 *   // cleanup() drops the test schema and releases the client
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const pool = require("../../db-pg");
const { seedSchema } = require("./seedSchema-pg");

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
  context_selection_required: false,
  context_header_enforced: false,
  kiosk_context_locked: false,
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

/**
 * Create a scoped DB proxy that runs all queries within a specific schema.
 * The proxy holds a dedicated client from the pool with search_path set.
 */
function createScopedDb(client) {
  // Wrap client with a no-op release() so route code that calls
  // db.getClient() + client.release() doesn't actually release
  // the test schema's dedicated client back to the pool.
  const safeClient = new Proxy(client, {
    get(target, prop) {
      if (prop === "release") return () => {};
      return target[prop];
    },
  });
  return {
    query: (sql, params) => client.query(sql, params),
    transaction: async (fn) => {
      await client.query("BEGIN");
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    },
    getClient: () => Promise.resolve(safeClient),
  };
}

function loadEmployeePerms(db) {
  return async (req, res, next) => {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) {
      req.employeePerms = [];
      return next();
    }
    try {
      const { rows: empRows } = await db.query(
        "SELECT role_id FROM employees WHERE id = $1", [employeeId]
      );
      if (!empRows.length) {
        req.employeePerms = [];
        return next();
      }
      const { rows: permRows } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1", [empRows[0].role_id]
      );
      req.employeePerms = permRows.map((r) => r.permission);
      next();
    } catch {
      req.employeePerms = [];
      next();
    }
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

function requireFeature(db) {
  return (flagKey) => {
    return async (req, res, next) => {
      try {
        const { rows } = await db.query("SELECT key, enabled FROM feature_flags");
        const merged = { ...DEFAULT_FEATURE_FLAGS };
        for (const row of rows || []) {
          merged[row.key] = row.enabled === true || Number(row.enabled) === 1;
        }
        if (!merged[flagKey]) {
          return res.status(503).json({ error: `Feature disabled: ${flagKey}`, flag: flagKey });
        }
        next();
      } catch {
        next();
      }
    };
  };
}

function createNotification() {}
function notifyLowStockForSale() {}
function ensureDefaultRolePermissions() {}

/**
 * Seed standard test fixtures into a Postgres schema.
 * Mirrors seedData.js but uses $1/$2 params and Postgres types.
 */
async function seedData(db) {
  // Company
  await db.query(
    `INSERT INTO companies (id, name, code, is_active) VALUES (1, 'Test Company', 'TEST', true)`
  );

  // Outlets
  await db.query(
    `INSERT INTO outlets (id, name, address, phone) VALUES (1, 'Main Store', '123 Main St', '111-1111')`
  );
  await db.query(
    `INSERT INTO outlets (id, name, address, phone) VALUES (2, 'Branch Store', '456 Branch Ave', '222-2222')`
  );

  // Roles
  await db.query(`INSERT INTO roles (id, name, description) VALUES (1, 'Administrator', 'Full access')`);
  await db.query(`INSERT INTO roles (id, name, description) VALUES (2, 'Manager', 'Store manager')`);
  await db.query(`INSERT INTO roles (id, name, description) VALUES (3, 'Cashier', 'POS operator')`);

  // Role permissions
  await db.query(`INSERT INTO role_permissions (role_id, permission) VALUES (1, 'all_access')`);
  for (const perm of [
    "manage_inventory", "manage_orders", "view_reports", "manage_employees",
    "pos_discount", "void_sales", "pos_park", "pos_void",
  ]) {
    await db.query(`INSERT INTO role_permissions (role_id, permission) VALUES (2, $1)`, [perm]);
  }
  for (const perm of ["view_reports", "pos_discount", "pos_park"]) {
    await db.query(`INSERT INTO role_permissions (role_id, permission) VALUES (3, $1)`, [perm]);
  }

  // Employees
  await db.query(
    `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary)
     VALUES (1, 'Hassan', 'Administrator', '2580', 1, 50000)`
  );
  await db.query(
    `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary)
     VALUES (2, 'Manager User', 'Manager', '2222', 2, 40000)`
  );
  await db.query(
    `INSERT INTO employees (id, name, role, pin_code, role_id, monthly_salary)
     VALUES (3, 'Cashier User', 'Cashier', '3333', 3, 25000)`
  );

  // Hash PINs
  const bcrypt = require("bcryptjs");
  const { rows: empRows } = await db.query(
    "SELECT id, pin_code FROM employees WHERE pin_code IS NOT NULL"
  );
  for (const row of empRows) {
    const hash = await bcrypt.hash(String(row.pin_code), 4);
    await db.query("UPDATE employees SET pin_hash = $1 WHERE id = $2", [hash, row.id]);
  }

  // Employee outlet assignments
  for (const empId of [1, 2, 3]) {
    await db.query(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES ($1, 1, true)`, [empId]);
  }
  await db.query(`INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (1, 2, false)`);

  // Category, Tax, Brand
  await db.query(`INSERT INTO categories (id, name, description) VALUES (1, 'Electronics', 'Electronic items')`);
  await db.query(`INSERT INTO categories (id, name, description) VALUES (2, 'Groceries', 'Food and grocery items')`);
  await db.query(`INSERT INTO taxes (id, name, rate, is_default) VALUES (1, 'GST 17%', 17, true)`);
  await db.query(`INSERT INTO brands (id, name, description) VALUES (1, 'TestBrand', 'Test brand')`);

  // Suppliers
  await db.query(
    `INSERT INTO suppliers (id, name, contact_person, phone) VALUES (1, 'Supplier A', 'John', '333-3333')`
  );
  await db.query(
    `INSERT INTO suppliers (id, name, contact_person, phone) VALUES (2, 'Supplier B', 'Jane', '444-4444')`
  );

  // Products
  const products = [
    [1, "PROD-001", "Widget A", 100, 50, 60, 17, 1, 1, 1, 1],
    [2, "PROD-002", "Widget B", 200, 30, 120, 17, 1, 1, 1, 1],
    [3, "PROD-003", "Gadget C", 500, 20, 300, 17, 1, 1, 1, 2],
    [4, "PROD-004", "Snack D", 50, 100, 30, 0, 2, null, null, null],
    [5, "PROD-005", "Drink E", 75, 80, 45, 0, 2, null, null, null],
  ];
  for (const [id, barcode, name, price, stock, cost_price, gst, cat_id, tax_id, brand_id, supplier_id] of products) {
    await db.query(
      `INSERT INTO products (id, barcode, name, price, stock, cost_price, gst, category_id, tax_id, brand_id, supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, barcode, name, price, stock, cost_price, gst, cat_id, tax_id, brand_id, supplier_id]
    );
  }

  // Outlet stock
  for (const [prodId, qty] of [[1, 50], [2, 30], [3, 20], [4, 100], [5, 80]]) {
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, 1, $2)`,
      [prodId, qty]
    );
  }
  await db.query(`INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 2, 10)`);
  await db.query(`INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (2, 2, 5)`);

  // Customer with wallet
  await db.query(
    `INSERT INTO customers (id, name, mobile, email, loyalty_points, balance)
     VALUES (1, 'Test Customer', '555-5555', 'test@example.com', 100, 500.00)`
  );

  // Feature flags
  for (const [key, enabled] of Object.entries(DEFAULT_FEATURE_FLAGS)) {
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)`,
      [key, enabled ? 1 : 0]
    );
  }

  // Company profile (ON CONFLICT because schema-pg.sql seeds this row)
  await db.query(
    `INSERT INTO company_profile (id, company_name) VALUES (1, 'Test Store') ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name`
  );

  // Reset sequences to avoid id conflicts after explicit id inserts
  for (const [table, maxId] of [
    ["outlets", 2], ["roles", 3], ["employees", 3], ["categories", 2],
    ["taxes", 1], ["brands", 1], ["suppliers", 2], ["products", 5], ["customers", 1],
  ]) {
    await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, true)`, [table, maxId]);
  }
}

async function createTestApp(options = {}) {
  const schemaName = "test_" + crypto.randomBytes(6).toString("hex");

  // Get a dedicated client for this test schema
  const client = await pool.getClient();
  await client.query(`CREATE SCHEMA ${schemaName}`);
  await client.query(`SET search_path = '${schemaName}'`);

  // Run DDL
  await seedSchema(client);

  // Build scoped db proxy
  const db = createScopedDb(client);

  // Seed data unless opted out
  if (options.seed !== false) {
    await seedData(db);
  }

  const app = express();
  app.use(express.json({ limit: "10mb" }));

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
    requirePerm,
    requireAnyPerm,
    requireFeature: requireFeature(db),
    createNotification,
    notifyLowStockForSale,
    loadEmployeePerms: loadEmployeePerms(db),
    loadCompanyProfile: (req, res, next) => {
      req.company = { timezone: "UTC" };
      next();
    },
    resolveContext: (req, res, next) => {
      req.context = { companyId: null, outletId: null, scopeMode: null };
      next();
    },
    requireContextOutlet: (req, res, next) => next(),
    ensureDefaultRolePermissions,
    PERMISSION_RULES,
    DEFAULT_FEATURE_FLAGS,
    runtimeState,
    requirePlanLimit: () => (req, res, next) => next(),
    requireActiveSubscription: (req, res, next) => next(),
    authLimiter: noopLimiter,
    webhookLimiter: noopLimiter,
    PRODUCT_UPLOADS_DIR: prodUploadsDir,
    COMPANY_UPLOADS_DIR: companyUploadsDir,
    UPLOADS_DIR: tmpDir,
    SHOPIFY_MAX_RETRY_ATTEMPTS: 3,
    ...shopifyStubs,
    ...shopifyUtilStubs,
  };

  // Wire middleware chain (mirrors registerAllRoutes.js lines 55-140)
  app.use(deps.loadEmployeePerms);
  app.use(deps.loadCompanyProfile);
  app.use(deps.resolveContext);
  app.use(deps.requireContextOutlet);

  // Permission rules middleware
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const rule = PERMISSION_RULES.find(
      (r) => r.methods.includes(req.method) && r.path.test(req.path)
    );
    if (!rule) return next();
    const perms = req.employeePerms || [];
    const allowed =
      perms.includes("all_access") ||
      (rule.anyPerms || []).some((p) => perms.includes(p));
    if (!allowed) {
      return res.status(403).json({ error: "Forbidden: insufficient permissions" });
    }
    return next();
  });

  // Restore lock middleware
  app.use((req, res, next) => {
    if (runtimeState.isRestoreInProgress && req.method !== "GET" && req.method !== "OPTIONS") {
      return res.status(503).json({ error: "Service temporarily unavailable: database restore in progress" });
    }
    next();
  });

  const cleanup = async () => {
    try {
      await client.query(`SET search_path = 'public'`);
      await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    } finally {
      client.release();
    }
  };

  return { app, db, deps, runtimeState, cleanup, schemaName };
}

module.exports = { createTestApp, DEFAULT_FEATURE_FLAGS, PERMISSION_RULES };
