/**
 * backend/routes/admin.js — Super-admin API for tenant management (Postgres).
 *
 * All endpoints live under /api/admin/* and are gated by requireSuperAdmin middleware.
 * Uses master-db-pg (public schema) directly, not the tenant DB proxy.
 */
const bcrypt = require("bcryptjs");
const net = require("net");
const alerting = require("../services/alerting");

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
  const { PLAN_DEFAULTS } = require("../middleware/plan-limits");
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

  async function logAdminAction(email, action, targetType, targetId, details, ip) {
    try {
      await db.query(
        `INSERT INTO admin_activity_log (admin_email, action, target_type, target_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, action, targetType, String(targetId || ""), details ? JSON.stringify(details) : null, ip || null]
      );
    } catch (_) { /* non-critical — never block admin operations */ }
  }

  async function logSecurityEvent(eventType, email, ip, userAgent, details) {
    try {
      await db.query(
        `INSERT INTO admin_security_log (event_type, email, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventType, email, ip, userAgent, details ? JSON.stringify(details) : null]
      );
    } catch (_) { /* non-critical */ }
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
        logSecurityEvent("login_failed", email, req.ip, req.headers["user-agent"], { reason: "invalid_credentials" });
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const valid = await bcrypt.compare(String(password), admin.password_hash);
      if (!valid) {
        logSecurityEvent("login_failed", email, req.ip, req.headers["user-agent"], { reason: "invalid_credentials" });
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const token = jwt.sign(
        { tid: 0, eid: 0, rid: 0, oid: null, aid: admin.id, email: admin.email, role: "super_admin", scope: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: jwtDefaults.accessExpiresIn }
      );
      logSecurityEvent("login_success", email, req.ip, req.headers["user-agent"], null);
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
                billing_cycle, plan_expires_at, grace_ends_at, payment_status,
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

      // Apply plan + its default limits
      const effectivePlan = plan || "free";
      const limits = PLAN_DEFAULTS[effectivePlan] || PLAN_DEFAULTS.free;
      await db.query(
        `UPDATE tenants SET plan = $1, max_outlets = $2, max_employees = $3, max_products = $4
         WHERE id = $5`,
        [effectivePlan, limits.max_outlets, limits.max_employees, limits.max_products, result.tenantId]
      );

      await auditLog(result.tenantId, "created", { slug, timezone: timezone || "UTC", plan: plan || "free" }, `admin:${req.admin.email}`);

      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.vercel.app";
      logAdminAction(req.admin.email, "tenant_created", "tenant", slug, { plan: plan || "free" }, req.ip);
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
      const { rows } = await db.query("SELECT id, plan, name FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      // When plan changes and no explicit limits are sent, auto-apply plan defaults
      const planChanged = plan && plan !== tenant.plan;
      const defaults = planChanged ? (PLAN_DEFAULTS[plan] || {}) : {};
      const effEmployees = max_employees ?? (planChanged ? defaults.max_employees : null) ?? null;
      const effOutlets   = max_outlets   ?? (planChanged ? defaults.max_outlets   : null) ?? null;
      const effProducts  = max_products  ?? (planChanged ? defaults.max_products  : null) ?? null;

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
         effEmployees, effOutlets, effProducts, req.params.id]
      );

      const changes = {};
      if (planChanged) changes.plan = { from: tenant.plan, to: plan };
      if (Object.keys(changes).length) {
        await auditLog(tenant.id, "updated", changes, `admin:${req.admin.email}`);
      }

      // Fire plan change notification email (fire-and-forget)
      if (planChanged) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows: [profile] } = await tenantDb.query("SELECT email FROM company_profile WHERE id = 1");
          if (profile?.email) {
            const { sendEmail } = require("../services/email");
            sendEmail({
              type: "billing_plan_changed",
              to: profile.email,
              data: {
                storeName: name || tenant.name || "Your store",
                oldPlan: tenant.plan,
                newPlan: plan,
                newLimits: PLAN_DEFAULTS[plan] || null,
              },
            }).catch((err) => console.error("Plan change email failed:", err.message));
          }
        } catch (emailErr) {
          console.error("Plan change email lookup failed:", emailErr.message);
        }
      }

      logAdminAction(req.admin.email, "tenant_updated", "tenant", req.params.id, req.body, req.ip);
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
      logAdminAction(req.admin.email, "tenant_suspended", "tenant", req.params.id, null, req.ip);
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
      logAdminAction(req.admin.email, "tenant_activated", "tenant", req.params.id, null, req.ip);
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

      // Validate slug is safe before using in schema name (only a-z, 0-9, underscore allowed)
      if (!/^[a-z0-9_]+$/.test(tenant.slug)) {
        return res.status(400).json({ error: "Invalid tenant slug — cannot safely drop schema" });
      }

      const schemaName = `tenant_${tenant.slug}`;

      await db.query(
        "UPDATE tenants SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );

      // Drop the tenant's Postgres schema and all its tables
      await db.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

      await auditLog(tenant.id, "deleted", null, `admin:${req.admin.email}`);
      logAdminAction(req.admin.email, "tenant_deleted", "tenant", req.params.id, null, req.ip);
      return res.json({ message: `Tenant "${tenant.slug}" deleted and schema dropped` });
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
        db.query(`SELECT COUNT(DISTINCT user_name) AS cnt FROM ${s}.action_history WHERE timestamp >= NOW() - INTERVAL '7 days'`),
        db.query(`SELECT COUNT(DISTINCT user_name) AS cnt FROM ${s}.action_history WHERE timestamp >= NOW() - INTERVAL '30 days'`),
        db.query(`SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0) AS bytes FROM pg_tables WHERE schemaname = $1`, [`tenant_${tenant.slug}`]),
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

  // ── Feature Usage Analytics ─────────────────────────────────────────────

  app.get("/api/admin/tenants/:id/feature-usage", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT slug, status FROM tenants WHERE id = $1 AND deleted_at IS NULL",
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "Tenant not found" });
      if (rows[0].status !== "active") return res.json({ all_time: [], last_30_days: [], top_users: [] });

      const s = `tenant_${rows[0].slug}`;
      const [allTimeRes, last30Res, topUsersRes] = await Promise.all([
        db.query(`SELECT action_type, COUNT(*)::int AS total FROM ${s}.action_history GROUP BY action_type ORDER BY total DESC`),
        db.query(`SELECT action_type, COUNT(*)::int AS total FROM ${s}.action_history WHERE timestamp >= NOW() - INTERVAL '30 days' GROUP BY action_type ORDER BY total DESC`),
        db.query(`SELECT user_name, COUNT(*)::int AS total FROM ${s}.action_history WHERE timestamp >= NOW() - INTERVAL '30 days' AND user_name IS NOT NULL GROUP BY user_name ORDER BY total DESC LIMIT 5`),
      ]);

      res.json({ all_time: allTimeRes.rows, last_30_days: last30Res.rows, top_users: topUsersRes.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
        "UPDATE company_profile SET setup_token = $1, setup_token_expires_at = NOW() + INTERVAL '48 hours', setup_complete = false WHERE id = 1",
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

  // ── Plan defaults (read-only) ──────────────────────────────────────────
  app.get("/api/admin/plan-defaults", requireAllowedIp, requireSuperAdmin, (req, res) => {
    res.json({ plans: PLAN_DEFAULTS });
  });

  app.get("/api/admin/stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: totalsRows } = await db.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
           SUM(CASE WHEN plan = 'free' THEN 1 ELSE 0 END) AS free_plan,
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
        "SELECT id, slug, name, plan, max_employees, max_products, max_outlets, created_at FROM tenants WHERE status = 'active'"
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
            setupPending.push({ id: t.id, slug: t.slug, name: t.name, created_at: t.created_at });
          }
        } catch {
          // Skip tenants with missing schemas
        }
      }

      const dead_tenants = setupPending.filter(
        (t) => new Date(t.created_at) < new Date(Date.now() - 7 * 86400000)
      );
      return res.json({ approaching_limits: approaching, dormant, setup_pending: setupPending, dead_tenants });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Dead Tenant Cleanup ─────────────────────────────────────────────────
  app.get("/api/admin/cleanup-preview", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { cleanupDeadTenants } = require("../jobs/cleanup-dead-tenants");
      const results = await cleanupDeadTenants({ dryRun: true });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/cleanup-run", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { cleanupDeadTenants } = require("../jobs/cleanup-dead-tenants");
      const results = await cleanupDeadTenants({ dryRun: false });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      logAdminAction(req.admin.email, "tenant_migrated", "tenant", req.params.id, null, req.ip);
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

      logAdminAction(req.admin.email, "migrate_all", "system", null, null, req.ip);
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
      logAdminAction(req.admin.email, "pin_reset", "tenant", req.params.id, null, req.ip);
      return res.json({ message: `Admin PIN reset for tenant "${tenant.slug}"`, employee_id: adminEmp.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Infrastructure Monitoring ─────────────────────────────────────────

  app.get("/api/admin/infra", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const [
        connResult,
        maxConnResult,
        dbSizeResult,
        slowNowResult,
        cacheResult,
        tableHealthResult,
        schemaSizeResult,
      ] = await Promise.all([
        // 1. Connection stats
        db.query(`
          SELECT
            COUNT(*) FILTER (WHERE state = 'active') AS active,
            COUNT(*) FILTER (WHERE state = 'idle') AS idle,
            COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
            COUNT(*) AS total
          FROM pg_stat_activity
          WHERE backend_type = 'client backend'
        `),
        // 2. Max connections
        db.query("SELECT setting::int AS max FROM pg_settings WHERE name = 'max_connections'"),
        // 3. Database size
        db.query("SELECT pg_database_size(current_database()) AS bytes, current_database() AS name"),
        // 4. Currently slow queries (running > 1 second)
        db.query(`
          SELECT
            pid,
            EXTRACT(EPOCH FROM (now() - query_start))::numeric AS duration_s,
            LEFT(query, 200) AS query,
            state,
            usename AS username,
            application_name AS app
          FROM pg_stat_activity
          WHERE state = 'active'
            AND query NOT ILIKE '%pg_stat_activity%'
            AND query_start < now() - interval '1 second'
          ORDER BY query_start ASC
          LIMIT 10
        `),
        // 5. Cache hit ratio
        db.query(`
          SELECT
            CASE WHEN (sum(heap_blks_hit) + sum(heap_blks_read)) = 0 THEN 100
            ELSE ROUND(sum(heap_blks_hit)::numeric / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100, 2)
            END AS hit_ratio
          FROM pg_statio_user_tables
        `),
        // 6. Table health — worst by dead tuples
        db.query(`
          SELECT
            schemaname AS schema,
            relname AS "table",
            n_dead_tup AS dead_tuples,
            n_live_tup AS live_tuples,
            last_autovacuum
          FROM pg_stat_user_tables
          WHERE n_dead_tup > 0
          ORDER BY n_dead_tup DESC
          LIMIT 15
        `),
        // 7. Per-schema sizes
        db.query(`
          SELECT
            schemaname AS schema,
            ROUND(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)))::numeric / 1048576, 2) AS size_mb
          FROM pg_tables
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
          GROUP BY schemaname
          ORDER BY size_mb DESC
        `),
      ]);

      const conn = connResult.rows[0];
      const maxConn = maxConnResult.rows[0]?.max || 100;

      const totalDeadTuples = tableHealthResult.rows.reduce((sum, r) => sum + parseInt(r.dead_tuples, 10), 0);
      const tablesNeedingVacuum = tableHealthResult.rows.filter((r) => parseInt(r.dead_tuples, 10) > 1000).length;

      // Try pg_stat_statements for historical slow queries (graceful skip if extension unavailable)
      let slowHistorical = [];
      try {
        const stmtResult = await db.query(`
          SELECT
            LEFT(query, 200) AS query,
            calls,
            ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
            ROUND(total_exec_time::numeric, 0) AS total_time_ms
          FROM pg_stat_statements
          WHERE calls > 5
            AND query NOT ILIKE '%pg_stat%'
          ORDER BY mean_exec_time DESC
          LIMIT 10
        `);
        slowHistorical = stmtResult.rows;
      } catch {
        // pg_stat_statements not enabled — skip silently
      }

      const connections = {
        active: parseInt(conn.active, 10),
        idle: parseInt(conn.idle, 10),
        idle_in_tx: parseInt(conn.idle_in_tx, 10),
        total: parseInt(conn.total, 10),
        max: maxConn,
      };

      // Fire DB pressure alert if active connections > 80% of max
      if (connections.active > connections.max * 0.8) {
        alerting.recordDbPressure({
          active: connections.active,
          max: connections.max,
          longestQuery: slowNowResult.rows[0]?.query || null,
        }).catch(() => {});
      }

      return res.json({
        connections,
        database: {
          size_mb: Math.round(Number(dbSizeResult.rows[0].bytes) / 1048576 * 10) / 10,
          name: dbSizeResult.rows[0].name,
        },
        cache: {
          hit_ratio: Number(cacheResult.rows[0].hit_ratio),
        },
        slow_queries_now: slowNowResult.rows.map((r) => ({
          ...r,
          duration_s: Math.round(Number(r.duration_s) * 10) / 10,
        })),
        table_health: {
          total_dead_tuples: totalDeadTuples,
          tables_needing_vacuum: tablesNeedingVacuum,
          worst_tables: tableHealthResult.rows.map((r) => ({
            schema: r.schema,
            table: r.table,
            dead_tuples: parseInt(r.dead_tuples, 10),
            live_tuples: parseInt(r.live_tuples, 10),
            last_autovacuum: r.last_autovacuum,
          })),
        },
        schema_sizes: schemaSizeResult.rows.map((r) => ({
          schema: r.schema,
          size_mb: Number(r.size_mb),
        })),
        slow_queries_historical: slowHistorical,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Billing & Subscription endpoints ────────────────────────────────────

  // 1. GET /api/admin/plan-pricing — list all pricing rows
  app.get("/api/admin/plan-pricing", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await masterDb.query(
        "SELECT * FROM plan_pricing ORDER BY plan, cycle"
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 2. PUT /api/admin/plan-pricing/:id — update price / is_active
  app.put("/api/admin/plan-pricing/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { price, is_active } = req.body;

      const sets = [];
      const vals = [];
      let idx = 1;

      if (price !== undefined) {
        sets.push(`price = $${idx++}`);
        vals.push(price);
      }
      if (is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        vals.push(is_active);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: "Nothing to update" });
      }

      vals.push(id);
      const { rows } = await masterDb.query(
        `UPDATE plan_pricing SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        vals
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Pricing row not found" });
      }
      logAdminAction(req.admin.email, "pricing_updated", "plan", req.params.id, req.body, req.ip);
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 3. POST /api/admin/tenants/:id/record-payment — record manual payment
  app.post("/api/admin/tenants/:id/record-payment", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantId = parseInt(req.params.id, 10);
      const { plan, cycle, amount, payment_method, reference_note } = req.body;

      if (!plan || !cycle || !amount) {
        return res.status(400).json({ error: "plan, cycle, and amount are required" });
      }

      const tenant = await masterDb.getTenantById(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const now = new Date();
      const periodStart = now;
      const daysToAdd = cycle === "annual" ? 365 : 30;
      const periodEnd = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      const graceEnd = new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Apply plan defaults (limits)
      const limits = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;

      // Update tenant record
      await masterDb.query(
        `UPDATE tenants
         SET plan = $1,
             billing_cycle = $2,
             plan_expires_at = $3,
             grace_ends_at = $4,
             payment_status = 'active',
             max_employees = $5,
             max_outlets = $6,
             max_products = $7,
             updated_at = NOW()
         WHERE id = $8`,
        [plan, cycle, periodEnd.toISOString(), graceEnd.toISOString(),
         limits.max_employees, limits.max_outlets, limits.max_products, tenantId]
      );

      // Insert payment record
      await masterDb.query(
        `INSERT INTO payment_records
           (tenant_id, amount, plan, cycle, period_start, period_end, payment_method, reference_note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tenantId, amount, plan, cycle, periodStart.toISOString(), periodEnd.toISOString(),
         payment_method || null, reference_note || null, req.admin.email]
      );

      await auditLog(tenantId, "payment_recorded", { plan, cycle, amount, payment_method }, `admin:${req.admin.email}`);

      // Fire billing notification email (fire-and-forget)
      try {
        const tenantDb = await tenantDbManager.getDb(tenantId);
        const { rows: [profile] } = await tenantDb.query("SELECT email FROM company_profile WHERE id = 1");
        if (profile?.email) {
          const { sendEmail } = require("../services/email");
          sendEmail({
            type: "billing_payment_recorded",
            to: profile.email,
            data: {
              storeName: tenant?.name || "Your store",
              amount: `${amount}`,
              plan,
              cycle,
              periodEnd: periodEnd.toLocaleDateString(),
            },
          }).catch((err) => console.error("Billing payment email failed:", err.message));
        }
      } catch (emailErr) {
        console.error("Billing payment email lookup failed:", emailErr.message);
      }

      logAdminAction(req.admin.email, "payment_recorded", "tenant", req.params.id, { amount: req.body.amount, method: req.body.method }, req.ip);
      return res.json({
        ok: true,
        plan,
        cycle,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        grace_ends_at: graceEnd.toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 4. GET /api/admin/tenants/:id/payments — payment history for a tenant
  app.get("/api/admin/tenants/:id/payments", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantId = parseInt(req.params.id, 10);
      const { rows } = await masterDb.query(
        "SELECT * FROM payment_records WHERE tenant_id = $1 ORDER BY recorded_at DESC",
        [tenantId]
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 5. GET /api/admin/upgrade-requests — all pending upgrade requests
  app.get("/api/admin/upgrade-requests", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await masterDb.query(
        `SELECT ur.*, t.slug, t.name AS tenant_name, t.plan AS current_plan
         FROM upgrade_requests ur
         JOIN tenants t ON t.id = ur.tenant_id
         WHERE ur.status = 'pending'
         ORDER BY ur.created_at ASC`
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 6. PUT /api/admin/upgrade-requests/:id — approve or dismiss
  app.put("/api/admin/upgrade-requests/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !["approved", "dismissed"].includes(status)) {
        return res.status(400).json({ error: "status must be 'approved' or 'dismissed'" });
      }

      const { rows } = await masterDb.query(
        `UPDATE upgrade_requests
         SET status = $1, resolved_at = NOW(), resolved_by = $2
         WHERE id = $3
         RETURNING *`,
        [status, req.admin.email, id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Upgrade request not found" });
      }

      logAdminAction(req.admin.email, "upgrade_request_" + status, "tenant", req.params.id, null, req.ip);
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 7. GET /api/admin/billing-attention — dashboard summary of billing issues
  app.get("/api/admin/billing-attention", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Due soon: expiring within 7 days but not yet expired
      const dueSoon = await masterDb.query(
        `SELECT id, slug, name, plan, plan_expires_at
         FROM tenants
         WHERE status = 'active'
           AND plan_expires_at IS NOT NULL
           AND plan_expires_at > $1
           AND plan_expires_at <= $2
         ORDER BY plan_expires_at ASC`,
        [now, sevenDays]
      );

      // Overdue: past expiry but still within grace period
      const overdue = await masterDb.query(
        `SELECT id, slug, name, plan, plan_expires_at, grace_ends_at
         FROM tenants
         WHERE status = 'active'
           AND plan_expires_at IS NOT NULL
           AND plan_expires_at < $1
           AND grace_ends_at IS NOT NULL
           AND grace_ends_at >= $1
         ORDER BY plan_expires_at ASC`,
        [now]
      );

      // Past grace: grace period has ended
      const pastGrace = await masterDb.query(
        `SELECT id, slug, name, plan, plan_expires_at, grace_ends_at
         FROM tenants
         WHERE status = 'active'
           AND grace_ends_at IS NOT NULL
           AND grace_ends_at < $1
         ORDER BY grace_ends_at ASC`,
        [now]
      );

      // Pending upgrade requests count
      const upgradeCount = await masterDb.query(
        "SELECT COUNT(*)::int AS count FROM upgrade_requests WHERE status = 'pending'"
      );

      return res.json({
        due_soon: dueSoon.rows,
        overdue: overdue.rows,
        past_grace: pastGrace.rows,
        pending_upgrades: upgradeCount.rows[0].count,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Support Tickets (cross-tenant) ──────────────────────────────────

  app.get("/api/admin/support-tickets", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const status = req.query.status || null;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allTickets = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          let sql = `SELECT id, type, message, page_url, browser, employee_id, screenshots, last_req_id, status, created_at, resolved_at
                     FROM support_tickets`;
          const params = [];
          if (status) {
            sql += " WHERE status = $1";
            params.push(status);
          }
          sql += " ORDER BY created_at DESC LIMIT $" + (params.length + 1);
          params.push(limit);

          const { rows } = await tenantDb.query(sql, params);
          for (const row of rows) {
            allTickets.push({ ...row, tenant_id: tenant.id, tenant_slug: tenant.slug, tenant_name: tenant.name });
          }
        } catch {
          // Table may not exist for this tenant — skip silently
        }
      }

      // Sort aggregated results by created_at DESC, then trim to limit
      allTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ tickets: allTickets.slice(0, limit) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/support-tickets/:tenantId/:ticketId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { status } = req.body || {};
      if (!status || !["open", "acknowledged", "resolved"].includes(status)) {
        return res.status(400).json({ error: "status must be one of: open, acknowledged, resolved" });
      }

      const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
      const resolvedAt = status === "resolved" ? "NOW()" : "NULL";
      const { rows } = await tenantDb.query(
        `UPDATE support_tickets SET status = $1, resolved_at = ${resolvedAt} WHERE id = $2 RETURNING *`,
        [status, req.params.ticketId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      // Send resolved notification to submitting employee (fire-and-forget)
      if (status === "resolved" && rows[0].employee_id) {
        try {
          const { rows: [emp] } = await tenantDb.query(
            "SELECT email FROM employees WHERE id = $1", [rows[0].employee_id]
          );
          const { rows: [profile] } = await tenantDb.query(
            "SELECT company_name FROM company_profile WHERE id = 1"
          );
          if (emp?.email) {
            const { sendEmail } = require("../services/email");
            sendEmail({
              type: "support_resolved",
              to: emp.email,
              data: {
                ticketId: rows[0].id,
                type: rows[0].type,
                storeName: profile?.company_name || "Your store",
              },
            }).catch((err) => console.error("Ticket resolved email failed:", err.message));
          }
        } catch (emailErr) {
          console.error("Ticket resolved email lookup failed:", emailErr.message);
        }
      }

      return res.json({ ticket: rows[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Impersonation ──────────────────────────────────────────────────

  app.post("/api/admin/impersonate/:tenantId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantId = parseInt(req.params.tenantId, 10);

      // 1. Get tenant from master DB
      const { rows: tenantRows } = await db.query(
        "SELECT id, slug, name, status FROM tenants WHERE id = $1",
        [tenantId]
      );
      const tenant = tenantRows[0];
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") return res.status(400).json({ error: "Can only impersonate active tenants" });

      // 2. Get tenant DB and find admin employee (role_id = 1)
      const tenantDb = await tenantDbManager.getDb(tenantId);
      const { rows: empRows } = await tenantDb.query(
        "SELECT id, name, role_id FROM employees WHERE role_id = 1 LIMIT 1"
      );
      const adminEmployee = empRows[0];
      if (!adminEmployee) return res.status(404).json({ error: "No admin employee found in tenant" });

      // 3. Get super-admin name for audit
      const { rows: saRows } = await db.query(
        "SELECT name FROM super_admins WHERE id = $1",
        [req.admin.id]
      );
      const adminName = saRows[0]?.name || req.admin.email;

      // 4. Create short-lived JWT (1 hour) — sign directly to include impersonation fields
      const token = jwt.sign(
        {
          tid: tenant.id,
          eid: adminEmployee.id,
          rid: 1,
          oid: null,
          scope: "full",
          impersonating: true,
          realIdentity: { id: req.admin.id, name: adminName, email: req.admin.email },
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      // 5. Create impersonation_sessions row
      const { rows: sessionRows } = await masterDb.query(
        "INSERT INTO impersonation_sessions (super_admin_id, tenant_id) VALUES ($1, $2) RETURNING id",
        [req.admin.id, tenantId]
      );
      const sessionId = sessionRows[0].id;

      // 6. Audit log
      await auditLog(tenantId, "impersonated", { session_id: sessionId, admin_name: adminName }, `admin:${req.admin.email}`);

      logAdminAction(req.admin.email, "impersonation_started", "tenant", req.params.tenantId, null, req.ip);
      return res.json({ token, tenantSlug: tenant.slug, tenantName: tenant.name, sessionId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/impersonate/:sessionId/end", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId, 10);
      await masterDb.query(
        "UPDATE impersonation_sessions SET ended_at = NOW() WHERE id = $1",
        [sessionId]
      );
      logAdminAction(req.admin.email, "impersonation_ended", "session", req.params.sessionId, null, req.ip);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Dead Letter Queue (cross-tenant) ────────────────────────────────

  app.get("/api/admin/dead-letters", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allEvents = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows } = await tenantDb.query(
            `SELECT id, topic, status, payload, error, retries, created_at, updated_at
             FROM shopify_webhook_events
             WHERE status IN ('dead_letter', 'failed')
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit]
          );
          for (const row of rows) {
            allEvents.push({ ...row, tenant_id: tenant.id, tenant_slug: tenant.slug, tenant_name: tenant.name });
          }
        } catch {
          // Table may not exist — skip silently
        }
      }

      allEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ events: allEvents.slice(0, limit) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/dead-letters/:tenantId/:id/retry", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantDb = await tenantDbManager.getDb(parseInt(req.params.tenantId, 10));
      const { rows } = await tenantDb.query(
        `UPDATE shopify_webhook_events SET status = 'pending', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
      }

      return res.json({ event: rows[0] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Tax Rate Reference CRUD (public schema) ────────────────────────

  // GET /api/admin/tax-rates
  app.get("/api/admin/tax-rates", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM public.tax_rate_reference ORDER BY hs_code");
      res.json({ rates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/tax-rates
  app.post("/api/admin/tax-rates", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes } = req.body;
      if (!hs_code || !description_en) return res.status(400).json({ error: "hs_code and description_en are required" });

      const { rows: [rate] } = await db.query(
        `INSERT INTO public.tax_rate_reference (hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [hs_code, description_en, description_ur || null, federal_gst || 0, punjab_pra || 0, sindh_srb || 0, kpk_kpra || 0, balochistan_bra || 0, exemption_notes || null]
      );
      res.json(rate);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/tax-rates/:id
  app.put("/api/admin/tax-rates/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes } = req.body;
      const { rows: [rate] } = await db.query(
        `UPDATE public.tax_rate_reference
         SET hs_code = COALESCE($1, hs_code), description_en = COALESCE($2, description_en),
             description_ur = COALESCE($3, description_ur), federal_gst = COALESCE($4, federal_gst),
             punjab_pra = COALESCE($5, punjab_pra), sindh_srb = COALESCE($6, sindh_srb),
             kpk_kpra = COALESCE($7, kpk_kpra), balochistan_bra = COALESCE($8, balochistan_bra),
             exemption_notes = COALESCE($9, exemption_notes), last_updated = CURRENT_DATE
         WHERE id = $10 RETURNING *`,
        [hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes, id]
      );
      if (!rate) return res.status(404).json({ error: "Rate not found" });
      res.json(rate);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/tax-rates/:id
  app.delete("/api/admin/tax-rates/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM public.tax_rate_reference WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Rate not found" });
      res.json({ message: "Rate deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tax Rate Suggestions Review ────────────────────────────────────

  // GET /api/admin/tax-rate-suggestions — aggregate across tenant schemas
  app.get("/api/admin/tax-rate-suggestions", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await masterDb.query("SELECT id, slug, name FROM tenants WHERE status = 'active'");
      const suggestions = [];
      for (const tenant of tenants) {
        try {
          const { rows } = await db.query(
            `SELECT * FROM tenant_${tenant.slug}.tax_rate_suggestions WHERE status = 'pending' ORDER BY created_at DESC`
          );
          rows.forEach((r) => suggestions.push({ ...r, tenant_slug: tenant.slug, tenant_name: tenant.name }));
        } catch (_) { /* skip tenants without the table */ }
      }
      res.json({ suggestions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/tax-rate-suggestions/:id — approve or reject
  app.put("/api/admin/tax-rate-suggestions/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, tenant_slug } = req.body;
      if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected" });
      if (!tenant_slug) return res.status(400).json({ error: "tenant_slug is required" });

      // Update suggestion in tenant schema
      const { rows: [suggestion] } = await db.query(
        `UPDATE tenant_${tenant_slug}.tax_rate_suggestions SET status = $1, reviewed_at = NOW() WHERE id = $2 RETURNING *`,
        [status, id]
      );
      if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });

      // If approved, update the reference rate
      if (status === "approved" && suggestion.field_name && suggestion.suggested_value != null) {
        const allowedFields = ["federal_gst", "punjab_pra", "sindh_srb", "kpk_kpra", "balochistan_bra"];
        if (allowedFields.includes(suggestion.field_name)) {
          await db.query(
            `UPDATE public.tax_rate_reference SET ${suggestion.field_name} = $1, last_updated = CURRENT_DATE WHERE id = $2`,
            [suggestion.suggested_value, suggestion.reference_id]
          );
        }
      }

      res.json({ message: `Suggestion ${status}`, suggestion });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── FBR Health (cross-tenant) ──────────────────────────────────────

  app.get("/api/admin/fbr-health", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await masterDb.query("SELECT id, slug, name FROM tenants WHERE status = 'active'");
      const health = [];

      for (const tenant of tenants) {
        try {
          // Check if FBR is enabled for this tenant
          const { rows: [flag] } = await db.query(
            `SELECT enabled FROM tenant_${tenant.slug}.feature_flags WHERE key = 'fbr_integration'`
          );
          if (!flag?.enabled) continue;

          const { rows: [stats] } = await db.query(
            `SELECT
               COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
               COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
               COUNT(*) FILTER (WHERE status = 'posted')::int AS posted,
               MIN(created_at) FILTER (WHERE status = 'pending') AS oldest_pending,
               AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) FILTER (WHERE status = 'pending') AS avg_delay_secs
             FROM tenant_${tenant.slug}.fbr_invoices`
          );
          health.push({
            tenant_slug: tenant.slug,
            tenant_name: tenant.name,
            ...stats,
          });
        } catch (_) { /* skip tenants without the table */ }
      }

      res.json({ health });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Email Queue Management ─────────────────────────────────────────

  // GET /api/admin/email-queue — list queued emails with optional status filter
  app.get("/api/admin/email-queue", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { status, limit: lim } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 100, 500);

      let where = "1=1";
      if (status === "pending") where = "eq.sent_at IS NULL AND eq.attempts < eq.max_attempts";
      else if (status === "sent") where = "eq.sent_at IS NOT NULL";
      else if (status === "failed") where = "eq.sent_at IS NULL AND eq.attempts >= eq.max_attempts";

      const { rows } = await db.query(
        `SELECT eq.id, eq.tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
                eq.email_type, eq.to_email, eq.subject, eq.from_address,
                eq.send_at, eq.sent_at, eq.error, eq.attempts, eq.max_attempts, eq.created_at
         FROM email_queue eq
         LEFT JOIN tenants t ON t.id = eq.tenant_id
         WHERE ${where}
         ORDER BY eq.id DESC
         LIMIT $1`,
        [limit]
      );

      // Summary counts
      const { rows: [counts] } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE sent_at IS NULL AND attempts < max_attempts) AS pending,
           COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
           COUNT(*) FILTER (WHERE sent_at IS NULL AND attempts >= max_attempts) AS failed
         FROM email_queue`
      );

      return res.json({
        emails: rows,
        counts: {
          pending: Number(counts.pending),
          sent: Number(counts.sent),
          failed: Number(counts.failed),
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/email-queue/:id/retry — reset a failed email for retry
  app.post("/api/admin/email-queue/:id/retry", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "UPDATE email_queue SET attempts = 0, error = NULL WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Broadcast Emails ───────────────────────────────────────────────

  // POST /api/admin/email/broadcast — send downtime or announcement to all tenants
  app.post("/api/admin/email/broadcast", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { type, subject, message } = req.body || {};
      if (!type || !["downtime", "announcement"].includes(type)) {
        return res.status(400).json({ error: "type must be 'downtime' or 'announcement'" });
      }
      if (!subject || !message) {
        return res.status(400).json({ error: "subject and message are required" });
      }

      // Get all active tenants
      const { rows: tenants } = await masterDb.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active'"
      );

      const { enqueueEmail } = require("../services/email");
      const dbPg = require("../db-pg");
      let enqueued = 0;

      for (const t of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(t.id);
          const { rows: [profile] } = await tenantDb.query(
            "SELECT email FROM company_profile WHERE id = 1"
          );
          if (!profile?.email) continue;

          await enqueueEmail(dbPg, {
            tenantId: t.id,
            type,
            to: profile.email,
            data: { subject, message },
          });
          enqueued++;
        } catch (err) {
          console.error(`Broadcast enqueue failed for ${t.slug}:`, err.message);
        }
      }

      await auditLog(null, "broadcast_sent", { type, subject, recipients: enqueued }, `admin:${req.admin.email}`);
      logAdminAction(req.admin.email, "broadcast_sent", "email", null, { subject: req.body.subject, type: req.body.type }, req.ip);
      return res.json({ ok: true, enqueued });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Activity Log ──────────────────────────────────────────────────
  app.get("/api/admin/activity-log", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { action, limit: lim, offset: off } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 50, 200);
      const offset = parseInt(off, 10) || 0;
      const conditions = [];
      const params = [];

      if (action) {
        params.push(action);
        conditions.push(`action = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await db.query(
        `SELECT * FROM admin_activity_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) AS count FROM admin_activity_log ${where}`,
        params
      );

      return res.json({ entries: rows, total: Number(count) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Security Log ──────────────────────────────────────────────────
  app.get("/api/admin/security-log", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { event_type, limit: lim, offset: off } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 50, 200);
      const offset = parseInt(off, 10) || 0;
      const conditions = [];
      const params = [];

      if (event_type) {
        params.push(event_type);
        conditions.push(`event_type = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await db.query(
        `SELECT * FROM admin_security_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) AS count FROM admin_security_log ${where}`,
        params
      );

      return res.json({ entries: rows, total: Number(count) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Cross-Tenant Activity ─────────────────────────────────────────
  app.get("/api/admin/tenant-activity", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allActivity = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows } = await tenantDb.query(
            `SELECT action, entity_type, entity_id, details, performed_by, created_at
             FROM action_history ORDER BY created_at DESC LIMIT $1`,
            [Math.ceil(limit / tenants.length) || 10]
          );
          for (const row of rows) {
            allActivity.push({ ...row, tenant_slug: tenant.slug, tenant_name: tenant.name });
          }
        } catch (_) { /* table may not exist */ }
      }

      allActivity.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ entries: allActivity.slice(0, limit) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/email-queue/purge-deleted — delete all emails for deleted tenants
  app.delete("/api/admin/email-queue/purge-deleted", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM email_queue WHERE tenant_id IN (SELECT id FROM tenants WHERE status = 'deleted')"
      );
      logAdminAction(req.admin.email, "email_purge_deleted", "email", null, { count: rowCount }, req.ip);
      return res.json({ message: `Purged ${rowCount} email(s) for deleted tenants` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/email-queue/:id — hard delete a pending/failed email
  app.delete("/api/admin/email-queue/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM email_queue WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      logAdminAction(req.admin.email, "email_deleted", "email", req.params.id, null, req.ip);
      return res.json({ message: "Email deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/email-queue/:id/send-now — force a pending email to send immediately
  app.post("/api/admin/email-queue/:id/send-now", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "UPDATE email_queue SET send_at = NOW(), attempts = 0, error = NULL WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      logAdminAction(req.admin.email, "email_force_sent", "email", req.params.id, null, req.ip);
      return res.json({ message: "Email queued for immediate send" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Revenue Stats ─────────────────────────────────────────────────
  app.get("/api/admin/revenue-stats", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: [pricing] } = await db.query(
        "SELECT price FROM plan_pricing WHERE plan = 'pro' AND cycle = 'monthly' LIMIT 1"
      );
      const proPrice = pricing ? Number(pricing.price) : 0;

      const { rows: [counts] } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE plan = 'pro' AND status = 'active') AS paying_tenants,
          COUNT(*) FILTER (WHERE status = 'active' AND payment_status = 'overdue') AS overdue
        FROM tenants
      `);

      const mrr = Number(counts.paying_tenants) * proPrice;

      const { rows: tenants } = await db.query(
        "SELECT id, slug FROM tenants WHERE status = 'active'"
      );
      let totalRevenue = 0;
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows: [rev] } = await tenantDb.query(
            `SELECT COALESCE(SUM(total), 0) AS revenue FROM sales
             WHERE "timestamp" >= date_trunc('month', NOW())`
          );
          totalRevenue += Number(rev.revenue);
        } catch (_) { /* skip */ }
      }

      return res.json({
        mrr,
        tenant_revenue_this_month: totalRevenue,
        paying_tenants: Number(counts.paying_tenants),
        overdue: Number(counts.overdue),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Worker Status ─────────────────────────────────────────────────
  app.get("/api/admin/worker-status", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const emailStatus = global.__emailWorkerStatus || null;
      const fbrStatus = global.__fbrWorkerStatus || null;
      const cleanupStatus = global.__cleanupWorkerStatus || null;

      function workerInfo(status, pollIntervalMs) {
        if (!status) return { enabled: false, running: false };
        const lastPollAgo = Date.now() - (status.lastPollAt || 0);
        return {
          enabled: true,
          running: lastPollAgo < pollIntervalMs * 2.5,
          last_poll_at: status.lastPollAt ? new Date(status.lastPollAt).toISOString() : null,
          last_poll_ago_seconds: Math.round(lastPollAgo / 1000),
          processed_today: status.processedToday || 0,
          queue_depth: status.queueDepth || 0,
        };
      }

      return res.json({
        email: workerInfo(emailStatus, 60_000),
        fbr: workerInfo(fbrStatus, 30_000),
        cleanup: workerInfo(cleanupStatus, 24 * 60 * 60 * 1000),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Orphaned Schemas ──────────────────────────────────────────────
  app.get("/api/admin/orphaned-schemas", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: schemas } = await db.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`
      );
      const { rows: tenants } = await db.query("SELECT slug FROM tenants");
      const tenantSlugs = new Set(tenants.map(t => `tenant_${t.slug}`));

      const orphans = [];
      for (const s of schemas) {
        if (!tenantSlugs.has(s.schema_name)) {
          const { rows: [size] } = await db.query(
            `SELECT pg_size_pretty(COALESCE(SUM(pg_total_relation_size(quote_ident($1)||'.'||quote_ident(tablename)))::bigint, 0)) AS size
             FROM pg_tables WHERE schemaname = $1`,
            [s.schema_name]
          );
          orphans.push({ schema: s.schema_name, size: size.size });
        }
      }

      return res.json({ orphans, count: orphans.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Orphaned Schema Cleanup ───────────────────────────────────────
  app.post("/api/admin/orphaned-schemas/cleanup", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: schemas } = await db.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' ORDER BY schema_name`
      );
      const { rows: tenants } = await db.query("SELECT slug FROM tenants");
      const tenantSlugs = new Set(tenants.map(t => `tenant_${t.slug}`));

      const dropped = [];
      for (const s of schemas) {
        if (!tenantSlugs.has(s.schema_name)) {
          await db.query(`DROP SCHEMA IF EXISTS "${s.schema_name}" CASCADE`);
          dropped.push(s.schema_name);
        }
      }

      logAdminAction(req.admin.email, "orphaned_schemas_cleanup", "system", null, { dropped }, req.ip);
      return res.json({ dropped, count: dropped.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
