/**
 * backend/routes/admin.js — Super-admin API for tenant management.
 *
 * All endpoints live under /api/admin/* and are gated by requireSuperAdmin middleware.
 * Uses master.db directly (not the tenant DB proxy).
 */
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const BCRYPT_ROUNDS = 10;

module.exports = function registerAdminRoutes(app, { authLimiter }) {
  const { getMasterDb, initMasterDb } = require("../master-db");
  const jwt = require("jsonwebtoken");
  const { verifyAccessToken, defaults: jwtDefaults } = require("../jwt-auth");
  const tenantDbManager = require("../tenant-db-manager");

  // ── Helpers ─────────────────────────────────────────────────────────────

  function masterGet(sql, params = []) {
    return new Promise((resolve, reject) => {
      getMasterDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  }

  function masterAll(sql, params = []) {
    return new Promise((resolve, reject) => {
      getMasterDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  }

  function masterRun(sql, params = []) {
    return new Promise((resolve, reject) => {
      getMasterDb().run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function tenantDbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  }

  function tenantDbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  }

  function tenantDbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function auditLog(tenantId, action, details, actor) {
    return masterRun(
      "INSERT INTO tenant_audit_log (tenant_id, action, details, actor) VALUES (?, ?, ?, ?)",
      [tenantId, action, details ? JSON.stringify(details) : null, actor]
    );
  }

  // ── Auth middleware ─────────────────────────────────────────────────────

  function requireSuperAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization required" });
    }
    try {
      const decoded = verifyAccessToken(authHeader.slice(7), process.env.JWT_SECRET);
      if (decoded.role !== "super_admin") {
        return res.status(403).json({ error: "Super-admin access required" });
      }
      req.admin = { id: decoded.aid, email: decoded.email };
      next();
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
      }
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  // ── Auth routes ─────────────────────────────────────────────────────────

  app.post("/api/admin/auth/login", authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    try {
      await initMasterDb();
      const admin = await masterGet(
        "SELECT id, email, password_hash, name FROM super_admins WHERE email = ?",
        [email.toLowerCase().trim()]
      );
      if (!admin) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const valid = await bcrypt.compare(String(password), admin.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const token = jwt.sign(
        { tid: 0, eid: 0, rid: 0, oid: null, aid: admin.id, email: admin.email, role: "super_admin", scope: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: jwtDefaults.accessExpiresIn }
      );
      return res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Tenant CRUD ─────────────────────────────────────────────────────────

  app.get("/api/admin/tenants", requireSuperAdmin, async (req, res) => {
    try {
      const tenants = await masterAll(
        `SELECT id, slug, name, owner_email, status, plan, timezone,
                max_employees, max_outlets, max_products,
                created_at, updated_at, suspended_at
         FROM tenants
         WHERE status != 'deleted'
         ORDER BY created_at DESC`
      );
      return res.json({ tenants });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants", requireSuperAdmin, async (req, res) => {
    const { slug, name, owner_email, timezone, pin, plan } = req.body || {};
    if (!slug || !name || !pin) {
      return res.status(400).json({ error: "slug, name, and pin are required" });
    }
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
      return res.status(400).json({ error: "slug must be 3-40 chars: lowercase letters, numbers, hyphens" });
    }
    if (!/^\d{4,8}$/.test(String(pin))) {
      return res.status(400).json({ error: "pin must be 4-8 digits" });
    }
    try {
      const existing = await masterGet("SELECT id FROM tenants WHERE slug = ?", [slug]);
      if (existing) {
        return res.status(409).json({ error: `Tenant "${slug}" already exists` });
      }

      // Inline provisioner logic (avoids shelling out to CLI)
      const { extractSchema } = require("../schema-full");
      const sqlite3 = require("sqlite3").verbose();

      const tenantDir = path.join(__dirname, "..", "tenants", `t_${slug}`);
      const dbPath = path.join(tenantDir, "data.db");
      const relDbPath = `tenants/t_${slug}/data.db`;
      const tz = timezone || "UTC";

      // 1. Create directories
      for (const subdir of ["uploads/products", "uploads/company", "backups", "exports/reports"]) {
        fs.mkdirSync(path.join(tenantDir, subdir), { recursive: true });
      }

      // 2. Initialize DB with schema
      const schema = await extractSchema();
      const tenantDb = await new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
          if (err) return reject(err);
          db.exec(schema, (err2) => {
            if (err2) return reject(err2);
            resolve(db);
          });
        });
      });

      // 3. Seed data (with bcrypt PIN hashing)
      const pinHash = await bcrypt.hash(String(pin), BCRYPT_ROUNDS);

      const ALL_PERMISSIONS = [
        "all_access", "manage_customers", "manage_employees", "manage_inventory",
        "manage_orders", "pos_discount", "pos_park", "pos_void", "view_reports", "void_sales"
      ];

      const outletId = (await tenantDbRun(tenantDb,
        "INSERT INTO outlets (name, address) VALUES (?, '')", [name]
      )).lastID;

      const roleId = (await tenantDbRun(tenantDb,
        "INSERT INTO roles (name, description) VALUES ('Admin', 'Full access admin role')"
      )).lastID;

      for (const perm of ALL_PERMISSIONS) {
        await tenantDbRun(tenantDb,
          "INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)",
          [roleId, perm]
        );
      }

      // Check if pin_hash column exists (depends on whether oneshop.db has migrate66 applied)
      const empCols = await new Promise((resolve, reject) => {
        tenantDb.all("PRAGMA table_info(employees)", (err, cols) => (err ? reject(err) : resolve(cols)));
      });
      const hasPinHash = empCols.some((c) => c.name === "pin_hash");
      const employeeId = hasPinHash
        ? (await tenantDbRun(tenantDb,
            "INSERT INTO employees (name, pin_code, pin_hash, role_id) VALUES ('Admin', ?, ?, ?)",
            [pin, pinHash, roleId])).lastID
        : (await tenantDbRun(tenantDb,
            "INSERT INTO employees (name, pin_code, role_id) VALUES ('Admin', ?, ?)",
            [pin, roleId])).lastID;

      await tenantDbRun(tenantDb,
        "INSERT OR IGNORE INTO employee_outlets (employee_id, outlet_id) VALUES (?, ?)",
        [employeeId, outletId]
      );

      await tenantDbRun(tenantDb,
        "INSERT OR IGNORE INTO company_profile (id, company_name, timezone) VALUES (1, ?, ?)",
        [name, tz]
      );

      await tenantDbRun(tenantDb,
        "INSERT INTO taxes (name, rate) VALUES ('Default Tax', 0)"
      );

      // Stamp schema version (66 includes pin_hash column from migrate66)
      await tenantDbRun(tenantDb,
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER NOT NULL PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))"
      );
      await tenantDbRun(tenantDb, "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)", [66]);

      await new Promise((resolve) => tenantDb.close(resolve));

      // 4. Register in master.db
      const result = await masterRun(
        `INSERT INTO tenants (slug, name, owner_email, status, plan, db_path, timezone)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        [slug, name, owner_email || "admin@example.com", plan || "free", relDbPath, tz]
      );

      await auditLog(result.lastID, "created", { slug, timezone: tz, plan: plan || "free" }, `admin:${req.admin.email}`);

      return res.status(201).json({
        message: "Tenant provisioned",
        tenant: { id: result.lastID, slug, name, status: "active", plan: plan || "free" },
      });
    } catch (err) {
      // Cleanup on failure
      const tenantDir = path.join(__dirname, "..", "tenants", `t_${slug}`);
      try { fs.rmSync(tenantDir, { recursive: true, force: true }); } catch {}
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterGet(
        `SELECT id, slug, name, owner_email, status, plan, db_path, timezone,
                max_employees, max_outlets, max_products,
                stripe_customer_id, stripe_subscription_id, trial_ends_at,
                created_at, updated_at, suspended_at, deleted_at
         FROM tenants WHERE id = ?`,
        [req.params.id]
      );
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const auditEntries = await masterAll(
        "SELECT action, details, actor, created_at FROM tenant_audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20",
        [req.params.id]
      );

      return res.json({ tenant, audit_log: auditEntries });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    const { name, owner_email, plan, timezone, max_employees, max_outlets, max_products } = req.body || {};
    try {
      const tenant = await masterGet("SELECT id, plan FROM tenants WHERE id = ?", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      await masterRun(
        `UPDATE tenants SET
           name = COALESCE(?, name),
           owner_email = COALESCE(?, owner_email),
           plan = COALESCE(?, plan),
           timezone = COALESCE(?, timezone),
           max_employees = COALESCE(?, max_employees),
           max_outlets = COALESCE(?, max_outlets),
           max_products = COALESCE(?, max_products),
           updated_at = datetime('now')
         WHERE id = ?`,
        [name || null, owner_email || null, plan || null, timezone || null,
         max_employees ?? null, max_outlets ?? null, max_products ?? null, req.params.id]
      );

      const changes = {};
      if (plan && plan !== tenant.plan) changes.plan = { from: tenant.plan, to: plan };
      if (Object.keys(changes).length) {
        await auditLog(tenant.id, "updated", changes, `admin:${req.admin.email}`);
      }

      return res.json({ message: "Tenant updated" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants/:id/suspend", requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterGet("SELECT id, slug, status FROM tenants WHERE id = ?", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status === "suspended") return res.json({ message: "Already suspended" });

      await masterRun(
        "UPDATE tenants SET status = 'suspended', suspended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [req.params.id]
      );

      // Close cached DB connection so future requests fail fast
      try { await tenantDbManager.closeDb(tenant.id); } catch {}

      await auditLog(tenant.id, "suspended", { reason: req.body?.reason }, `admin:${req.admin.email}`);
      return res.json({ message: `Tenant "${tenant.slug}" suspended` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants/:id/activate", requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterGet("SELECT id, slug, status FROM tenants WHERE id = ?", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status === "active") return res.json({ message: "Already active" });
      if (tenant.status === "deleted") return res.status(400).json({ error: "Cannot reactivate a deleted tenant" });

      await masterRun(
        "UPDATE tenants SET status = 'active', suspended_at = NULL, updated_at = datetime('now') WHERE id = ?",
        [req.params.id]
      );

      await auditLog(tenant.id, "activated", null, `admin:${req.admin.email}`);
      return res.json({ message: `Tenant "${tenant.slug}" activated` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterGet("SELECT id, slug, status FROM tenants WHERE id = ?", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status === "deleted") return res.json({ message: "Already deleted" });

      await masterRun(
        "UPDATE tenants SET status = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [req.params.id]
      );

      try { await tenantDbManager.closeDb(tenant.id); } catch {}

      await auditLog(tenant.id, "deleted", null, `admin:${req.admin.email}`);
      return res.json({ message: `Tenant "${tenant.slug}" soft-deleted` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Stats ───────────────────────────────────────────────────────────────

  app.get("/api/admin/tenants/:id/stats", requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterGet("SELECT id, slug, db_path, status FROM tenants WHERE id = ?", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") {
        return res.json({ stats: { status: tenant.status, message: "Tenant is not active" } });
      }

      const tDb = await tenantDbManager.getDb(tenant.id);
      const [employees, products, outlets, sales, customers] = await Promise.all([
        tenantDbGet(tDb, "SELECT COUNT(*) AS cnt FROM employees"),
        tenantDbGet(tDb, "SELECT COUNT(*) AS cnt FROM products"),
        tenantDbGet(tDb, "SELECT COUNT(*) AS cnt FROM outlets"),
        tenantDbGet(tDb, "SELECT COUNT(*) AS cnt FROM sales"),
        tenantDbGet(tDb, "SELECT COUNT(*) AS cnt FROM customers"),
      ]);

      return res.json({
        stats: {
          employees: employees.cnt,
          products: products.cnt,
          outlets: outlets.cnt,
          total_sales: sales.cnt,
          customers: customers.cnt,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/stats", requireSuperAdmin, async (req, res) => {
    try {
      const totals = await masterGet(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
           SUM(CASE WHEN plan = 'free' THEN 1 ELSE 0 END) AS free_plan,
           SUM(CASE WHEN plan = 'starter' THEN 1 ELSE 0 END) AS starter_plan,
           SUM(CASE WHEN plan = 'pro' THEN 1 ELSE 0 END) AS pro_plan
         FROM tenants WHERE status != 'deleted'`
      );

      const recentTenants = await masterAll(
        "SELECT id, slug, name, plan, status, created_at FROM tenants WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 5"
      );

      const recentAudit = await masterAll(
        `SELECT a.action, a.details, a.actor, a.created_at, t.slug AS tenant_slug
         FROM tenant_audit_log a
         LEFT JOIN tenants t ON a.tenant_id = t.id
         ORDER BY a.created_at DESC LIMIT 10`
      );

      return res.json({ totals, recent_tenants: recentTenants, recent_audit: recentAudit });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Migrations ──────────────────────────────────────────────────────────

  app.post("/api/admin/tenants/:id/migrate", requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterGet("SELECT id, slug, db_path, status FROM tenants WHERE id = ?", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") {
        return res.status(400).json({ error: "Can only migrate active tenants" });
      }

      const { runMigrationsOnTenant } = require("../tenant-migrate");
      const result = await runMigrationsOnTenant(tenant);

      await auditLog(tenant.id, "migrated", { applied: result.applied }, `admin:${req.admin.email}`);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/migrate-all", requireSuperAdmin, async (req, res) => {
    try {
      const tenants = await masterAll(
        "SELECT id, slug, db_path, status FROM tenants WHERE status = 'active'"
      );

      const { runMigrationsOnTenant } = require("../tenant-migrate");
      const results = [];

      for (const tenant of tenants) {
        try {
          const result = await runMigrationsOnTenant(tenant);
          results.push({ slug: tenant.slug, ...result });
          if (result.applied.length > 0) {
            await auditLog(tenant.id, "migrated", { applied: result.applied }, `admin:${req.admin.email}`);
          }
        } catch (err) {
          results.push({ slug: tenant.slug, error: err.message });
        }
      }

      return res.json({ results });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── PIN Reset ───────────────────────────────────────────────────────────

  app.post("/api/admin/tenants/:id/reset-pin", requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterGet("SELECT id, slug, db_path, status FROM tenants WHERE id = ?", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") {
        return res.status(400).json({ error: "Can only reset PIN for active tenants" });
      }

      const newPin = req.body?.pin || "0000";
      const pinHash = await bcrypt.hash(String(newPin), BCRYPT_ROUNDS);

      const tDb = await tenantDbManager.getDb(tenant.id);

      // Find the admin employee (first employee with all_access permission)
      const adminEmp = await tenantDbGet(tDb,
        `SELECT e.id FROM employees e
         JOIN roles r ON e.role_id = r.id
         JOIN role_permissions rp ON rp.role_id = r.id
         WHERE rp.permission = 'all_access'
         LIMIT 1`
      );

      if (!adminEmp) {
        return res.status(404).json({ error: "No admin employee found in tenant" });
      }

      await tenantDbRun(tDb,
        "UPDATE employees SET pin_code = ?, pin_hash = ? WHERE id = ?",
        [newPin, pinHash, adminEmp.id]
      );

      await auditLog(tenant.id, "pin_reset", { employee_id: adminEmp.id }, `admin:${req.admin.email}`);
      return res.json({ message: `Admin PIN reset for tenant "${tenant.slug}"`, employee_id: adminEmp.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
