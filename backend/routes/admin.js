/**
 * backend/routes/admin.js — Super-admin API for tenant management (Postgres).
 *
 * All endpoints live under /api/admin/* and are gated by requireSuperAdmin middleware.
 * Uses master-db-pg (public schema) directly, not the tenant DB proxy.
 */
const bcrypt = require("bcryptjs");
const net = require("net");

const BCRYPT_ROUNDS = 10;

// ── IP Allowlist helpers ────────────────────────────────────────────────

/**
 * Check if an IPv4 address falls within a CIDR range.
 * Plain IPs (no slash) are treated as /32.
 */
function ipToInt(ip) {
  // Strip ::ffff: prefix (IPv4-mapped IPv6)
  const clean = ip.replace(/^::ffff:/, "");
  const parts = clean.split(".");
  if (parts.length !== 4) return null;
  return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function ipInCidr(ip, cidr) {
  const [network, bitsStr] = cidr.includes("/") ? cidr.split("/") : [cidr, "32"];
  const bits = parseInt(bitsStr, 10);
  if (bits < 0 || bits > 32) return false;

  const ipInt = ipToInt(ip);
  const netInt = ipToInt(network);
  if (ipInt === null || netInt === null) return false;

  if (bits === 0) return true; // /0 matches everything
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function parseAllowedIps() {
  const raw = (process.env.ADMIN_ALLOWED_IPS || "").trim();
  if (!raw) return null; // null means allow all
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

module.exports = function registerAdminRoutes(app, { authLimiter }) {
  const db = require("../db-pg");
  const masterDb = require("../master-db-pg");
  const jwt = require("jsonwebtoken");
  const { verifyAccessToken, defaults: jwtDefaults } = require("../jwt-auth");
  const { provision } = require("../tenant-provisioner-pg");
  const tenantDbManager = require("../tenant-db-manager-pg");
  tenantDbManager.init(db);

  // ── IP Allowlist middleware ──────────────────────────────────────────────

  function requireAllowedIp(req, res, next) {
    const allowedIps = parseAllowedIps();
    if (!allowedIps) return next(); // env var unset → allow all

    const clientIp = req.ip || "";
    const matches = allowedIps.some((entry) => ipInCidr(clientIp, entry));
    if (!matches) {
      return res.status(403).json({ error: "IP not allowed" });
    }
    next();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  async function auditLog(tenantId, action, details, actor) {
    await masterDb.query(
      "INSERT INTO tenant_audit_log (tenant_id, action, details, actor) VALUES ($1, $2, $3, $4)",
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

  app.post("/api/admin/auth/login", requireAllowedIp, authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    try {
      await masterDb.init(db);
      const { rows } = await db.query(
        "SELECT id, email, password_hash, name FROM super_admins WHERE email = $1",
        [email.toLowerCase().trim()]
      );
      const admin = rows[0] || null;
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

  app.get("/api/admin/tenants", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await db.query(
        `SELECT id, slug, name, owner_email, status, plan, timezone,
                max_employees, max_outlets, max_products,
                created_at, updated_at, suspended_at
         FROM tenants
         WHERE status != 'deleted'
         ORDER BY created_at DESC`
      );

      const enriched = await Promise.all(tenants.map(async (t) => {
        if (t.status !== "active") return { ...t, last_login: null, revenue_this_month: 0, setup_complete: true };
        const s = `tenant_${t.slug}`;
        try {
          const [loginR, revR, setupR] = await Promise.all([
            db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.action_history WHERE action_type = 'login'`),
            db.query(`SELECT COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp >= date_trunc('month', NOW())`),
            db.query(`SELECT setup_complete FROM ${s}.company_profile WHERE id = 1`),
          ]);
          return {
            ...t,
            last_login: loginR.rows[0].ts || null,
            revenue_this_month: Number(revR.rows[0].rev),
            setup_complete: setupR.rows[0]?.setup_complete ?? true,
          };
        } catch {
          return { ...t, last_login: null, revenue_this_month: 0, setup_complete: true };
        }
      }));

      return res.json({ tenants: enriched });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants", requireAllowedIp, requireSuperAdmin, async (req, res) => {
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
      const { rows: existing } = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
      if (existing.length > 0) {
        return res.status(409).json({ error: `Tenant "${slug}" already exists` });
      }

      // Use tenant-provisioner-pg to create schema + seed + register
      const result = await provision(db, {
        slug,
        name,
        ownerEmail: owner_email || "admin@example.com",
        timezone: timezone || "UTC",
        pin: String(pin),
      });

      // Update plan if not default
      if (plan && plan !== "free") {
        await db.query("UPDATE tenants SET plan = $1 WHERE id = $2", [plan, result.tenantId]);
      }

      await auditLog(result.tenantId, "created", { slug, timezone: timezone || "UTC", plan: plan || "free" }, `admin:${req.admin.email}`);

      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.vercel.app";
      return res.status(201).json({
        message: "Tenant provisioned",
        tenant: { id: result.tenantId, slug, name, status: "active", plan: plan || "free" },
        setup_token: result.setupToken,
        setup_url: `${frontendUrl}/setup?tenant=${slug}&token=${result.setupToken}`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/tenants/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, slug, name, owner_email, status, plan, timezone,
                max_employees, max_outlets, max_products,
                stripe_customer_id, stripe_subscription_id, trial_ends_at,
                created_at, updated_at, suspended_at, deleted_at
         FROM tenants WHERE id = $1`,
        [req.params.id]
      );
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const { rows: auditEntries } = await db.query(
        "SELECT action, details, actor, created_at FROM tenant_audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20",
        [req.params.id]
      );

      return res.json({ tenant, audit_log: auditEntries });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/tenants/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    const { name, owner_email, plan, timezone, max_employees, max_outlets, max_products } = req.body || {};
    try {
      const { rows } = await db.query("SELECT id, plan FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      await db.query(
        `UPDATE tenants SET
           name = COALESCE($1, name),
           owner_email = COALESCE($2, owner_email),
           plan = COALESCE($3, plan),
           timezone = COALESCE($4, timezone),
           max_employees = COALESCE($5, max_employees),
           max_outlets = COALESCE($6, max_outlets),
           max_products = COALESCE($7, max_products),
           updated_at = NOW()
         WHERE id = $8`,
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

  app.post("/api/admin/tenants/:id/suspend", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status === "suspended") return res.json({ message: "Already suspended" });

      await db.query(
        "UPDATE tenants SET status = 'suspended', suspended_at = NOW(), updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );

      await auditLog(tenant.id, "suspended", { reason: req.body?.reason }, `admin:${req.admin.email}`);
      return res.json({ message: `Tenant "${tenant.slug}" suspended` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants/:id/activate", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status === "active") return res.json({ message: "Already active" });
      if (tenant.status === "deleted") return res.status(400).json({ error: "Cannot reactivate a deleted tenant" });

      await db.query(
        "UPDATE tenants SET status = 'active', suspended_at = NULL, updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );

      await auditLog(tenant.id, "activated", null, `admin:${req.admin.email}`);
      return res.json({ message: `Tenant "${tenant.slug}" activated` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/tenants/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status === "deleted") return res.json({ message: "Already deleted" });

      await db.query(
        "UPDATE tenants SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );

      await auditLog(tenant.id, "deleted", null, `admin:${req.admin.email}`);
      return res.json({ message: `Tenant "${tenant.slug}" soft-deleted` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Stats ───────────────────────────────────────────────────────────────

  app.get("/api/admin/tenants/:id/stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT id, slug, status, max_employees, max_products, max_outlets FROM tenants WHERE id = $1",
        [req.params.id]
      );
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") {
        return res.json({ stats: { status: tenant.status, message: "Tenant is not active" } });
      }

      const s = `tenant_${tenant.slug}`;
      const [
        employees, products, outlets, sales, customers,
        salesToday, salesWeek, salesMonth,
        lastLogin, lastSale, lastShift,
        activeEmp7d, activeEmp30d,
        schemaSize
      ] = await Promise.all([
        db.query(`SELECT COUNT(*) AS cnt FROM ${s}.employees WHERE deleted_at IS NULL`),
        db.query(`SELECT COUNT(*) AS cnt FROM ${s}.products WHERE deleted_at IS NULL`),
        db.query(`SELECT COUNT(*) AS cnt FROM ${s}.outlets`),
        db.query(`SELECT COUNT(*) AS cnt FROM ${s}.sales`),
        db.query(`SELECT COUNT(*) AS cnt FROM ${s}.customers WHERE deleted_at IS NULL`),
        db.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp::date = CURRENT_DATE`),
        db.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp >= date_trunc('week', NOW())`),
        db.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0)::numeric AS rev FROM ${s}.sales WHERE timestamp >= date_trunc('month', NOW())`),
        db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.action_history WHERE action_type = 'login'`),
        db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.sales`),
        db.query(`SELECT MAX(opened_at) AS ts FROM ${s}.cash_shifts`),
        db.query(`SELECT COUNT(DISTINCT employee_id) AS cnt FROM ${s}.action_history WHERE timestamp >= NOW() - INTERVAL '7 days'`),
        db.query(`SELECT COUNT(DISTINCT employee_id) AS cnt FROM ${s}.action_history WHERE timestamp >= NOW() - INTERVAL '30 days'`),
        db.query(`SELECT COALESCE(SUM(pg_total_relation_size(schemaname || '.' || tablename)), 0) AS bytes FROM pg_tables WHERE schemaname = $1`, [`tenant_${tenant.slug}`]),
      ]);

      return res.json({
        stats: {
          employees: parseInt(employees.rows[0].cnt, 10),
          max_employees: tenant.max_employees,
          products: parseInt(products.rows[0].cnt, 10),
          max_products: tenant.max_products,
          outlets: parseInt(outlets.rows[0].cnt, 10),
          max_outlets: tenant.max_outlets,
          total_sales: parseInt(sales.rows[0].cnt, 10),
          customers: parseInt(customers.rows[0].cnt, 10),
          sales_today: parseInt(salesToday.rows[0].cnt, 10),
          revenue_today: Number(salesToday.rows[0].rev),
          sales_this_week: parseInt(salesWeek.rows[0].cnt, 10),
          revenue_this_week: Number(salesWeek.rows[0].rev),
          sales_this_month: parseInt(salesMonth.rows[0].cnt, 10),
          revenue_this_month: Number(salesMonth.rows[0].rev),
          last_login: lastLogin.rows[0].ts || null,
          last_sale: lastSale.rows[0].ts || null,
          last_shift_opened: lastShift.rows[0].ts || null,
          active_employees_7d: parseInt(activeEmp7d.rows[0].cnt, 10),
          active_employees_30d: parseInt(activeEmp30d.rows[0].cnt, 10),
          schema_size_mb: Math.round(Number(schemaSize.rows[0].bytes) / 1048576 * 10) / 10,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Setup Token ─────────────────────────────────────────────────────────

  app.get("/api/admin/tenants/:id/setup-token", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterDb.getTenantById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const tenantDb = await tenantDbManager.getDb(tenant.id);
      const { rows: [profile] } = await tenantDb.query(
        "SELECT setup_token, setup_complete FROM company_profile WHERE id = 1"
      );

      if (!profile || profile.setup_complete) {
        return res.json({ setup_complete: true, setup_token: null, setup_url: null });
      }

      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.vercel.app";
      res.json({
        setup_complete: false,
        setup_token: profile.setup_token,
        setup_url: `${frontendUrl}/setup?tenant=${tenant.slug}&token=${profile.setup_token}`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants/:id/regenerate-setup-token", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterDb.getTenantById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const tenantDb = await tenantDbManager.getDb(tenant.id);
      const crypto = require("crypto");
      const newToken = crypto.randomBytes(32).toString("hex");
      await tenantDb.query(
        "UPDATE company_profile SET setup_token = $1, setup_complete = false WHERE id = 1",
        [newToken]
      );

      await auditLog(tenant.id, "setup_token_regenerated", { slug: tenant.slug }, `admin:${req.admin.email}`);

      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.vercel.app";
      res.json({
        setup_token: newToken,
        setup_url: `${frontendUrl}/setup?tenant=${tenant.slug}&token=${newToken}`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: totalsRows } = await db.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
           SUM(CASE WHEN plan = 'free' THEN 1 ELSE 0 END) AS free_plan,
           SUM(CASE WHEN plan = 'starter' THEN 1 ELSE 0 END) AS starter_plan,
           SUM(CASE WHEN plan = 'pro' THEN 1 ELSE 0 END) AS pro_plan
         FROM tenants WHERE status != 'deleted'`
      );
      const totals = totalsRows[0] || {};

      const { rows: recentTenants } = await db.query(
        "SELECT id, slug, name, plan, status, created_at FROM tenants WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 5"
      );

      const { rows: recentAudit } = await db.query(
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

  app.get("/api/admin/attention", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await db.query(
        "SELECT id, slug, name, plan, max_employees, max_products, max_outlets FROM tenants WHERE status = 'active'"
      );

      const approaching = [];
      const dormant = [];
      const setupPending = [];

      for (const t of tenants) {
        const s = `tenant_${t.slug}`;
        try {
          const [empR, prodR, outR, loginR, setupR] = await Promise.all([
            db.query(`SELECT COUNT(*) AS cnt FROM ${s}.employees WHERE deleted_at IS NULL`),
            db.query(`SELECT COUNT(*) AS cnt FROM ${s}.products WHERE deleted_at IS NULL`),
            db.query(`SELECT COUNT(*) AS cnt FROM ${s}.outlets`),
            db.query(`SELECT MAX(timestamp) AS ts FROM ${s}.action_history WHERE action_type = 'login'`),
            db.query(`SELECT setup_complete FROM ${s}.company_profile WHERE id = 1`),
          ]);

          const emp = parseInt(empR.rows[0].cnt, 10);
          const prod = parseInt(prodR.rows[0].cnt, 10);
          const out = parseInt(outR.rows[0].cnt, 10);
          const lastLogin = loginR.rows[0].ts;
          const setupComplete = setupR.rows[0]?.setup_complete;

          if (t.max_employees && emp / t.max_employees > 0.85) {
            approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "employees", used: emp, max: t.max_employees });
          }
          if (t.max_products && prod / t.max_products > 0.85) {
            approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "products", used: prod, max: t.max_products });
          }
          if (t.max_outlets && out / t.max_outlets > 0.85) {
            approaching.push({ id: t.id, slug: t.slug, name: t.name, dimension: "outlets", used: out, max: t.max_outlets });
          }

          if (lastLogin) {
            const daysSince = (Date.now() - new Date(lastLogin).getTime()) / 86400000;
            if (daysSince >= 14) {
              dormant.push({ id: t.id, slug: t.slug, name: t.name, last_login: lastLogin, days_inactive: Math.floor(daysSince) });
            }
          } else if (setupComplete) {
            dormant.push({ id: t.id, slug: t.slug, name: t.name, last_login: null, days_inactive: null });
          }

          if (!setupComplete) {
            setupPending.push({ id: t.id, slug: t.slug, name: t.name });
          }
        } catch {
          // Skip tenants with missing schemas
        }
      }

      return res.json({ approaching_limits: approaching, dormant, setup_pending: setupPending });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Migrations ──────────────────────────────────────────────────────────

  app.post("/api/admin/tenants/:id/migrate", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") {
        return res.status(400).json({ error: "Can only migrate active tenants" });
      }

      // TODO: implement tenant-migrate-pg.js — Postgres tenant migration runner
      // For now, return a stub response
      const result = { applied: [], message: "Postgres tenant migration not yet implemented" };

      await auditLog(tenant.id, "migrated", { applied: result.applied }, `admin:${req.admin.email}`);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/migrate-all", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await db.query(
        "SELECT id, slug, status FROM tenants WHERE status = 'active'"
      );

      // TODO: implement tenant-migrate-pg.js — Postgres tenant migration runner
      const results = tenants.map((t) => ({
        slug: t.slug,
        applied: [],
        message: "Postgres tenant migration not yet implemented",
      }));

      return res.json({ results });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── PIN Reset ───────────────────────────────────────────────────────────

  app.post("/api/admin/tenants/:id/reset-pin", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") {
        return res.status(400).json({ error: "Can only reset PIN for active tenants" });
      }

      const newPin = req.body?.pin || "0000";
      const pinHash = await bcrypt.hash(String(newPin), BCRYPT_ROUNDS);

      const schemaName = `tenant_${tenant.slug}`;

      // Find the admin employee (first employee with all_access permission)
      const { rows: adminRows } = await db.query(
        `SELECT e.id FROM ${schemaName}.employees e
         JOIN ${schemaName}.roles r ON e.role_id = r.id
         JOIN ${schemaName}.role_permissions rp ON rp.role_id = r.id
         WHERE rp.permission = 'all_access'
         LIMIT 1`
      );
      const adminEmp = adminRows[0] || null;

      if (!adminEmp) {
        return res.status(404).json({ error: "No admin employee found in tenant" });
      }

      await db.query(
        `UPDATE ${schemaName}.employees SET pin_code = $1, pin_hash = $2 WHERE id = $3`,
        [newPin, pinHash, adminEmp.id]
      );

      await auditLog(tenant.id, "pin_reset", { employee_id: adminEmp.id }, `admin:${req.admin.email}`);
      return res.json({ message: `Admin PIN reset for tenant "${tenant.slug}"`, employee_id: adminEmp.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
