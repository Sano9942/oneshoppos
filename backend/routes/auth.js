module.exports = function registerAuthRoutes(app, deps) {
  const { db, authLimiter } = deps;
  const bcrypt = require("bcryptjs");

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { username, pin } = req.body || {};
    if (!username || !pin) {
      return res.status(400).json({ error: "username and pin are required" });
    }

    try {
      const { rows: [employee] } = await db.query(
        `SELECT e.id, e.name, e.role_id, e.pin_code, e.pin_hash, r.name as role, NULL as outlet_id
         FROM employees e
         LEFT JOIN roles r ON e.role_id = r.id
         WHERE LOWER(e.name) = LOWER($1)`,
        [String(username).trim()]
      );

      if (!employee) {
        return res.status(401).json({ error: "Invalid username or PIN" });
      }

      // Verify PIN: prefer pin_hash (bcrypt), fall back to plaintext pin_code
      let pinValid = false;
      if (employee.pin_hash) {
        pinValid = await bcrypt.compare(String(pin).trim(), employee.pin_hash);
      } else if (employee.pin_code) {
        pinValid = String(pin).trim() === String(employee.pin_code).trim();
      }

      if (!pinValid) {
        return res.status(401).json({ error: "Invalid username or PIN" });
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

    // POST /api/auth/mt-login — standard login with tenant slug + username + PIN
    app.post("/api/auth/mt-login", authLimiter, async (req, res) => {
      const { tenant_slug, username, pin } = req.body || {};
      if (!tenant_slug || !username || !pin) {
        return res.status(400).json({ error: "tenant_slug, username, and pin are required" });
      }
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
          `SELECT e.id, e.name, e.role_id, e.pin_hash
           FROM employees e
           WHERE LOWER(e.name) = LOWER($1)`,
          [String(username).trim()]
        );
        if (!employee) {
          return res.status(401).json({ error: "Invalid username or PIN" });
        }

        // 3. Verify PIN via bcrypt
        let pinValid = false;
        if (employee.pin_hash) {
          pinValid = await bcrypt.compare(String(pin).trim(), employee.pin_hash);
        }
        if (!pinValid) {
          return res.status(401).json({ error: "Invalid username or PIN" });
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
    app.post("/api/auth/kiosk-login", authLimiter, async (req, res) => {
      const { tenant_slug, pin } = req.body || {};
      if (!tenant_slug || !pin) {
        return res.status(400).json({ error: "tenant_slug and pin are required" });
      }
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

  app.get("/api/auth/me", async (req, res) => {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { rows: [employee] } = await db.query(
        `SELECT e.id, e.name, e.role_id, r.name as role, NULL as outlet_id
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
        },
        permissions: (rows || []).map((r) => r.permission),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
