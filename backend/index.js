const express = require("express");
const cors = require("cors");
const db = require("./db");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const {
  verifyConnection,
  fetchShopifyLocations,
  adjustShopifyInventory,
  fetchShopifyVariantCatalog,
  fetchInventoryLevel,
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
const SHOPIFY_MAX_RETRY_ATTEMPTS = Math.max(1, parseInt(process.env.SHOPIFY_MAX_RETRY_ATTEMPTS || "5", 10));
const DB_PATH = path.resolve(__dirname, "oneshop.db");
const UPLOADS_DIR = path.resolve(__dirname, "uploads");
const PRODUCT_UPLOADS_DIR = path.resolve(UPLOADS_DIR, "products");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PRODUCT_UPLOADS_DIR)) fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });

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
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SHOPIFY_SECRET_ENC_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptShopifySecret(storedText) {
  const stored = String(storedText || "");
  if (!stored) return "";
  if (!stored.startsWith(`${SHOPIFY_SECRET_ENC_PREFIX}:`)) return stored;
  const key = getShopifySecretKeyBuffer();
  if (!key) {
    throw new Error("SHOPIFY_SECRET_KEY is required to decrypt Shopify secrets");
  }
  const parts = stored.split(":");
  if (parts.length !== 5) throw new Error("Invalid encrypted Shopify secret format");
  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const encrypted = Buffer.from(parts[4], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

function logShopifyEvent(level, event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    area: "shopify_connector",
    event,
    ...details,
  };
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  logger(JSON.stringify(payload));
}

// Middleware
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.includes("/api/integrations/shopify/webhooks/")) {
      req.rawBody = buf.toString("utf8");
    }
  },
})); // Parse JSON bodies
app.use("/uploads", express.static(UPLOADS_DIR));

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
        }
      );
    }
  );
}

function requirePerm(permission) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    if (perms.includes("all_access") || perms.includes(permission)) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden: insufficient permissions" });
  };
}

function requireAnyPerm(permissions) {
  return (req, res, next) => {
    const perms = req.employeePerms || [];
    const allowed =
      perms.includes("all_access") ||
      permissions.some((p) => perms.includes(p));
    if (allowed) return next();
    return res.status(403).json({ error: "Forbidden: insufficient permissions" });
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
  { methods: ["GET"], path: /^\/api\/attendance(\/|$)/, anyPerms: ["view_reports", "manage_employees"] },

  // Setup/config mutation
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

  // Orders/procurement mutation
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/suppliers(\/\d+)?$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/supplier-returns$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/supplier-invoices\/\d+\/pay$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/returns$/, anyPerms: ["manage_orders"] },

  // Approval workflow
  { methods: ["GET"], path: /^\/api\/approvals$/, anyPerms: ["manage_orders", "manage_employees"] },
  { methods: ["POST"], path: /^\/api\/purchase-orders\/\d+\/submit$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/purchase-orders\/\d+\/approve$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/transfers\/\d+\/submit$/, anyPerms: ["manage_orders"] },
  { methods: ["POST"], path: /^\/api\/transfers\/\d+\/approve$/, anyPerms: ["manage_orders"] },

  // POS-specific restricted flows
  { methods: ["POST", "DELETE"], path: /^\/api\/parked-sales(\/\d+)?$/, anyPerms: ["pos_park"] },
];

const DEFAULT_FEATURE_FLAGS = {
  backup_restore: true,
  e_invoicing_export: true,
  supplier_payables: true,
  approvals: true,
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

app.use(loadEmployeePerms);
ensureDefaultRolePermissions();

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  const rule = PERMISSION_RULES.find(
    (r) => r.methods.includes(req.method) && r.path.test(req.path),
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

let isRestoreInProgress = false;
app.use((req, res, next) => {
  if (isRestoreInProgress && req.method !== "GET" && req.method !== "OPTIONS") {
    return res.status(503).json({
      error: "Service temporarily unavailable: database restore in progress",
    });
  }
  next();
});

// --- ROUTES: FEATURE FLAGS / HEALTH ---

app.get("/api/feature-flags", requirePerm("manage_employees"), (req, res) => {
  db.all(
    "SELECT key, enabled, description, updated_by, updated_at FROM feature_flags ORDER BY key ASC",
    [],
    (err, rows) => {
      if (err) {
        if (String(err.message || "").includes("no such table")) {
          const fallback = Object.keys(DEFAULT_FEATURE_FLAGS).map((k) => ({
            key: k,
            enabled: DEFAULT_FEATURE_FLAGS[k] ? 1 : 0,
            description: null,
            updated_by: null,
            updated_at: null,
          }));
          return res.json({ flags: fallback });
        }
        return res.status(500).json({ error: err.message });
      }
      return res.json({ flags: rows || [] });
    }
  );
});

app.put("/api/feature-flags/:key", requirePerm("manage_employees"), (req, res) => {
  const { key } = req.params;
  const { enabled, description, updated_by } = req.body || {};
  const enabledInt = enabled ? 1 : 0;
  db.run(
    `INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET
       enabled = excluded.enabled,
       description = COALESCE(excluded.description, feature_flags.description),
       updated_by = excluded.updated_by,
       updated_at = datetime('now','localtime')`,
    [key, enabledInt, description || null, updated_by || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Feature flag updated", key, enabled: enabledInt });
    }
  );
});

app.get("/api/health", (req, res) => {
  const requiredTables = ["sales", "sale_items", "sale_payments", "backup_log", "invoice_sequences", "feature_flags"];
  db.all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${requiredTables
      .map(() => "?")
      .join(",")})`,
    requiredTables,
    (err, rows) => {
      if (err) return res.status(500).json({ status: "error", error: err.message });
      const found = new Set((rows || []).map((r) => r.name));
      const missingTables = requiredTables.filter((t) => !found.has(t));
      const ok = missingTables.length === 0;
      res.status(ok ? 200 : 503).json({
        status: ok ? "ok" : "degraded",
        database: "reachable",
        restore_lock: isRestoreInProgress,
        missing_tables: missingTables,
        checked_at: new Date().toISOString(),
      });
    }
  );
});

// --- ROUTES: TAXES ---

// Get all taxes
app.get("/api/taxes", (req, res) => {
  db.all("SELECT * FROM taxes ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ taxes: rows });
  });
});

// Add a new tax
app.post("/api/taxes", requirePerm("manage_inventory"), (req, res) => {
  const { name, rate, is_default } = req.body;
  db.run(
    "INSERT INTO taxes (name, rate, is_default) VALUES (?, ?, ?)",
    [name, rate, is_default ? 1 : 0],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, rate, is_default });
    },
  );
});

// Update a tax
app.put("/api/taxes/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const { name, rate, is_default } = req.body;
  db.run(
    "UPDATE taxes SET name = COALESCE(?, name), rate = COALESCE(?, rate), is_default = COALESCE(?, is_default) WHERE id = ?",
    [name, rate, is_default ? 1 : 0, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Tax not found" });
      res.json({ message: "Tax updated successfully" });
    },
  );
});

// Delete a tax
app.delete("/api/taxes/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM taxes WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Tax not found" });
    res.json({ message: "Tax deleted" });
  });
});

// --- ROUTES: CATEGORIES ---

// Get all categories
app.get("/api/categories", (req, res) => {
  db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ categories: rows });
  });
});

// Add a new category
app.post("/api/categories", (req, res) => {
  const { name, description } = req.body;
  db.run(
    "INSERT INTO categories (name, description) VALUES (?, ?)",
    [name, description],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, description });
    },
  );
});

// Update a category
app.put("/api/categories/:id", (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  db.run(
    "UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
    [name, description, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Category not found" });
      res.json({ message: "Category updated successfully" });
    },
  );
});

// Delete a category
app.delete("/api/categories/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM categories WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Category not found" });
    res.json({ message: "Category deleted" });
  });
});

// --- ROUTES: OUTLETS ---

// Get all outlets
app.get("/api/outlets", (req, res) => {
  db.all("SELECT * FROM outlets ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ outlets: rows });
  });
});

// Add a new outlet
app.post("/api/outlets", (req, res) => {
  const { name, address, phone } = req.body;
  db.run(
    "INSERT INTO outlets (name, address, phone) VALUES (?, ?, ?)",
    [name, address, phone],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, address, phone });
    },
  );
});

// Update an outlet
app.put("/api/outlets/:id", (req, res) => {
  const { id } = req.params;
  const { name, address, phone } = req.body;
  db.run(
    "UPDATE outlets SET name = COALESCE(?, name), address = COALESCE(?, address), phone = COALESCE(?, phone) WHERE id = ?",
    [name, address, phone, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Outlet not found" });
      res.json({ message: "Outlet updated successfully" });
    },
  );
});

// Delete an outlet
app.delete("/api/outlets/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM outlets WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Outlet not found" });
    res.json({ message: "Outlet deleted" });
  });
});

// --- ROUTES: EMPLOYEES ---

// --- ROUTES: AUTH ---

app.post("/api/auth/login", (req, res) => {
  const { username, pin } = req.body || {};
  if (!username || !pin) {
    return res.status(400).json({ error: "username and pin are required" });
  }

  db.get(
    `SELECT e.id, e.name, e.role_id, r.name as role, NULL as outlet_id
     FROM employees e
     LEFT JOIN roles r ON e.role_id = r.id
     WHERE LOWER(e.name) = LOWER(?) AND e.pin_code = ?`,
    [String(username).trim(), String(pin).trim()],
    (err, employee) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!employee) {
        return res.status(401).json({ error: "Invalid username or PIN" });
      }

      db.all(
        "SELECT permission FROM role_permissions WHERE role_id = ?",
        [employee.role_id || 3],
        (permErr, rows) => {
          if (permErr) return res.status(500).json({ error: permErr.message });
          return res.json({
            employee: {
              id: employee.id,
              name: employee.name,
              role_id: employee.role_id,
              outlet_id: employee.outlet_id || null,
            },
            permissions: (rows || []).map((r) => r.permission),
          });
        },
      );
    },
  );
});

app.post("/api/auth/logout", (req, res) => {
  res.json({ success: true });
});

app.get("/api/auth/me", (req, res) => {
  const employeeId = req.headers["x-employee-id"];
  if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

  db.get(
    `SELECT e.id, e.name, e.role_id, r.name as role, NULL as outlet_id
     FROM employees e
     LEFT JOIN roles r ON e.role_id = r.id
     WHERE e.id = ?`,
    [employeeId],
    (err, employee) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!employee) return res.status(401).json({ error: "Unauthorized" });

      db.all(
        "SELECT permission FROM role_permissions WHERE role_id = ?",
        [employee.role_id || 3],
        (permErr, rows) => {
          if (permErr) return res.status(500).json({ error: permErr.message });
          return res.json({
            employee: {
              id: employee.id,
              name: employee.name,
              role_id: employee.role_id,
              outlet_id: employee.outlet_id || null,
            },
            permissions: (rows || []).map((r) => r.permission),
          });
        },
      );
    },
  );
});

// Get all employees
app.get("/api/employees", (req, res) => {
  db.all(
    "SELECT e.id, e.name, e.pin_code, r.name as role, e.role_id FROM employees e LEFT JOIN roles r ON e.role_id = r.id ORDER BY e.name ASC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ employees: rows });
    },
  );
});

// Validate PIN (For POS Login)
app.post("/api/employees/validate-pin", (req, res) => {
  const { pin_code } = req.body;
  db.get(
    "SELECT e.id, e.name, e.role_id, r.name as role FROM employees e LEFT JOIN roles r ON e.role_id = r.id WHERE e.pin_code = ?",
    [pin_code],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(401).json({ error: "Invalid PIN" });
      res.json({ employee: row });
    },
  );
});

// Add a new employee
app.post("/api/employees", requirePerm("manage_employees"), (req, res) => {
  const { name, role_id, pin_code } = req.body;
  db.run(
    "INSERT INTO employees (name, role_id, pin_code) VALUES (?, ?, ?)",
    [name, role_id || 3, pin_code],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "PIN code must be unique" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, name, role_id });
    },
  );
});

// Update an employee
app.put("/api/employees/:id", requirePerm("manage_employees"), (req, res) => {
  const { id } = req.params;
  const { name, role_id, pin_code } = req.body;

  // Allow updating PIN only if it's provided, otherwise keep existing
  let query =
    "UPDATE employees SET name = COALESCE(?, name), role_id = COALESCE(?, role_id)";
  let params = [name, role_id];

  if (pin_code !== undefined && pin_code !== "") {
    query += ", pin_code = ?";
    params.push(pin_code);
  }

  query += " WHERE id = ?";
  params.push(id);

  db.run(query, params, function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "PIN code must be unique" });
      }
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0)
      return res.status(404).json({ error: "Employee not found" });
    res.json({ message: "Employee updated successfully" });
  });
});

// Delete an employee
app.delete("/api/employees/:id", requirePerm("manage_employees"), (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM employees WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Employee not found" });
    res.json({ message: "Employee deleted" });
  });
});

// --- ROUTES: ROLES AND PERMISSIONS ---

// Get all roles
app.get("/api/roles", (req, res) => {
  db.all("SELECT * FROM roles ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ roles: rows });
  });
});

// Add a new role
app.post("/api/roles", requirePerm("manage_employees"), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Role name is required" });

  db.run(
    "INSERT INTO roles (name, description) VALUES (?, ?)",
    [name, description],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Role name already exists" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, name, description });
    },
  );
});

// Update a role
app.put("/api/roles/:id", requirePerm("manage_employees"), (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  db.run(
    "UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
    [name, description, id],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Role name already exists" });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0)
        return res.status(404).json({ error: "Role not found" });
      res.json({ message: "Role updated successfully" });
    },
  );
});

// Delete a role
app.delete("/api/roles/:id", requirePerm("manage_employees"), (req, res) => {
  const { id } = req.params;

  // Prevent deleting default roles (id 1, 2, 3)
  if (["1", "2", "3"].includes(id.toString())) {
    return res.status(400).json({
      error:
        "Cannot delete default system roles. You can only edit their names or permissions.",
    });
  }

  // Check if role is used by employees
  db.get(
    "SELECT COUNT(*) as count FROM employees WHERE role_id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row.count > 0)
        return res.status(400).json({
          error: `Cannot delete role. It is currently assigned to ${row.count} employee(s).`,
        });

      db.run("DELETE FROM role_permissions WHERE role_id = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run("DELETE FROM roles WHERE id = ?", [id], function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Role not found" });
          res.json({ message: "Role deleted" });
        });
      });
    },
  );
});

// Get permissions for a specific role
app.get("/api/roles/:id/permissions", (req, res) => {
  const { id } = req.params;
  db.all(
    "SELECT permission FROM role_permissions WHERE role_id = ?",
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      // Transform rows array of objects into simple array of strings
      const permissions = rows.map((r) => r.permission);
      res.json({ permissions });
    },
  );
});

// Update permissions for a specific role
app.put("/api/roles/:id/permissions", requirePerm("manage_employees"), (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body; // expected to be an array of permission strings

  if (!Array.isArray(permissions)) {
    return res
      .status(400)
      .json({ error: "Permissions must be an array of strings" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    // Clear old permissions
    db.run("DELETE FROM role_permissions WHERE role_id = ?", [id], (err) => {
      if (err) {
        db.run("ROLLBACK");
        return res.status(500).json({ error: err.message });
      }
    });

    if (permissions.length > 0) {
      // Create new permissions
      const placeholders = permissions.map(() => "(?, ?)").join(", ");
      const values = permissions.reduce(
        (acc, perm) => acc.concat([id, perm]),
        [],
      );

      db.run(
        `INSERT INTO role_permissions (role_id, permission) VALUES ${placeholders}`,
        values,
        (err) => {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }
          db.run("COMMIT");
          return res.json({ message: "Permissions updated successfully" });
        },
      );
    } else {
      db.run("COMMIT");
      return res.json({ message: "Permissions cleared successfully" });
    }
  });
});

// --- ROUTES: BRANDS ---

// Get all brands
app.get("/api/brands", (req, res) => {
  db.all("SELECT * FROM brands ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ brands: rows });
  });
});

// Add a new brand
app.post("/api/brands", (req, res) => {
  const { name, description } = req.body;
  db.run(
    "INSERT INTO brands (name, description) VALUES (?, ?)",
    [name, description],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Brand name must be unique" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, name, description });
    },
  );
});

// Update a brand
app.put("/api/brands/:id", (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  db.run(
    "UPDATE brands SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
    [name, description, id],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Brand name must be unique" });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0)
        return res.status(404).json({ error: "Brand not found" });
      res.json({ message: "Brand updated successfully" });
    },
  );
});

// Delete a brand
app.delete("/api/brands/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM brands WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Brand not found" });
    res.json({ message: "Brand deleted" });
  });
});

// --- ROUTES: PRODUCTS (INVENTORY) ---

function normalizeProductMediaInput(media, image_urls) {
  const normalized = [];

  if (Array.isArray(media)) {
    media.forEach((item) => {
      if (!item) return;
      if (typeof item === "string") {
        const url = item.trim();
        if (url) normalized.push({ url, alt_text: null });
        return;
      }
      const url = String(item.url || "").trim();
      if (!url) return;
      normalized.push({
        url,
        alt_text: item.alt_text != null ? String(item.alt_text) : null,
      });
    });
  }

  if (Array.isArray(image_urls)) {
    image_urls.forEach((urlRaw) => {
      const url = String(urlRaw || "").trim();
      if (url) normalized.push({ url, alt_text: null });
    });
  }

  const seen = new Set();
  const deduped = [];
  normalized.forEach((m, idx) => {
    const key = m.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push({
      url: m.url,
      alt_text: m.alt_text,
      position: idx,
    });
  });

  return deduped;
}

function replaceProductMedia(productId, mediaItems, cb) {
  const media = Array.isArray(mediaItems) ? mediaItems : [];
  db.serialize(() => {
    db.run(
      "DELETE FROM product_media WHERE product_id = ? AND variant_id IS NULL",
      [productId],
      (delErr) => {
        if (delErr) {
          if (String(delErr.message || "").includes("no such table")) return cb(null);
          return cb(delErr);
        }
        if (media.length === 0) return cb(null);

        let pending = media.length;
        let failed = false;
        media.forEach((item, idx) => {
          if (failed) return;
          db.run(
            "INSERT INTO product_media (product_id, variant_id, url, alt_text, position) VALUES (?, NULL, ?, ?, ?)",
            [productId, item.url, item.alt_text || null, item.position != null ? item.position : idx],
            (insErr) => {
              if (failed) return;
              if (insErr) {
                failed = true;
                return cb(insErr);
              }
              pending -= 1;
              if (pending === 0) cb(null);
            },
          );
        });
      },
    );
  });
}

// Get all products (with aggregated stock)
app.get("/api/products", (req, res) => {
  db.all(
    `
        SELECT p.*, 
               c.name as category_name, 
               t.name as tax_name, t.rate as tax_rate,
               s.name as supplier_name,
               b.name as brand_name,
               (COALESCE(os_sum.total, 0) + COALESCE(pv_sum.total, 0)) as total_stock
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN (
            SELECT product_id, SUM(quantity) as total FROM outlet_stock GROUP BY product_id
        ) os_sum ON p.id = os_sum.product_id
        LEFT JOIN (
            SELECT product_id, SUM(stock) as total FROM product_variants GROUP BY product_id
        ) pv_sum ON p.id = pv_sum.product_id
        ORDER BY p.name ASC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ products: rows });
    },
  );
});

// Get variants for a specific product
app.get("/api/products/:id/variants", (req, res) => {
  const { id } = req.params;

  db.all(
    `SELECT pv.*, 
            json_group_array(
               json_object('attribute_name', a.name, 'option_value', ao.value)
            ) as options_json
     FROM product_variants pv
     LEFT JOIN variant_option_values vov ON pv.id = vov.variant_id
     LEFT JOIN attributes a ON vov.attribute_id = a.id
     LEFT JOIN attribute_options ao ON vov.attribute_option_id = ao.id
     WHERE pv.product_id = ?
     GROUP BY pv.id`,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const variants = rows.map((r) => ({
        ...r,
        options: r.options_json
          ? JSON.parse(r.options_json).filter((o) => o.attribute_name !== null)
          : [],
      }));
      res.json({ variants });
    },
  );
});

// Get individual product stock across all outlets
app.get("/api/products/:id/stock", (req, res) => {
  const { id } = req.params;
  db.all(
    `
        SELECT os.outlet_id, o.name as outlet_name, os.quantity 
        FROM outlet_stock os
        JOIN outlets o ON os.outlet_id = o.id
        WHERE os.product_id = ?
    `,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ stock: rows });
    },
  );
});

// Search products by name or barcode (for autocomplete and search)
app.get("/api/products/search", (req, res) => {
  const { query, outlet_id } = req.query;

  if (!query) return res.json({ products: [] });

  const searchQuery = `%${query}%`;

  let sql = `
        SELECT p.*, t.rate as tax_rate, t.name as tax_name,
               COALESCE(SUM(os.quantity), 0) as local_stock
        FROM products p
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = ${outlet_id}` : ""}
        WHERE p.name LIKE ? OR p.barcode LIKE ?
        GROUP BY p.id
        ORDER BY p.name ASC
        LIMIT 50
    `;

  db.all(sql, [searchQuery, searchQuery], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Normalize Tax Output for the POS Terminal
    const productsWithTax = rows.map((row) => {
      const effectiveTaxRate =
        row.tax_rate !== null ? row.tax_rate : row.gst !== null ? row.gst : 0;
      const effectiveTaxName =
        row.tax_name || (row.gst !== null ? "GST" : "No Tax");
      return {
        ...row,
        effectiveTaxRate,
        effectiveTaxName,
      };
    });

    res.json({ products: productsWithTax });
  });
});

// Scan/Find a product by barcode (Crucial for POS speed)
app.get("/api/products/scan/:barcode", (req, res) => {
  const { barcode } = req.params;
  const outlet_id = req.query.outlet_id; // Pass outlet ID from POS to get local stock

  let query = `
        SELECT p.*, t.rate as tax_rate, t.name as tax_name,
               COALESCE(SUM(os.quantity), 0) as local_stock
        FROM products p
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = ${outlet_id}` : ""}
        WHERE p.barcode = ?
        GROUP BY p.id
    `;

  db.get(query, [barcode], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Product not found" });

    // Normalize Tax Output for the POS Terminal
    // If it has a tax profile, use it. Otherwise fallback to legacy GST.
    const effectiveTaxRate =
      row.tax_rate !== null ? row.tax_rate : row.gst !== null ? row.gst : 0;
    const effectiveTaxName =
      row.tax_name || (row.gst !== null ? "GST" : "No Tax");

    const productWithTax = {
      ...row,
      effectiveTaxRate,
      effectiveTaxName,
    };

    res.json({ product: productWithTax });
  });
});

// Add a new product (and optionally set initial stock for a specific outlet)
app.post("/api/products", (req, res) => {
  const {
    barcode,
    name,
    price,
    cost_price,
    gst,
    category_id,
    tax_id,
    brand_id,
    outlet_id,
    initial_stock,
    has_variants,
    attribute_set_id,
    variants, // Array of variant objects if has_variants is true
    min_qty,
    max_qty,
    unit,
    description_html,
    compare_at_price,
    product_type,
    vendor,
    tags,
    status,
    media,
    image_urls,
  } = req.body;
  const productMediaItems = normalizeProductMediaInput(media, image_urls);

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      "INSERT INTO products (barcode, name, price, cost_price, gst, stock, category_id, tax_id, brand_id, has_variants, attribute_set_id, min_qty, max_qty, unit, description_html, compare_at_price, product_type, vendor, tags, status) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        barcode,
        name,
        price,
        cost_price || 0,
        gst === "" ? null : gst,
        category_id || null,
        tax_id || null,
        brand_id || null,
        has_variants ? 1 : 0,
        attribute_set_id || null,
        min_qty || 0,
        max_qty || 0,
        unit || "pcs",
        description_html || null,
        compare_at_price || 0,
        product_type || null,
        vendor || null,
        tags || null,
        status || "active",
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Barcode already exists" });
          }
          return res.status(500).json({ error: err.message });
        }
        const newProductId = this.lastID;

        // Helper function to successfully terminate the request
        const finishCreation = () => {
          replaceProductMedia(newProductId, productMediaItems, (mediaErr) => {
            if (mediaErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: mediaErr.message });
            }
            db.run("COMMIT");
            res.json({ id: newProductId, barcode, name, has_variants });
          });
        };

        // 1. If it has variants, process them
        if (has_variants && variants && variants.length > 0) {
          let pendingVariants = variants.length;
          let hasError = false;

          variants.forEach((variant) => {
            if (hasError) return;

            db.run(
              `INSERT INTO product_variants
                 (product_id, sku, price, cost_price, compare_at_price, weight, weight_unit, stock)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
              [
                newProductId,
                variant.sku,
                variant.price || price,
                variant.cost_price || cost_price,
                variant.compare_at_price || variant.price || price || 0,
                variant.weight || 0,
                variant.weight_unit || "kg",
              ],
              function (vErr) {
                if (vErr) {
                  hasError = true;
                  db.run("ROLLBACK");
                  return res.status(500).json({
                    error: "Variant SKU constraint failed: " + vErr.message,
                  });
                }
                const variantId = this.lastID;

                // Insert Outlet stock for variant if provided
                if (outlet_id && variant.initial_stock) {
                  // TODO: Variant stock should probably be tracked in a outlet_variant_stock table in the future.
                  // For now we'll put it in the base variant table's stock column.
                  db.run("UPDATE product_variants SET stock = ? WHERE id = ?", [
                    variant.initial_stock,
                    variantId,
                  ]);
                }

                const options = variant.options || [];
                if (options.length === 0) {
                  pendingVariants--;
                  if (pendingVariants === 0 && !hasError) finishCreation();
                  return;
                }

                let pendingOptions = options.length;
                options.forEach((opt) => {
                  if (hasError) return;
                  db.run(
                    "INSERT INTO variant_option_values (variant_id, attribute_id, attribute_option_id) VALUES (?, ?, ?)",
                    [variantId, opt.attribute_id, opt.attribute_option_id],
                    function (oErr) {
                      if (oErr) {
                        hasError = true;
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: oErr.message });
                      }
                      pendingOptions--;
                      if (pendingOptions === 0) {
                        pendingVariants--;
                        if (pendingVariants === 0 && !hasError)
                          finishCreation();
                      }
                    },
                  );
                });
              },
            );
          });
        } else {
          // 2. Simple product stock initialization
          if (outlet_id && initial_stock) {
            db.run(
              "INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)",
              [newProductId, outlet_id, initial_stock],
              function (stockErr) {
                if (stockErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({
                    error:
                      "Failed to initialize outlet stock: " + stockErr.message,
                  });
                }
                finishCreation();
              },
            );
          } else {
            finishCreation();
          }
        }
      },
    );
  });
});

// Bulk import products from CSV rows (upsert by barcode)
app.post("/api/products/bulk-import", (req, res) => {
  const { rows } = req.body; // [{ barcode, name, price, ..., image_url, image_urls }]
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "No rows provided" });
  }

  const results = [];

  const processNext = (index) => {
    if (index >= rows.length) {
      return res.json({ results });
    }
    const row = rows[index];
    const {
      barcode,
      name,
      price,
      cost_price,
      compare_at_price,
      description_html,
      product_type,
      vendor,
      tags,
      status,
      gst,
      stock,
      min_qty,
      max_qty,
      unit,
      image_url,
      image_urls,
    } = row;
    const productMediaItems = normalizeProductMediaInput(
      null,
      image_urls
        ? String(image_urls)
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean)
        : image_url
          ? [String(image_url).trim()]
          : [],
    );

    if (!barcode || !name || !price) {
      results.push({ barcode: barcode || "?", status: "error", message: "barcode, name, and price are required" });
      return processNext(index + 1);
    }

    db.get(
      "SELECT id FROM products WHERE barcode = ?",
      [barcode],
      (findErr, existing) => {
        if (findErr) {
          results.push({ barcode, status: "error", message: findErr.message });
          return processNext(index + 1);
        }

        db.run(
          `INSERT INTO products (barcode, name, price, cost_price, compare_at_price, description_html, product_type, vendor, tags, status, gst, stock, min_qty, max_qty, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(barcode) DO UPDATE SET
             name = excluded.name,
             price = excluded.price,
             cost_price = excluded.cost_price,
             compare_at_price = excluded.compare_at_price,
             description_html = excluded.description_html,
             product_type = excluded.product_type,
             vendor = excluded.vendor,
             tags = excluded.tags,
             status = excluded.status,
             gst = excluded.gst,
             stock = excluded.stock,
             min_qty = excluded.min_qty,
             max_qty = excluded.max_qty,
             unit = excluded.unit`,
          [
            barcode,
            name,
            parseFloat(price) || 0,
            parseFloat(cost_price) || 0,
            parseFloat(compare_at_price) || 0,
            description_html || null,
            product_type || null,
            vendor || null,
            tags || null,
            status || "active",
            gst !== "" && gst != null ? parseFloat(gst) : null,
            parseInt(stock) || 0,
            parseInt(min_qty) || 0,
            parseInt(max_qty) || 0,
            unit || "pcs",
          ],
          function (err) {
            if (err) {
              results.push({ barcode, status: "error", message: err.message });
              return processNext(index + 1);
            }

            const productId = existing ? existing.id : this.lastID;
            replaceProductMedia(productId, productMediaItems, (mediaErr) => {
              if (mediaErr) {
                results.push({ barcode, status: "error", message: mediaErr.message });
              } else {
                results.push({
                  barcode,
                  name,
                  status: existing ? "updated" : "inserted",
                });
              }
              processNext(index + 1);
            });
          },
        );
      },
    );
  };

  processNext(0);
});

// Update a product (Prices, Names, Categories... NOT Stock. Stock is handled via Adjustments/Transfers)
app.put("/api/products/:id", (req, res) => {
  const { id } = req.params;
  const {
    name,
    price,
    cost_price,
    gst,
    barcode,
    category_id,
    tax_id,
    brand_id,
    min_qty,
    max_qty,
    unit,
    description_html,
    compare_at_price,
    product_type,
    vendor,
    tags,
    status,
    media,
    image_urls,
  } = req.body;
  const shouldReplaceMedia =
    Object.prototype.hasOwnProperty.call(req.body || {}, "media") ||
    Object.prototype.hasOwnProperty.call(req.body || {}, "image_urls");
  const productMediaItems = normalizeProductMediaInput(media, image_urls);

  // Simple dynamic update
  db.run(
    "UPDATE products SET name = COALESCE(?, name), price = COALESCE(?, price), cost_price = COALESCE(?, cost_price), gst = ?, barcode = COALESCE(?, barcode), category_id = COALESCE(?, category_id), tax_id = COALESCE(?, tax_id), brand_id = COALESCE(?, brand_id), min_qty = COALESCE(?, min_qty), max_qty = COALESCE(?, max_qty), unit = COALESCE(?, unit), description_html = COALESCE(?, description_html), compare_at_price = COALESCE(?, compare_at_price), product_type = COALESCE(?, product_type), vendor = COALESCE(?, vendor), tags = COALESCE(?, tags), status = COALESCE(?, status) WHERE id = ?",
    [
      name,
      price,
      cost_price,
      gst === "" ? null : gst,
      barcode,
      category_id || null,
      tax_id || null,
      brand_id || null,
      min_qty !== undefined ? min_qty : null,
      max_qty !== undefined ? max_qty : null,
      unit || null,
      description_html || null,
      compare_at_price !== undefined ? compare_at_price : null,
      product_type || null,
      vendor || null,
      tags || null,
      status || null,
      id,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Product not found" });
      if (!shouldReplaceMedia) {
        return res.json({ message: "Product updated successfully" });
      }
      replaceProductMedia(id, productMediaItems, (mediaErr) => {
        if (mediaErr) return res.status(500).json({ error: mediaErr.message });
        res.json({ message: "Product updated successfully" });
      });
    },
  );
});

// Delete a product
app.delete("/api/products/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM products WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Product deleted" });
  });
});

// --- ROUTES: SUPPLIERS ---

// Get all suppliers
app.get("/api/suppliers", (req, res) => {
  db.all("SELECT * FROM suppliers ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ suppliers: rows });
  });
});

// Add a new supplier
app.post("/api/suppliers", (req, res) => {
  const { name, contact_person, phone, email, address } = req.body;
  db.run(
    "INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)",
    [name, contact_person, phone, email, address],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        name,
        contact_person,
        phone,
        email,
        address,
      });
    },
  );
});

// Update a supplier
app.put("/api/suppliers/:id", (req, res) => {
  const { id } = req.params;
  const { name, contact_person, phone, email, address } = req.body;

  db.run(
    "UPDATE suppliers SET name = COALESCE(?, name), contact_person = COALESCE(?, contact_person), phone = COALESCE(?, phone), email = COALESCE(?, email), address = COALESCE(?, address) WHERE id = ?",
    [name, contact_person, phone, email, address, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Supplier not found" });
      res.json({ message: "Supplier updated successfully" });
    },
  );
});

// Delete a supplier
app.delete("/api/suppliers/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM suppliers WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0)
      return res.status(404).json({ error: "Supplier not found" });
    res.json({ message: "Supplier deleted" });
  });
});

// --- ROUTES: PURCHASE ORDERS ---

// Get all purchase orders (with supplier names)
app.get("/api/purchase-orders", (req, res) => {
  db.all(
    `
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        ORDER BY po.created_at DESC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ purchaseOrders: rows });
    },
  );
});

// Get a single purchase order with its items
app.get("/api/purchase-orders/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ?
    `,
    [id],
    (err, po) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!po)
        return res.status(404).json({ error: "Purchase order not found" });

      db.all(
        `
            SELECT poi.*, p.name, p.barcode
            FROM purchase_order_items poi
            JOIN products p ON poi.product_id = p.id
            WHERE poi.po_id = ?
        `,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ purchaseOrder: po, items });
        },
      );
    },
  );
});

// Create a new purchase order
app.post("/api/purchase-orders", requirePerm("manage_orders"), (req, res) => {
  const { supplier_id, total_cost, items, due_date } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Purchase order must have items" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "INSERT INTO purchase_orders (supplier_id, total_cost, status, due_date) VALUES (?, ?, 'Draft', ?)",
      [supplier_id, total_cost, due_date || null],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Failed to create PO" });
        }

        const poId = this.lastID;
        const stmt = db.prepare(
          "INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)",
        );
        let hasError = false;

        items.forEach((item) => {
          stmt.run(
            poId,
            item.product_id,
            item.quantity,
            item.cost_price,
            (err) => {
              if (err) hasError = true;
            },
          );
        });

        stmt.finalize();

        if (hasError) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Transaction failed while adding items" });
        }

        db.run("COMMIT", (err) => {
          if (err)
            return res.status(500).json({ error: "Failed to commit PO" });
          res.json({ message: "Purchase order created", id: poId });
        });
      },
    );
  });
});

// Receive a purchase order (Updates Inventory Stock & Cost Price)
app.post("/api/purchase-orders/:id/receive", requirePerm("manage_orders"), (req, res) => {
  const { id } = req.params;
  const { outlet_id, received_by, items: receivedItems, notes } = req.body;

  if (!outlet_id) {
    return res
      .status(400)
      .json({ error: "Outlet ID is required to receive PO" });
  }

  db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status === "Received")
      return res.status(400).json({ error: "PO already received" });

    db.all(
      "SELECT poi.*, p.name as product_name FROM purchase_order_items poi JOIN products p ON poi.product_id = p.id WHERE poi.po_id = ?",
      [id],
      (err, poItems) => {
        if (err) return res.status(500).json({ error: err.message });

        // Build a map of qty_received: use provided items or default to full quantity
        const receivedMap = {};
        if (receivedItems && Array.isArray(receivedItems)) {
          receivedItems.forEach((ri) => {
            receivedMap[ri.product_id] = parseFloat(ri.qty_received) || 0;
          });
        }

        const grnNumber = `GRN-${Date.now()}`;

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");

          // 1. Update PO status
          db.run(
            "UPDATE purchase_orders SET status = 'Received' WHERE id = ?",
            [id],
          );

          // 2. Create GRN header
          db.run(
            "INSERT INTO goods_received_notes (grn_number, po_id, outlet_id, received_by, notes) VALUES (?, ?, ?, ?, ?)",
            [grnNumber, id, outlet_id, received_by || null, notes || null],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }

              const grnId = this.lastID;
              const grnItemStmt = db.prepare(
                "INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price) VALUES (?, ?, ?, ?, ?)",
              );
              const updateCostStmt = db.prepare(
                "UPDATE products SET cost_price = ? WHERE id = ?",
              );
              const updateStockStmt = db.prepare(`
                INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                VALUES (?, ?, ?)
                ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?
              `);

              poItems.forEach((item) => {
                const qtyReceived =
                  receivedMap[item.product_id] ?? item.quantity;
                grnItemStmt.run(
                  grnId,
                  item.product_id,
                  item.quantity,
                  qtyReceived,
                  item.cost_price,
                );
                updateCostStmt.run(item.cost_price, item.product_id);
                updateStockStmt.run(
                  item.product_id,
                  outlet_id,
                  qtyReceived,
                  qtyReceived,
                );
              });

              grnItemStmt.finalize();
              updateCostStmt.finalize();
              updateStockStmt.finalize();

              db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: err.message });
                const syncChanges = poItems.map((item) => ({
                  product_id: item.product_id,
                  outlet_id,
                  delta: Number(receivedMap[item.product_id] ?? item.quantity ?? 0),
                  reason: "po_receive",
                  reference_type: "purchase_order",
                  reference_id: po.id,
                }));
                enqueueInventorySyncEvents(syncChanges, {}, () => {});
                // Auto-create supplier invoice for this GRN
                if (po.supplier_id && po.total_cost > 0) {
                  const invNumber = `INV-${grnNumber}`;
                  db.run(
                    "INSERT INTO supplier_invoices (supplier_id, po_id, grn_id, invoice_number, amount, due_date) VALUES (?, ?, ?, ?, ?, ?)",
                    [po.supplier_id, po.id, grnId, invNumber, po.total_cost, po.due_date || null],
                    () => {} // best-effort, don't fail the response
                  );
                }
                res.json({
                  message: "PO received. GRN created.",
                  grn_number: grnNumber,
                  grn_id: grnId,
                });
              });
            },
          );
        });
      },
    );
  });
});

// --- GRN (Goods Received Notes) ---

app.get("/api/grn", (req, res) => {
  const { date_from, date_to } = req.query;
  const where = [];
  const params = [];
  if (date_from) {
    where.push("date(g.received_at,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(g.received_at,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT g.id, g.grn_number, g.received_at, g.notes,
           ('PO-' || printf('%04d', po.id)) as po_number, s.name as supplier_name,
           o.name as outlet_name,
           e.name as received_by_name,
           COUNT(gi.id) as line_count
    FROM goods_received_notes g
    LEFT JOIN purchase_orders po ON g.po_id = po.id
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    LEFT JOIN outlets o ON g.outlet_id = o.id
    LEFT JOIN employees e ON g.received_by = e.id
    LEFT JOIN grn_items gi ON g.id = gi.grn_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY g.id
    ORDER BY g.received_at DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ grns: rows });
  });
});

app.get("/api/grn/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT g.*, ('PO-' || printf('%04d', po.id)) as po_number, s.name as supplier_name, o.name as outlet_name, e.name as received_by_name
     FROM goods_received_notes g
     LEFT JOIN purchase_orders po ON g.po_id = po.id
     LEFT JOIN suppliers s ON po.supplier_id = s.id
     LEFT JOIN outlets o ON g.outlet_id = o.id
     LEFT JOIN employees e ON g.received_by = e.id
     WHERE g.id = ?`,
    [id],
    (err, grn) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!grn) return res.status(404).json({ error: "GRN not found" });
      db.all(
        `SELECT gi.*, p.name as product_name, p.barcode
         FROM grn_items gi JOIN products p ON gi.product_id = p.id
         WHERE gi.grn_id = ?`,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ grn, items });
        },
      );
    },
  );
});

// Delete a purchase order
app.delete("/api/purchase-orders/:id", requirePerm("manage_orders"), (req, res) => {
  const { id } = req.params;

  db.get("SELECT status FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status === "Received")
      return res.status(400).json({ error: "Cannot delete a received PO" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "DELETE FROM purchase_order_items WHERE po_id = ?",
        [id],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }
        },
      );
      db.run("DELETE FROM purchase_orders WHERE id = ?", [id], function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }
      });
      db.run("COMMIT", (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Purchase order deleted" });
      });
    });
  });
});

// --- SUPPLIER PAYABLES ---

// GET all supplier invoices (with supplier name, payment totals)
app.get("/api/supplier-invoices", requireFeature("supplier_payables"), (req, res) => {
  const { supplier_id, status } = req.query;
  let query = `
    SELECT si.*,
           s.name as supplier_name,
           COALESCE(SUM(sp.amount), 0) as amount_paid,
           si.amount - COALESCE(SUM(sp.amount), 0) as amount_due
    FROM supplier_invoices si
    JOIN suppliers s ON si.supplier_id = s.id
    LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
  `;
  const params = [];
  const wheres = [];
  if (supplier_id) { wheres.push("si.supplier_id = ?"); params.push(supplier_id); }
  if (status) { wheres.push("si.status = ?"); params.push(status); }
  if (wheres.length) query += " WHERE " + wheres.join(" AND ");
  query += " GROUP BY si.id ORDER BY si.created_at DESC";
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ invoices: rows });
  });
});

// GET single supplier invoice with its payments
app.get("/api/supplier-invoices/:id", requireFeature("supplier_payables"), (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT si.*, s.name as supplier_name FROM supplier_invoices si
     JOIN suppliers s ON si.supplier_id = s.id WHERE si.id = ?`,
    [id],
    (err, inv) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      db.all(
        "SELECT * FROM supplier_payments WHERE supplier_invoice_id = ? ORDER BY paid_at DESC",
        [id],
        (err2, payments) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ invoice: inv, payments: payments || [] });
        }
      );
    }
  );
});

// POST record a payment against a supplier invoice
app.post("/api/supplier-invoices/:id/pay", requireFeature("supplier_payables"), (req, res) => {
  const { id } = req.params;
  const { amount, payment_method = "Cash", reference, paid_by, notes } = req.body;
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount is required" });

  db.get(
    `SELECT si.*, COALESCE(SUM(sp.amount), 0) as amount_paid
     FROM supplier_invoices si
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     WHERE si.id = ?`,
    [id],
    (err, inv) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      if (inv.status === "paid") return res.status(400).json({ error: "Invoice already fully paid" });

      const amt = parseFloat(amount);
      const remaining = inv.amount - inv.amount_paid;
      if (amt > remaining + 0.001)
        return res.status(400).json({ error: `Payment exceeds outstanding amount (PKRs ${remaining.toFixed(2)})` });

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          "INSERT INTO supplier_payments (supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, inv.supplier_id, amt, payment_method, reference || null, paid_by || null, notes || null],
          function (err) {
            if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
            // Update invoice status
            const newPaid = inv.amount_paid + amt;
            const newStatus = newPaid >= inv.amount - 0.001 ? "paid" : "partial";
            db.run(
              "UPDATE supplier_invoices SET status = ? WHERE id = ?",
              [newStatus, id],
              (err2) => {
                if (err2) { db.run("ROLLBACK"); return res.status(500).json({ error: err2.message }); }
                db.run("COMMIT", () => {
                  res.json({ message: "Payment recorded", status: newStatus });
                });
              }
            );
          }
        );
      });
    }
  );
});

// GET supplier aging summary — one row per supplier with total owed
app.get("/api/supplier-aging", requireFeature("supplier_payables"), (req, res) => {
  db.all(
    `SELECT s.id, s.name as supplier_name, s.phone,
            COUNT(DISTINCT si.id) as invoice_count,
            COALESCE(SUM(si.amount), 0) as total_invoiced,
            COALESCE(SUM(sp.amount), 0) as total_paid,
            COALESCE(SUM(si.amount), 0) - COALESCE(SUM(sp.amount), 0) as total_due
     FROM suppliers s
     LEFT JOIN supplier_invoices si ON si.supplier_id = s.id
     LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
     GROUP BY s.id
     HAVING total_invoiced > 0
     ORDER BY total_due DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ aging: rows });
    }
  );
});

// --- PROMOTIONS ENGINE ---

// GET all promotions
app.get("/api/promotions", (req, res) => {
  db.all("SELECT * FROM promotions ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ promotions: rows });
  });
});

// POST create promotion
app.post("/api/promotions", requirePerm("manage_inventory"), (req, res) => {
  const { name, type, value, min_order_amount = 0, buy_qty = 0, get_qty = 0,
          applies_to = "all", product_id, category_id, starts_at, ends_at } = req.body;
  if (!name || !type || value === undefined)
    return res.status(400).json({ error: "name, type, value are required" });
  db.run(
    `INSERT INTO promotions (name, type, value, min_order_amount, buy_qty, get_qty, applies_to, product_id, category_id, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, type, value, min_order_amount, buy_qty, get_qty, applies_to,
     product_id || null, category_id || null, starts_at || null, ends_at || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Promotion created", id: this.lastID });
    }
  );
});

// PUT update promotion
app.put("/api/promotions/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const { name, type, value, min_order_amount = 0, buy_qty = 0, get_qty = 0,
          applies_to = "all", product_id, category_id, active, starts_at, ends_at } = req.body;
  db.run(
    `UPDATE promotions SET name=?, type=?, value=?, min_order_amount=?, buy_qty=?, get_qty=?,
     applies_to=?, product_id=?, category_id=?, active=?, starts_at=?, ends_at=? WHERE id=?`,
    [name, type, value, min_order_amount, buy_qty, get_qty, applies_to,
     product_id || null, category_id || null, active !== undefined ? active : 1,
     starts_at || null, ends_at || null, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Promotion not found" });
      res.json({ message: "Promotion updated" });
    }
  );
});

// DELETE promotion
app.delete("/api/promotions/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM promotions WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Promotion not found" });
    res.json({ message: "Promotion deleted" });
  });
});

// POST /api/promotions/quote — evaluate active promotions against a cart
// Body: { items: [{product_id, category_id, quantity, price}], order_total }
app.post("/api/promotions/quote", (req, res) => {
  const { items = [], order_total = 0 } = req.body;
  const now = new Date().toISOString().slice(0, 10);

  db.all(
    `SELECT * FROM promotions WHERE active = 1
     AND (starts_at IS NULL OR starts_at <= ?)
     AND (ends_at IS NULL OR ends_at >= ?)
     ORDER BY id ASC`,
    [now, now],
    (err, promos) => {
      if (err) return res.status(500).json({ error: err.message });

      const applied = [];
      let totalDiscount = 0;

      for (const promo of promos) {
        const itemMatches = (item) => {
          if (promo.applies_to === "all") return true;
          if (promo.applies_to === "product" && promo.product_id)
            return item.product_id === promo.product_id;
          if (promo.applies_to === "category" && promo.category_id)
            return item.category_id === promo.category_id;
          return false;
        };

        const matchedItems = items.filter(itemMatches);
        const matchedTotal = matchedItems.reduce((s, i) => s + i.price * i.quantity, 0);
        let discount = 0;

        if (promo.type === "percent") {
          discount = matchedTotal * (promo.value / 100);
        } else if (promo.type === "fixed") {
          discount = Math.min(promo.value, matchedTotal);
        } else if (promo.type === "threshold_percent") {
          if (order_total >= promo.min_order_amount)
            discount = matchedTotal * (promo.value / 100);
        } else if (promo.type === "threshold_fixed") {
          if (order_total >= promo.min_order_amount)
            discount = Math.min(promo.value, matchedTotal);
        } else if (promo.type === "bxgy") {
          if (promo.buy_qty > 0 && promo.get_qty > 0) {
            matchedItems.forEach((item) => {
              const sets = Math.floor(item.quantity / (promo.buy_qty + promo.get_qty));
              discount += sets * promo.get_qty * item.price;
            });
          }
        }

        if (discount > 0) {
          totalDiscount += discount;
          applied.push({
            promotion_id: promo.id,
            name: promo.name,
            type: promo.type,
            discount: parseFloat(discount.toFixed(2)),
          });
        }
      }

      res.json({
        applied_promotions: applied,
        total_promotion_discount: parseFloat(totalDiscount.toFixed(2)),
      });
    }
  );
});

// --- FOR CHECKOUT (POINT OF SALE) ---

// --- CUSTOMERS ---

// GET all customers (with total order count and spend)
app.get("/api/customers", (req, res) => {
  const { search = "" } = req.query;
  let query = `
    SELECT c.*,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
  `;
  const params = [];
  if (search) {
    query += " WHERE c.name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ?";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += " GROUP BY c.id ORDER BY c.name ASC";
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ customers: rows });
  });
});

// GET single customer's sales history
app.get("/api/customers/:id/sales", (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT s.*, o.name as outlet_name, e.name as employee_name,
            COUNT(si.id) as item_count
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     LEFT JOIN sale_items si ON s.id = si.sale_id
     WHERE s.customer_id = ?
     GROUP BY s.id
     ORDER BY s.timestamp DESC`,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ sales: rows });
    },
  );
});

// POST create customer
app.post("/api/customers", (req, res) => {
  const { name, mobile, email, address, cnic, occupation, balance } = req.body;
  if (!name)
    return res.status(400).json({ error: "Customer name is required" });
  db.run(
    "INSERT INTO customers (name, mobile, email, address, cnic, occupation, balance) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      name,
      mobile || null,
      email || null,
      address || null,
      cnic || null,
      occupation || null,
      balance || 0,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        id: this.lastID,
        name,
        mobile,
        email,
        address,
        cnic,
        occupation,
        balance: balance || 0,
        order_count: 0,
        total_spent: 0,
      });
    },
  );
});

// PUT update customer
app.put("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  const { name, mobile, email, address, cnic, occupation, balance } = req.body;
  if (!name)
    return res.status(400).json({ error: "Customer name is required" });
  db.run(
    "UPDATE customers SET name = ?, mobile = ?, email = ?, address = ?, cnic = ?, occupation = ?, balance = COALESCE(?, balance) WHERE id = ?",
    [
      name,
      mobile || null,
      email || null,
      address || null,
      cnic || null,
      occupation || null,
      balance !== undefined ? balance : null,
      id,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ message: "Customer updated" });
    },
  );
});

// PUT update customer points manually
app.put("/api/customers/:id/points", (req, res) => {
  const { id } = req.params;
  const { points } = req.body;
  if (points === undefined || isNaN(points))
    return res.status(400).json({ error: "Points value is required" });

  db.run(
    "UPDATE customers SET loyalty_points = ? WHERE id = ?",
    [parseInt(points), id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Customer not found" });
      res.json({ message: "Customer points updated" });
    },
  );
});

// GET customer wallet balance + ledger
app.get("/api/customers/:id/wallet", (req, res) => {
  const { id } = req.params;
  db.get("SELECT balance FROM customers WHERE id = ?", [id], (err, customer) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    db.all(
      "SELECT * FROM customer_wallet_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50",
      [id],
      (err2, ledger) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ balance: customer.balance || 0, ledger: ledger || [] });
      }
    );
  });
});

// POST top-up customer wallet (credit)
app.post("/api/customers/:id/wallet/topup", (req, res) => {
  const { id } = req.params;
  const { amount, note } = req.body;
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount is required" });

  const amt = parseFloat(amount);
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      "UPDATE customers SET balance = COALESCE(balance, 0) + ? WHERE id = ?",
      [amt, id],
      function (err) {
        if (err || this.changes === 0) {
          db.run("ROLLBACK");
          return res.status(err ? 500 : 404).json({ error: err ? err.message : "Customer not found" });
        }
        db.run(
          "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, note) VALUES (?, 'credit', ?, 'topup', ?)",
          [id, amt, note || "Manual top-up"],
          (err2) => {
            if (err2) { db.run("ROLLBACK"); return res.status(500).json({ error: err2.message }); }
            db.run("COMMIT", () => {
              db.get("SELECT balance FROM customers WHERE id = ?", [id], (e, row) => {
                res.json({ message: "Wallet topped up", balance: row?.balance || 0 });
              });
            });
          }
        );
      }
    );
  });
});

// DELETE customer (only if no linked sales)
app.delete("/api/customers/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    "SELECT COUNT(*) as count FROM sales WHERE customer_id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row.count > 0) {
        return res.status(400).json({
          error: `Cannot delete — this customer has ${row.count} linked sale(s).`,
        });
      }
      db.run("DELETE FROM customers WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Customer deleted" });
      });
    },
  );
});

// --- CUSTOMER REPORTS ---

// Customer Details report
app.get("/api/reports/customer-details", (req, res) => {
  const { search = "" } = req.query;
  let query = `
    SELECT c.id, c.name, c.mobile, c.email, c.created_at,
           COUNT(s.id) as order_count,
           COALESCE(SUM(s.total_amount), 0) as total_spent
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
  `;
  const params = [];
  if (search) {
    query += " WHERE c.name LIKE ? OR c.mobile LIKE ?";
    params.push(`%${search}%`, `%${search}%`);
  }
  query += " GROUP BY c.id ORDER BY total_spent DESC";
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ customers: rows });
  });
});

// Customer Wise report (summary)
app.get("/api/reports/customer-wise", (req, res) => {
  db.all(
    `SELECT c.name as customer, COUNT(s.id) as order_count,
            COALESCE(SUM(s.total_amount), 0) as total_amount
     FROM customers c
     LEFT JOIN sales s ON c.id = s.customer_id AND s.voided = 0
     GROUP BY c.id
     ORDER BY total_amount DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ data: rows });
    },
  );
});

// Order Wise report
app.get("/api/reports/order-wise", (req, res) => {
  const { date_from = "", date_to = "", search = "" } = req.query;
  let conditions = ["1=1"];
  const params = [];

  if (search) {
    conditions.push("(CAST(s.id AS TEXT) LIKE ? OR c.name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (date_from) {
    conditions.push("date(s.timestamp, 'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    conditions.push("date(s.timestamp, 'localtime') <= ?");
    params.push(date_to);
  }
  conditions.push("s.voided = 0");

  const where = conditions.join(" AND ");
  db.all(
    `SELECT s.id, s.timestamp, s.total_amount, s.payment_method,
            COALESCE(s.discount_amount, 0) as discount_amount,
            COALESCE(c.name, 'Walk-in Customer') as customer_name,
            o.name as outlet_name,
            COALESCE(SUM(si.price_at_sale * si.quantity), 0) as sale_excl_tax
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN sale_items si ON s.id = si.sale_id
     WHERE ${where}
     GROUP BY s.id
     ORDER BY s.timestamp DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ orders: rows });
    },
  );
});

// --- SALES HISTORY ROUTES ---

// GET all sales (paginated, filterable)
app.get("/api/sales", (req, res) => {
  const {
    page = 1,
    limit = 50,
    search = "",
    date_from = "",
    date_to = "",
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let conditions = ["1=1"];
  let params = [];

  if (search) {
    conditions.push(
      "(CAST(s.id AS TEXT) LIKE ? OR e.name LIKE ? OR o.name LIKE ?)",
    );
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (date_from) {
    conditions.push("date(s.timestamp, 'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    conditions.push("date(s.timestamp, 'localtime') <= ?");
    params.push(date_to);
  }

  const where = conditions.join(" AND ");

  const countQuery = `SELECT COUNT(*) as total FROM sales s
    LEFT JOIN outlets o ON s.outlet_id = o.id
    LEFT JOIN employees e ON s.employee_id = e.id
    WHERE ${where}`;

  db.get(countQuery, params, (err, countRow) => {
    if (err) return res.status(500).json({ error: err.message });

    const total = countRow?.total || 0;
    const listParams = [...params, parseInt(limit), offset];

    const listQuery = `
      SELECT s.id, s.timestamp, s.total_amount, s.payment_method, s.voided, s.void_reason,
             COALESCE(s.discount_amount, 0) as discount_amount,
             o.name as outlet_name, e.name as employee_name,
             COUNT(si.id) as item_count
      FROM sales s
      LEFT JOIN outlets o ON s.outlet_id = o.id
      LEFT JOIN employees e ON s.employee_id = e.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE ${where}
      GROUP BY s.id
      ORDER BY s.timestamp DESC
      LIMIT ? OFFSET ?`;

    db.all(listQuery, listParams, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        sales: rows,
        total,
        pages: Math.ceil(total / parseInt(limit)),
        page: parseInt(page),
      });
    });
  });
});

// GET a single sale with full line items and payments
app.get("/api/sales/:id", (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT s.*, o.name as outlet_name, e.name as employee_name
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     WHERE s.id = ?`,
    [id],
    (err, sale) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!sale) return res.status(404).json({ error: "Sale not found" });

      db.all(
        `SELECT si.*, p.name as product_name, p.barcode
         FROM sale_items si JOIN products p ON si.product_id = p.id
         WHERE si.sale_id = ?`,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });

          db.all(
            "SELECT * FROM sale_payments WHERE sale_id = ?",
            [id],
            (err, payments) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ sale, items, payments });
            },
          );
        },
      );
    },
  );
});

// VOID a sale — marks as voided and restores stock to outlet
app.put("/api/sales/:id/void", requireAnyPerm(["void_sales", "pos_void"]), (req, res) => {
  const { id } = req.params;
  const { void_reason } = req.body;

  if (!void_reason)
    return res.status(400).json({ error: "void_reason is required" });

  // Fetch the sale first to check it exists and isn't already voided
  db.get("SELECT * FROM sales WHERE id = ?", [id], (err, sale) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    if (sale.voided)
      return res.status(400).json({ error: "Sale is already voided" });
    if (!sale.outlet_id)
      return res
        .status(400)
        .json({ error: "Cannot void sales without outlet attribution" });

    // Fetch line items to restore stock
    db.all("SELECT * FROM sale_items WHERE sale_id = ?", [id], (err, items) => {
      if (err) return res.status(500).json({ error: err.message });

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Mark the sale as voided
        db.run(
          "UPDATE sales SET voided = 1, void_reason = ? WHERE id = ?",
          [void_reason, id],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: "Failed to void sale" });
            }
          },
        );

        // Restore stock for each item back to the outlet
        const restoreStmt = db.prepare(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
        );
        items.forEach((item) => {
          restoreStmt.run(
            item.product_id,
            sale.outlet_id,
            item.quantity,
            item.quantity,
          );
        });
        restoreStmt.finalize();

        db.run("COMMIT", (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to commit void transaction" });
          const syncChanges = items.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            outlet_id: sale.outlet_id,
            delta: Number(item.quantity || 0),
            reason: "void",
            reference_type: "sale_void",
            reference_id: id,
          }));
          enqueueInventorySyncEvents(syncChanges, {}, () => {});
          res.json({
            message: "Sale voided successfully. Stock has been restored.",
          });
        });
      });
    });
  });
});

// Process a Sale (Cart Checkout)
app.post("/api/sales", (req, res) => {
  const {
    cartItems,
    paymentMethod,
    payments,
    outlet_id,
    employee_id,
    customer_id,
    discount_amount = 0,
    discount_type = "fixed",
    points_earned = 0,
    points_redeemed = 0,
    notes = null,
  } = req.body;

  // Validation
  if (!cartItems || cartItems.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }
  if (!outlet_id) {
    return res
      .status(400)
      .json({ error: "Outlet ID is required for checkout" });
  }

  // 1. Calculate Expected Total (subtotal minus discount)
  const subtotal = cartItems.reduce(
    (acc, item) => acc + item.price * item.quantity,
    0,
  );
  const discountValue =
    discount_type === "percent"
      ? (subtotal * parseFloat(discount_amount || 0)) / 100
      : parseFloat(discount_amount || 0);
  const totalAmount = subtotal - discountValue - parseFloat(points_redeemed || 0);

  // Determine the actual payments to record
  let finalPayments = payments;
  let mainPaymentMethod = paymentMethod || "Cash";

  if (!finalPayments || finalPayments.length === 0) {
    finalPayments = [{ method: mainPaymentMethod, amount: totalAmount }];
  } else if (finalPayments.length > 1) {
    mainPaymentMethod = "Split";
  } else if (finalPayments.length === 1) {
    mainPaymentMethod = finalPayments[0].method;
  }

  // Start Transaction Logic
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // 2. Insert into Sales Table (outlet_id + employee_id + customer_id + discount + points)
    db.run(
      "INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, points_earned, points_redeemed, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        totalAmount,
        mainPaymentMethod,
        outlet_id,
        employee_id || null,
        customer_id || null,
        discountValue,
        discount_type,
        points_earned,
        points_redeemed,
        notes || null,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Failed to create sale record" });
        }

        const saleId = this.lastID;
        const itemsStmt = db.prepare(
          "INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale, cost_price_at_sale) VALUES (?, ?, ?, ?, ?, ?)",
        );
        const stockStmt = db.prepare(`
                    UPDATE outlet_stock 
                    SET quantity = quantity - ? 
                    WHERE product_id = ? AND outlet_id = ?
                `);
        const variantStockStmt = db.prepare(`
                    UPDATE product_variants 
                    SET stock = stock - ? 
                    WHERE id = ?
                `);
        const paymentsStmt = db.prepare(
          "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)",
        );

        let hasError = false;

        // 3. Loop through cart to insert Line Items AND deduct stock
        cartItems.forEach((item) => {
          itemsStmt.run(
            saleId,
            item.original_product_id || item.id,
            item.variant_id || null,
            item.quantity,
            item.price,
            item.cost_price || 0,
            (err) => {
              if (err) hasError = true;
            },
          );

          if (item.variant_id) {
            variantStockStmt.run(item.quantity, item.variant_id, (err) => {
              if (err) hasError = true;
            });
          } else {
            stockStmt.run(item.quantity, item.id, outlet_id, (err) => {
              if (err) hasError = true;
            });
          }
        });

        // 4. Insert Payments
        finalPayments.forEach((payment) => {
          paymentsStmt.run(saleId, payment.method, payment.amount, (err) => {
            if (err) hasError = true;
          });
        });

        itemsStmt.finalize();
        stockStmt.finalize();
        variantStockStmt.finalize();
        paymentsStmt.finalize();

        // Update customer points if applicable
        if (customer_id && (points_earned > 0 || points_redeemed > 0)) {
          db.run(
            "UPDATE customers SET loyalty_points = loyalty_points + ? - ? WHERE id = ?",
            [points_earned, points_redeemed, customer_id],
            (err) => {
              if (err) hasError = true;
            },
          );
        }

        // Debit wallet for any Wallet payments
        const walletPayments = finalPayments.filter((p) => p.method === "Wallet");
        if (customer_id && walletPayments.length > 0) {
          const walletTotal = walletPayments.reduce((s, p) => s + p.amount, 0);
          db.run(
            "UPDATE customers SET balance = COALESCE(balance, 0) - ? WHERE id = ?",
            [walletTotal, customer_id],
            (err) => { if (err) hasError = true; }
          );
          db.run(
            "INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, reference_id, note) VALUES (?, 'debit', ?, 'sale', ?, ?)",
            [customer_id, walletTotal, saleId, `Debit for Sale #${saleId}`],
            (err) => { if (err) hasError = true; }
          );
        }

        // 5. Commit or Rollback
        if (hasError) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Transaction failed" });
        }

        db.run("COMMIT", (err) => {
          if (err)
            return res.status(500).json({ error: "Failed to commit sale" });
          const syncChanges = cartItems.map((item) => ({
            product_id: item.original_product_id || item.product_id || item.id,
            variant_id: item.variant_id || null,
            outlet_id,
            delta: -1 * Number(item.quantity || 0),
            reason: "sale",
            reference_type: "sale",
            reference_id: saleId,
          }));
          enqueueInventorySyncEvents(syncChanges, {}, () => {});
          assignInvoiceNumberToSale(saleId, 1, (invErr, invoiceNumber) => {
            if (invErr) {
              return res.status(500).json({
                error: "Sale committed but invoice finalization failed",
                saleId,
                details: invErr.message,
              });
            }
            res.json({
              message: "Sale completed successfully",
              saleId,
              totalAmount,
              invoiceNumber: invoiceNumber || null,
              payments: finalPayments,
            });
          });
        });
      },
    );
  });
});

// --- INVENTORY TRANSFERS ---

// Get all transfers (with product, outlet, employee names)
app.get("/api/transfers", (req, res) => {
  const query = `
        SELECT it.*,
               p.name as product_name, p.barcode,
               fo.name as from_outlet_name,
               to_o.name as to_outlet_name,
               e.name as employee_name
        FROM inventory_transfers it
        JOIN products p ON it.product_id = p.id
        JOIN outlets fo ON it.from_outlet_id = fo.id
        JOIN outlets to_o ON it.to_outlet_id = to_o.id
        LEFT JOIN employees e ON it.employee_id = e.id
        ORDER BY it.timestamp DESC
    `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ transfers: rows });
  });
});

// Create a new inventory transfer (atomically moves stock between outlets)
app.post("/api/transfers", requirePerm("manage_inventory"), (req, res) => {
  const {
    product_id,
    from_outlet_id,
    to_outlet_id,
    quantity,
    employee_id,
    note,
  } = req.body;

  if (!product_id || !from_outlet_id || !to_outlet_id || !quantity) {
    return res.status(400).json({
      error:
        "product_id, from_outlet_id, to_outlet_id, and quantity are required",
    });
  }
  if (from_outlet_id === to_outlet_id) {
    return res
      .status(400)
      .json({ error: "Source and destination outlets must be different" });
  }
  if (quantity <= 0) {
    return res
      .status(400)
      .json({ error: "Quantity must be greater than zero" });
  }

  // First: validate sufficient stock in source outlet
  db.get(
    "SELECT quantity FROM outlet_stock WHERE product_id = ? AND outlet_id = ?",
    [product_id, from_outlet_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const currentStock = row ? row.quantity : 0;
      if (currentStock < quantity) {
        return res.status(400).json({
          error: `Insufficient stock. Only ${currentStock} available at source outlet.`,
        });
      }

      // All valid — perform atomic transfer
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // 1. Record the transfer
        db.run(
          `INSERT INTO inventory_transfers (product_id, from_outlet_id, to_outlet_id, quantity, employee_id, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            product_id,
            from_outlet_id,
            to_outlet_id,
            quantity,
            employee_id || null,
            note || null,
          ],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to record transfer" });
            }
          },
        );

        // 2. Deduct from source outlet
        db.run(
          "UPDATE outlet_stock SET quantity = quantity - ? WHERE product_id = ? AND outlet_id = ?",
          [quantity, product_id, from_outlet_id],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to deduct stock from source outlet" });
            }
          },
        );

        // 3. Add to destination outlet (upsert)
        db.run(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES (?, ?, ?)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
          [product_id, to_outlet_id, quantity, quantity],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to add stock to destination outlet" });
            }
          },
        );

        // 4. Commit
        db.run("COMMIT", (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to commit transfer transaction" });
          enqueueInventorySyncEvents(
            [
              {
                product_id,
                outlet_id: from_outlet_id,
                delta: -1 * Number(quantity || 0),
                reason: "transfer_out",
                reference_type: "transfer",
                reference_id: null,
              },
              {
                product_id,
                outlet_id: to_outlet_id,
                delta: Number(quantity || 0),
                reason: "transfer_in",
                reference_type: "transfer",
                reference_id: null,
              },
            ],
            {},
            () => {},
          );
          res.json({ message: "Transfer completed successfully" });
        });
      });
    },
  );
});

// --- STOCK ADJUSTMENTS ---

app.get("/api/adjustments", (req, res) => {
  const query = `
        SELECT sa.*, p.name as product_name, p.barcode, o.name as outlet_name, e.name as employee_name
        FROM stock_adjustments sa
        JOIN products p ON sa.product_id = p.id
        JOIN outlets o ON sa.outlet_id = o.id
        LEFT JOIN employees e ON sa.employee_id = e.id
        ORDER BY sa.timestamp DESC
    `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/adjustments", requirePerm("manage_inventory"), (req, res) => {
  const { product_id, outlet_id, employee_id, quantity_change, reason } =
    req.body;

  if (!product_id || !outlet_id || quantity_change === undefined || !reason) {
    return res
      .status(400)
      .json({ error: "Missing required fields for stock adjustment" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // Insert adjustment record
    db.run(
      `INSERT INTO stock_adjustments (product_id, outlet_id, employee_id, quantity_change, reason)
             VALUES (?, ?, ?, ?, ?)`,
      [product_id, outlet_id, employee_id || null, quantity_change, reason],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Failed to record adjustment" });
        }
        const adjustmentId = this.lastID;

        // Upsert outlet_stock
        db.run(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                     VALUES (?, ?, ?)
                     ON CONFLICT(product_id, outlet_id) 
                     DO UPDATE SET quantity = quantity + ?`,
          [product_id, outlet_id, quantity_change, quantity_change],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: "Failed to update stock" });
            }

            db.run("COMMIT", (err) => {
              if (err)
                return res
                  .status(500)
                  .json({ error: "Failed to commit adjustment transaction" });
              enqueueInventorySyncEvents(
                [
                  {
                    product_id,
                    outlet_id,
                    delta: Number(quantity_change || 0),
                    reason: "adjustment",
                    reference_type: "adjustment",
                    reference_id: adjustmentId || null,
                  },
                ],
                {},
                () => {},
              );
              res.json({ message: "Stock adjusted successfully" });
            });
          },
        );
      },
    );
  });
});

// --- REPORTS DASHBOARD ---

app.get("/api/reports/dashboard", async (req, res) => {
  try {
    const getQuery = (query, params = []) =>
      new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) =>
          err ? reject(err) : resolve(rows),
        );
      });

    // 1. Z-Report: Today's Revenue by Payment Method (handles split tenders & backward compatibility)
    const zReport = await getQuery(`
            SELECT COALESCE(sp.payment_method, s.payment_method) as payment_method, 
                   SUM(COALESCE(sp.amount, s.total_amount)) as total
            FROM sales s
            LEFT JOIN sale_payments sp ON s.id = sp.sale_id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
            GROUP BY COALESCE(sp.payment_method, s.payment_method)
        `);
    const totalRevenueToday = zReport.reduce((sum, row) => sum + row.total, 0);

    // Calculate Tax Exclusive Revenue vs Inclusive
    // We calculate this mathematically based on the products sold today and their live GST profile (or the stored gst)
    const revenueMetrics = await getQuery(`
            SELECT 
                SUM(si.quantity * si.price_at_sale) as tax_inclusive,
                SUM(
                  CASE 
                    WHEN p.tax_id IS NOT NULL THEN (si.quantity * si.price_at_sale) / (1 + (t.rate / 100))
                    ELSE (si.quantity * si.price_at_sale) / (1 + (COALESCE(p.gst, 0) / 100))
                  END
                ) as tax_exclusive,
                SUM(si.quantity * si.cost_price_at_sale) as total_cost
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN taxes t ON p.tax_id = t.id
            WHERE date(s.timestamp, 'localtime') = date('now', 'localtime')
        `);

    const taxInclusive = revenueMetrics[0]?.tax_inclusive || 0;
    const taxExclusive = revenueMetrics[0]?.tax_exclusive || 0;
    const totalCost = revenueMetrics[0]?.total_cost || 0;
    const todayProfit = taxExclusive - totalCost; // Profit is on exclusive revenue

    // Count of sales today
    const saleCountRow = await getQuery(
      `SELECT COUNT(id) as count FROM sales WHERE date(timestamp, 'localtime') = date('now', 'localtime')`,
    );
    const saleCount = saleCountRow[0]?.count || 0;

    // 3. Top Selling Items (All time)
    const topSelling = await getQuery(`
            SELECT p.name, SUM(si.quantity) as total_sold
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            GROUP BY p.name
            ORDER BY total_sold DESC
            LIMIT 5
        `);

    // 4. Low Stock Alert (Threshold: 10 or less) — using outlet_stock as source of truth
    const lowStock = await getQuery(`
            SELECT p.name, p.barcode, p.price, p.cost_price, COALESCE(SUM(os.quantity), 0) as stock
            FROM products p
            LEFT JOIN outlet_stock os ON p.id = os.product_id
            GROUP BY p.id
            HAVING stock <= 10
            ORDER BY stock ASC
        `);

    // 5. Estimated Inventory Value — using outlet_stock as source of truth
    const inventoryValueRow = await getQuery(`
            SELECT 
                SUM(os.quantity * p.price) as retail_value,
                SUM(os.quantity * p.cost_price) as cost_value
            FROM outlet_stock os
            JOIN products p ON os.product_id = p.id
            WHERE os.quantity > 0
        `);

    // 6. Last 7 days sales trend (for chart)
    const salesTrend = await getQuery(`
      SELECT date(timestamp,'localtime') as day,
             ROUND(SUM(total_amount),2) as revenue,
             COUNT(id) as sale_count
      FROM sales
      WHERE voided = 0
        AND date(timestamp,'localtime') >= date('now','-6 days','localtime')
      GROUP BY day
      ORDER BY day ASC
    `);

    // 7. Today's expenses total (deducted from net profit)
    const expenseRows = await getQuery(
      `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date = date('now','localtime')`
    );
    const todayExpenses = expenseRows[0]?.total || 0;
    const netProfitToday = todayProfit - todayExpenses;

    res.json({
      zReport,
      totalRevenueToday,
      taxInclusive,
      taxExclusive,
      todayProfit: netProfitToday,
      todayGrossProfit: todayProfit,
      todayExpenses,
      saleCount,
      topSelling,
      lowStock,
      salesTrend,
      inventoryValue: inventoryValueRow[0] || {
        retail_value: 0,
        cost_value: 0,
      },
    });
  } catch (err) {
    console.error("Report Error:", err);
    res.status(500).json({ error: "Failed to generate reports" });
  }
});

// Top Salespeople report
app.get("/api/reports/top-salespeople", (req, res) => {
  const { date_from, date_to } = req.query;
  const where = ["s.voided = 0", "s.employee_id IS NOT NULL"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT e.name AS employee_name,
           COUNT(DISTINCT s.id) AS transactions,
           ROUND(SUM(s.total_amount), 2) AS revenue,
           SUM(si.quantity) AS items_sold,
           ROUND(SUM(s.total_amount) / COUNT(DISTINCT s.id), 2) AS avg_basket
    FROM sales s
    JOIN employees e ON s.employee_id = e.id
    LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.employee_id
    ORDER BY revenue DESC
  `;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ salespeople: rows });
  });
});

// --- CASH MANAGEMENT ---

// GET all shifts (newest first, with outlet + employee names)
app.get("/api/shifts", (req, res) => {
  const { outlet_id } = req.query;
  let query = `
    SELECT cs.*, o.name as outlet_name, e.name as employee_name
    FROM cash_shifts cs
    JOIN outlets o ON cs.outlet_id = o.id
    LEFT JOIN employees e ON cs.employee_id = e.id
  `;
  const params = [];
  if (outlet_id) {
    query += " WHERE cs.outlet_id = ?";
    params.push(outlet_id);
  }
  query += " ORDER BY cs.opened_at DESC";

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ shifts: rows });
  });
});

// GET active shift for an outlet (used by POS to check before checkout)
app.get("/api/shifts/active", (req, res) => {
  const { outlet_id } = req.query;
  if (!outlet_id)
    return res.status(400).json({ error: "outlet_id is required" });

  db.get(
    `SELECT cs.*, o.name as outlet_name, e.name as employee_name
     FROM cash_shifts cs
     JOIN outlets o ON cs.outlet_id = o.id
     LEFT JOIN employees e ON cs.employee_id = e.id
     WHERE cs.outlet_id = ? AND cs.status = 'open'
     ORDER BY cs.opened_at DESC LIMIT 1`,
    [outlet_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ shift: row || null });
    },
  );
});

// POST open a new shift
app.post("/api/shifts/open", (req, res) => {
  const { outlet_id, employee_id, opening_float } = req.body;

  if (!outlet_id || opening_float === undefined) {
    return res
      .status(400)
      .json({ error: "outlet_id and opening_float are required" });
  }

  // Check if there's already an open shift for this outlet
  db.get(
    "SELECT id FROM cash_shifts WHERE outlet_id = ? AND status = 'open'",
    [outlet_id],
    (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (existing) {
        return res.status(400).json({
          error: "A shift is already open for this outlet. Close it first.",
        });
      }

      db.run(
        "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float) VALUES (?, ?, ?)",
        [outlet_id, employee_id || null, opening_float],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Shift opened successfully",
            shift_id: this.lastID,
          });
        },
      );
    },
  );
});

// POST close a shift — auto-calculates expected cash from cash sales during shift period
app.post("/api/shifts/:id/close", (req, res) => {
  const { id } = req.params;
  const { closing_cash, notes, variance_reason, variance_approved_by, denominations } = req.body;

  if (closing_cash === undefined) {
    return res.status(400).json({ error: "closing_cash is required" });
  }

  // Get the shift first
  db.get(
    "SELECT * FROM cash_shifts WHERE id = ? AND status = 'open'",
    [id],
    (err, shift) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!shift)
        return res.status(404).json({ error: "Open shift not found" });

      // Sum all cash payments for this outlet during this shift period
      db.get(
        `SELECT COALESCE(SUM(sp.amount), 0) as cash_sales
       FROM sale_payments sp
       JOIN sales s ON sp.sale_id = s.id
       WHERE s.outlet_id = ?
         AND s.voided = 0
         AND sp.payment_method = 'Cash'
         AND s.timestamp >= ?`,
        [shift.outlet_id, shift.opened_at],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });

          const cashSales = row?.cash_sales || 0;

          db.get(
            `SELECT COALESCE(SUM(total_refund), 0) as cash_refunds
             FROM returns
             WHERE outlet_id = ?
               AND refund_method = 'Cash'
               AND timestamp >= ?`,
            [shift.outlet_id, shift.opened_at],
            (err, refundRow) => {
              if (err) return res.status(500).json({ error: err.message });

              const cashRefunds = refundRow?.cash_refunds || 0;
              const netCashSales = cashSales - cashRefunds;
              const expectedCash =
                parseFloat(shift.opening_float) + netCashSales;
              const variance = parseFloat(closing_cash) - expectedCash;
              const closedAt = new Date()
                .toISOString()
                .replace("T", " ")
                .slice(0, 19);

              db.run(
                `UPDATE cash_shifts
               SET status = 'closed', closing_cash = ?, expected_cash = ?, variance = ?,
                   closed_at = ?, notes = ?, variance_reason = ?, variance_approved_by = ?
               WHERE id = ?`,
                [
                  closing_cash,
                  expectedCash,
                  variance,
                  closedAt,
                  notes || null,
                  variance_reason || null,
                  variance_approved_by || null,
                  id,
                ],
                function (err) {
                  if (err) return res.status(500).json({ error: err.message });
                  // Store denomination breakdown if provided
                  if (denominations && denominations.length > 0) {
                    const stmt = db.prepare(
                      "INSERT INTO shift_denominations (shift_id, denomination, count) VALUES (?,?,?)"
                    );
                    denominations.forEach((d) => {
                      if (d.count > 0)
                        stmt.run([id, d.denomination, d.count]);
                    });
                    stmt.finalize();
                  }
                  res.json({
                    message: "Shift closed successfully",
                    opening_float: shift.opening_float,
                    cash_sales: cashSales,
                    cash_refunds: cashRefunds,
                    net_cash_sales: netCashSales,
                    expected_cash: expectedCash,
                    closing_cash,
                    variance,
                    variance_reason: variance_reason || null,
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

// GET denomination breakdown for a shift
app.get("/api/shifts/:id/denominations", (req, res) => {
  db.all(
    "SELECT denomination, count, subtotal FROM shift_denominations WHERE shift_id = ? ORDER BY denomination DESC",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ denominations: rows });
    }
  );
});

// GET variance reason codes (static list)
app.get("/api/variance-reasons", (req, res) => {
  res.json({
    reasons: [
      "Counting error",
      "Till refund not recorded",
      "Change given incorrectly",
      "Currency denomination mix-up",
      "Tip/gratuity retained",
      "Manager override",
      "Other",
    ],
  });
});

// --- EMPLOYEE ATTENDANCE ---

app.get("/api/attendance", (req, res) => {
  const { date_from, date_to, employee_id } = req.query;
  const where = [];
  const params = [];
  if (date_from) {
    where.push("date(ea.check_in,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(ea.check_in,'localtime') <= ?");
    params.push(date_to);
  }
  if (employee_id) {
    where.push("ea.employee_id = ?");
    params.push(employee_id);
  }
  const sql = `
    SELECT ea.*, e.name AS employee_name, e.role, o.name AS outlet_name
    FROM employee_attendance ea
    JOIN employees e ON ea.employee_id = e.id
    JOIN outlets o ON ea.outlet_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ea.check_in DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ records: rows });
  });
});

app.post("/api/attendance/checkin", (req, res) => {
  const { employee_id, outlet_id } = req.body;
  if (!employee_id || !outlet_id)
    return res
      .status(400)
      .json({ error: "employee_id and outlet_id are required" });
  db.run(
    "INSERT INTO employee_attendance (employee_id, outlet_id, status) VALUES (?, ?, 'present')",
    [employee_id, outlet_id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        "SELECT * FROM employee_attendance WHERE id = ?",
        [this.lastID],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ attendance: row });
        },
      );
    },
  );
});

app.post("/api/attendance/:id/checkout", (req, res) => {
  const { id } = req.params;
  db.get(
    "SELECT * FROM employee_attendance WHERE id = ?",
    [id],
    (err, record) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!record)
        return res.status(404).json({ error: "Attendance record not found" });
      if (record.check_out)
        return res.status(400).json({ error: "Already clocked out" });
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);
      const hours = parseFloat(
        ((new Date() - new Date(record.check_in)) / 3600000).toFixed(2),
      );
      db.run(
        "UPDATE employee_attendance SET check_out = ?, hours = ? WHERE id = ?",
        [now, hours, id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({
            message: "Clocked out successfully",
            hours,
            check_out: now,
          });
        },
      );
    },
  );
});

// --- EXTENDED REPORTS ---

// Sales Summary: per-sale header with outlet, employee, customer, payment methods
app.get("/api/reports/sales-summary", (req, res) => {
  const { date_from, date_to, search } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  if (search) {
    where.push("(CAST(s.id AS TEXT) LIKE ? OR COALESCE(c.name,'') LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT s.id, s.timestamp, s.total_amount,
           COALESCE(c.name,'Walk-in') AS customer_name,
           COALESCE(e.name,'—') AS employee_name,
           COALESCE(o.name,'—') AS outlet_name,
           GROUP_CONCAT(DISTINCT COALESCE(sp.payment_method, s.payment_method)) AS payment_methods
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN employees e ON s.employee_id = e.id
    LEFT JOIN outlets o ON s.outlet_id = o.id
    LEFT JOIN sale_payments sp ON s.id = sp.sale_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id
    ORDER BY s.timestamp DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ sales: rows });
  });
});

// Sales Detail: flat line-item list with parent sale info
app.get("/api/reports/sales-detail", (req, res) => {
  const { date_from, date_to, search } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  if (search) {
    where.push("(p.name LIKE ? OR CAST(s.id AS TEXT) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT s.id AS sale_id, s.timestamp, COALESCE(c.name,'Walk-in') AS customer_name,
           p.name AS product_name, p.barcode,
           si.quantity, si.price_at_sale, si.cost_price_at_sale,
           (si.quantity * si.price_at_sale) AS line_total
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE ${where.join(" AND ")}
    ORDER BY s.timestamp DESC, si.id ASC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ items: rows });
  });
});

// Sales & Stock: product with all-time sales + current stock
app.get("/api/reports/sales-stock", (req, res) => {
  const sql = `
    SELECT p.id, p.name, p.barcode, COALESCE(cat.name,'—') AS category,
           COALESCE(SUM(DISTINCT os.quantity),0) AS total_stock,
           COALESCE(SUM(si.quantity),0) AS units_sold,
           COALESCE(SUM(si.quantity * si.price_at_sale),0) AS revenue
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN outlet_stock os ON p.id = os.product_id
    LEFT JOIN sale_items si ON p.id = si.product_id
    GROUP BY p.id
    ORDER BY units_sold DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Inventory Dump: stock per product per outlet with full product info
app.get("/api/reports/inventory-dump", (req, res) => {
  const { outlet_id } = req.query;
  let where = [];
  const params = [];
  if (outlet_id) {
    where.push("os.outlet_id = ?");
    params.push(outlet_id);
  }
  const sql = `
    SELECT o.name AS outlet_name, p.name AS product_name, p.barcode,
           COALESCE(cat.name,'—') AS category, COALESCE(b.name,'—') AS brand,
           p.price, p.cost_price, os.quantity,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY o.name, p.name`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Category Wise: sales grouped by product category
app.get("/api/reports/category-wise", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT COALESCE(cat.name,'Uncategorized') AS category,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS profit
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    WHERE ${where.join(" AND ")}
    GROUP BY cat.id
    ORDER BY revenue DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    const data = rows.map((r) => ({
      ...r,
      pct: total > 0 ? ((r.revenue / total) * 100).toFixed(1) : "0.0",
    }));
    res.json({ data });
  });
});

// Product Specification: full product table with all FK names
app.get("/api/reports/product-spec", (req, res) => {
  const { search } = req.query;
  let where = [];
  const params = [];
  if (search) {
    where.push("(p.name LIKE ? OR p.barcode LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const sql = `
    SELECT p.id, p.barcode, p.name, p.price, p.cost_price,
           COALESCE(cat.name,'—') AS category, COALESCE(b.name,'—') AS brand,
           COALESCE(sup.name,'—') AS supplier,
           COALESCE(t.name,'—') AS tax_name, COALESCE(t.rate, p.gst, 0) AS tax_rate
    FROM products p
    LEFT JOIN categories cat ON p.category_id = cat.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN suppliers sup ON p.supplier_id = sup.id
    LEFT JOIN taxes t ON p.tax_id = t.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// On Hand Inventory: current stock per product per outlet
app.get("/api/reports/on-hand", (req, res) => {
  const { outlet_id } = req.query;
  let where = [];
  const params = [];
  if (outlet_id) {
    where.push("os.outlet_id = ?");
    params.push(outlet_id);
  }
  const sql = `
    SELECT p.name AS product_name, p.barcode, o.name AS outlet_name,
           os.quantity, p.price, p.cost_price,
           (os.quantity * p.price) AS retail_value,
           (os.quantity * p.cost_price) AS cost_value
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.name, o.name`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Item Wise: sales grouped by product
app.get("/api/reports/item-wise", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY units_sold DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Product Performance: same as item-wise but sorted by margin %
app.get("/api/reports/product-performance", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["s.voided = 0"];
  const params = [];
  if (date_from) {
    where.push("date(s.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(s.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT p.id, p.name AS product_name, p.barcode,
           SUM(si.quantity) AS units_sold,
           SUM(si.quantity * si.price_at_sale) AS revenue,
           SUM(si.quantity * si.cost_price_at_sale) AS total_cost,
           SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale) AS gross_profit,
           CASE WHEN SUM(si.quantity * si.price_at_sale) > 0
                THEN ROUND(((SUM(si.quantity * si.price_at_sale) - SUM(si.quantity * si.cost_price_at_sale))
                     / SUM(si.quantity * si.price_at_sale)) * 100, 1)
                ELSE 0 END AS margin_pct
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY margin_pct DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Inventory Loss: stock adjustments with negative quantity
app.get("/api/reports/inventory-loss", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["sa.quantity_change < 0"];
  const params = [];
  if (date_from) {
    where.push("date(sa.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(sa.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Wastage: stock adjustments for Damaged or Expired reasons
app.get("/api/reports/wastage", (req, res) => {
  const { date_from, date_to } = req.query;
  let where = ["sa.reason IN ('Damaged','Expired')"];
  const params = [];
  if (date_from) {
    where.push("date(sa.timestamp,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(sa.timestamp,'localtime') <= ?");
    params.push(date_to);
  }
  const sql = `
    SELECT sa.timestamp, p.name AS product_name, p.barcode,
           o.name AS outlet_name, COALESCE(e.name,'—') AS employee_name,
           sa.quantity_change, sa.reason
    FROM stock_adjustments sa
    JOIN products p ON sa.product_id = p.id
    JOIN outlets o ON sa.outlet_id = o.id
    LEFT JOIN employees e ON sa.employee_id = e.id
    WHERE ${where.join(" AND ")}
    ORDER BY sa.timestamp DESC`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// Replenishment: products at or below threshold per outlet
app.get("/api/reports/replenishment", (req, res) => {
  const threshold = parseInt(req.query.threshold) || 10;
  const sql = `
    SELECT p.name AS product_name, p.barcode,
           o.name AS outlet_name, os.quantity
    FROM outlet_stock os
    JOIN products p ON os.product_id = p.id
    JOIN outlets o ON os.outlet_id = o.id
    WHERE os.quantity <= ?
    ORDER BY os.quantity ASC, p.name ASC`;
  db.all(sql, [threshold], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows, threshold });
  });
});

// Supplier Wise: PO spending aggregated per supplier
app.get("/api/reports/supplier-wise", (req, res) => {
  const sql = `
    SELECT s.id, s.name AS supplier_name, s.contact_person, s.phone,
           COUNT(DISTINCT po.id) AS total_pos,
           COALESCE(SUM(poi.quantity),0) AS total_items,
           COALESCE(SUM(poi.quantity * poi.cost_price),0) AS total_cost
    FROM suppliers s
    LEFT JOIN purchase_orders po ON s.id = po.supplier_id
    LEFT JOIN purchase_order_items poi ON po.id = poi.po_id
    GROUP BY s.id
    ORDER BY total_cost DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ rows });
  });
});

// --- ROUTES: RETURNS ---

// Create a new return
app.post("/api/returns", (req, res) => {
  const {
    original_sale_id,
    outlet_id,
    employee_id,
    customer_id,
    total_refund,
    refund_method,
    reason,
    items,
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Return must have items" });
  }
  if (!outlet_id) {
    return res
      .status(400)
      .json({ error: "Outlet ID is required for restocking" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "INSERT INTO returns (original_sale_id, outlet_id, employee_id, customer_id, total_refund, refund_method, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        original_sale_id || null,
        outlet_id,
        employee_id || null,
        customer_id || null,
        total_refund,
        refund_method,
        reason || null,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Failed to create return: " + err.message });
        }

        const returnId = this.lastID;
        const insertItemStmt = db.prepare(
          "INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES (?, ?, ?, ?)",
        );
        const updateStockStmt = db.prepare(`
          INSERT INTO outlet_stock (product_id, outlet_id, quantity)
          VALUES (?, ?, ?)
          ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?
        `);

        let hasError = false;

        items.forEach((item) => {
          insertItemStmt.run(
            returnId,
            item.product_id,
            item.quantity,
            item.refund_price,
            (err) => {
              if (err) hasError = true;
            },
          );
          // Restock the returned items
          updateStockStmt.run(
            item.product_id,
            outlet_id,
            item.quantity,
            item.quantity,
            (err) => {
              if (err) hasError = true;
            },
          );
        });

        insertItemStmt.finalize();
        updateStockStmt.finalize();

        if (hasError) {
          db.run("ROLLBACK");
          return res.status(500).json({
            error: "Transaction failed while processing return items",
          });
        }

        db.run("COMMIT", (err) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Failed to commit return transaction" });
          const syncChanges = items.map((item) => ({
            product_id: item.product_id,
            outlet_id,
            delta: Number(item.quantity || 0),
            reason: "return",
            reference_type: "return",
            reference_id: returnId,
          }));
          enqueueInventorySyncEvents(syncChanges, {}, () => {});
          res.json({ message: "Return processed successfully", id: returnId });
        });
      },
    );
  });
});

// Get all returns (with details)
app.get("/api/returns", (req, res) => {
  const { date_from, date_to } = req.query;
  const where = [];
  const params = [];

  if (date_from) {
    where.push("date(r.timestamp, 'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(r.timestamp, 'localtime') <= ?");
    params.push(date_to);
  }

  const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

  const sql = `
    SELECT r.*,
           o.name as outlet_name,
           e.name as employee_name,
           c.name as customer_name,
           COUNT(ri.id) as item_count
    FROM returns r
    LEFT JOIN outlets o ON r.outlet_id = o.id
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN customers c ON r.customer_id = c.id
    LEFT JOIN return_items ri ON r.id = ri.return_id
    ${whereClause}
    GROUP BY r.id
    ORDER BY r.timestamp DESC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ returns: rows });
  });
});

// Get a single return with items
app.get("/api/returns/:id", (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT r.*, o.name as outlet_name, e.name as employee_name, c.name as customer_name
    FROM returns r
    LEFT JOIN outlets o ON r.outlet_id = o.id
    LEFT JOIN employees e ON r.employee_id = e.id
    LEFT JOIN customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `;

  db.get(sql, [id], (err, returnRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!returnRow) return res.status(404).json({ error: "Return not found" });

    db.all(
      `SELECT ri.*, p.name as product_name, p.barcode
       FROM return_items ri
       JOIN products p ON ri.product_id = p.id
       WHERE ri.return_id = ?`,
      [id],
      (err, items) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ returnData: returnRow, items });
      },
    );
  });
});

// --- ROUTES: ATTRIBUTE SETS ---

// Get all attribute sets with nested attributes and options
app.get("/api/attribute-sets", (req, res) => {
  db.all("SELECT * FROM attribute_sets ORDER BY name ASC", [], (err, sets) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sets || sets.length === 0) return res.json({ attributeSets: [] });

    db.all("SELECT * FROM attributes", [], (err, attributes) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all("SELECT * FROM attribute_options", [], (err, options) => {
        if (err) return res.status(500).json({ error: err.message });

        // Build nested structure
        const enrichedSets = sets.map((s) => {
          const setAttrs = attributes.filter(
            (a) => a.attribute_set_id === s.id,
          );
          const enrichedAttrs = setAttrs.map((a) => {
            return {
              ...a,
              options: options.filter((o) => o.attribute_id === a.id),
            };
          });
          return { ...s, attributes: enrichedAttrs };
        });

        res.json({ attributeSets: enrichedSets });
      });
    });
  });
});

// Create an attribute set with its attributes and options
app.post("/api/attribute-sets", (req, res) => {
  const { name, description, attributes } = req.body;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "INSERT INTO attribute_sets (name, description) VALUES (?, ?)",
      [name, description],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        const setId = this.lastID;

        if (!attributes || attributes.length === 0) {
          db.run("COMMIT");
          return res.json({ id: setId, name, description, attributes: [] });
        }

        let pendingAttributes = attributes.length;
        let hasError = false;

        attributes.forEach((attr) => {
          if (hasError) return;

          db.run(
            "INSERT INTO attributes (name, attribute_set_id) VALUES (?, ?)",
            [attr.name, setId],
            function (err2) {
              if (err2) {
                hasError = true;
                db.run("ROLLBACK");
                return res.status(500).json({ error: err2.message });
              }

              const attrId = this.lastID;
              const options = attr.options || [];

              if (options.length === 0) {
                pendingAttributes--;
                if (pendingAttributes === 0 && !hasError) {
                  db.run("COMMIT");
                  res.json({ message: "Attribute set created", id: setId });
                }
                return;
              }

              let pendingOptions = options.length;
              options.forEach((opt) => {
                if (hasError) return;
                const optValue = typeof opt === "string" ? opt : opt.value;
                db.run(
                  "INSERT INTO attribute_options (attribute_id, value) VALUES (?, ?)",
                  [attrId, optValue],
                  function (err3) {
                    if (err3) {
                      hasError = true;
                      db.run("ROLLBACK");
                      return res.status(500).json({ error: err3.message });
                    }
                    pendingOptions--;
                    if (pendingOptions === 0) {
                      pendingAttributes--;
                      if (pendingAttributes === 0 && !hasError) {
                        db.run("COMMIT");
                        res.json({
                          message: "Attribute set created",
                          id: setId,
                        });
                      }
                    }
                  },
                );
              });
            },
          );
        });
      },
    );
  });
});

// Update attribute set (full replace of attributes + options)
app.put("/api/attribute-sets/:id", (req, res) => {
  const { id } = req.params;
  const { name, description, attributes } = req.body;

  if (!name) return res.status(400).json({ error: "Name is required" });

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    db.run(
      "UPDATE attribute_sets SET name = ?, description = ? WHERE id = ?",
      [name, description || null, id],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Attribute set name must be unique" });
          }
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          db.run("ROLLBACK");
          return res.status(404).json({ error: "Attribute set not found" });
        }

        // Delete old attributes (CASCADE removes attribute_options too)
        db.run("DELETE FROM attributes WHERE attribute_set_id = ?", [id], (err2) => {
          if (err2) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err2.message });
          }

          if (!attributes || attributes.length === 0) {
            db.run("COMMIT");
            return res.json({ message: "Attribute set updated", id });
          }

          let pendingAttributes = attributes.length;
          let hasError = false;

          attributes.forEach((attr) => {
            if (hasError) return;

            db.run(
              "INSERT INTO attributes (name, attribute_set_id) VALUES (?, ?)",
              [attr.name, id],
              function (err3) {
                if (err3) {
                  hasError = true;
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err3.message });
                }

                const attrId = this.lastID;
                const options = attr.options || [];

                if (options.length === 0) {
                  pendingAttributes--;
                  if (pendingAttributes === 0 && !hasError) {
                    db.run("COMMIT");
                    res.json({ message: "Attribute set updated", id });
                  }
                  return;
                }

                let pendingOptions = options.length;
                options.forEach((opt) => {
                  if (hasError) return;
                  const optValue = typeof opt === "string" ? opt : opt.value;
                  db.run(
                    "INSERT INTO attribute_options (attribute_id, value) VALUES (?, ?)",
                    [attrId, optValue],
                    function (err4) {
                      if (err4) {
                        hasError = true;
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err4.message });
                      }
                      pendingOptions--;
                      if (pendingOptions === 0) {
                        pendingAttributes--;
                        if (pendingAttributes === 0 && !hasError) {
                          db.run("COMMIT");
                          res.json({
                            message: "Attribute set updated",
                            id,
                          });
                        }
                      }
                    },
                  );
                });
              },
            );
          });
        });
      },
    );
  });
});

// Delete attribute set
app.delete("/api/attribute-sets/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM attribute_sets WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted successfully" });
  });
});

// --- RECEIPT TEMPLATES ---

app.get("/api/receipt-templates", (req, res) => {
  db.all("SELECT * FROM receipt_templates ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ templates: rows });
  });
});

app.get("/api/receipt-templates/active", (req, res) => {
  db.get(
    "SELECT * FROM receipt_templates WHERE is_active = 1 ORDER BY id DESC LIMIT 1",
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ template: row || null });
    },
  );
});

app.post("/api/receipt-templates", (req, res) => {
  const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  db.serialize(() => {
    if (is_active) db.run("UPDATE receipt_templates SET is_active = 0");
    db.run(
      "INSERT INTO receipt_templates (name, header_text, footer_text, show_barcode, show_logo, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      [name, header_text || "", footer_text || "", show_barcode ? 1 : 0, show_logo ? 1 : 0, is_active ? 1 : 0],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: "Template created" });
      },
    );
  });
});

app.put("/api/receipt-templates/:id", (req, res) => {
  const { id } = req.params;
  const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  db.serialize(() => {
    if (is_active) db.run("UPDATE receipt_templates SET is_active = 0");
    db.run(
      "UPDATE receipt_templates SET name=?, header_text=?, footer_text=?, show_barcode=?, show_logo=?, is_active=? WHERE id=?",
      [name, header_text || "", footer_text || "", show_barcode ? 1 : 0, show_logo ? 1 : 0, is_active ? 1 : 0, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Template not found" });
        res.json({ message: "Template updated" });
      },
    );
  });
});

app.delete("/api/receipt-templates/:id", (req, res) => {
  db.run("DELETE FROM receipt_templates WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Template not found" });
    res.json({ message: "Template deleted" });
  });
});

// --- ACTION HISTORY ---

app.post("/api/action-history", (req, res) => {
  const { user_name, action_type, description } = req.body;
  if (!action_type || !description) {
    return res.status(400).json({ error: "Missing action details" });
  }

  db.run(
    "INSERT INTO action_history (user_name, action_type, description) VALUES (?, ?, ?)",
    [user_name || "System", action_type, description],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: "Action logged" });
    },
  );
});

app.get("/api/action-history", (req, res) => {
  const { search } = req.query;
  let where = "";
  let params = [];

  if (search) {
    where =
      "WHERE user_name LIKE ? OR action_type LIKE ? OR description LIKE ?";
    params = [`%${search}%`, `%${search}%`, `%${search}%`];
  }

  db.all(
    `SELECT * FROM action_history ${where} ORDER BY timestamp DESC LIMIT 500`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ logs: rows });
    },
  );
});

// --- SUPPLIER RETURNS (RMA) ---

app.get("/api/supplier-returns", (req, res) => {
  db.all(
    `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name, (SELECT COUNT(id) FROM supplier_return_items WHERE supplier_return_id = sr.id) as item_count 
     FROM supplier_returns sr
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     LEFT JOIN outlets o ON sr.outlet_id = o.id
     LEFT JOIN employees e ON sr.employee_id = e.id
     ORDER BY sr.return_date DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ returns: rows });
    },
  );
});

app.get("/api/supplier-returns/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT sr.*, s.name as supplier_name, o.name as outlet_name, e.name as employee_name 
     FROM supplier_returns sr 
     LEFT JOIN suppliers s ON sr.supplier_id = s.id
     LEFT JOIN outlets o ON sr.outlet_id = o.id
     LEFT JOIN employees e ON sr.employee_id = e.id
     WHERE sr.id = ?`,
    [id],
    (err, returnRow) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!returnRow) return res.status(404).json({ error: "RMA not found" });

      db.all(
        `SELECT sri.*, p.name as product_name, p.barcode 
         FROM supplier_return_items sri 
         JOIN products p ON sri.product_id = p.id 
         WHERE sri.supplier_return_id = ?`,
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ returnData: returnRow, items });
        },
      );
    },
  );
});

app.post("/api/supplier-returns", (req, res) => {
  const {
    supplier_id,
    employee_id,
    outlet_id,
    reason,
    reference_number,
    items,
  } = req.body;
  if (!supplier_id || !outlet_id || !items || items.length === 0) {
    return res.status(400).json({ error: "Missing required return payload" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const totalValue = items.reduce(
      (sum, item) => sum + item.quantity * (item.unit_price || 0),
      0,
    );

    db.run(
      "INSERT INTO supplier_returns (supplier_id, employee_id, outlet_id, reason, total_value, reference_number, status) VALUES (?, ?, ?, ?, ?, ?, 'Completed')",
      [
        supplier_id,
        employee_id || null,
        outlet_id,
        reason || null,
        totalValue,
        reference_number || null,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        const returnId = this.lastID;
        const itemsStmt = db.prepare(
          "INSERT INTO supplier_return_items (supplier_return_id, product_id, variant_id, quantity, unit_price, reason) VALUES (?, ?, ?, ?, ?, ?)",
        );
        const stockStmt = db.prepare(
          "UPDATE outlet_stock SET quantity = quantity - ? WHERE product_id = ? AND outlet_id = ?",
        );
        const variantStockStmt = db.prepare(
          "UPDATE product_variants SET stock = stock - ? WHERE id = ?",
        );

        let hasError = false;

        items.forEach((item) => {
          itemsStmt.run(
            returnId,
            item.product_id || item.id,
            item.variant_id || null,
            item.quantity,
            item.unit_price || item.cost_price || 0,
            item.reason || null,
            (err) => {
              if (err) hasError = true;
            },
          );

          if (item.variant_id) {
            variantStockStmt.run(item.quantity, item.variant_id, (err) => {
              if (err) hasError = true;
            });
          } else {
            stockStmt.run(
              item.quantity,
              item.product_id || item.id,
              outlet_id,
              (err) => {
                if (err) hasError = true;
              },
            );
          }
        });

        itemsStmt.finalize();
        stockStmt.finalize();
        variantStockStmt.finalize();

        if (hasError) {
          db.run("ROLLBACK");
          return res
            .status(500)
            .json({ error: "Transaction processed with failures" });
        }

        db.run("COMMIT", (err) => {
          if (err) return res.status(500).json({ error: err.message });
          const syncChanges = items.map((item) => ({
            product_id: item.product_id || item.id,
            variant_id: item.variant_id || null,
            outlet_id,
            delta: -1 * Number(item.quantity || 0),
            reason: "supplier_return",
            reference_type: "supplier_return",
            reference_id: returnId,
          }));
          enqueueInventorySyncEvents(syncChanges, {}, () => {});
          res.json({ message: "Supplier return processed", id: returnId });
        });
      },
    );
  });
});

// --- ROUTES: PARKED SALES (Phase 3) ---

// List all parked sales (with item count)
app.get("/api/parked-sales", (req, res) => {
  const { outlet_id } = req.query;
  let sql = `
    SELECT ps.*, e.name as employee_name, c.name as customer_name,
           COUNT(psi.id) as item_count
    FROM parked_sales ps
    LEFT JOIN employees e ON ps.employee_id = e.id
    LEFT JOIN customers c ON ps.customer_id = c.id
    LEFT JOIN parked_sale_items psi ON psi.parked_sale_id = ps.id
  `;
  const params = [];
  if (outlet_id) {
    sql += " WHERE ps.outlet_id = ?";
    params.push(outlet_id);
  }
  sql += " GROUP BY ps.id ORDER BY ps.parked_at DESC";
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ parkedSales: rows });
  });
});

// Get a single parked sale with all items
app.get("/api/parked-sales/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT ps.*, e.name as employee_name, c.name as customer_name
     FROM parked_sales ps
     LEFT JOIN employees e ON ps.employee_id = e.id
     LEFT JOIN customers c ON ps.customer_id = c.id
     WHERE ps.id = ?`,
    [id],
    (err, sale) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!sale) return res.status(404).json({ error: "Parked sale not found" });
      db.all(
        "SELECT * FROM parked_sale_items WHERE parked_sale_id = ?",
        [id],
        (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ parkedSale: sale, items });
        }
      );
    }
  );
});

// Park a sale (create)
app.post("/api/parked-sales", (req, res) => {
  const { employee_id, outlet_id, customer_id, label, notes, items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Cannot park an empty cart" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      "INSERT INTO parked_sales (employee_id, outlet_id, customer_id, label, notes) VALUES (?, ?, ?, ?, ?)",
      [employee_id || null, outlet_id || null, customer_id || null, label || null, notes || null],
      function (err) {
        if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
        const parkedId = this.lastID;
        const stmt = db.prepare(
          "INSERT INTO parked_sale_items (parked_sale_id, product_id, variant_id, product_name, quantity, price, effective_tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        items.forEach((item) => {
          stmt.run(parkedId, item.product_id || null, item.variant_id || null,
            item.product_name || item.name || "", item.quantity, item.price, item.effective_tax_rate || 0);
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Sale parked successfully", id: parkedId });
        });
      }
    );
  });
});

// Delete (unpark/restore) a parked sale
app.delete("/api/parked-sales/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM parked_sales WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Parked sale not found" });
    res.json({ message: "Parked sale removed" });
  });
});

// --- ROUTES: ORDERS (Website order staging before live Shopify integration) ---

app.get("/api/orders", requirePerm("manage_orders"), (req, res) => {
  const {
    source,
    order_status,
    payment_status,
    fulfillment_status,
    date_from,
    date_to,
    search,
  } = req.query;

  const where = ["1=1"];
  const params = [];

  if (source) {
    where.push("wo.source = ?");
    params.push(source);
  }
  if (order_status) {
    where.push("wo.order_status = ?");
    params.push(order_status);
  }
  if (payment_status) {
    where.push("wo.payment_status = ?");
    params.push(payment_status);
  }
  if (fulfillment_status) {
    where.push("wo.fulfillment_status = ?");
    params.push(fulfillment_status);
  }
  if (date_from) {
    where.push("date(wo.ordered_at,'localtime') >= ?");
    params.push(date_from);
  }
  if (date_to) {
    where.push("date(wo.ordered_at,'localtime') <= ?");
    params.push(date_to);
  }
  if (search) {
    where.push(
      "(wo.external_order_number LIKE ? OR wo.external_order_id LIKE ? OR COALESCE(c.name,'') LIKE ?)",
    );
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  db.all(
    `SELECT wo.*,
            c.name as customer_name,
            o.name as outlet_name,
            COUNT(woi.id) as item_count
     FROM web_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     LEFT JOIN outlets o ON wo.outlet_id = o.id
     LEFT JOIN web_order_items woi ON woi.web_order_id = wo.id
     WHERE ${where.join(" AND ")}
     GROUP BY wo.id
     ORDER BY COALESCE(wo.ordered_at, wo.created_at) DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ orders: rows || [] });
    },
  );
});

// Product-level media list (variant_id NULL records)
app.get("/api/products/:id/media", (req, res) => {
  const { id } = req.params;
  db.all(
    `SELECT id, product_id, variant_id, url, alt_text, position, created_at
     FROM product_media
     WHERE product_id = ? AND variant_id IS NULL
     ORDER BY position ASC, id ASC`,
    [id],
    (err, rows) => {
      if (err) {
        if (String(err.message || "").includes("no such table")) {
          return res.json({ media: [] });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ media: rows || [] });
    },
  );
});

app.post("/api/products/:id/media", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const { url, alt_text = null, position = 0 } = req.body || {};
  if (!url || !String(url).trim()) {
    return res.status(400).json({ error: "url is required" });
  }
  db.run(
    "INSERT INTO product_media (product_id, variant_id, url, alt_text, position) VALUES (?, NULL, ?, ?, ?)",
    [id, String(url).trim(), alt_text, Number(position) || 0],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, product_id: Number(id), url, alt_text, position: Number(position) || 0 });
    },
  );
});

app.delete("/api/products/:id/media/:mediaId", requirePerm("manage_inventory"), (req, res) => {
  const { id, mediaId } = req.params;
  db.get(
    "SELECT id, url FROM product_media WHERE id = ? AND product_id = ? AND variant_id IS NULL",
    [mediaId, id],
    (findErr, row) => {
      if (findErr) return res.status(500).json({ error: findErr.message });
      if (!row) return res.status(404).json({ error: "Media not found" });
      db.run("DELETE FROM product_media WHERE id = ?", [mediaId], (delErr) => {
        if (delErr) return res.status(500).json({ error: delErr.message });
        const url = String(row.url || "");
        if (url.startsWith("/uploads/products/")) {
          const filename = path.basename(url);
          const filePath = path.join(PRODUCT_UPLOADS_DIR, filename);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (_) { /* ignore file cleanup errors */ }
          }
        }
        res.json({ deleted: true });
      });
    },
  );
});

// Upload a product image file and return a served URL
const productImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PRODUCT_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
    cb(null, `product_${Date.now()}_${Math.round(Math.random() * 1e6)}${safeExt}`);
  },
});

const productImageUpload = multer({
  storage: productImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file || !file.mimetype) return cb(new Error("Invalid file"));
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    cb(null, true);
  },
});

app.post("/api/uploads/product-image", requirePerm("manage_inventory"), productImageUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });
  const relativeUrl = `/uploads/products/${req.file.filename}`;
  res.json({
    url: relativeUrl,
    filename: req.file.filename,
    original_name: req.file.originalname,
    size: req.file.size,
  });
});

app.get("/api/orders/:id", requirePerm("manage_orders"), (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT wo.*, c.name as customer_name, o.name as outlet_name
     FROM web_orders wo
     LEFT JOIN customers c ON wo.customer_id = c.id
     LEFT JOIN outlets o ON wo.outlet_id = o.id
     WHERE wo.id = ?`,
    [id],
    (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: "Order not found" });

      db.all(
        "SELECT * FROM web_order_items WHERE web_order_id = ? ORDER BY id ASC",
        [id],
        (itemErr, items) => {
          if (itemErr) return res.status(500).json({ error: itemErr.message });
          db.all(
            "SELECT * FROM web_order_transactions WHERE web_order_id = ? ORDER BY processed_at DESC, id DESC",
            [id],
            (txnErr, transactions) => {
              if (txnErr) return res.status(500).json({ error: txnErr.message });
              db.all(
                "SELECT * FROM web_order_fulfillments WHERE web_order_id = ? ORDER BY fulfilled_at DESC, id DESC",
                [id],
                (fulErr, fulfillments) => {
                  if (fulErr) return res.status(500).json({ error: fulErr.message });
                  res.json({
                    order,
                    items: items || [],
                    transactions: transactions || [],
                    fulfillments: fulfillments || [],
                  });
                },
              );
            },
          );
        },
      );
    },
  );
});

app.post("/api/orders", requirePerm("manage_orders"), (req, res) => {
  const {
    source = "shopify",
    external_order_id,
    external_order_number,
    customer_id,
    outlet_id,
    currency = "PKR",
    subtotal = 0,
    discount_total = 0,
    tax_total = 0,
    shipping_total = 0,
    grand_total = 0,
    payment_status = "pending",
    fulfillment_status = "unfulfilled",
    order_status = "open",
    ordered_at,
    raw_payload = null,
    items = [],
  } = req.body || {};

  if (!external_order_id) {
    return res.status(400).json({ error: "external_order_id is required" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      `INSERT INTO web_orders (
          source, external_order_id, external_order_number, customer_id, outlet_id, currency,
          subtotal, discount_total, tax_total, shipping_total, grand_total,
          payment_status, fulfillment_status, order_status, ordered_at, raw_payload
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        source,
        String(external_order_id),
        external_order_number || null,
        customer_id || null,
        outlet_id || null,
        currency,
        parseFloat(subtotal || 0),
        parseFloat(discount_total || 0),
        parseFloat(tax_total || 0),
        parseFloat(shipping_total || 0),
        parseFloat(grand_total || 0),
        payment_status,
        fulfillment_status,
        order_status,
        ordered_at || new Date().toISOString(),
        raw_payload ? JSON.stringify(raw_payload) : null,
      ],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          if (String(err.message || "").includes("UNIQUE constraint failed")) {
            return res.status(409).json({ error: "Order already exists for this source" });
          }
          return res.status(500).json({ error: err.message });
        }
        const webOrderId = this.lastID;

        if (!items || items.length === 0) {
          return db.run("COMMIT", (commitErr) => {
            if (commitErr) return res.status(500).json({ error: commitErr.message });
            applyWebOrderStockPolicy(webOrderId, (policyErr, policy) => {
              return res.json({
                id: webOrderId,
                message: "Order created",
                stock_policy: policyErr ? { error: policyErr.message } : (policy || null),
              });
            });
          });
        }

        const stmt = db.prepare(
          `INSERT INTO web_order_items (
            web_order_id, product_id, variant_id, sku, barcode, title, qty,
            unit_price, discount, tax, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of items) {
          const qty = parseInt(item.qty || item.quantity || 0);
          const unitPrice = parseFloat(item.unit_price || item.price || 0);
          const discount = parseFloat(item.discount || 0);
          const tax = parseFloat(item.tax || 0);
          const lineTotal = item.line_total !== undefined
            ? parseFloat(item.line_total || 0)
            : qty * unitPrice - discount + tax;
          stmt.run([
            webOrderId,
            item.product_id || null,
            item.variant_id || null,
            item.sku || null,
            item.barcode || null,
            item.title || item.name || null,
            qty,
            unitPrice,
            discount,
            tax,
            lineTotal,
          ]);
        }
        stmt.finalize((finErr) => {
          if (finErr) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: finErr.message });
          }
          db.run("COMMIT", (commitErr) => {
            if (commitErr) return res.status(500).json({ error: commitErr.message });
            applyWebOrderStockPolicy(webOrderId, (policyErr, policy) => {
              return res.json({
                id: webOrderId,
                message: "Order created",
                stock_policy: policyErr ? { error: policyErr.message } : (policy || null),
              });
            });
          });
        });
      },
    );
  });
});

app.put("/api/orders/:id/status", requirePerm("manage_orders"), (req, res) => {
  const { id } = req.params;
  const { order_status, payment_status, fulfillment_status } = req.body || {};
  db.run(
    `UPDATE web_orders
     SET order_status = COALESCE(?, order_status),
         payment_status = COALESCE(?, payment_status),
         fulfillment_status = COALESCE(?, fulfillment_status),
         updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [order_status || null, payment_status || null, fulfillment_status || null, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Order not found" });
      applyWebOrderStockPolicy(id, (policyErr, policy) => {
        res.json({
          message: "Order status updated",
          stock_policy: policyErr ? { error: policyErr.message } : (policy || null),
        });
      });
    },
  );
});

app.post("/api/orders/mark-complete", requirePerm("manage_orders"), (req, res) => {
  const { ids = [], set_paid = false } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array is required" });
  }

  const normalizedIds = ids
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (normalizedIds.length === 0) {
    return res.status(400).json({ error: "No valid ids provided" });
  }

  const placeholders = normalizedIds.map(() => "?").join(",");
  const sql = set_paid
    ? `UPDATE web_orders
       SET order_status = 'closed',
           fulfillment_status = 'fulfilled',
           payment_status = 'paid',
           updated_at = datetime('now','localtime')
       WHERE id IN (${placeholders})`
    : `UPDATE web_orders
       SET order_status = 'closed',
           fulfillment_status = 'fulfilled',
           updated_at = datetime('now','localtime')
       WHERE id IN (${placeholders})`;

  db.run(sql, normalizedIds, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Orders marked complete", updated: this.changes || 0 });
  });
});

app.post("/api/orders/bulk-update", requirePerm("manage_orders"), (req, res) => {
  const {
    ids = [],
    order_status = null,
    payment_status = null,
    fulfillment_status = null,
  } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array is required" });
  }

  const normalizedIds = ids
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (normalizedIds.length === 0) {
    return res.status(400).json({ error: "No valid ids provided" });
  }

  const updates = [];
  const params = [];
  if (order_status != null && String(order_status).trim() !== "") {
    updates.push("order_status = ?");
    params.push(String(order_status).trim());
  }
  if (payment_status != null && String(payment_status).trim() !== "") {
    updates.push("payment_status = ?");
    params.push(String(payment_status).trim());
  }
  if (fulfillment_status != null && String(fulfillment_status).trim() !== "") {
    updates.push("fulfillment_status = ?");
    params.push(String(fulfillment_status).trim());
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "At least one status field is required" });
  }

  updates.push("updated_at = datetime('now','localtime')");
  const placeholders = normalizedIds.map(() => "?").join(",");
  const sql = `UPDATE web_orders SET ${updates.join(", ")} WHERE id IN (${placeholders})`;

  db.run(sql, [...params, ...normalizedIds], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Orders updated", updated: this.changes || 0 });
  });
});

app.post("/api/orders/:id/transactions", requirePerm("manage_orders"), (req, res) => {
  const { id } = req.params;
  const {
    external_txn_id,
    gateway,
    kind,
    status,
    amount = 0,
    processed_at,
    raw_payload,
  } = req.body || {};
  db.run(
    `INSERT INTO web_order_transactions (
      web_order_id, external_txn_id, gateway, kind, status, amount, processed_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      external_txn_id || null,
      gateway || null,
      kind || null,
      status || null,
      parseFloat(amount || 0),
      processed_at || new Date().toISOString(),
      raw_payload ? JSON.stringify(raw_payload) : null,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: "Transaction recorded" });
    },
  );
});

app.post("/api/orders/:id/fulfillments", requirePerm("manage_orders"), (req, res) => {
  const { id } = req.params;
  const {
    external_fulfillment_id,
    status,
    carrier,
    tracking_number,
    tracking_url,
    fulfilled_at,
    raw_payload,
  } = req.body || {};
  db.run(
    `INSERT INTO web_order_fulfillments (
      web_order_id, external_fulfillment_id, status, carrier, tracking_number, tracking_url, fulfilled_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      external_fulfillment_id || null,
      status || null,
      carrier || null,
      tracking_number || null,
      tracking_url || null,
      fulfilled_at || new Date().toISOString(),
      raw_payload ? JSON.stringify(raw_payload) : null,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: "Fulfillment recorded" });
    },
  );
});

function maskSecret(secret) {
  let value = String(secret || "");
  try {
    value = decryptShopifySecret(value);
  } catch {
    // keep masked fallback for unreadable encrypted data
  }
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function logActionHistory(req, actionType, description, cb = () => {}) {
  const employeeId = req.headers["x-employee-id"];
  if (!employeeId) return cb();
  db.get("SELECT name FROM employees WHERE id = ?", [employeeId], (err, row) => {
    const userName = err ? "System" : (row?.name || "System");
    db.run(
      "INSERT INTO action_history (user_name, action_type, description) VALUES (?, ?, ?)",
      [userName, actionType, description],
      () => cb(),
    );
  });
}

function getActiveShopifyConnection(cb) {
  db.get(
    `SELECT *
     FROM shopify_connections
     WHERE is_active = 1
     ORDER BY id DESC
     LIMIT 1`,
    [],
    (err, row) => {
      if (err || !row) return cb(err, row);
      try {
        const hydrated = {
          ...row,
          access_token: decryptShopifySecret(row.access_token),
          webhook_secret: decryptShopifySecret(row.webhook_secret),
        };
        return cb(null, hydrated);
      } catch (e) {
        return cb(e);
      }
    },
  );
}

function upsertWebOrderFromShopifyPayload(payload, cb) {
  const source = "shopify";
  const externalOrderId = String(payload?.id || payload?.order_id || "");
  if (!externalOrderId) {
    return cb(new Error("Missing Shopify order id"));
  }
  const externalOrderNumber = payload?.name || payload?.order_number || null;
  const currency = payload?.currency || "PKR";
  const subtotal = parseFloat(payload?.subtotal_price || 0);
  const discountTotal = parseFloat(payload?.total_discounts || 0);
  const taxTotal = parseFloat(payload?.total_tax || 0);
  const shippingTotal = parseFloat(payload?.total_shipping_price_set?.shop_money?.amount || 0);
  const grandTotal = parseFloat(payload?.total_price || 0);
  const paymentStatus = payload?.financial_status || "pending";
  const fulfillmentStatus = payload?.fulfillment_status || "unfulfilled";
  const orderedAt = payload?.created_at || new Date().toISOString();
  const rawPayload = JSON.stringify(payload || {});
  const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(
      `INSERT INTO web_orders (
        source, external_order_id, external_order_number, currency,
        subtotal, discount_total, tax_total, shipping_total, grand_total,
        payment_status, fulfillment_status, order_status, ordered_at, raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      ON CONFLICT(source, external_order_id) DO UPDATE SET
        external_order_number = excluded.external_order_number,
        currency = excluded.currency,
        subtotal = excluded.subtotal,
        discount_total = excluded.discount_total,
        tax_total = excluded.tax_total,
        shipping_total = excluded.shipping_total,
        grand_total = excluded.grand_total,
        payment_status = excluded.payment_status,
        fulfillment_status = excluded.fulfillment_status,
        ordered_at = excluded.ordered_at,
        raw_payload = excluded.raw_payload,
        updated_at = datetime('now','localtime')`,
      [
        source,
        externalOrderId,
        externalOrderNumber,
        currency,
        subtotal,
        discountTotal,
        taxTotal,
        shippingTotal,
        grandTotal,
        paymentStatus,
        fulfillmentStatus,
        orderedAt,
        rawPayload,
      ],
      (err) => {
        if (err) {
          db.run("ROLLBACK");
          return cb(err);
        }
        db.get(
          "SELECT id FROM web_orders WHERE source = ? AND external_order_id = ?",
          [source, externalOrderId],
          (getErr, row) => {
            if (getErr || !row) {
              db.run("ROLLBACK");
              return cb(getErr || new Error("Failed to resolve web order"));
            }
            const webOrderId = row.id;
            db.run("DELETE FROM web_order_items WHERE web_order_id = ?", [webOrderId], (delErr) => {
              if (delErr) {
                db.run("ROLLBACK");
                return cb(delErr);
              }
              if (lineItems.length === 0) {
                return db.run("COMMIT", (commitErr) => {
                  if (commitErr) return cb(commitErr);
                  return applyWebOrderStockPolicy(webOrderId, (policyErr, policy) => {
                    return cb(null, {
                      web_order_id: webOrderId,
                      item_count: 0,
                      stock_policy: policyErr ? { error: policyErr.message } : (policy || null),
                    });
                  });
                });
              }
              const stmt = db.prepare(
                `INSERT INTO web_order_items (
                  web_order_id, sku, barcode, title, qty, unit_price, discount, tax, line_total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              );
              for (const item of lineItems) {
                const qty = parseInt(item.quantity || 0, 10);
                const unitPrice = parseFloat(item.price || 0);
                const discount = parseFloat(item.total_discount || 0);
                const tax = parseFloat(item.total_tax || 0);
                const lineTotal = (qty * unitPrice) - discount + tax;
                stmt.run([
                  webOrderId,
                  item.sku || null,
                  item.barcode || null,
                  item.title || null,
                  qty,
                  unitPrice,
                  discount,
                  tax,
                  lineTotal,
                ]);
              }
              stmt.finalize((finErr) => {
                if (finErr) {
                  db.run("ROLLBACK");
                  return cb(finErr);
                }
                db.run("COMMIT", (commitErr) => {
                  if (commitErr) return cb(commitErr);
                  return applyWebOrderStockPolicy(webOrderId, (policyErr, policy) => {
                    return cb(null, {
                      web_order_id: webOrderId,
                      item_count: lineItems.length,
                      stock_policy: policyErr ? { error: policyErr.message } : (policy || null),
                    });
                  });
                });
              });
            });
          },
        );
      },
    );
  });
}

function shouldApplyWebOrderStock(order) {
  const payment = String(order?.payment_status || "").toLowerCase();
  const orderStatus = String(order?.order_status || "").toLowerCase();
  const paidStates = ["paid", "partially_paid", "authorized"];
  const blockedStates = ["cancelled", "canceled"];
  return paidStates.includes(payment) && !blockedStates.includes(orderStatus);
}

function shouldReverseWebOrderStock(order) {
  const payment = String(order?.payment_status || "").toLowerCase();
  const orderStatus = String(order?.order_status || "").toLowerCase();
  const reversalPayments = ["refunded", "partially_refunded", "voided", "failed"];
  const reversalStatuses = ["cancelled", "canceled"];
  return reversalPayments.includes(payment) || reversalStatuses.includes(orderStatus);
}

function resolveWebOrderOutletId(order, cb) {
  if (order?.outlet_id) return cb(null, Number(order.outlet_id));
  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return cb(connErr);
    if (!conn?.default_location_id) {
      return cb(new Error("Order has no outlet_id and no default Shopify location is configured"));
    }
    db.get(
      "SELECT outlet_id FROM shopify_location_map WHERE shopify_location_id = ? LIMIT 1",
      [String(conn.default_location_id)],
      (mapErr, row) => {
        if (mapErr) return cb(mapErr);
        if (!row?.outlet_id) {
          return cb(new Error("No outlet mapping found for default Shopify location"));
        }
        return cb(null, Number(row.outlet_id));
      },
    );
  });
}

function resolveWebOrderItemMapping(item, cb) {
  const directProduct = item?.product_id ? Number(item.product_id) : null;
  const directVariant = item?.variant_id ? Number(item.variant_id) : null;
  if (directProduct) {
    return cb(null, { product_id: directProduct, variant_id: directVariant });
  }

  const sku = String(item?.sku || "").trim();
  const barcode = String(item?.barcode || "").trim();

  const done = (result) => cb(null, result);

  const byVariantSku = () => {
    if (!sku) return byVariantBarcode();
    db.get(
      "SELECT id as variant_id, product_id FROM product_variants WHERE sku = ? LIMIT 1",
      [sku],
      (err, row) => {
        if (err) return cb(err);
        if (row?.product_id) return done({ product_id: Number(row.product_id), variant_id: Number(row.variant_id) });
        return byVariantBarcode();
      },
    );
  };

  const byVariantBarcode = () => {
    if (!barcode) return byProductBarcode();
    db.get(
      "SELECT id as variant_id, product_id FROM product_variants WHERE barcode = ? LIMIT 1",
      [barcode],
      (err, row) => {
        if (err) return cb(err);
        if (row?.product_id) return done({ product_id: Number(row.product_id), variant_id: Number(row.variant_id) });
        return byProductBarcode();
      },
    );
  };

  const byProductBarcode = () => {
    if (!barcode) return done(null);
    db.get(
      "SELECT id as product_id FROM products WHERE barcode = ? LIMIT 1",
      [barcode],
      (err, row) => {
        if (err) return cb(err);
        if (row?.product_id) return done({ product_id: Number(row.product_id), variant_id: null });
        return done(null);
      },
    );
  };

  byVariantSku();
}

function applyWebOrderStockPolicy(webOrderId, cb = () => {}) {
  db.get("SELECT * FROM web_orders WHERE id = ?", [webOrderId], (orderErr, order) => {
    if (orderErr) return cb(orderErr);
    if (!order) return cb(new Error("Web order not found"));

    const applied = Number(order.stock_applied || 0) === 1;
    const shouldApply = shouldApplyWebOrderStock(order);
    const shouldReverse = shouldReverseWebOrderStock(order);

    if (shouldApply && applied) return cb(null, { action: "noop_already_applied" });
    if (shouldReverse && !applied) return cb(null, { action: "noop_already_reversed" });
    if (!shouldApply && !shouldReverse) return cb(null, { action: "noop_state_not_actionable" });

    const direction = shouldApply ? -1 : 1;
    const nextAppliedState = shouldApply ? 1 : 0;
    const actionLabel = shouldApply ? "apply" : "reverse";

    resolveWebOrderOutletId(order, (outletErr, resolvedOutletId) => {
      if (outletErr) {
        db.run(
          "UPDATE web_orders SET stock_policy_note = ? WHERE id = ?",
          [String(outletErr.message || "Failed resolving outlet"), webOrderId],
          () => cb(outletErr),
        );
        return;
      }

      db.all(
        "SELECT * FROM web_order_items WHERE web_order_id = ? ORDER BY id ASC",
        [webOrderId],
        (itemsErr, items) => {
          if (itemsErr) return cb(itemsErr);
          if (!items || items.length === 0) return cb(null, { action: "noop_no_items" });

          const resolved = [];
          const unresolved = [];
          let idx = 0;

          const resolveNext = () => {
            if (idx >= items.length) {
              if (unresolved.length > 0) {
                const note = `Unmapped items (${unresolved.length}) - stock policy not applied`;
                return db.run(
                  "UPDATE web_orders SET stock_policy_note = ? WHERE id = ?",
                  [note, webOrderId],
                  () => cb(new Error(note)),
                );
              }

              db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stockStmt = db.prepare(
                  `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                   VALUES (?, ?, ?)
                   ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
                );
                for (const r of resolved) {
                  const delta = direction * Number(r.qty || 0);
                  stockStmt.run([r.product_id, resolvedOutletId, delta, delta]);
                }
                stockStmt.finalize((finErr) => {
                  if (finErr) {
                    db.run("ROLLBACK");
                    return cb(finErr);
                  }
                  db.run(
                    `UPDATE web_orders
                     SET stock_applied = ?,
                         stock_applied_at = datetime('now','localtime'),
                         stock_policy_note = ?,
                         outlet_id = COALESCE(outlet_id, ?),
                         updated_at = datetime('now','localtime')
                     WHERE id = ?`,
                    [nextAppliedState, `Stock policy ${actionLabel}d`, resolvedOutletId, webOrderId],
                    (updErr) => {
                      if (updErr) {
                        db.run("ROLLBACK");
                        return cb(updErr);
                      }
                      db.run("COMMIT", (commitErr) => {
                        if (commitErr) return cb(commitErr);
                        return cb(null, {
                          action: actionLabel,
                          outlet_id: resolvedOutletId,
                          item_count: resolved.length,
                        });
                      });
                    },
                  );
                });
              });
              return;
            }

            const current = items[idx];
            idx += 1;
            resolveWebOrderItemMapping(current, (mapErr, mapped) => {
              if (mapErr) return cb(mapErr);
              if (!mapped?.product_id) {
                unresolved.push(current.id);
                return resolveNext();
              }
              db.run(
                "UPDATE web_order_items SET product_id = COALESCE(product_id, ?), variant_id = COALESCE(variant_id, ?) WHERE id = ?",
                [mapped.product_id, mapped.variant_id || null, current.id],
                () => {
                  resolved.push({
                    item_id: current.id,
                    product_id: mapped.product_id,
                    variant_id: mapped.variant_id || null,
                    qty: Number(current.qty || 0),
                  });
                  resolveNext();
                },
              );
            });
          };

          resolveNext();
        },
      );
    });
  });
}

function enqueueInventorySyncEvents(changes, context = {}, cb = () => {}) {
  const normalized = (changes || [])
    .map((c) => ({
      product_id: c.product_id ? Number(c.product_id) : null,
      variant_id: c.variant_id ? Number(c.variant_id) : null,
      outlet_id: c.outlet_id ? Number(c.outlet_id) : null,
      delta: Number(c.delta || 0),
      reason: c.reason || context.reason || "correction",
      reference_type: c.reference_type || context.reference_type || null,
      reference_id: c.reference_id || context.reference_id || null,
    }))
    .filter((c) => c.product_id && c.outlet_id && c.delta !== 0);

  if (normalized.length === 0) return cb(null, { queued: 0, skipped: 0 });

  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return cb(connErr);
    if (!conn) return cb(null, { queued: 0, skipped: normalized.length, reason: "no_connection" });

    let idx = 0;
    let queued = 0;
    let skipped = 0;

    const step = () => {
      if (idx >= normalized.length) return cb(null, { queued, skipped });
      const item = normalized[idx];
      idx += 1;

      db.get(
        `SELECT shopify_location_id
         FROM shopify_location_map
         WHERE outlet_id = ?`,
        [item.outlet_id],
        (locErr, loc) => {
          if (locErr) return cb(locErr);
          db.get(
            `SELECT shopify_inventory_item_id, product_id, variant_id
             FROM shopify_product_map
             WHERE is_active = 1
               AND (
                 (variant_id IS NOT NULL AND variant_id = ?)
                 OR (variant_id IS NULL AND product_id = ?)
               )
             ORDER BY CASE WHEN variant_id IS NOT NULL THEN 0 ELSE 1 END, id DESC
             LIMIT 1`,
            [item.variant_id || -1, item.product_id],
            (mapErr, map) => {
              if (mapErr) return cb(mapErr);

              const idempotencyKey = [
                "outbound_inventory",
                item.reason || "correction",
                item.reference_type || "none",
                item.reference_id || "none",
                item.product_id,
                item.variant_id || 0,
                item.outlet_id,
              ].join("_");

              if (!loc?.shopify_location_id || !map?.shopify_inventory_item_id) {
                db.run(
                  `INSERT OR IGNORE INTO external_sync_events (
                    direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at, attempt_count
                  ) VALUES ('outbound', 'inventory', ?, 'failed_mapping', ?, ?, datetime('now','localtime'), datetime('now','localtime'), 0)`,
                  [
                    idempotencyKey,
                    "Missing Shopify product/location mapping",
                    JSON.stringify({
                      product_id: item.product_id,
                      variant_id: item.variant_id,
                      outlet_id: item.outlet_id,
                      delta: item.delta,
                    }),
                  ],
                  () => {
                    skipped += 1;
                    step();
                  },
                );
                return;
              }

              const payload = JSON.stringify({
                product_id: item.product_id,
                variant_id: item.variant_id,
                outlet_id: item.outlet_id,
                delta: item.delta,
                reason: item.reason,
                reference_type: item.reference_type,
                reference_id: item.reference_id,
                shopify_inventory_item_id: map.shopify_inventory_item_id,
                shopify_location_id: loc.shopify_location_id,
              });

              db.run(
                `INSERT OR IGNORE INTO external_sync_events (
                  direction, entity_type, idempotency_key, status, payload, created_at, attempt_count, next_retry_at
                ) VALUES ('outbound', 'inventory', ?, 'pending', ?, datetime('now','localtime'), 0, datetime('now','localtime'))`,
                [idempotencyKey, payload],
                function () {
                  if (this?.changes > 0) queued += 1;
                  else skipped += 1;
                  step();
                },
              );
            },
          );
        },
      );
    };

    step();
  });
}

function processPendingShopifyInventoryEvents(limit = 25, cb = () => {}) {
  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return cb(connErr);
    if (!conn) return cb(null, { processed: 0, failed: 0, skipped: 0, reason: "no_connection" });

    db.all(
      `SELECT id, payload, attempt_count
       FROM external_sync_events
       WHERE direction = 'outbound'
         AND entity_type = 'inventory'
         AND status IN ('pending', 'retry')
         AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now','localtime'))
       ORDER BY id ASC
       LIMIT ?`,
      [limit],
      async (listErr, rows) => {
        if (listErr) return cb(listErr);
        let processed = 0;
        let failed = 0;
        let skipped = 0;

        for (const row of rows || []) {
          let parsed;
          try {
            parsed = JSON.parse(row.payload || "{}");
          } catch {
            parsed = {};
          }
          const delta = Number(parsed.delta || 0);
          const inventoryItemId = parsed.shopify_inventory_item_id || null;
          const locationId = parsed.shopify_location_id || null;
          if (!inventoryItemId || !locationId || delta === 0) {
            skipped += 1;
            logShopifyEvent("warn", "outbound_payload_invalid", {
              event_id: row.id,
              inventory_item_id: inventoryItemId,
              location_id: locationId,
              delta,
            });
            await new Promise((resolve) => {
              db.run(
                `UPDATE external_sync_events
                 SET status = 'dead_letter',
                     error_message = ?,
                     last_attempt_at = datetime('now','localtime'),
                     processed_at = datetime('now','localtime')
                 WHERE id = ?`,
                ["Invalid payload for Shopify inventory sync", row.id],
                () => resolve(),
              );
            });
            continue;
          }

          try {
            const result = await adjustShopifyInventory(
              conn,
              [{ inventory_item_id: inventoryItemId, location_id: locationId, delta }],
              parsed.reason || "correction",
            );
            if ((result.userErrors || []).length > 0) {
              failed += 1;
              const msg = result.userErrors.map((e) => e.message).join("; ");
              logShopifyEvent("warn", "outbound_user_error", {
                event_id: row.id,
                attempt: Number(row.attempt_count || 0) + 1,
                error: msg || "Shopify user error",
              });
              const nextAttempt = Number(row.attempt_count || 0) + 1;
              const terminal = nextAttempt >= SHOPIFY_MAX_RETRY_ATTEMPTS;
              const delayMins = retryDelayMinutesWithJitter(nextAttempt);
              await new Promise((resolve) => {
                db.run(
                  `UPDATE external_sync_events
                   SET status = ?,
                       error_message = ?,
                       attempt_count = ?,
                       last_attempt_at = datetime('now','localtime'),
                       next_retry_at = CASE
                         WHEN ? = 1 THEN NULL
                         ELSE datetime('now','localtime', '+' || ? || ' minutes')
                       END,
                       processed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
                   WHERE id = ?`,
                  [
                    terminal ? "dead_letter" : "retry",
                    msg || "Shopify user error",
                    nextAttempt,
                    terminal ? 1 : 0,
                    delayMins,
                    terminal ? 1 : 0,
                    row.id,
                  ],
                  () => resolve(),
                );
              });
            } else {
              processed += 1;
              await new Promise((resolve) => {
                db.run(
                  `UPDATE external_sync_events
                   SET status = 'processed',
                       error_message = NULL,
                       attempt_count = COALESCE(attempt_count, 0) + 1,
                       last_attempt_at = datetime('now','localtime'),
                       next_retry_at = NULL,
                       processed_at = datetime('now','localtime')
                   WHERE id = ?`,
                  [row.id],
                  () => resolve(),
                );
              });
            }
          } catch (err) {
            failed += 1;
            logShopifyEvent("error", "outbound_sync_exception", {
              event_id: row.id,
              attempt: Number(row.attempt_count || 0) + 1,
              error: String(err?.message || "Shopify sync failed"),
            });
            const nextAttempt = Number(row.attempt_count || 0) + 1;
            const terminal = nextAttempt >= SHOPIFY_MAX_RETRY_ATTEMPTS;
            const delayMins = retryDelayMinutesWithJitter(nextAttempt);
            await new Promise((resolve) => {
              db.run(
                `UPDATE external_sync_events
                 SET status = ?,
                     error_message = ?,
                     attempt_count = ?,
                     last_attempt_at = datetime('now','localtime'),
                     next_retry_at = CASE
                       WHEN ? = 1 THEN NULL
                       ELSE datetime('now','localtime', '+' || ? || ' minutes')
                     END,
                     processed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
                 WHERE id = ?`,
                [
                  terminal ? "dead_letter" : "retry",
                  String(err?.message || "Shopify sync failed"),
                  nextAttempt,
                  terminal ? 1 : 0,
                  delayMins,
                  terminal ? 1 : 0,
                  row.id,
                ],
                () => resolve(),
              );
            });
          }
        }

        db.run(
          `UPDATE shopify_connections
           SET last_sync_at = datetime('now','localtime'),
               last_error = ?,
               updated_at = datetime('now','localtime')
           WHERE id = ?`,
          [failed > 0 ? `${failed} event(s) failed` : null, conn.id],
          () => cb(null, { processed, failed, skipped }),
        );
      },
    );
  });
}

// --- ROUTES: SHOPIFY CONNECTOR ---

app.get("/api/integrations/shopify/config", requirePerm("manage_inventory"), (req, res) => {
  getActiveShopifyConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!conn) {
      return res.json({
        connected: false,
        config: null,
      });
    }
    return res.json({
      connected: true,
      config: {
        id: conn.id,
        shop_domain: conn.shop_domain,
        api_version: conn.api_version,
        webhook_secret_masked: maskSecret(conn.webhook_secret),
        default_location_id: conn.default_location_id,
        is_active: Number(conn.is_active || 0) === 1,
        last_sync_at: conn.last_sync_at,
        last_error: conn.last_error,
      },
    });
  });
});

app.put("/api/integrations/shopify/config", requirePerm("manage_inventory"), (req, res) => {
  const {
    shop_domain,
    access_token,
    api_version = "2025-10",
    webhook_secret = null,
    default_location_id = null,
    is_active = true,
  } = req.body || {};
  if (!shop_domain) {
    return res.status(400).json({ error: "shop_domain is required" });
  }
  const normalizedDomain = String(shop_domain).trim().toLowerCase();
  db.get(
    "SELECT access_token FROM shopify_connections WHERE shop_domain = ?",
    [normalizedDomain],
    (selErr, existing) => {
      if (selErr) return res.status(500).json({ error: selErr.message });
      const tokenInput = String(access_token || "").trim();
      const effectiveToken = tokenInput
        ? encryptShopifySecret(tokenInput)
        : (existing?.access_token || null);
      if (!effectiveToken) {
        return res.status(400).json({ error: "access_token is required for first-time connection" });
      }

      db.serialize(() => {
        db.run("UPDATE shopify_connections SET is_active = 0");
        db.run(
          `INSERT INTO shopify_connections (
            shop_domain, access_token, api_version, webhook_secret, default_location_id, is_active, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
          ON CONFLICT(shop_domain) DO UPDATE SET
            access_token = excluded.access_token,
            api_version = excluded.api_version,
            webhook_secret = COALESCE(excluded.webhook_secret, shopify_connections.webhook_secret),
            default_location_id = excluded.default_location_id,
            is_active = excluded.is_active,
            updated_at = datetime('now','localtime')`,
          [
            normalizedDomain,
            effectiveToken,
            String(api_version).trim(),
            webhook_secret ? encryptShopifySecret(String(webhook_secret)) : null,
            default_location_id ? String(default_location_id) : null,
            is_active ? 1 : 0,
          ],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Shopify connection saved", id: this.lastID || null });
          },
        );
      });
    },
  );
});

app.post("/api/integrations/shopify/disconnect", requirePerm("manage_inventory"), (req, res) => {
  db.run(
    "UPDATE shopify_connections SET is_active = 0, updated_at = datetime('now','localtime') WHERE is_active = 1",
    [],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Shopify disconnected", updated: this.changes || 0 });
    },
  );
});

app.get("/api/integrations/shopify/status", requireAnyPerm(["manage_inventory", "manage_orders"]), (req, res) => {
  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });
    db.get(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed,
              SUM(CASE WHEN status IN ('failed', 'dead_letter', 'failed_mapping') THEN 1 ELSE 0 END) as failed,
              SUM(CASE WHEN status IN ('pending', 'retry') THEN 1 ELSE 0 END) as pending
       FROM external_sync_events`,
      [],
      (evtErr, stats) => {
        if (evtErr) return res.status(500).json({ error: evtErr.message });
        db.get(
          `SELECT started_at, finished_at, status, processed_count, failed_count, direction, run_type
           FROM shopify_sync_runs
           ORDER BY id DESC
           LIMIT 1`,
          [],
          (runErr, lastRun) => {
            if (runErr) return res.status(500).json({ error: runErr.message });
            db.get(
              `SELECT
                 SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) as dead_letter,
                 SUM(CASE
                       WHEN status = 'retry'
                        AND (next_retry_at IS NULL OR datetime(next_retry_at) <= datetime('now','localtime'))
                       THEN 1 ELSE 0 END) as retry_due,
                 SUM(CASE WHEN status IN ('pending','retry') THEN 1 ELSE 0 END) as backlog,
                 MIN(CASE WHEN status IN ('pending','retry') THEN created_at END) as oldest_backlog_at
               FROM external_sync_events
               WHERE direction = 'outbound'
                 AND entity_type = 'inventory'`,
              [],
              (opsErr, ops) => {
                if (opsErr) return res.status(500).json({ error: opsErr.message });
                let oldestBacklogMinutes = null;
                if (ops?.oldest_backlog_at) {
                  const oldestMs = Date.parse(String(ops.oldest_backlog_at).replace(" ", "T"));
                  if (!Number.isNaN(oldestMs)) {
                    oldestBacklogMinutes = Math.max(0, Math.round((Date.now() - oldestMs) / 60000));
                  }
                }
                res.json({
                  connected: Boolean(conn),
                  shop_domain: conn?.shop_domain || null,
                  last_sync_at: conn?.last_sync_at || null,
                  last_error: conn?.last_error || null,
                  event_stats: {
                    total: stats?.total || 0,
                    processed: stats?.processed || 0,
                    failed: stats?.failed || 0,
                    pending: stats?.pending || 0,
                  },
                  queue_health: {
                    dead_letter: Number(ops?.dead_letter || 0),
                    retry_due: Number(ops?.retry_due || 0),
                    backlog: Number(ops?.backlog || 0),
                    oldest_backlog_minutes: oldestBacklogMinutes,
                  },
                  last_run: lastRun || null,
                });
              },
            );
          },
        );
      },
    );
  });
});

app.post("/api/integrations/shopify/verify", requirePerm("manage_inventory"), async (req, res) => {
  getActiveShopifyConnection(async (err, conn) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });
    try {
      const shop = await verifyConnection(conn);
      res.json({ ok: true, shop });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || "Verification failed" });
    }
  });
});

app.post("/api/integrations/shopify/live-validation", requirePerm("manage_inventory"), async (req, res) => {
  getActiveShopifyConnection(async (err, conn) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });

    try {
      const shop = await verifyConnection(conn);
      const locations = await fetchShopifyLocations(conn);

      db.all(
        `SELECT spm.product_id, spm.variant_id, spm.shopify_inventory_item_id, slm.shopify_location_id
         FROM shopify_product_map spm
         JOIN shopify_location_map slm
         WHERE spm.is_active = 1
           AND spm.shopify_inventory_item_id IS NOT NULL
         LIMIT 5`,
        [],
        async (mapErr, mappedRows) => {
          if (mapErr) return res.status(500).json({ error: mapErr.message });
          const sampleChecks = [];
          for (const row of mappedRows || []) {
            try {
              const inv = await fetchInventoryLevel(conn, row.shopify_inventory_item_id, row.shopify_location_id);
              sampleChecks.push({
                product_id: row.product_id,
                variant_id: row.variant_id || null,
                inventory_item_id: row.shopify_inventory_item_id,
                location_id: row.shopify_location_id,
                ok: true,
                available: Number(inv?.available || 0),
              });
            } catch (e) {
              sampleChecks.push({
                product_id: row.product_id,
                variant_id: row.variant_id || null,
                inventory_item_id: row.shopify_inventory_item_id,
                location_id: row.shopify_location_id,
                ok: false,
                error: String(e?.message || "Failed fetching inventory level"),
              });
            }
          }
          const failedSamples = sampleChecks.filter((s) => !s.ok).length;
          return res.json({
            ok: failedSamples === 0,
            checked_at: new Date().toISOString(),
            checks: {
              shop_connection: {
                ok: true,
                myshopify_domain: shop?.myshopifyDomain || null,
                shop_name: shop?.name || null,
              },
              locations: {
                ok: Array.isArray(locations),
                count: Array.isArray(locations) ? locations.length : 0,
              },
              mapped_inventory_sample: {
                ok: failedSamples === 0,
                total: sampleChecks.length,
                failed: failedSamples,
                rows: sampleChecks,
              },
            },
          });
        },
      );
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message || "Live validation failed" });
    }
  });
});

app.get("/api/integrations/shopify/webhooks/setup", requirePerm("manage_inventory"), (req, res) => {
  getActiveShopifyConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });

    const configuredBase = String(process.env.APP_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    const detectedBase = `${req.protocol}://${req.get("host")}`;
    const baseUrl = configuredBase || detectedBase;
    const endpoint = `${baseUrl}/api/integrations/shopify/webhooks/orders-create`;
    res.json({
      ok: true,
      base_url: baseUrl,
      callback_url: endpoint,
      shop_domain: conn.shop_domain || null,
      secret_configured: Boolean(conn.webhook_secret),
      required_topics: [
        "orders/create",
        "orders/updated",
        "orders/cancelled",
        "refunds/create",
      ],
      notes: [
        "Set webhook format to JSON.",
        "Use the same webhook secret configured in OneShopPOS.",
        "Use HTTPS callback URL reachable by Shopify.",
      ],
    });
  });
});

app.get("/api/integrations/shopify/uat-checklist", requireAnyPerm(["manage_inventory", "manage_orders"]), (req, res) => {
  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });
    db.serialize(() => {
      db.get("SELECT COUNT(*) as count FROM shopify_location_map", [], (locErr, locRow) => {
        if (locErr) return res.status(500).json({ error: locErr.message });
        db.get("SELECT COUNT(*) as count FROM shopify_product_map WHERE is_active = 1", [], (mapErr, mapRow) => {
          if (mapErr) return res.status(500).json({ error: mapErr.message });
          db.get(
            `SELECT
               SUM(CASE WHEN direction='outbound' AND status='processed' THEN 1 ELSE 0 END) as outbound_processed,
               SUM(CASE WHEN direction='inbound' AND status='processed' THEN 1 ELSE 0 END) as inbound_processed,
               SUM(CASE WHEN status='dead_letter' THEN 1 ELSE 0 END) as dead_letter
             FROM external_sync_events`,
            [],
            (evtErr, ev) => {
              if (evtErr) return res.status(500).json({ error: evtErr.message });
              const checklist = [
                { id: "connection", label: "Active Shopify connection", pass: Boolean(conn) },
                { id: "location_mapping", label: "At least one location mapping", pass: Number(locRow?.count || 0) > 0 },
                { id: "product_mapping", label: "At least one active product mapping", pass: Number(mapRow?.count || 0) > 0 },
                { id: "outbound_processed", label: "At least one outbound event processed", pass: Number(ev?.outbound_processed || 0) > 0 },
                { id: "inbound_processed", label: "At least one inbound event processed", pass: Number(ev?.inbound_processed || 0) > 0 },
                { id: "dead_letter_zero", label: "No dead-letter events", pass: Number(ev?.dead_letter || 0) === 0 },
              ];
              return res.json({
                checked_at: new Date().toISOString(),
                checklist,
                stats: {
                  location_mappings: Number(locRow?.count || 0),
                  product_mappings: Number(mapRow?.count || 0),
                  outbound_processed: Number(ev?.outbound_processed || 0),
                  inbound_processed: Number(ev?.inbound_processed || 0),
                  dead_letter: Number(ev?.dead_letter || 0),
                },
              });
            },
          );
        });
      });
    });
  });
});

app.get("/api/integrations/shopify/locations/live", requirePerm("manage_inventory"), async (req, res) => {
  getActiveShopifyConnection(async (err, conn) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });
    try {
      const locations = await fetchShopifyLocations(conn);
      res.json({ locations });
    } catch (e) {
      res.status(400).json({ error: e.message || "Failed to load Shopify locations" });
    }
  });
});

app.get("/api/integrations/shopify/events", requireAnyPerm(["manage_inventory", "manage_orders"]), (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
  const { status, entity_type, direction, search } = req.query;
  const where = ["1=1"];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(String(status));
  }
  if (entity_type) {
    where.push("entity_type = ?");
    params.push(String(entity_type));
  }
  if (direction) {
    where.push("direction = ?");
    params.push(String(direction));
  }
  if (search) {
    where.push("(idempotency_key LIKE ? OR COALESCE(error_message,'') LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  params.push(limit);
  db.all(
    `SELECT id, direction, entity_type, idempotency_key, status, error_message, attempt_count, next_retry_at, created_at, processed_at
     FROM external_sync_events
     WHERE ${where.join(" AND ")}
     ORDER BY id DESC
     LIMIT ?`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ events: rows || [] });
    },
  );
});

app.post("/api/integrations/shopify/sync/retry-event/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT id, direction, entity_type, status
     FROM external_sync_events
     WHERE id = ?`,
    [id],
    (selErr, eventRow) => {
      if (selErr) return res.status(500).json({ error: selErr.message });
      if (!eventRow) return res.status(404).json({ error: "Event not found" });
      if (eventRow.direction !== "outbound" || eventRow.entity_type !== "inventory") {
        return res.status(400).json({ error: "Only outbound inventory events can be retried" });
      }
      if (!isRetryableInventoryEventStatus(eventRow.status)) {
        return res.status(400).json({ error: "Event status is not retryable" });
      }

      db.run(
        `UPDATE external_sync_events
         SET status = 'pending',
             error_message = NULL,
             next_retry_at = datetime('now','localtime'),
             processed_at = NULL
         WHERE id = ?`,
        [id],
        function (updErr) {
          if (updErr) return res.status(500).json({ error: updErr.message });
          logShopifyEvent("info", "retry_single_queued", { event_id: Number(id), previous_status: eventRow.status });
          res.json({ message: "Event queued for retry", id: Number(id) });
        },
      );
    },
  );
});

app.post("/api/integrations/shopify/sync/process-pending", requirePerm("manage_inventory"), (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit || "25", 10)));
  db.run(
    `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
     VALUES ('outbound', 'process_pending_inventory', 'running', ?)`,
    [`Manual queue processing requested (limit ${limit})`],
    function (runErr) {
      if (runErr) return res.status(500).json({ error: runErr.message });
      const runId = this.lastID;
      processPendingShopifyInventoryEvents(limit, (err, result) => {
        const out = result || { processed: 0, failed: 0, skipped: 0 };
        db.run(
          `UPDATE shopify_sync_runs
           SET finished_at = datetime('now','localtime'),
               status = ?,
               processed_count = ?,
               failed_count = ?
           WHERE id = ?`,
          [out.failed > 0 ? "completed_with_errors" : "completed", out.processed || 0, out.failed || 0, runId],
        );
        if (err) return res.status(500).json({ error: err.message });
        res.json({ run_id: runId, ...out });
      });
    },
  );
});

app.post("/api/integrations/shopify/sync/retry-failed", requirePerm("manage_inventory"), (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.body?.limit || "100", 10)));
  db.run(
    `UPDATE external_sync_events
     SET status = 'pending',
         error_message = NULL,
         next_retry_at = datetime('now','localtime'),
         processed_at = NULL
     WHERE id IN (
       SELECT id FROM external_sync_events
       WHERE direction = 'outbound'
         AND entity_type = 'inventory'
         AND status IN ('failed', 'dead_letter', 'retry', 'failed_mapping')
       ORDER BY id ASC
       LIMIT ?
     )`,
    [limit],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      logShopifyEvent("info", "retry_bulk_queued", { queued: this.changes || 0, limit });
      res.json({ message: "Failed events queued for retry", queued: this.changes || 0 });
    },
  );
});

app.post("/api/integrations/shopify/sync/push-inventory", requirePerm("manage_inventory"), (req, res) => {
  const { rows = [], process_now = true } = req.body || {};
  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });

    db.serialize(() => {
      db.run(
        `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
         VALUES ('outbound', 'manual_push_inventory', 'running', ?)`,
        [rows.length > 0 ? "Manual rows pushed" : "Dry-run push generated from local inventory"],
        function (runErr) {
          if (runErr) return res.status(500).json({ error: runErr.message });
          const runId = this.lastID;
          const toPush = Array.isArray(rows) ? rows : [];
          enqueueInventorySyncEvents(
            toPush,
            { reason: "manual_sync", reference_type: "manual", reference_id: runId },
            (enqueueErr, enqueueResult) => {
              if (enqueueErr) {
                db.run(
                  `UPDATE shopify_sync_runs
                   SET finished_at = datetime('now','localtime'),
                       status = 'failed',
                       failed_count = 1,
                       notes = ?
                   WHERE id = ?`,
                  [enqueueErr.message, runId],
                );
                return res.status(500).json({ error: enqueueErr.message });
              }

              const queuedCount = enqueueResult?.queued || 0;
              const finalizeRun = (processResult) => {
                const processedCount = processResult?.processed || 0;
                const failedCount = processResult?.failed || 0;
                db.run(
                  `UPDATE shopify_sync_runs
                   SET finished_at = datetime('now','localtime'),
                       status = ?,
                       processed_count = ?,
                       failed_count = ?
                   WHERE id = ?`,
                  [failedCount > 0 ? "completed_with_errors" : "completed", processedCount, failedCount, runId],
                );
                db.run(
                  `UPDATE shopify_connections
                   SET last_sync_at = datetime('now','localtime'),
                       last_error = ?,
                       updated_at = datetime('now','localtime')
                   WHERE id = ?`,
                  [failedCount > 0 ? `${failedCount} event(s) failed` : null, conn.id],
                );
                return res.json({
                  message: "Inventory sync run completed",
                  run_id: runId,
                  queued: queuedCount,
                  processed: processedCount,
                  failed: failedCount,
                  skipped: processResult?.skipped || 0,
                });
              };

              if (!process_now || queuedCount === 0) {
                return finalizeRun({ processed: 0, failed: 0, skipped: enqueueResult?.skipped || 0 });
              }
              processPendingShopifyInventoryEvents(50, (procErr, procResult) => {
                if (procErr) return res.status(500).json({ error: procErr.message });
                return finalizeRun(procResult || {});
              });
            },
          );
        },
      );
    });
  });
});

app.post("/api/integrations/shopify/sync/pull-orders", requirePerm("manage_orders"), (req, res) => {
  const { orders = [] } = req.body || {};
  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });

    const demoOrders = Array.isArray(orders) && orders.length > 0
      ? orders
      : [{
        id: `demo-${Date.now()}`,
        name: `#WEB-${Date.now().toString().slice(-6)}`,
        currency: "PKR",
        subtotal_price: 0,
        total_discounts: 0,
        total_tax: 0,
        total_price: 0,
        financial_status: "pending",
        fulfillment_status: "unfulfilled",
        line_items: [],
      }];

    db.run(
      `INSERT INTO shopify_sync_runs (direction, run_type, status, notes)
       VALUES ('inbound', 'manual_pull_orders', 'running', ?)`,
      [`Pull requested: ${demoOrders.length} order(s)`],
      function (runErr) {
        if (runErr) return res.status(500).json({ error: runErr.message });
        const runId = this.lastID;
        let idx = 0;
        let processed = 0;
        let failed = 0;

        const next = () => {
          if (idx >= demoOrders.length) {
            db.run(
              `UPDATE shopify_sync_runs
               SET finished_at = datetime('now','localtime'),
                   status = ?,
                   processed_count = ?,
                   failed_count = ?
               WHERE id = ?`,
              [failed > 0 ? "completed_with_errors" : "completed", processed, failed, runId],
            );
            db.run(
              `UPDATE shopify_connections
               SET last_sync_at = datetime('now','localtime'),
                   last_error = ?,
                   updated_at = datetime('now','localtime')
               WHERE id = ?`,
              [failed > 0 ? "Some orders failed in pull run" : null, conn.id],
            );
            return res.json({
              message: "Order pull run completed",
              run_id: runId,
              processed,
              failed,
            });
          }

          const orderPayload = demoOrders[idx];
          idx += 1;
          upsertWebOrderFromShopifyPayload(orderPayload, (orderErr, result) => {
            const idemKey = `inbound_order_${String(orderPayload?.id || "")}_${String(orderPayload?.updated_at || Date.now())}`;
            db.run(
              `INSERT OR IGNORE INTO external_sync_events (
                 direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at
               ) VALUES ('inbound', 'order', ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
              [
                idemKey,
                orderErr ? "failed" : "processed",
                orderErr ? String(orderErr.message || "Unknown error") : null,
                JSON.stringify({
                  run_id: runId,
                  order_id: orderPayload?.id || null,
                  web_order_id: result?.web_order_id || null,
                }),
              ],
              () => {
                if (orderErr) failed += 1;
                else processed += 1;
                next();
              },
            );
          });
        };
        next();
      },
    );
  });
});

app.post("/api/integrations/shopify/webhooks/orders-create", (req, res) => {
  const payload = req.body || {};
  const rawBody = req.rawBody || JSON.stringify(payload || {});
  const webhookId = req.headers["x-shopify-webhook-id"] || "";
  const hmacHeader = req.headers["x-shopify-hmac-sha256"] || "";
  const shopHeader = req.headers["x-shopify-shop-domain"] || "";
  const triggeredAtHeader = req.headers["x-shopify-triggered-at"] || "";
  const orderId = String(payload?.id || payload?.order_id || "");
  const idempotencyKey = buildWebhookIdempotencyKey({ webhookId, payload });

  getActiveShopifyConnection((connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });

    if (shopHeader && conn.shop_domain && String(shopHeader).toLowerCase() !== String(conn.shop_domain).toLowerCase()) {
      return res.status(403).json({ error: "Shop domain mismatch" });
    }

    const signatureCheck = verifyWebhookSignature({
      rawBody,
      providedHmac: hmacHeader,
      webhookSecret: conn.webhook_secret,
    });
    if (!signatureCheck.ok) {
      return res.status(401).json({
        error: signatureCheck.reason === "missing_signature" ? "Missing webhook signature" : "Invalid webhook signature",
      });
    }

    const replayWindow = evaluateWebhookTimestampWindow(triggeredAtHeader, Date.now());
    if (!replayWindow.ok) {
      logShopifyEvent("warn", "webhook_replay_window_reject", {
        reason: replayWindow.reason,
        age_ms: replayWindow.ageMs || null,
        webhook_id: webhookId || null,
        shop: shopHeader || null,
      });
      return res.status(401).json({ error: "Webhook timestamp outside allowed replay window" });
    }

    db.get(
      "SELECT id FROM external_sync_events WHERE idempotency_key = ?",
      [idempotencyKey],
      (dupErr, dup) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (dup) {
          logShopifyEvent("info", "webhook_duplicate_ignored", {
            webhook_id: webhookId || null,
            idempotency_key: idempotencyKey,
          });
          return res.json({ success: true, duplicate: true });
        }

        upsertWebOrderFromShopifyPayload(payload, (orderErr, result) => {
          db.run(
            `INSERT INTO external_sync_events (
              direction, entity_type, idempotency_key, status, error_message, payload, created_at, processed_at
            ) VALUES ('inbound', 'order', ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
            [
              idempotencyKey,
              orderErr ? "failed" : "processed",
              orderErr ? String(orderErr.message || "Unknown error") : null,
              JSON.stringify({
                webhook_id: webhookId || null,
                order_id: orderId || null,
                web_order_id: result?.web_order_id || null,
              }),
            ],
            (evtErr) => {
              if (evtErr) return res.status(500).json({ error: evtErr.message });
              db.run(
                `UPDATE shopify_connections
                 SET last_sync_at = datetime('now','localtime'),
                     last_error = ?,
                     updated_at = datetime('now','localtime')
                 WHERE id = ?`,
                [orderErr ? String(orderErr.message || "Webhook order processing failed") : null, conn.id],
              );
              if (orderErr) return res.status(500).json({ error: orderErr.message });
              return res.json({ success: true, web_order_id: result?.web_order_id || null });
            },
          );
        });
      },
    );
  });
});

// --- ROUTES: INTERNAL SHOPIFY MAPPINGS ---

app.get("/api/integrations/mappings/products", requirePerm("manage_inventory"), (req, res) => {
  db.all(
    `SELECT spm.*, p.name as product_name, pv.sku as variant_sku
     FROM shopify_product_map spm
     LEFT JOIN products p ON p.id = spm.product_id
     LEFT JOIN product_variants pv ON pv.id = spm.variant_id
     ORDER BY spm.id DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ mappings: rows || [] });
    },
  );
});

app.put("/api/integrations/mappings/products/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const {
    product_id,
    variant_id,
    shopify_product_id,
    shopify_variant_id,
    shopify_inventory_item_id,
    is_active,
  } = req.body || {};
  db.run(
    `INSERT INTO shopify_product_map (
      id, product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(id) DO UPDATE SET
      product_id = excluded.product_id,
      variant_id = excluded.variant_id,
      shopify_product_id = excluded.shopify_product_id,
      shopify_variant_id = excluded.shopify_variant_id,
      shopify_inventory_item_id = excluded.shopify_inventory_item_id,
      is_active = excluded.is_active,
      last_verified_at = datetime('now','localtime')`,
    [
      parseInt(id),
      product_id || null,
      variant_id || null,
      shopify_product_id || null,
      shopify_variant_id || null,
      shopify_inventory_item_id || null,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Product mapping saved" });
    },
  );
});

app.post("/api/integrations/mappings/products/auto", requirePerm("manage_inventory"), (req, res) => {
  // Placeholder for later Shopify-aware auto-map.
  // For pre-integration phase, return local products/variants candidates.
  db.all(
    `SELECT p.id as product_id, p.name, p.barcode, pv.id as variant_id, pv.sku
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id
     ORDER BY p.name ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ candidates: rows || [], message: "Auto-map candidates generated" });
    },
  );
});

app.post("/api/integrations/mappings/products/auto-live", requirePerm("manage_inventory"), (req, res) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.body?.limit || "500", 10)));
  getActiveShopifyConnection(async (connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });

    try {
      const remoteVariants = await fetchShopifyVariantCatalog(conn, limit);
      db.all(
        `SELECT p.id as product_id,
                p.name as product_name,
                p.barcode as product_barcode,
                pv.id as variant_id,
                pv.sku as variant_sku,
                pv.barcode as variant_barcode
         FROM products p
         LEFT JOIN product_variants pv ON pv.product_id = p.id`,
        [],
        (localErr, localRows) => {
          if (localErr) return res.status(500).json({ error: localErr.message });

          const byBarcode = new Map();
          const bySku = new Map();
          for (const rv of remoteVariants) {
            const b = String(rv.barcode || "").trim().toLowerCase();
            const s = String(rv.sku || "").trim().toLowerCase();
            if (b && !byBarcode.has(b)) byBarcode.set(b, rv);
            if (s && !bySku.has(s)) bySku.set(s, rv);
          }

          const suggestions = [];
          for (const lr of localRows || []) {
            const localBarcode = String(lr.variant_barcode || lr.product_barcode || "").trim().toLowerCase();
            const localSku = String(lr.variant_sku || "").trim().toLowerCase();

            let match = null;
            let confidence = "";
            if (localBarcode && byBarcode.has(localBarcode)) {
              match = byBarcode.get(localBarcode);
              confidence = "exact_barcode";
            } else if (localSku && bySku.has(localSku)) {
              match = bySku.get(localSku);
              confidence = "exact_sku";
            }
            if (!match) continue;

            suggestions.push({
              product_id: lr.product_id,
              product_name: lr.product_name,
              variant_id: lr.variant_id || null,
              local_sku: lr.variant_sku || null,
              local_barcode: lr.variant_barcode || lr.product_barcode || null,
              shopify_product_id: match.product_id || null,
              shopify_variant_id: match.variant_id || null,
              shopify_inventory_item_id: match.inventory_item_id || null,
              shopify_title: match.display_name || match.product_title || null,
              confidence,
            });
          }

          return res.json({
            message: "Live mapping suggestions generated",
            remote_count: remoteVariants.length,
            suggestion_count: suggestions.length,
            suggestions,
          });
        },
      );
    } catch (e) {
      return res.status(400).json({ error: e.message || "Failed to generate live mappings" });
    }
  });
});

app.post("/api/integrations/mappings/products/apply-suggestions", requirePerm("manage_inventory"), (req, res) => {
  const suggestions = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
  if (suggestions.length === 0) {
    return res.status(400).json({ error: "suggestions array is required" });
  }

  let idx = 0;
  let applied = 0;
  let skipped = 0;
  const conflicts = [];

  const next = () => {
    if (idx >= suggestions.length) {
      return res.json({
        message: "Suggestions processed",
        total: suggestions.length,
        applied,
        skipped,
        conflicts,
      });
    }

    const s = suggestions[idx];
    idx += 1;
    const productId = s.product_id ? Number(s.product_id) : null;
    const variantId = s.variant_id ? Number(s.variant_id) : null;
    const shopifyProductId = s.shopify_product_id || null;
    const shopifyVariantId = s.shopify_variant_id || null;
    const shopifyInventoryItemId = s.shopify_inventory_item_id || null;

    if (!productId || !shopifyVariantId) {
      skipped += 1;
      return next();
    }

    db.get(
      `SELECT id, product_id, variant_id
       FROM shopify_product_map
       WHERE shopify_variant_id = ?
         AND (
           product_id != ?
           OR COALESCE(variant_id, -1) != COALESCE(?, -1)
         )
       LIMIT 1`,
      [shopifyVariantId, productId, variantId],
      (confErr, conflict) => {
        if (confErr) {
          skipped += 1;
          conflicts.push({
            product_id: productId,
            variant_id: variantId,
            shopify_variant_id: shopifyVariantId,
            reason: confErr.message,
          });
          return next();
        }
        if (conflict) {
          skipped += 1;
          conflicts.push({
            product_id: productId,
            variant_id: variantId,
            shopify_variant_id: shopifyVariantId,
            reason: `Already mapped to local product ${conflict.product_id}/${conflict.variant_id || "no-variant"}`,
          });
          return next();
        }

        db.run(
          `INSERT INTO shopify_product_map (
             product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at
           ) VALUES (?, ?, ?, ?, ?, 1, datetime('now','localtime'))
           ON CONFLICT(product_id, variant_id) DO UPDATE SET
             shopify_product_id = excluded.shopify_product_id,
             shopify_variant_id = excluded.shopify_variant_id,
             shopify_inventory_item_id = excluded.shopify_inventory_item_id,
             is_active = 1,
             last_verified_at = datetime('now','localtime')`,
          [productId, variantId, shopifyProductId, shopifyVariantId, shopifyInventoryItemId],
          (upErr) => {
            if (upErr) {
              skipped += 1;
              conflicts.push({
                product_id: productId,
                variant_id: variantId,
                shopify_variant_id: shopifyVariantId,
                reason: upErr.message,
              });
            } else {
              applied += 1;
            }
            return next();
          },
        );
      },
    );
  };

  next();
});

app.get("/api/integrations/mappings/locations", requirePerm("manage_inventory"), (req, res) => {
  db.all(
    `SELECT slm.*, o.name as outlet_name
     FROM shopify_location_map slm
     LEFT JOIN outlets o ON o.id = slm.outlet_id
     ORDER BY o.name ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ mappings: rows || [] });
    },
  );
});

app.put("/api/integrations/mappings/locations/:outletId", requirePerm("manage_inventory"), (req, res) => {
  const { outletId } = req.params;
  const { shopify_location_id, shopify_location_name } = req.body || {};
  if (!shopify_location_id) {
    return res.status(400).json({ error: "shopify_location_id is required" });
  }
  db.run(
    `INSERT INTO shopify_location_map (outlet_id, shopify_location_id, shopify_location_name)
     VALUES (?, ?, ?)
     ON CONFLICT(outlet_id, shopify_location_id) DO UPDATE SET
       shopify_location_name = excluded.shopify_location_name`,
    [outletId, String(shopify_location_id), shopify_location_name || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Location mapping saved" });
    },
  );
});

app.get("/api/integrations/mappings/customers", requirePerm("manage_orders"), (req, res) => {
  db.all(
    `SELECT scm.*, c.name as customer_name, c.mobile, c.email
     FROM shopify_customer_map scm
     LEFT JOIN customers c ON c.id = scm.customer_id
     ORDER BY scm.id DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ mappings: rows || [] });
    },
  );
});

app.put("/api/integrations/mappings/customers/:customerId", requirePerm("manage_orders"), (req, res) => {
  const { customerId } = req.params;
  const { shopify_customer_id } = req.body || {};
  if (!shopify_customer_id) {
    return res.status(400).json({ error: "shopify_customer_id is required" });
  }
  db.run(
    `INSERT INTO shopify_customer_map (customer_id, shopify_customer_id, last_synced_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(shopify_customer_id) DO UPDATE SET
      customer_id = excluded.customer_id,
      last_synced_at = datetime('now','localtime')`,
    [customerId, String(shopify_customer_id)],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Customer mapping saved" });
    },
  );
});

// --- ROUTES: RECONCILIATION (internal) ---

app.get("/api/reconciliation/inventory", requireAnyPerm(["view_reports", "manage_inventory"]), (req, res) => {
  const { status, resolution_status } = req.query;
  const where = ["1=1"];
  const params = [];
  if (status) {
    where.push("ir.status = ?");
    params.push(status);
  }
  if (resolution_status) {
    where.push("ir.resolution_status = ?");
    params.push(resolution_status);
  }
  db.all(
    `SELECT ir.*,
            p.name as product_name,
            pv.sku as variant_sku,
            o.name as outlet_name
     FROM inventory_reconciliation ir
     LEFT JOIN products p ON p.id = ir.product_id
     LEFT JOIN product_variants pv ON pv.id = ir.variant_id
     LEFT JOIN outlets o ON o.id = ir.outlet_id
     WHERE ${where.join(" AND ")}
     ORDER BY ir.checked_at DESC, ABS(ir.diff) DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ rows: rows || [] });
    },
  );
});

app.post("/api/reconciliation/inventory/run", requirePerm("manage_inventory"), (req, res) => {
  getActiveShopifyConnection(async (connErr, conn) => {
    if (connErr) return res.status(500).json({ error: connErr.message });
    if (!conn) return res.status(400).json({ error: "No active Shopify connection" });

    db.all(
      `SELECT spm.product_id,
              spm.variant_id,
              spm.shopify_inventory_item_id,
              slm.outlet_id,
              slm.shopify_location_id,
              COALESCE(SUM(os.quantity), 0) as local_qty
       FROM shopify_product_map spm
       JOIN shopify_location_map slm
       LEFT JOIN outlet_stock os
         ON os.product_id = spm.product_id
        AND os.outlet_id = slm.outlet_id
       WHERE spm.is_active = 1
         AND spm.shopify_inventory_item_id IS NOT NULL
       GROUP BY spm.product_id, spm.variant_id, spm.shopify_inventory_item_id, slm.outlet_id, slm.shopify_location_id`,
      [],
      async (mapErr, mappedRows) => {
        if (mapErr) return res.status(500).json({ error: mapErr.message });
        if (!mappedRows || mappedRows.length === 0) {
          return res.status(400).json({ error: "No mapped inventory items/locations found for reconciliation" });
        }

        const rowsToInsert = [];
        let matched = 0;
        let mismatch = 0;
        let errors = 0;

        for (const row of mappedRows) {
          const localQty = Number(row.local_qty || 0);
          try {
            const remote = await fetchInventoryLevel(conn, row.shopify_inventory_item_id, row.shopify_location_id);
            const externalQty = Number(remote.available || 0);
            const diff = Number((localQty - externalQty).toFixed(4));
            const status = diff === 0 ? "matched" : "mismatch";
            if (status === "matched") matched += 1;
            else mismatch += 1;
            rowsToInsert.push({
              product_id: row.product_id,
              variant_id: row.variant_id || null,
              outlet_id: row.outlet_id,
              external_location_id: row.shopify_location_id,
              local_qty: localQty,
              external_qty: externalQty,
              diff,
              status,
              resolution_status: "open",
              resolution_note: null,
            });
          } catch (e) {
            errors += 1;
            rowsToInsert.push({
              product_id: row.product_id,
              variant_id: row.variant_id || null,
              outlet_id: row.outlet_id,
              external_location_id: row.shopify_location_id,
              local_qty: localQty,
              external_qty: 0,
              diff: localQty,
              status: "error",
              resolution_status: "open",
              resolution_note: String(e.message || "Failed fetching Shopify quantity"),
            });
          }
        }

        db.serialize(() => {
          db.run("DELETE FROM inventory_reconciliation");
          const stmt = db.prepare(
            `INSERT INTO inventory_reconciliation (
               product_id, variant_id, outlet_id, external_location_id,
               local_qty, external_qty, diff, status, checked_at,
               resolution_status, resolution_note
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?, ?)`,
          );
          for (const r of rowsToInsert) {
            stmt.run([
              r.product_id,
              r.variant_id,
              r.outlet_id,
              r.external_location_id,
              r.local_qty,
              r.external_qty,
              r.diff,
              r.status,
              r.resolution_status,
              r.resolution_note,
            ]);
          }
          stmt.finalize((finErr) => {
            if (finErr) return res.status(500).json({ error: finErr.message });
            return res.json({
              message: "Live reconciliation completed",
              row_count: rowsToInsert.length,
              matched,
              mismatch,
              errors,
            });
          });
        });
      },
    );
  });
});

app.post("/api/reconciliation/inventory/:id/resolve", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const { resolution_status = "resolved", resolution_note = null } = req.body || {};
  const allowed = ["open", "resolved", "ignored"];
  if (!allowed.includes(String(resolution_status))) {
    return res.status(400).json({ error: `resolution_status must be one of: ${allowed.join(", ")}` });
  }
  const resolvedBy = req.headers["x-employee-id"] ? Number(req.headers["x-employee-id"]) : null;
  db.run(
    `UPDATE inventory_reconciliation
     SET resolution_status = ?,
         resolution_note = ?,
         resolved_by = ?,
         resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now','localtime') END
     WHERE id = ?`,
    [resolution_status, resolution_note, resolvedBy, resolution_status, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Reconciliation row not found" });
      logActionHistory(
        req,
        "reconciliation_resolve",
        `Reconciliation row #${id} marked as ${resolution_status}`,
      );
      res.json({ message: "Reconciliation row updated" });
    },
  );
});

function executeReconciliationFix(req, row, mode, cb) {
  const fixMode = String(mode || "");
  if (!["push_to_shopify", "pull_to_local"].includes(fixMode)) {
    return cb(new Error("mode must be 'push_to_shopify' or 'pull_to_local'"));
  }
  const rowId = row?.id;
  if (!rowId) return cb(new Error("Reconciliation row not found"));

  const localQty = Number(row.local_qty || 0);
  const externalQty = Number(row.external_qty || 0);
  const diff = Number((localQty - externalQty).toFixed(4));

  if (fixMode === "push_to_shopify") {
    if (!row.external_location_id) {
      return cb(new Error("Missing external location id on reconciliation row"));
    }
    return db.get(
      `SELECT shopify_inventory_item_id
       FROM shopify_product_map
       WHERE product_id = ?
         AND ((variant_id IS NOT NULL AND variant_id = ?) OR (variant_id IS NULL AND ? IS NULL))
         AND is_active = 1
       ORDER BY CASE WHEN variant_id IS NOT NULL THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
      [row.product_id, row.variant_id || null, row.variant_id || null],
      (mapErr, map) => {
        if (mapErr) return cb(mapErr);
        if (!map?.shopify_inventory_item_id) {
          return cb(new Error("No active Shopify inventory mapping found for this row"));
        }
        return getActiveShopifyConnection(async (connErr, conn) => {
          if (connErr) return cb(connErr);
          if (!conn) return cb(new Error("No active Shopify connection"));
          try {
            const result = await adjustShopifyInventory(
              conn,
              [
                {
                  inventory_item_id: map.shopify_inventory_item_id,
                  location_id: row.external_location_id,
                  delta: diff,
                },
              ],
              "correction",
            );
            if ((result.userErrors || []).length > 0) {
              return cb(new Error(result.userErrors.map((e) => e.message).join("; ") || "Shopify user error"));
            }
            db.run(
              `UPDATE inventory_reconciliation
               SET external_qty = local_qty,
                   diff = 0,
                   status = 'matched',
                   resolution_status = 'resolved',
                   resolution_note = ?,
                   resolved_by = ?,
                   resolved_at = datetime('now','localtime')
               WHERE id = ?`,
              [
                "Corrective action: pushed local qty to Shopify",
                req.headers["x-employee-id"] ? Number(req.headers["x-employee-id"]) : null,
                rowId,
              ],
              (updErr) => {
                if (updErr) return cb(updErr);
                return cb(null, { message: "Corrective push applied to Shopify", delta: diff });
              },
            );
          } catch (e) {
            return cb(new Error(e.message || "Failed applying Shopify correction"));
          }
        });
      },
    );
  }

  const deltaLocal = Number((externalQty - localQty).toFixed(4));
  return db.run(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
     VALUES (?, ?, ?)
     ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = quantity + ?`,
    [row.product_id, row.outlet_id, deltaLocal, deltaLocal],
    (stockErr) => {
      if (stockErr) return cb(stockErr);
      return db.run(
        `UPDATE inventory_reconciliation
         SET local_qty = external_qty,
             diff = 0,
             status = 'matched',
             resolution_status = 'resolved',
             resolution_note = ?,
             resolved_by = ?,
             resolved_at = datetime('now','localtime')
         WHERE id = ?`,
        [
          "Corrective action: pulled Shopify qty to local stock",
          req.headers["x-employee-id"] ? Number(req.headers["x-employee-id"]) : null,
          rowId,
        ],
        (updErr) => {
          if (updErr) return cb(updErr);
          return cb(null, { message: "Corrective pull applied to local stock", delta: deltaLocal });
        },
      );
    },
  );
}

app.post("/api/reconciliation/inventory/:id/request-fix", requirePerm("manage_inventory"), requireFeature("approvals"), (req, res) => {
  const { id } = req.params;
  const { mode, requested_by, note } = req.body || {};
  const requesterEmployeeId = req.headers["x-employee-id"] ? Number(req.headers["x-employee-id"]) : null;
  const fixMode = String(mode || "");
  if (!["push_to_shopify", "pull_to_local"].includes(fixMode)) {
    return res.status(400).json({ error: "mode must be 'push_to_shopify' or 'pull_to_local'" });
  }

  db.get(
    "SELECT * FROM inventory_reconciliation WHERE id = ?",
    [id],
    (rowErr, row) => {
      if (rowErr) return res.status(500).json({ error: rowErr.message });
      if (!row) return res.status(404).json({ error: "Reconciliation row not found" });

      db.get(
        `SELECT id
         FROM approval_requests
         WHERE reference_type = 'reconciliation'
           AND reference_id = ?
           AND status = 'pending_approval'`,
        [id],
        (pendingErr, pendingReq) => {
          if (pendingErr) return res.status(500).json({ error: pendingErr.message });
          if (pendingReq) {
            return res.status(409).json({ error: "A reconciliation approval is already pending for this row" });
          }

          const notes = JSON.stringify({
            mode: fixMode,
            note: note || null,
            diff: row.diff,
            local_qty: row.local_qty,
            external_qty: row.external_qty,
            product_id: row.product_id,
            variant_id: row.variant_id || null,
            outlet_id: row.outlet_id,
            requester_employee_id: requesterEmployeeId || null,
            requested_at: new Date().toISOString(),
          });

          db.run(
            `INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes, status)
             VALUES ('reconciliation_fix', ?, 'reconciliation', ?, ?, 'pending_approval')`,
            [id, requested_by || (requesterEmployeeId ? String(requesterEmployeeId) : null), notes],
            function (insErr) {
              if (insErr) return res.status(500).json({ error: insErr.message });
              logActionHistory(
                req,
                "reconciliation_fix_request",
                `Reconciliation fix requested for row #${id} mode=${fixMode}`,
              );
              return res.json({
                message: "Reconciliation fix approval request submitted",
                approval_request_id: this.lastID,
              });
            },
          );
        },
      );
    },
  );
});

app.post("/api/reconciliation/inventory/:id/approve-fix", requireAnyPerm(["manage_orders", "manage_employees"]), requireFeature("approvals"), (req, res) => {
  const { id } = req.params;
  const { action, action_by, reason } = req.body || {};
  const approverEmployeeId = req.headers["x-employee-id"] ? Number(req.headers["x-employee-id"]) : null;
  if (!["approved", "rejected"].includes(String(action))) {
    return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
  }

  db.get("SELECT * FROM inventory_reconciliation WHERE id = ?", [id], (rowErr, row) => {
    if (rowErr) return res.status(500).json({ error: rowErr.message });
    if (!row) return res.status(404).json({ error: "Reconciliation row not found" });

    db.get(
      `SELECT *
       FROM approval_requests
       WHERE reference_type = 'reconciliation'
         AND reference_id = ?
         AND status = 'pending_approval'
       ORDER BY id DESC
       LIMIT 1`,
      [id],
      (reqErr, approvalReq) => {
        if (reqErr) return res.status(500).json({ error: reqErr.message });
        if (!approvalReq) return res.status(404).json({ error: "No pending approval request found for this row" });

        let parsedNotes = {};
        try {
          parsedNotes = JSON.parse(approvalReq.notes || "{}");
        } catch {
          parsedNotes = {};
        }
        const mode = String(parsedNotes.mode || "");
        if (!["push_to_shopify", "pull_to_local"].includes(mode)) {
          return res.status(400).json({ error: "Pending request is missing a valid mode" });
        }
        const requesterFromNotes = Number(parsedNotes.requester_employee_id || 0) || null;
        const requesterFromColumn = Number(approvalReq.requested_by || 0) || null;
        const requesterEmployeeId = requesterFromNotes || requesterFromColumn;
        if (!canApproveReconciliationRequest({ requesterEmployeeId, approverEmployeeId })) {
          return res.status(403).json({ error: "Requester cannot approve or reject their own reconciliation fix request" });
        }

        const finalizeApproval = (finalStatus, extraMessage = null) => {
          const actionReasonPayload = JSON.stringify({
            note: reason || null,
            mode,
            row_id: Number(id),
            requester_employee_id: requesterEmployeeId || null,
            approver_employee_id: approverEmployeeId || null,
            local_qty_before: Number(row.local_qty || 0),
            external_qty_before: Number(row.external_qty || 0),
            diff_before: Number(row.diff || 0),
            decision_at: new Date().toISOString(),
          });
          db.serialize(() => {
            db.run(
              "UPDATE approval_requests SET status = ? WHERE id = ?",
              [finalStatus, approvalReq.id],
            );
            db.run(
              "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
              [approvalReq.id, finalStatus, action_by || (approverEmployeeId ? String(approverEmployeeId) : null), actionReasonPayload],
            );
          });
          return res.json({
            message:
              finalStatus === "approved"
                ? (extraMessage || "Reconciliation fix approved and applied")
                : "Reconciliation fix rejected",
          });
        };

        if (action === "rejected") {
          logActionHistory(
            req,
            "reconciliation_fix_reject",
            `Reconciliation fix request rejected for row #${id}`,
          );
          return finalizeApproval("rejected");
        }

        executeReconciliationFix(req, row, mode, (fixErr, fixResult) => {
          if (fixErr) return res.status(500).json({ error: fixErr.message });
          logActionHistory(
            req,
            "reconciliation_fix_approve",
            `Reconciliation fix approved for row #${id} mode=${mode}`,
          );
          return finalizeApproval("approved", fixResult?.message || null);
        });
      },
    );
  });
});

app.get("/api/reconciliation/inventory/:id/audit", requireAnyPerm(["manage_inventory", "manage_employees", "view_reports"]), (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT ir.*,
            p.name as product_name,
            o.name as outlet_name
     FROM inventory_reconciliation ir
     LEFT JOIN products p ON p.id = ir.product_id
     LEFT JOIN outlets o ON o.id = ir.outlet_id
     WHERE ir.id = ?`,
    [id],
    (rowErr, row) => {
      if (rowErr) return res.status(500).json({ error: rowErr.message });
      if (!row) return res.status(404).json({ error: "Reconciliation row not found" });

      db.all(
        `SELECT *
         FROM approval_requests
         WHERE reference_type = 'reconciliation'
           AND reference_id = ?
         ORDER BY id DESC`,
        [id],
        (reqErr, requests) => {
          if (reqErr) return res.status(500).json({ error: reqErr.message });
          const requestIds = (requests || []).map((r) => r.id);
          if (requestIds.length === 0) {
            return res.json({ row, approval_requests: [], approval_actions: [] });
          }
          const placeholders = requestIds.map(() => "?").join(",");
          db.all(
            `SELECT *
             FROM approval_actions
             WHERE approval_request_id IN (${placeholders})
             ORDER BY id DESC`,
            requestIds,
            (actErr, actions) => {
              if (actErr) return res.status(500).json({ error: actErr.message });
              return res.json({
                row,
                approval_requests: requests || [],
                approval_actions: actions || [],
              });
            },
          );
        },
      );
    },
  );
});

// --- APPROVAL WORKFLOW TABLES (Phase 1) ---
// Ensure approval tables exist on startup (idempotent)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_type TEXT NOT NULL,
    reference_id INTEGER NOT NULL,
    reference_type TEXT NOT NULL,
    requested_by TEXT,
    status TEXT DEFAULT 'pending_approval',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS approval_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_request_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    action_by TEXT,
    reason TEXT,
    actioned_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
});

// --- ROUTES: APPROVAL WORKFLOW ---

// List pending approvals (with context info)
app.get("/api/approvals", requireFeature("approvals"), (req, res) => {
  const { status = "pending_approval" } = req.query;
  db.all(
    `SELECT * FROM approval_requests WHERE status = ? ORDER BY created_at DESC`,
    [status],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ approvals: rows });
    }
  );
});

// Submit a PO for approval
app.post("/api/purchase-orders/:id/submit", requireFeature("approvals"), (req, res) => {
  const { id } = req.params;
  const { requested_by, notes } = req.body;

  db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status !== "Draft")
      return res.status(400).json({ error: "Only Draft POs can be submitted for approval" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "UPDATE purchase_orders SET status = 'pending_approval' WHERE id = ?",
        [id],
        (err) => {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
        }
      );
      db.run(
        "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('po_approval', ?, 'purchase_order', ?, ?)",
        [id, requested_by || null, notes || null],
        function (err) {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "PO submitted for approval", approval_request_id: this.lastID });
          });
        }
      );
    });
  });
});

// Approve or reject a PO
app.post("/api/purchase-orders/:id/approve", requireFeature("approvals"), (req, res) => {
  const { id } = req.params;
  const { action, action_by, reason } = req.body; // action: 'approved' | 'rejected'

  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
  }

  db.get("SELECT * FROM purchase_orders WHERE id = ?", [id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: "PO not found" });
    if (po.status !== "pending_approval")
      return res.status(400).json({ error: "Only POs pending approval can be approved/rejected" });

    db.get(
      "SELECT id FROM approval_requests WHERE reference_type = 'purchase_order' AND reference_id = ? AND status = 'pending_approval'",
      [id],
      (err, req_row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run(
            "UPDATE purchase_orders SET status = ? WHERE id = ?",
            [action === "approved" ? "Approved" : "Draft", id]
          );
          if (req_row) {
            db.run(
              "UPDATE approval_requests SET status = ? WHERE id = ?",
              [action, req_row.id]
            );
            db.run(
              "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
              [req_row.id, action, action_by || null, reason || null]
            );
          }
          db.run(
            "INSERT INTO action_history (user_name, action_type, description) VALUES (?, 'po_approval', ?)",
            [action_by || "System", `PO #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`]
          );
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `PO ${action} successfully` });
          });
        });
      }
    );
  });
});

// Submit a transfer for approval
app.post("/api/transfers/:id/submit", requireFeature("approvals"), (req, res) => {
  const { id } = req.params;
  const { requested_by, notes } = req.body;

  db.get("SELECT * FROM inventory_transfers WHERE id = ?", [id], (err, tr) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!tr) return res.status(404).json({ error: "Transfer not found" });
    if (tr.status !== "draft")
      return res.status(400).json({ error: "Only draft transfers can be submitted for approval" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "UPDATE inventory_transfers SET status = 'pending_approval' WHERE id = ?",
        [id],
        (err) => {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
        }
      );
      db.run(
        "INSERT INTO approval_requests (request_type, reference_id, reference_type, requested_by, notes) VALUES ('str_approval', ?, 'transfer', ?, ?)",
        [id, requested_by || null, notes || null],
        function (err) {
          if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Transfer submitted for approval", approval_request_id: this.lastID });
          });
        }
      );
    });
  });
});

// Approve or reject a transfer
app.post("/api/transfers/:id/approve", requireFeature("approvals"), (req, res) => {
  const { id } = req.params;
  const { action, action_by, reason } = req.body;

  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
  }

  db.get("SELECT * FROM inventory_transfers WHERE id = ?", [id], (err, tr) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!tr) return res.status(404).json({ error: "Transfer not found" });
    if (tr.status !== "pending_approval")
      return res.status(400).json({ error: "Only transfers pending approval can be approved/rejected" });

    db.get(
      "SELECT id FROM approval_requests WHERE reference_type = 'transfer' AND reference_id = ? AND status = 'pending_approval'",
      [id],
      (err, req_row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run(
            "UPDATE inventory_transfers SET status = ? WHERE id = ?",
            [action === "approved" ? "approved" : "draft", id]
          );
          if (req_row) {
            db.run("UPDATE approval_requests SET status = ? WHERE id = ?", [action, req_row.id]);
            db.run(
              "INSERT INTO approval_actions (approval_request_id, action, action_by, reason) VALUES (?, ?, ?, ?)",
              [req_row.id, action, action_by || null, reason || null]
            );
          }
          db.run(
            "INSERT INTO action_history (user_name, action_type, description) VALUES (?, 'str_approval', ?)",
            [action_by || "System", `Transfer #${id} ${action} by ${action_by || "manager"}. ${reason || ""}`]
          );
          db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `Transfer ${action} successfully` });
          });
        });
      }
    );
  });
});

// --- BARCODE TEMPLATES ---

app.get("/api/barcode-templates", (req, res) => {
  db.all("SELECT * FROM barcode_templates ORDER BY is_default DESC, name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ templates: rows });
  });
});

app.post("/api/barcode-templates", requirePerm("manage_inventory"), (req, res) => {
  const { name, width_mm = 50, height_mm = 30, show_name = 1, show_price = 1, show_barcode = 1, show_sku = 0, show_brand = 0, font_size = 10, is_default = 0 } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.serialize(() => {
    if (is_default) db.run("UPDATE barcode_templates SET is_default = 0");
    db.run(
      "INSERT INTO barcode_templates (name, width_mm, height_mm, show_name, show_price, show_barcode, show_sku, show_brand, font_size, is_default) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [name, width_mm, height_mm, show_name ? 1 : 0, show_price ? 1 : 0, show_barcode ? 1 : 0, show_sku ? 1 : 0, show_brand ? 1 : 0, font_size, is_default ? 1 : 0],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  });
});

app.put("/api/barcode-templates/:id", requirePerm("manage_inventory"), (req, res) => {
  const { id } = req.params;
  const { name, width_mm, height_mm, show_name, show_price, show_barcode, show_sku, show_brand, font_size, is_default } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.serialize(() => {
    if (is_default) db.run("UPDATE barcode_templates SET is_default = 0");
    db.run(
      "UPDATE barcode_templates SET name=?, width_mm=?, height_mm=?, show_name=?, show_price=?, show_barcode=?, show_sku=?, show_brand=?, font_size=?, is_default=? WHERE id=?",
      [name, width_mm, height_mm, show_name ? 1 : 0, show_price ? 1 : 0, show_barcode ? 1 : 0, show_sku ? 1 : 0, show_brand ? 1 : 0, font_size, is_default ? 1 : 0, id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: true });
      }
    );
  });
});

app.delete("/api/barcode-templates/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM barcode_templates WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true });
  });
});

// POST /api/barcode-print-jobs — log a batch print event
app.post("/api/barcode-print-jobs", (req, res) => {
  const { template_id, items = [] } = req.body;
  if (!items.length) return res.status(400).json({ error: "No items" });
  const stmt = db.prepare(
    "INSERT INTO barcode_print_jobs (template_id, product_id, product_name, barcode, price, copies) VALUES (?,?,?,?,?,?)"
  );
  for (const item of items) {
    stmt.run([template_id || null, item.product_id || null, item.name || "", item.barcode || "", item.price || 0, item.copies || 1]);
  }
  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ logged: items.length });
  });
});

// --- EXPENSES ---

// Expense categories CRUD
app.get("/api/expense-categories", (req, res) => {
  db.all("SELECT * FROM expense_categories ORDER BY name ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ categories: rows });
  });
});

app.post("/api/expense-categories", requirePerm("manage_inventory"), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.run("INSERT INTO expense_categories (name, description) VALUES (?,?)", [name, description || null], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put("/api/expense-categories/:id", requirePerm("manage_inventory"), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  db.run("UPDATE expense_categories SET name=?, description=? WHERE id=?", [name, description || null, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: true });
  });
});

app.delete("/api/expense-categories/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM expense_categories WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true });
  });
});

// Expenses CRUD
app.get("/api/expenses", (req, res) => {
  const { outlet_id, category_id, from, to } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  if (outlet_id) { where += " AND e.outlet_id=?"; params.push(outlet_id); }
  if (category_id) { where += " AND e.category_id=?"; params.push(category_id); }
  if (from) { where += " AND e.expense_date >= ?"; params.push(from); }
  if (to) { where += " AND e.expense_date <= ?"; params.push(to); }

  db.all(`
    SELECT e.*, ec.name as category_name, o.name as outlet_name,
           emp.name as employee_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON e.category_id = ec.id
    LEFT JOIN outlets o ON e.outlet_id = o.id
    LEFT JOIN employees emp ON e.employee_id = emp.id
    ${where}
    ORDER BY e.expense_date DESC, e.created_at DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ expenses: rows });
  });
});

app.post("/api/expenses", (req, res) => {
  const { category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date } = req.body;
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount required" });
  db.run(
    `INSERT INTO expenses (category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      category_id || null, outlet_id || null, shift_id || null, employee_id || null,
      parseFloat(amount), description || null, reference || null,
      expense_date || new Date().toISOString().slice(0, 10),
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put("/api/expenses/:id", (req, res) => {
  const { category_id, outlet_id, shift_id, employee_id, amount, description, reference, expense_date } = req.body;
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
    return res.status(400).json({ error: "Valid amount required" });
  db.run(
    `UPDATE expenses SET category_id=?, outlet_id=?, shift_id=?, employee_id=?, amount=?,
     description=?, reference=?, expense_date=? WHERE id=?`,
    [
      category_id || null, outlet_id || null, shift_id || null, employee_id || null,
      parseFloat(amount), description || null, reference || null,
      expense_date || new Date().toISOString().slice(0, 10), req.params.id,
    ],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: true });
    }
  );
});

app.delete("/api/expenses/:id", requirePerm("manage_inventory"), (req, res) => {
  db.run("DELETE FROM expenses WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: true });
  });
});

// Summary: expenses by category for a date range (used by reports/dashboard)
app.get("/api/expenses/summary", (req, res) => {
  const { from, to, outlet_id } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  if (from) { where += " AND e.expense_date >= ?"; params.push(from); }
  if (to) { where += " AND e.expense_date <= ?"; params.push(to); }
  if (outlet_id) { where += " AND e.outlet_id = ?"; params.push(outlet_id); }

  db.all(`
    SELECT ec.name as category, SUM(e.amount) as total, COUNT(e.id) as count
    FROM expenses e
    LEFT JOIN expense_categories ec ON e.category_id = ec.id
    ${where}
    GROUP BY e.category_id
    ORDER BY total DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    res.json({ summary: rows, grand_total: grandTotal });
  });
});

// ─── BACKUP / RESTORE ────────────────────────────────────────────────────────

const backupUploadDir = UPLOADS_DIR;

const restoreStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, backupUploadDir),
  filename: (req, file, cb) => cb(null, `restore_${Date.now()}.db`),
});
const restoreUpload = multer({ storage: restoreStorage, limits: { fileSize: 500 * 1024 * 1024 } });

// GET /api/backup/download — stream the SQLite file
app.get("/api/backup/download", requirePerm("manage_employees"), requireFeature("backup_restore"), (req, res) => {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `oneshop_backup_${ts}.db`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  const stream = fs.createReadStream(DB_PATH);
  stream.on("error", (err) => res.status(500).json({ error: err.message }));
  stream.pipe(res);
  // Log the backup event after streaming begins
  const { performed_by } = req.query;
  const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
  db.run(
    "INSERT INTO backup_log (action, filename, size_bytes, performed_by) VALUES ('backup', ?, ?, ?)",
    [filename, size, performed_by || null]
  );
});

// POST /api/backup/restore — upload a .db file and replace the live DB
app.post("/api/backup/restore", requirePerm("manage_employees"), requireFeature("backup_restore"), restoreUpload.single("backup_file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (isRestoreInProgress) {
    return res.status(409).json({ error: "Restore already in progress" });
  }
  isRestoreInProgress = true;

  const uploadedPath = req.file.path;
  const { performed_by, note } = req.body;

  const cleanupAndFail = (status, message) => {
    try {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    } catch (_) {
      // ignore cleanup errors
    }
    isRestoreInProgress = false;
    return res.status(status).json({ error: message });
  };

  try {
    const header = Buffer.alloc(16);
    const fd = fs.openSync(uploadedPath, "r");
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    if (header.toString("ascii", 0, 6) !== "SQLite") {
      return cleanupAndFail(400, "Uploaded file is not a valid SQLite database");
    }
  } catch (err) {
    return cleanupAndFail(400, "Failed to read uploaded file: " + err.message);
  }

  const verifyDb = new sqlite3.Database(uploadedPath, sqlite3.OPEN_READONLY, (openErr) => {
    if (openErr) {
      return cleanupAndFail(400, "Failed to open uploaded database: " + openErr.message);
    }

    verifyDb.get("PRAGMA quick_check", [], (qcErr, qcRow) => {
      verifyDb.close(() => {});
      if (qcErr) return cleanupAndFail(400, "Failed SQLite integrity check: " + qcErr.message);
      const qc = qcRow ? Object.values(qcRow)[0] : null;
      if (String(qc).toLowerCase() !== "ok") {
        return cleanupAndFail(400, "Uploaded database failed integrity check");
      }

      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const snapshotPath = path.join(backupUploadDir, `oneshop_pre_restore_${ts}.db`);
      const stagedPath = path.join(backupUploadDir, `oneshop_restore_staged_${Date.now()}.db`);

      db.run("BEGIN IMMEDIATE", (lockErr) => {
        if (lockErr) return cleanupAndFail(503, "Could not acquire database lock for restore");

        try {
          fs.copyFileSync(DB_PATH, snapshotPath);
          fs.copyFileSync(uploadedPath, stagedPath);
          fs.copyFileSync(stagedPath, DB_PATH);
          fs.unlinkSync(uploadedPath);
          fs.unlinkSync(stagedPath);
        } catch (swapErr) {
          db.run("ROLLBACK");
          return cleanupAndFail(500, "Failed to replace database: " + swapErr.message);
        }

        db.run("ROLLBACK");
        db.run(
          "INSERT INTO backup_log (action, filename, size_bytes, performed_by, note) VALUES ('restore', ?, ?, ?, ?)",
          [req.file.originalname, req.file.size, performed_by || null, note || null],
          () => {
            // best-effort logging
          }
        );

        res.json({
          success: true,
          message:
            "Database restored successfully. Backend will restart now. If not supervised, restart it manually.",
        });
        res.on("finish", () => {
          setTimeout(() => process.exit(0), 300);
        });
      });
    });
  });
});

// GET /api/backup/log — backup/restore history
app.get("/api/backup/log", requirePerm("manage_employees"), requireFeature("backup_restore"), (req, res) => {
  db.all("SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 100", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ log: rows });
  });
});

// ─── E-INVOICING ─────────────────────────────────────────────────────────────

// Helper: generate next invoice number atomically (INV-YYYY-00001)
function generateInvoiceNumber(cb) {
  const year = new Date().getFullYear();
  db.serialize(() => {
    db.run(
      "INSERT INTO invoice_sequences (year, last_seq) VALUES (?, 1) ON CONFLICT(year) DO UPDATE SET last_seq = last_seq + 1",
      [year],
      function (err) {
        if (err) return cb(err);
        db.get("SELECT last_seq FROM invoice_sequences WHERE year = ?", [year], (err2, row) => {
          if (err2) return cb(err2);
          const seq = String(row.last_seq).padStart(5, "0");
          cb(null, `INV-${year}-${seq}`);
        });
      }
    );
  });
}

function assignInvoiceNumberToSale(saleId, retriesLeft, cb) {
  generateInvoiceNumber((invErr, invoiceNumber) => {
    if (invErr || !invoiceNumber) {
      if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
      return cb(invErr || new Error("Failed to generate invoice number"));
    }

    db.run(
      "UPDATE sales SET invoice_number = ? WHERE id = ? AND invoice_number IS NULL",
      [invoiceNumber, saleId],
      function (updateErr) {
        if (updateErr) {
          if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
          return cb(updateErr);
        }

        if (this.changes > 0) return cb(null, invoiceNumber);

        db.get("SELECT invoice_number FROM sales WHERE id = ?", [saleId], (rowErr, row) => {
          if (rowErr) {
            if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
            return cb(rowErr);
          }
          if (row && row.invoice_number) return cb(null, row.invoice_number);
          if (retriesLeft > 0) return assignInvoiceNumberToSale(saleId, retriesLeft - 1, cb);
          return cb(new Error("Invoice number update affected zero rows"));
        });
      }
    );
  });
}

function getInvoiceData(saleId, cb) {
  db.get(
    `SELECT s.*, o.name as outlet_name, o.address as outlet_address,
            e.name as employee_name,
            c.name as customer_name, c.mobile as customer_phone, c.email as customer_email
     FROM sales s
     LEFT JOIN outlets o ON s.outlet_id = o.id
     LEFT JOIN employees e ON s.employee_id = e.id
     LEFT JOIN customers c ON s.customer_id = c.id
     WHERE s.id = ?`,
    [saleId],
    (err, sale) => {
      if (err) return cb(err);
      if (!sale) return cb(null, null);
      db.all(
        `SELECT si.*, p.name as product_name, p.barcode,
                t.name as tax_name, t.rate as tax_rate
         FROM sale_items si
         JOIN products p ON si.product_id = p.id
         LEFT JOIN taxes t ON p.tax_id = t.id
         WHERE si.sale_id = ?`,
        [saleId],
        (err2, items) => {
          if (err2) return cb(err2);
          db.all("SELECT * FROM sale_payments WHERE sale_id = ?", [saleId], (err3, payments) => {
            if (err3) return cb(err3);
            cb(null, { sale, items: items || [], payments: payments || [] });
          });
        }
      );
    }
  );
}

// GET /api/sales/:id/invoice — formal invoice data for a sale
app.get("/api/sales/:id/invoice", (req, res) => {
  const { id } = req.params;
  getInvoiceData(id, (err, payload) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!payload) return res.status(404).json({ error: "Sale not found" });
    return res.json(payload);
  });
});

// GET /api/sales/:id/invoice/export - normalized JSON export contract (v1.0)
app.get("/api/sales/:id/invoice/export", requireFeature("e_invoicing_export"), (req, res) => {
  const { id } = req.params;
  getInvoiceData(id, (err, payload) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!payload) return res.status(404).json({ error: "Sale not found" });

    const { sale, items, payments } = payload;
    const normalizedItems = items.map((item) => {
      const unitPrice = Number(item.price_at_sale || 0);
      const quantity = Number(item.quantity || 0);
      const taxRate = Number(item.tax_rate || 0);
      const lineSubtotal = Number((unitPrice * quantity).toFixed(2));
      const lineTax = Number(((lineSubtotal * taxRate) / 100).toFixed(2));
      return {
        product_id: item.product_id,
        product_name: item.product_name || null,
        barcode: item.barcode || null,
        quantity,
        unit_price: unitPrice,
        tax_name: item.tax_name || null,
        tax_rate: taxRate,
        line_subtotal: lineSubtotal,
        line_tax: lineTax,
        line_total: Number((lineSubtotal + lineTax).toFixed(2)),
      };
    });

    const subtotal = Number(
      normalizedItems.reduce((sum, row) => sum + row.line_subtotal, 0).toFixed(2)
    );
    const taxTotal = Number(
      normalizedItems.reduce((sum, row) => sum + row.line_tax, 0).toFixed(2)
    );
    const discountAmount = Number(sale.discount_amount || 0);
    const pointsRedeemed = Number(sale.points_redeemed || 0);
    const totalAmount = Number(sale.total_amount || 0);

    return res.json({
      version: "1.0",
      exported_at: new Date().toISOString(),
      invoice: {
        invoice_number: sale.invoice_number || `SALE-${sale.id}`,
        sale_id: sale.id,
        timestamp: sale.timestamp,
        status: sale.status || (sale.voided ? "voided" : "paid"),
        currency: "PKR",
        totals: {
          subtotal,
          tax_total: taxTotal,
          discount_amount: discountAmount,
          points_redeemed: pointsRedeemed,
          total_amount: totalAmount,
        },
      },
      seller: {
        outlet_id: sale.outlet_id || null,
        outlet_name: sale.outlet_name || null,
        outlet_address: sale.outlet_address || null,
      },
      buyer: sale.customer_id
        ? {
            customer_id: sale.customer_id,
            name: sale.customer_name || null,
            phone: sale.customer_phone || null,
            email: sale.customer_email || null,
          }
        : null,
      items: normalizedItems,
      payments: (payments || []).map((p) => ({
        payment_method: p.payment_method || null,
        amount: Number(p.amount || 0),
      })),
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const SHOPIFY_WORKER_DISABLED = String(process.env.SHOPIFY_SYNC_WORKER_DISABLED || "0") === "1";
if (!SHOPIFY_WORKER_DISABLED) {
  setInterval(() => {
    processPendingShopifyInventoryEvents(20, () => {});
  }, 30000);
}


