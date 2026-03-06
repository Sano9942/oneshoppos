module.exports = function registerAuthRoutes(app, deps) {
  const { db, authLimiter } = deps;
  const bcrypt = require("bcryptjs");

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { username, pin } = req.body || {};
    if (!username || !pin) {
      return res.status(400).json({ error: "username and pin are required" });
    }

    try {
      const employee = await new Promise((resolve, reject) => {
        db.get(
          `SELECT e.id, e.name, e.role_id, e.pin_code, e.pin_hash, r.name as role, NULL as outlet_id
           FROM employees e
           LEFT JOIN roles r ON e.role_id = r.id
           WHERE LOWER(e.name) = LOWER(?)`,
          [String(username).trim()],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

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

      const permissions = await new Promise((resolve, reject) => {
        db.all(
          "SELECT permission FROM role_permissions WHERE role_id = ?",
          [employee.role_id || 3],
          (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.permission)))
        );
      });

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
        const { getMasterDb } = require("../master-db");
        const { hashToken } = require("../jwt-auth");
        const masterDb = getMasterDb();

        // Revoke by cookie token hash if present
        const refreshToken = req.cookies?.refreshToken;
        if (refreshToken) {
          const tokenHash = hashToken(refreshToken);
          await new Promise((resolve) => {
            masterDb.run(
              "UPDATE tenant_refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL",
              [tokenHash],
              resolve
            );
          });
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
  app.get("/api/context/bootstrap", (req, res) => {
    const employeeId = req.headers["x-employee-id"];
    if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

    db.get(
      `SELECT e.id, e.name, e.role_id, r.name AS role_name
       FROM employees e LEFT JOIN roles r ON e.role_id = r.id
       WHERE e.id = ?`,
      [employeeId],
      (err, emp) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!emp) return res.status(401).json({ error: "Employee not found" });

        // Check if admin (role_id 1 = Administrator, or has all_access)
        db.all(
          "SELECT permission FROM role_permissions WHERE role_id = ?",
          [emp.role_id],
          (permErr, permRows) => {
            if (permErr) return res.status(500).json({ error: permErr.message });
            const perms = (permRows || []).map((r) => r.permission);
            const isAdmin = perms.includes("all_access");

            // Get companies
            db.all(
              "SELECT id, name, code FROM companies WHERE is_active = 1",
              [],
              (cErr, companies) => {
                if (cErr) return res.status(500).json({ error: cErr.message });

                // Get outlets: admin sees all active, others see assigned only
                const outletQuery = isAdmin
                  ? `SELECT id, name, address, company_id, branch_code FROM outlets WHERE is_active = 1 ORDER BY name`
                  : `SELECT o.id, o.name, o.address, o.company_id, o.branch_code
                     FROM outlets o
                     JOIN employee_outlets eo ON eo.outlet_id = o.id
                     WHERE eo.employee_id = ? AND o.is_active = 1
                     ORDER BY o.name`;
                const outletParams = isAdmin ? [] : [employeeId];

                db.all(outletQuery, outletParams, (oErr, outlets) => {
                  if (oErr) return res.status(500).json({ error: oErr.message });

                  // Get primary outlet
                  db.get(
                    "SELECT outlet_id FROM employee_outlets WHERE employee_id = ? AND is_primary = 1",
                    [employeeId],
                    (pErr, primary) => {
                      if (pErr) return res.status(500).json({ error: pErr.message });

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
                    },
                  );
                });
              },
            );
          },
        );
      },
    );
  });

  // --- Multi-tenant JWT endpoints (only active when MULTI_TENANT=1) ---
  if (process.env.MULTI_TENANT === "1") {
    const { signAccessToken, signRefreshToken, verifyRefreshToken, verifyAccessToken, hashToken } = require("../jwt-auth");
    const jwtLib = require("jsonwebtoken");
    const { getMasterDb } = require("../master-db");

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
        const masterDb = getMasterDb();

        // 1. Look up tenant by slug
        const tenant = await new Promise((resolve, reject) => {
          masterDb.get(
            "SELECT id, slug, name, status FROM tenants WHERE slug = ? AND status = 'active'",
            [String(tenant_slug).trim()],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
        if (!tenant) {
          return res.status(401).json({ error: "Invalid store code" });
        }

        // 2. Find employee in tenant DB by username
        const employee = await new Promise((resolve, reject) => {
          db.get(
            `SELECT e.id, e.name, e.role_id, e.pin_hash
             FROM employees e
             WHERE LOWER(e.name) = LOWER(?)`,
            [String(username).trim()],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
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
        const permissions = await new Promise((resolve, reject) => {
          db.all(
            "SELECT permission FROM role_permissions WHERE role_id = ?",
            [employee.role_id || 3],
            (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.permission)))
          );
        });

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
        await new Promise((resolve, reject) => {
          masterDb.run(
            "INSERT INTO tenant_refresh_tokens (tenant_id, employee_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
            [tenant.id, employee.id, tokenHash, expiresAt],
            (err) => (err ? reject(err) : resolve())
          );
        });

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
        const masterDb = getMasterDb();
        const tokenHash = hashToken(refreshToken);
        const storedToken = await new Promise((resolve, reject) => {
          masterDb.get(
            "SELECT * FROM tenant_refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL",
            [tokenHash],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
        if (!storedToken) {
          return res.status(401).json({ error: "Refresh token invalid or revoked" });
        }

        // 3. Check tenant is still active
        const tenant = await new Promise((resolve, reject) => {
          masterDb.get(
            "SELECT status FROM tenants WHERE id = ?",
            [decoded.tid],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
        if (!tenant || tenant.status !== "active") {
          return res.status(403).json({ error: "Account suspended. Contact support." });
        }

        // 4. Load employee role for new token
        const employee = await new Promise((resolve, reject) => {
          db.get(
            "SELECT id, role_id FROM employees WHERE id = ?",
            [decoded.eid],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
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
        const masterDb = getMasterDb();

        // 1. Look up tenant
        const tenant = await new Promise((resolve, reject) => {
          masterDb.get(
            "SELECT id, slug, name, status FROM tenants WHERE slug = ? AND status = 'active'",
            [String(tenant_slug).trim()],
            (err, row) => (err ? reject(err) : resolve(row))
          );
        });
        if (!tenant) {
          return res.status(401).json({ error: "Invalid store code" });
        }

        // 2. Scan all employees, compare PIN via bcrypt
        const employees = await new Promise((resolve, reject) => {
          db.all(
            "SELECT id, name, role_id, pin_hash FROM employees",
            [],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });

        let matched = null;
        for (const emp of employees) {
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
            if (permErr)
              return res.status(500).json({ error: permErr.message });
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
};
