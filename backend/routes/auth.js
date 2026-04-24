module.exports = function registerAuthRoutes(app, deps) {
  const { db, authLimiter } = deps;
  const bcrypt = require("bcryptjs");
  const { getPreset } = require("../config/industry-config");
  const { validate } = require("../middleware/validate");
  const { LoginSchema, MtLoginSchema, KioskLoginSchema, ForgotPasswordSchema, ResetPasswordSchema, SignupSchema } = require("../schemas/auth");

  /**
   * @swagger
   * /api/auth/login:
   *   post:
   *     summary: Login (single-tenant mode)
   *     description: Authenticate with username and password/PIN. Returns employee info and permissions. Used in single-tenant deployments.
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username]
   *             properties:
   *               username:
   *                 type: string
   *                 description: Employee name
   *               password:
   *                 type: string
   *                 description: Employee password (or PIN for legacy accounts)
   *               pin:
   *                 type: string
   *                 description: PIN code (fallback auth)
   *     responses:
   *       200:
   *         description: Login successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 employee:
   *                   type: object
   *                   properties:
   *                     id: { type: integer }
   *                     name: { type: string }
   *                     role_id: { type: integer }
   *                     outlet_id: { type: integer, nullable: true }
   *                 permissions:
   *                   type: array
   *                   items: { type: string }
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  app.post("/api/auth/login", authLimiter, validate(LoginSchema), async (req, res) => {
    const { username, password, pin } = req.body;

    try {
      const { rows: [employee] } = await db.query(
        `SELECT e.id, e.name, e.role_id, e.pin_code, e.pin_hash, e.password_hash, r.name as role, NULL as outlet_id
         FROM employees e
         LEFT JOIN roles r ON e.role_id = r.id
         WHERE LOWER(e.name) = LOWER($1) AND e.deleted_at IS NULL`,
        [String(username).trim()]
      );

      if (!employee) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Dual auth: password takes priority, PIN as fallback for legacy accounts
      let credValid = false;
      if (password && employee.password_hash) {
        credValid = await bcrypt.compare(String(password), employee.password_hash);
      } else if (!employee.password_hash) {
        const pinInput = pin || password;
        if (pinInput) {
          if (employee.pin_hash) {
            credValid = await bcrypt.compare(String(pinInput).trim(), employee.pin_hash);
          } else if (employee.pin_code) {
            credValid = String(pinInput).trim() === String(employee.pin_code).trim();
          }
        }
      } else if (pin) {
        return res.status(401).json({ error: "Please use your password to log in" });
      }

      if (!credValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const { rows: permRows } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1",
        [employee.role_id || 3]
      );
      const permissions = (permRows || []).map(r => r.permission);

      return res.json({
        employee: {
          id: employee.id,
          name: employee.name,
          role_id: employee.role_id,
          outlet_id: employee.outlet_id || null,
        },
        permissions,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    // In multi-tenant mode: revoke refresh tokens and clear cookie
    if (process.env.MULTI_TENANT === "1") {
      try {
        const masterDb = require("../master-db-pg");
        const { hashToken } = require("../jwt-auth");

        // Revoke by cookie token hash if present
        const refreshToken = req.cookies?.refreshToken;
        if (refreshToken) {
          const tokenHash = hashToken(refreshToken);
          await masterDb.query(
            "UPDATE tenant_refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
            [tokenHash]
          );
        }

        res.clearCookie("refreshToken", {
          path: "/api/auth",
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
        });
      } catch {
        // Best-effort — still return success
      }
    }
    res.json({ success: true });
  });

  // Context bootstrap — returns companies, outlets, and scope defaults for the
  // logged-in employee so the frontend can render the context-selection step.
  app.get("/api/context/bootstrap", async (req, res) => {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { rows: [emp] } = await db.query(
        `SELECT e.id, e.name, e.role_id, r.name AS role_name
         FROM employees e LEFT JOIN roles r ON e.role_id = r.id
         WHERE e.id = $1`,
        [employeeId]
      );
      if (!emp) return res.status(401).json({ error: "Employee not found" });

      // Check if admin (role_id 1 = Administrator, or has all_access)
      const { rows: permRows } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1",
        [emp.role_id]
      );
      const perms = (permRows || []).map((r) => r.permission);
      const isAdmin = perms.includes("all_access");

      // Get companies
      const { rows: companies } = await db.query(
        "SELECT id, name, code FROM companies WHERE is_active = true",
        []
      );

      // Get outlets: admin sees all active, others see assigned only
      let outlets;
      if (isAdmin) {
        const result = await db.query(
          "SELECT id, name, address, company_id, branch_code FROM outlets WHERE is_active = true ORDER BY name",
          []
        );
        outlets = result.rows;
      } else {
        const result = await db.query(
          `SELECT o.id, o.name, o.address, o.company_id, o.branch_code
           FROM outlets o
           JOIN employee_outlets eo ON eo.outlet_id = o.id
           WHERE eo.employee_id = $1 AND o.is_active = true
           ORDER BY o.name`,
          [employeeId]
        );
        outlets = result.rows;
      }

      // Get primary outlet
      const { rows: [primary] } = await db.query(
        "SELECT outlet_id FROM employee_outlets WHERE employee_id = $1 AND is_primary = true",
        [employeeId]
      );

      // Fetch preset data (safe fallback for pre-migration tenants)
      let presetData = null;
      try {
        const { rows: [cpProfile] } = await db.query(
          "SELECT industry_type, business_model, country_code FROM company_profile WHERE id = 1"
        );
        const industryType = cpProfile?.industry_type || "general_retail";
        const presetConfig = getPreset(industryType);

        let enabledModes = [];
        try {
          const { rows: modeRows } = await db.query(
            "SELECT mode FROM tenant_modes WHERE enabled = true"
          );
          enabledModes = modeRows.map(r => r.mode);
        } catch {
          // tenant_modes table may not exist yet
        }

        presetData = {
          industry_type: industryType,
          business_model: presetConfig.business_model,
          labels: presetConfig.labels,
          dashboard_widgets: presetConfig.dashboard_widgets,
          onboarding_steps: presetConfig.onboarding_steps,
          pos_layout_mode: presetConfig.pos_layout_mode,
          pos_search_config: presetConfig.pos_search_config,
          visible_report_groups: presetConfig.visible_report_groups,
          unit_vocabulary: presetConfig.unit_vocabulary,
          enabled_modes: enabledModes,
        };
      } catch {
        // Pre-migration tenants — no preset columns exist yet
      }

      res.json({
        employee: {
          id: emp.id,
          name: emp.name,
          role_id: emp.role_id,
          role_name: emp.role_name,
        },
        companies: companies || [],
        outlets: outlets || [],
        allowed_outlet_ids: (outlets || []).map((o) => o.id),
        scope_mode_default: isAdmin ? "all_branches" : "single_branch",
        primary_outlet_id: primary?.outlet_id || (outlets?.[0]?.id ?? null),
        preset: presetData,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // --- Multi-tenant JWT endpoints (only active when MULTI_TENANT=1) ---
  if (process.env.MULTI_TENANT === "1") {
    const { signAccessToken, signRefreshToken, verifyRefreshToken, verifyAccessToken, hashToken } = require("../jwt-auth");
    const jwtLib = require("jsonwebtoken");
    const masterDb = require("../master-db-pg");
    const tenantDbMgr = process.env.DATABASE_URL
      ? require("../tenant-db-manager-pg")
      : require("../tenant-db-manager");

    /**
     * @swagger
     * /api/auth/mt-login:
     *   post:
     *     summary: Login (multi-tenant mode)
     *     description: Authenticate with tenant slug, username, and password/PIN. Returns JWT access + refresh tokens. This is the primary login endpoint for production.
     *     tags: [Auth]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [tenant_slug, username]
     *             properties:
     *               tenant_slug:
     *                 type: string
     *                 description: Tenant store code (e.g. "mystore")
     *               username:
     *                 type: string
     *                 description: Employee name
     *               password:
     *                 type: string
     *                 description: Employee password
     *               pin:
     *                 type: string
     *                 description: PIN code (fallback for legacy accounts)
     *     responses:
     *       200:
     *         description: Login successful — returns JWT tokens and employee info
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 token:
     *                   type: string
     *                   description: JWT access token (short-lived)
     *                 employee:
     *                   type: object
     *                   properties:
     *                     id: { type: integer }
     *                     name: { type: string }
     *                     role_id: { type: integer }
     *                 permissions:
     *                   type: array
     *                   items: { type: string }
     *                 tenant:
     *                   type: object
     *                   properties:
     *                     id: { type: integer }
     *                     slug: { type: string }
     *                     name: { type: string }
     *       401:
     *         description: Invalid credentials or inactive tenant
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    // POST /api/auth/mt-login — standard login with tenant slug + username + password/PIN
    app.post("/api/auth/mt-login", authLimiter, validate(MtLoginSchema), async (req, res) => {
      const { tenant_slug, username, password, pin } = req.body;
      const JWT_SECRET = process.env.JWT_SECRET;
      const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
      if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
        return res.status(500).json({ error: "JWT secrets not configured" });
      }

      try {
        // 1. Look up tenant by slug
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id, slug, name, status FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(tenant_slug).trim()]
        );
        if (!tenant) {
          return res.status(401).json({ error: "Invalid store code" });
        }

        // 2. Find employee in tenant DB by username (manual resolution — no ALS context yet)
        const tenantDb = await tenantDbMgr.getDb(tenant.id);
        const { rows: [employee] } = await tenantDb.query(
          `SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, e.password_hash
           FROM employees e
           WHERE LOWER(e.name) = LOWER($1) AND e.deleted_at IS NULL`,
          [String(username).trim()]
        );
        if (!employee) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        // 3. Dual auth: password takes priority, PIN as fallback for legacy accounts
        let credValid = false;
        if (password && employee.password_hash) {
          // Employee has a password set — verify it
          credValid = await bcrypt.compare(String(password), employee.password_hash);
        } else if (!employee.password_hash) {
          // No password set yet — fall back to PIN verification
          // The "password" field may contain a PIN during transition period
          const pinInput = pin || password;
          if (pinInput) {
            if (employee.pin_hash) {
              credValid = await bcrypt.compare(String(pinInput).trim(), employee.pin_hash);
            } else if (employee.pin_code) {
              credValid = String(pinInput).trim() === String(employee.pin_code).trim();
            }
          }
        } else if (pin) {
          // password_hash exists but only PIN sent — reject
          return res.status(401).json({ error: "Please use your password to log in" });
        }
        if (!credValid) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        // 4. Load permissions
        const { rows: permRows } = await tenantDb.query(
          "SELECT permission FROM role_permissions WHERE role_id = $1",
          [employee.role_id || 3]
        );
        const permissions = (permRows || []).map(r => r.permission);

        // 5. Sign access token (oid null until context selection)
        const accessToken = signAccessToken(
          { tid: tenant.id, eid: employee.id, rid: employee.role_id, oid: null },
          JWT_SECRET
        );

        // 6. Sign refresh token and store hash in master.db
        const { token: refreshToken, hash: tokenHash, expiresAt } = signRefreshToken(
          { tid: tenant.id, eid: employee.id },
          JWT_REFRESH_SECRET
        );
        await masterDb.query(
          "INSERT INTO tenant_refresh_tokens (tenant_id, employee_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
          [tenant.id, employee.id, tokenHash, expiresAt]
        );

        // 7. Set refresh token as httpOnly cookie
        res.cookie("refreshToken", refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
          path: "/api/auth",
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        // Log login to action_history for tenant health tracking
        try {
          await tenantDb.query(
            "INSERT INTO action_history (action_type, description, user_name) VALUES ('login', $1, $2)",
            [`${employee.name} logged in`, employee.name]
          );
        } catch { /* best-effort — don't block login */ }

        return res.json({
          token: accessToken,
          employee: { id: employee.id, name: employee.name, role_id: employee.role_id },
          permissions,
          tenant: { slug: tenant.slug, name: tenant.name },
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    });

    // POST /api/auth/refresh — exchange refresh cookie for new access token
    app.post("/api/auth/refresh", async (req, res) => {
      const JWT_SECRET = process.env.JWT_SECRET;
      const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
      if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
        return res.status(500).json({ error: "JWT secrets not configured" });
      }

      const refreshToken = req.cookies?.refreshToken;
      if (!refreshToken) {
        return res.status(401).json({ error: "Refresh token missing" });
      }

      try {
        // 1. Verify signature
        const decoded = verifyRefreshToken(refreshToken, JWT_REFRESH_SECRET);
        if (decoded.type !== "refresh") {
          return res.status(401).json({ error: "Invalid refresh token" });
        }

        // 2. Check token in master.db (not revoked)
        const tokenHash = hashToken(refreshToken);
        const { rows: [storedToken] } = await masterDb.query(
          "SELECT * FROM tenant_refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL",
          [tokenHash]
        );
        if (!storedToken) {
          return res.status(401).json({ error: "Refresh token invalid or revoked" });
        }

        // 3. Check tenant is still active
        const { rows: [tenant] } = await masterDb.query(
          "SELECT status FROM tenants WHERE id = $1",
          [decoded.tid]
        );
        if (!tenant || tenant.status !== "active") {
          return res.status(403).json({ error: "Account suspended. Contact support." });
        }

        // 4. Load employee role for new token (manual resolution — no ALS context)
        const tenantDb = await tenantDbMgr.getDb(decoded.tid);
        const { rows: [employee] } = await tenantDb.query(
          "SELECT id, role_id FROM employees WHERE id = $1",
          [decoded.eid]
        );
        if (!employee) {
          return res.status(401).json({ error: "Employee not found" });
        }

        // 5. Sign new access token
        const accessToken = signAccessToken(
          { tid: decoded.tid, eid: decoded.eid, rid: employee.role_id, oid: null },
          JWT_SECRET
        );

        return res.json({ token: accessToken });
      } catch (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({ error: "Refresh token expired", code: "REFRESH_EXPIRED" });
        }
        return res.status(401).json({ error: "Invalid refresh token" });
      }
    });

    // POST /api/auth/update-context — re-sign JWT with selected outlet_id
    app.post("/api/auth/update-context", async (req, res) => {
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) {
        return res.status(500).json({ error: "JWT secrets not configured" });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authorization header required" });
      }

      try {
        const decoded = verifyAccessToken(authHeader.slice(7), JWT_SECRET);
        const { outlet_id } = req.body || {};

        const newToken = signAccessToken(
          {
            tid: decoded.tid,
            eid: decoded.eid,
            rid: decoded.rid,
            oid: outlet_id ? Number(outlet_id) : null,
            scope: decoded.scope || "full",
          },
          JWT_SECRET
        );

        return res.json({ token: newToken });
      } catch (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
        }
        return res.status(401).json({ error: "Invalid token" });
      }
    });

    // POST /api/auth/kiosk-login — PIN-only login with limited scope (8h, kiosk scope)
    app.post("/api/auth/kiosk-login", authLimiter, validate(KioskLoginSchema), async (req, res) => {
      const { tenant_slug, pin } = req.body;
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) {
        return res.status(500).json({ error: "JWT secrets not configured" });
      }

      try {
        // 1. Look up tenant
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id, slug, name, status FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(tenant_slug).trim()]
        );
        if (!tenant) {
          return res.status(401).json({ error: "Invalid store code" });
        }

        // 2. Scan all employees, compare PIN via bcrypt (manual resolution — no ALS context)
        const tenantDb = await tenantDbMgr.getDb(tenant.id);
        const { rows: employees } = await tenantDb.query(
          "SELECT id, name, role_id, pin_hash FROM employees",
          []
        );

        let matched = null;
        for (const emp of (employees || [])) {
          if (emp.pin_hash && await bcrypt.compare(String(pin).trim(), emp.pin_hash)) {
            matched = emp;
            break;
          }
        }
        if (!matched) {
          return res.status(401).json({ error: "Invalid PIN" });
        }

        // 3. Sign kiosk-scoped token (8h, no refresh token)
        const kioskToken = jwtLib.sign(
          { tid: tenant.id, eid: matched.id, rid: matched.role_id, oid: null, scope: "kiosk" },
          JWT_SECRET,
          { expiresIn: "8h" }
        );

        return res.json({
          token: kioskToken,
          employee: { id: matched.id, name: matched.name },
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    });
  }

  const crypto = require("crypto");

  // POST /api/auth/forgot-password — request password reset email
  app.post("/api/auth/forgot-password", authLimiter, validate(ForgotPasswordSchema), async (req, res) => {
    const { username, store_code } = req.body;

    const okMsg = { message: "If an account with that username exists and has an email address, a reset link has been sent." };

    try {
      let tenantDb = db;
      let tenantSlug = null;
      let storeName = "SanoPOS";

      if (process.env.MULTI_TENANT === "1") {
        if (!store_code) return res.json(okMsg);
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id, slug, name FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(store_code).trim()]
        );
        if (!tenant) return res.json(okMsg);
        tenantDb = await tenantDbMgr.getDb(tenant.id);
        tenantSlug = tenant.slug;
        storeName = tenant.name || "SanoPOS";
      }

      const { rows: [employee] } = await tenantDb.query(
        "SELECT id, name, email FROM employees WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL",
        [String(username).trim()]
      );

      if (!employee || !employee.email) return res.json(okMsg);

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await tenantDb.query(
        "INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [employee.id, tokenHash, expiresAt]
      );

      const frontendUrl = process.env.CORS_ORIGIN?.split(",")[0] || "http://localhost:5173";
      let resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;
      if (tenantSlug) resetLink += `&tenant=${tenantSlug}`;

      const { sendPasswordResetEmail } = require("../utils/resendEmail");
      await sendPasswordResetEmail({
        toEmail: employee.email,
        employeeName: employee.name,
        resetLink,
        storeName,
      });

      return res.json(okMsg);
    } catch (err) {
      console.error("[forgot-password]", err.message);
      return res.json(okMsg);
    }
  });

  // POST /api/auth/reset-password — consume token, set new password
  app.post("/api/auth/reset-password", validate(ResetPasswordSchema), async (req, res) => {
    const { token, new_password, store_code } = req.body;

    try {
      let tenantDb = db;

      if (process.env.MULTI_TENANT === "1") {
        if (!store_code) return res.status(400).json({ error: "store_code is required" });
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = require("../tenant-db-manager-pg");
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(store_code).trim()]
        );
        if (!tenant) return res.status(400).json({ error: "Invalid store code" });
        tenantDb = await tenantDbMgr.getDb(tenant.id);
      }

      const { rows: tokens } = await tenantDb.query(
        "SELECT id, employee_id, token_hash FROM password_reset_tokens WHERE used_at IS NULL AND expires_at > NOW()"
      );

      let matchedToken = null;
      for (const t of tokens) {
        if (await bcrypt.compare(token, t.token_hash)) {
          matchedToken = t;
          break;
        }
      }

      if (!matchedToken) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }

      const passwordHash = await bcrypt.hash(new_password, 10);
      await tenantDb.query(
        "UPDATE employees SET password_hash = $1 WHERE id = $2",
        [passwordHash, matchedToken.employee_id]
      );

      await tenantDb.query(
        "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
        [matchedToken.id]
      );

      await tenantDb.query(
        "UPDATE employees SET tokens_revoked_before = NOW() WHERE id = $1",
        [matchedToken.employee_id]
      );

      return res.json({ message: "Password has been reset successfully. Please log in with your new password." });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  const signupLimits = new Map(); // ip -> { count, resetAt }
  function checkSignupRate(ip) {
    const now = Date.now();
    const entry = signupLimits.get(ip);
    if (!entry || now > entry.resetAt) {
      signupLimits.set(ip, { count: 1, resetAt: now + 3600000 }); // 1 hour window
      return true;
    }
    if (entry.count >= 5) return false;
    entry.count += 1;
    return true;
  }

  // POST /api/auth/signup — self-service tenant signup (MT only, opt-in)
  app.post("/api/auth/signup", validate(SignupSchema), async (req, res) => {
    if (process.env.MULTI_TENANT !== "1") {
      return res.status(400).json({ error: "Signup is only available in multi-tenant mode" });
    }
    if (process.env.SELF_SERVICE_SIGNUP !== "1") {
      return res.status(400).json({ error: "Self-service signup is not enabled" });
    }

    const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
    if (!checkSignupRate(clientIp)) {
      return res.status(429).json({ error: "Too many signup attempts. Please try again in an hour." });
    }

    const { store_name, owner_name, email, password } = req.body;

    const slug = store_name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 30);

    if (slug.length < 3) {
      return res.status(400).json({ error: "Store name too short (need at least 3 valid characters)" });
    }

    try {
      const masterDb = require("../master-db-pg");
      const { rows: existing } = await masterDb.query("SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL", [slug]);
      if (existing.length) return res.status(409).json({ error: "Store name already taken" });

      // Provision tenant using shared db pool
      const dbPg = require("../db-pg");
      const { provision } = require("../tenant-provisioner-pg");
      const result = await provision(dbPg, { slug, name: store_name, ownerEmail: email, pin: "0000", timezone: "UTC" });

      // Free-forever: every signup lands on the Free plan with active status
      // and no trial clock. Pro is reached via /billing upgrade flow.
      const { PLAN_DEFAULTS } = require("../middleware/plan-limits");
      const limits = PLAN_DEFAULTS.free;

      // PR 8: gate setup-complete on email verification. Generate a fresh
      // verification token; the merchant follows the link in their email,
      // we mark email_verified_at, and only THEN do we hand back the
      // setupToken so they can hit the wizard.
      const verificationToken = crypto.randomUUID();

      await masterDb.query(
        `UPDATE tenants SET plan = 'free', max_outlets = $1, max_employees = $2, max_products = $3,
                            trial_ends_at = NULL, payment_status = 'active',
                            email_verified_at = NULL, email_verification_token = $4
         WHERE id = $5`,
        [limits.max_outlets, limits.max_employees, limits.max_products, verificationToken, result.tenantId]
      );

      // Update the admin employee with password and email
      const tenantDbManager = require("../tenant-db-manager-pg");
      const tenantDb = await tenantDbManager.getDb(result.tenantId);
      const passwordHash = await bcrypt.hash(password, 10);
      await tenantDb.query(
        "UPDATE employees SET name = $1, email = $2, password_hash = $3 WHERE id = $4",
        [owner_name, email, passwordHash, result.employeeId]
      );

      // Send verification email (replaces the previous welcome-with-setup-link).
      // The setup link is intentionally NOT in this email — it's handed out by
      // /api/auth/verify-email after the merchant clicks the verify link.
      if (process.env.RESEND_API_KEY) {
        try {
          const { sendVerifyEmail } = require("../utils/resendEmail");
          const corsOrigin = process.env.CORS_ORIGIN?.split(",")[0] || "https://sanopos.com";
          const verifyUrl = `${corsOrigin}/verify-email?token=${verificationToken}&tenant=${slug}`;
          await sendVerifyEmail({
            toEmail: email,
            ownerName: owner_name,
            storeName: store_name,
            verifyUrl,
          });
        } catch (emailErr) {
          console.error("Verify email failed:", emailErr.message);
        }
      }

      // Enqueue onboarding drip emails
      try {
        const { enqueueEmail } = require("../services/email");
        const dbPg = require("../db-pg");
        const corsOrigin = process.env.CORS_ORIGIN?.split(",")[0] || "https://sanopos.com";
        const dripData = { storeName: store_name, slug, frontendUrl: corsOrigin };

        const day2 = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        const day5 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

        await enqueueEmail(dbPg, {
          tenantId: result.tenantId,
          type: "drip_getting_started",
          to: email,
          tenant: { slug, name: store_name },
          data: dripData,
          sendAt: day2,
        });
        await enqueueEmail(dbPg, {
          tenantId: result.tenantId,
          type: "drip_features",
          to: email,
          tenant: { slug, name: store_name },
          data: dripData,
          sendAt: day5,
        });
      } catch (dripErr) {
        console.error("Drip email enqueue failed:", dripErr.message);
      }

      // PR 8: do NOT return setupToken yet — frontend shows "Check your email"
      // screen and the merchant only gets the setup token after verifying.
      res.json({
        ok: true,
        slug,
        email,
        verification_required: true,
        message: "Store created. Please check your email to verify your address.",
      });
    } catch (err) {
      console.error("[signup]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/auth/verify-email — exchange verification token for setup token
  // Body: { token, tenant }
  // On success, marks email_verified_at + clears email_verification_token,
  // and returns { setupToken, slug } so the wizard can pick up where signup
  // left off. Idempotent only on first success — re-using the same token
  // returns 404 (already-consumed tokens are wiped).
  app.post("/api/auth/verify-email", async (req, res) => {
    if (process.env.MULTI_TENANT !== "1") {
      return res.status(400).json({ error: "Email verification is only used in multi-tenant mode" });
    }
    const { token, tenant: slug } = req.body || {};
    if (!token || !slug) {
      return res.status(400).json({ error: "token and tenant are required" });
    }
    try {
      const masterDb = require("../master-db-pg");
      const { rows: [tenant] } = await masterDb.query(
        `SELECT id, slug, status FROM tenants
         WHERE slug = $1 AND email_verification_token = $2 AND deleted_at IS NULL`,
        [String(slug).trim(), String(token).trim()]
      );
      if (!tenant) {
        return res.status(404).json({ error: "Verification link is invalid or has already been used." });
      }
      if (tenant.status !== "active") {
        return res.status(403).json({ error: "Tenant is not active" });
      }

      // Mark verified + clear token (one-shot use)
      await masterDb.query(
        `UPDATE tenants
            SET email_verified_at = NOW(),
                email_verification_token = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [tenant.id]
      );

      // Read the freshly-issued setupToken from the tenant's company_profile.
      // This was set by tenant-provisioner during signup with a 48h TTL.
      const tenantDbManager = require("../tenant-db-manager-pg");
      const tenantDb = await tenantDbManager.getDb(tenant.id);
      const { rows: [profile] } = await tenantDb.query(
        "SELECT setup_token, setup_token_expires_at, setup_complete FROM company_profile WHERE id = 1"
      );
      if (!profile) {
        return res.status(500).json({ error: "Tenant setup record missing" });
      }
      if (profile.setup_complete) {
        // Already finished setup — direct them to login instead of wizard
        return res.json({ ok: true, slug: tenant.slug, setup_complete: true });
      }
      if (!profile.setup_token) {
        return res.status(410).json({ error: "Setup link no longer available. Please request a new one." });
      }
      if (profile.setup_token_expires_at && new Date(profile.setup_token_expires_at) < new Date()) {
        return res.status(410).json({ error: "Your setup link has expired. Please request a new one." });
      }

      return res.json({
        ok: true,
        slug: tenant.slug,
        setupToken: profile.setup_token,
      });
    } catch (err) {
      console.error("[verify-email]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { rows: [employee] } = await db.query(
        `SELECT e.id, e.name, e.role_id, e.home_page, r.name as role, NULL as outlet_id
         FROM employees e
         LEFT JOIN roles r ON e.role_id = r.id
         WHERE e.id = $1`,
        [employeeId]
      );
      if (!employee) return res.status(401).json({ error: "Unauthorized" });

      const { rows } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1",
        [employee.role_id || 3]
      );

      return res.json({
        employee: {
          id: employee.id,
          name: employee.name,
          role_id: employee.role_id,
          outlet_id: employee.outlet_id || null,
          // 2-G.16 Merchant home: landing preference, null=default (/dashboard)
          home_page: employee.home_page || null,
        },
        permissions: (rows || []).map((r) => r.permission),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
