/**
 * Tenant CRUD, stats, feature-usage, setup-token, feature-flags, notes, PIN reset, migrations.
 */
const { validate } = require("../../middleware/validate");
const { CreateTenantSchema } = require("../../schemas/admin");
const { DEFAULT_FEATURE_FLAGS } = require("../../middleware/feature-flags");

module.exports = function registerTenantRoutes(app, deps) {
  const { db, masterDb, requireAllowedIp, requireSuperAdmin, tenantDbManager, PLAN_DEFAULTS, provision, bcrypt, BCRYPT_ROUNDS, auditLog, logAdminAction } = deps;

  // ── List tenants ───────────────────────────────────────────────────────
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

  // ── Create tenant ──────────────────────────────────────────────────────
  app.post("/api/admin/tenants", requireAllowedIp, requireSuperAdmin, validate(CreateTenantSchema), async (req, res) => {
    const { slug, name, owner_email, timezone, pin, plan } = req.body || {};
    if (!slug || !name || !pin) {
      return res.status(400).json({ error: "slug, name, and pin are required" });
    }
    if (!/^[a-z0-9_]{3,40}$/.test(slug)) {
      return res.status(400).json({ error: "slug must be 3-40 chars: lowercase letters, numbers, underscores only" });
    }
    if (!/^\d{4,8}$/.test(String(pin))) {
      return res.status(400).json({ error: "pin must be 4-8 digits" });
    }
    try {
      const { rows: existing } = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
      if (existing.length > 0) {
        return res.status(409).json({ error: `Tenant "${slug}" already exists` });
      }

      const result = await provision(db, {
        slug,
        name,
        ownerEmail: owner_email || "admin@example.com",
        timezone: timezone || "UTC",
        pin: String(pin),
      });

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

  // ── Get tenant detail ──────────────────────────────────────────────────
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

  // ── Update tenant ──────────────────────────────────────────────────────
  app.put("/api/admin/tenants/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    const { name, owner_email, plan, timezone, max_employees, max_outlets, max_products } = req.body || {};
    try {
      const { rows } = await db.query("SELECT id, plan, name FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

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

      if (planChanged) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows: [profile] } = await tenantDb.query("SELECT email FROM company_profile WHERE id = 1");
          if (profile?.email) {
            const { sendEmail } = require("../../services/email");
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

  // ── Suspend ────────────────────────────────────────────────────────────
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

  // ── Activate ───────────────────────────────────────────────────────────
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

  // ── Delete ─────────────────────────────────────────────────────────────
  app.delete("/api/admin/tenants/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status === "deleted") return res.json({ message: "Already deleted" });

      if (!/^[a-z0-9_]+$/.test(tenant.slug)) {
        return res.status(400).json({ error: "Invalid tenant slug — cannot safely drop schema" });
      }

      const schemaName = `tenant_${tenant.slug}`;

      await db.query(
        "UPDATE tenants SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );

      await db.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

      await auditLog(tenant.id, "deleted", null, `admin:${req.admin.email}`);
      logAdminAction(req.admin.email, "tenant_deleted", "tenant", req.params.id, null, req.ip);
      return res.json({ message: `Tenant "${tenant.slug}" deleted and schema dropped` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Tenant Stats ───────────────────────────────────────────────────────
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

  // ── Feature Usage ──────────────────────────────────────────────────────
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

  // ── Setup Token ────────────────────────────────────────────────────────
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

  // ── Feature Flags (per-tenant schema) ──────────────────────────────────
  app.get("/api/admin/tenants/:id/feature-flags", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows: [tenant] } = await db.query("SELECT id, slug FROM tenants WHERE id = $1", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const tenantDb = await tenantDbManager.getDb(tenant.id);
      const { rows } = await tenantDb.query("SELECT key, enabled, description FROM feature_flags ORDER BY key");
      const rowMap = new Map(rows.map((r) => [r.key, r]));
      const mergedDefaults = Object.keys(DEFAULT_FEATURE_FLAGS).map((key) => {
        const existing = rowMap.get(key);
        if (existing) return existing;
        return { key, enabled: !!DEFAULT_FEATURE_FLAGS[key], description: null };
      });
      const extras = rows.filter((r) => !Object.prototype.hasOwnProperty.call(DEFAULT_FEATURE_FLAGS, r.key));
      return res.json([...mergedDefaults, ...extras].sort((a, b) => a.key.localeCompare(b.key)));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/tenants/:id/feature-flags", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { key, enabled } = req.body;
      if (!key) return res.status(400).json({ error: "key is required" });

      const { rows: [tenant] } = await db.query("SELECT id, slug FROM tenants WHERE id = $1", [req.params.id]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const tenantDb = await tenantDbManager.getDb(tenant.id);
      await tenantDb.query(
        `INSERT INTO feature_flags (key, enabled, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [key, !!enabled, `admin:${req.admin.email}`]
      );

      logAdminAction(req.admin.email, "feature_flag_toggled", "tenant", req.params.id, { key, enabled: !!enabled }, req.ip);
      return res.json({ message: "Feature flag updated" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Tenant Notes ───────────────────────────────────────────────────────
  app.get("/api/admin/tenants/:id/notes", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM tenant_notes WHERE tenant_id = $1 ORDER BY created_at DESC",
        [req.params.id]
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tenants/:id/notes", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { note } = req.body;
      if (!note || !note.trim()) return res.status(400).json({ error: "Note is required" });

      const { rows } = await db.query(
        "INSERT INTO tenant_notes (tenant_id, admin_email, note) VALUES ($1, $2, $3) RETURNING *",
        [req.params.id, req.admin.email, note.trim()]
      );
      logAdminAction(req.admin.email, "note_added", "tenant", req.params.id, { note: note.trim().substring(0, 100) }, req.ip);
      return res.status(201).json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/tenants/:id/notes/:noteId", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM tenant_notes WHERE id = $1 AND tenant_id = $2",
        [req.params.noteId, req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Note not found" });
      return res.json({ message: "Note deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Migrations ─────────────────────────────────────────────────────────
  app.post("/api/admin/tenants/:id/migrate", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, slug, status FROM tenants WHERE id = $1", [req.params.id]);
      const tenant = rows[0] || null;
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (tenant.status !== "active") {
        return res.status(400).json({ error: "Can only migrate active tenants" });
      }

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

  // ── PIN Reset ──────────────────────────────────────────────────────────
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
        `UPDATE ${schemaName}.employees SET pin_hash = $1 WHERE id = $2`,
        [pinHash, adminEmp.id]
      );

      await auditLog(tenant.id, "pin_reset", { employee_id: adminEmp.id }, `admin:${req.admin.email}`);
      logAdminAction(req.admin.email, "pin_reset", "tenant", req.params.id, null, req.ip);
      return res.json({ message: `Admin PIN reset for tenant "${tenant.slug}"`, employee_id: adminEmp.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
