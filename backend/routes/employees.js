module.exports = function registerEmployeeRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requirePlanLimit } = deps;
  const bcrypt = require("bcryptjs");
  const { pinTakenByOther, PIN_TAKEN } = require("../services/staff-pin");
  const { validate } = require("../middleware/validate");
  const { pinValidateLimiter } = require("../middleware/rate-limit");
  const { ValidatePinSchema, CreateEmployeeSchema, SetPasswordSchema, ChangePasswordSchema, ChangePinSchema } = require("../schemas/employees");
  const EMPLOYEE_USAGE_CHECKS = [
    ["sales", "employee_id"],
    ["returns", "employee_id"],
    ["cash_shifts", "employee_id"],
    ["employee_attendance", "employee_id"],
    ["attendance_sessions", "employee_id"],
    ["inventory_transfers", "employee_id"],
    ["stock_adjustments", "employee_id"],
    ["supplier_returns", "employee_id"],
    ["goods_received_notes", "received_by"],
    ["quotations", "employee_id"],
    ["crm_activities", "employee_id"],
    ["crm_leads", "assigned_to"],
    ["leave_requests", "employee_id"],
    ["leave_requests", "approved_by"],
    ["payroll_lines", "employee_id"],
    ["payroll_periods", "created_by"],
    ["accounting_periods", "closed_by"],
  ];

  const getEmployeeUsage = async (employeeId) => {
    const refs = [];
    for (const [table, column] of EMPLOYEE_USAGE_CHECKS) {
      try {
        const { rows } = await db.query(
          `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = $1`,
          [employeeId],
        );
        const count = Number(rows[0]?.count || 0);
        if (count > 0) refs.push({ table, column, count });
      } catch {
        // Table may not exist in test schemas — skip
      }
    }
    return refs;
  };

  // Get all employees
  // C1 (role audit) — manage_employees, not all_access: Managers hold
  // manage_employees by default and ~21 pages feed their staff dropdowns
  // from this list; the all_access guard blanked them all.
  app.get("/api/employees", requireAnyPerm(["manage_employees", "all_access"]), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT e.id, e.name, e.pin_code, e.email, e.password_hash IS NOT NULL as has_password,
                e.salary_type, e.monthly_salary, e.hourly_rate, e.daily_rate, e.work_hours_per_day, e.home_staff,
                e.employee_type,
                r.name as role, e.role_id
         FROM employees e LEFT JOIN roles r ON e.role_id = r.id
         WHERE e.deleted_at IS NULL ORDER BY e.name ASC`,
      );
      res.json({ employees: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Validate PIN (For POS Login)
  app.post("/api/employees/validate-pin", pinValidateLimiter, validate(ValidatePinSchema), async (req, res) => {
    const { pin_code } = req.body;

    try {
      const { rows: employees } = await db.query(
        "SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, r.name as role FROM employees e LEFT JOIN roles r ON e.role_id = r.id WHERE e.deleted_at IS NULL",
      );

      for (const emp of employees) {
        let match = false;
        if (emp.pin_hash) {
          match = await bcrypt.compare(String(pin_code), emp.pin_hash);
        } else if (emp.pin_code) {
          match = String(pin_code) === String(emp.pin_code);
        }
        if (match) {
          return res.json({ employee: { id: emp.id, name: emp.name, role_id: emp.role_id, role: emp.role } });
        }
      }
      return res.status(401).json({ error: "Invalid PIN" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Add a new employee
  app.post("/api/employees", requirePerm("all_access"), requirePlanLimit("employees"), validate(CreateEmployeeSchema), async (req, res) => {
    const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate, email, password, home_staff } = req.body;
    try {
      // The kiosk finds the person by PIN alone: one PIN, one person.
      if (pin_code && await pinTakenByOther(db, pin_code)) return res.status(409).json(PIN_TAKEN);
      const pin_hash = pin_code ? await bcrypt.hash(String(pin_code), 10) : null;
      const password_hash = password ? await bcrypt.hash(String(password), 10) : null;
      const { rows } = await db.query(
        "INSERT INTO employees (name, role_id, pin_hash, salary_type, monthly_salary, hourly_rate, daily_rate, email, password_hash, home_staff) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
        [name, role_id || 3, pin_hash, salary_type || "monthly", Number(monthly_salary || 0), Number(hourly_rate || 0), Number(daily_rate || 0), email || null, password_hash, home_staff === true],
      );
      const newId = rows[0].id;
      // Auto-assign new employee to all active outlets
      await db.query(
        `INSERT INTO employee_outlets (employee_id, outlet_id, is_primary)
         SELECT $1, o.id, CASE WHEN o.id = (SELECT MIN(id) FROM outlets WHERE is_active = true) THEN true ELSE false END
         FROM outlets o WHERE o.is_active = true
         ON CONFLICT DO NOTHING`,
        [newId],
      );
      res.json({ id: newId, name, role_id });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "PIN code must be unique" });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Update an employee
  app.put("/api/employees/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate, email, home_staff } = req.body;
    const perms = req.employeePerms || [];
    const isAdmin = perms.includes("all_access");

    // Block self-role changes (only if actually changing the role, not re-sending same value)
    if (role_id !== undefined && String(id) === String(req.headers["x-employee-id"])) {
      // Look up current role to see if it's actually changing
      const { rows: [current] } = await db.query("SELECT role_id FROM employees WHERE id = $1", [id]);
      if (current && Number(role_id) !== Number(current.role_id)) {
        return res.status(403).json({ error: "You cannot change your own role." });
      }
    }

    // Only admin can assign the Administrator role (role_id 1)
    if (role_id !== undefined && Number(role_id) === 1 && !isAdmin) {
      return res.status(403).json({ error: "Only an Administrator can assign the Administrator role." });
    }

    try {
      let paramIdx = 1;
      let query =
        `UPDATE employees SET name = COALESCE($${paramIdx++}, name), role_id = COALESCE($${paramIdx++}, role_id), salary_type = COALESCE($${paramIdx++}, salary_type), monthly_salary = COALESCE($${paramIdx++}, monthly_salary), hourly_rate = COALESCE($${paramIdx++}, hourly_rate), daily_rate = COALESCE($${paramIdx++}, daily_rate)`;
      let params = [name, role_id, salary_type, monthly_salary != null ? Number(monthly_salary) : null, hourly_rate != null ? Number(hourly_rate) : null, daily_rate != null ? Number(daily_rate) : null];

      if (pin_code !== undefined && pin_code !== "") {
        if (await pinTakenByOther(db, pin_code, id)) return res.status(409).json(PIN_TAKEN);
        const pin_hash = await bcrypt.hash(String(pin_code), 10);
        query += `, pin_hash = $${paramIdx++}`;
        params.push(pin_hash);
      }

      if (email !== undefined) {
        query += `, email = $${paramIdx++}`;
        params.push(email === "" ? null : email);
      }

      // F4b: works for the owner's home (salary booked as Owner / home).
      if (typeof home_staff === "boolean") {
        query += `, home_staff = $${paramIdx++}`;
        params.push(home_staff);
      }

      query += ` WHERE id = $${paramIdx++}`;
      params.push(id);

      const { rowCount } = await db.query(query, params);
      if (rowCount === 0) return res.status(404).json({ error: "Employee not found" });
      res.json({ message: "Employee updated successfully" });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "PIN code must be unique" });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // --- Employee-outlet assignments ---

  // Get assigned outlets for an employee (role_id/role_name per row are the
  // Step 13 per-outlet overrides; null = inherit base_role_id)
  app.get("/api/employees/:id/outlets", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: [emp] } = await db.query(
        "SELECT role_id FROM employees WHERE id = $1", [id],
      );
      const { rows } = await db.query(
        `SELECT eo.outlet_id, o.name, o.branch_code, o.company_id, eo.is_primary,
                eo.role_id, r.name AS role_name
         FROM employee_outlets eo
         JOIN outlets o ON o.id = eo.outlet_id
         LEFT JOIN roles r ON r.id = eo.role_id
         WHERE eo.employee_id = $1
         ORDER BY o.name`,
        [id],
      );
      res.json({ outlets: rows || [], base_role_id: emp ? emp.role_id : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk-replace outlet assignments for an employee. Optional outlet_roles
  // map (outlet_id → role_id) sets per-outlet role overrides (Step 13);
  // null/omitted entries inherit the employee's base role.
  app.put("/api/employees/:id/outlets", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { outlet_ids, primary_outlet_id, outlet_roles } = req.body || {};

    if (!Array.isArray(outlet_ids) || outlet_ids.length === 0) {
      return res.status(400).json({ error: "outlet_ids must be a non-empty array" });
    }

    const numericIds = outlet_ids.map(Number).filter((n) => n > 0);
    if (numericIds.length === 0) {
      return res.status(400).json({ error: "No valid outlet IDs provided" });
    }

    // Normalize + validate the override map before touching the DB.
    const roleByOutlet = new Map();
    if (outlet_roles != null) {
      if (typeof outlet_roles !== "object" || Array.isArray(outlet_roles)) {
        return res.status(400).json({ error: "outlet_roles must be an object map of outlet_id to role_id" });
      }
      for (const [key, value] of Object.entries(outlet_roles)) {
        const outletId = Number(key);
        if (!numericIds.includes(outletId)) {
          return res.status(400).json({ error: "outlet_roles references an unassigned outlet" });
        }
        if (value == null) continue; // explicit null = inherit
        const roleId = Number(value);
        if (!Number.isSafeInteger(roleId) || roleId <= 0) {
          return res.status(400).json({ error: "Unknown role_id" });
        }
        roleByOutlet.set(outletId, roleId);
      }
    }

    const primaryId = primary_outlet_id ? Number(primary_outlet_id) : numericIds[0];

    try {
      const { rows: empRows } = await db.query(
        "SELECT role_id FROM employees WHERE id = $1",
        [id],
      );
      if (!empRows.length)
        return res.status(404).json({ error: "Employee not found" });

      // Multi-outlet assignment is legal for every role (PLAN-V2 Step 13).
      // The old "Manager/Cashier = exactly one outlet" rule existed to stop a
      // branch-fixed role from acting in other branches; that intent is now
      // enforced properly by outlet-assignment enforcement (outlet-context.js)
      // — a non-all_access employee can only act in outlets they're assigned
      // to, and acts there under that outlet's effective role (override or
      // inherited base). A per-outlet override is scoping, not a demotion; to
      // hard-demote an employee everywhere, change the base role.

      if (roleByOutlet.size > 0) {
        const roleIds = [...new Set(roleByOutlet.values())];
        const { rows: roleRows } = await db.query(
          "SELECT id FROM roles WHERE id = ANY($1::int[])", [roleIds],
        );
        if (roleRows.length !== roleIds.length) {
          return res.status(400).json({ error: "Unknown role_id" });
        }
      }

      await db.transaction(async (client) => {
        await client.query("DELETE FROM employee_outlets WHERE employee_id = $1", [id]);
        for (const outletId of numericIds) {
          await client.query(
            "INSERT INTO employee_outlets (employee_id, outlet_id, is_primary, role_id) VALUES ($1, $2, $3, $4)",
            [id, outletId, outletId === primaryId, roleByOutlet.get(outletId) ?? null],
          );
        }
      });

      res.json({
        message: "Outlet assignments updated",
        outlet_ids: numericIds,
        primary_outlet_id: primaryId,
        outlet_roles: Object.fromEntries(roleByOutlet),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Archive an employee (soft delete)
  app.delete("/api/employees/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const actorId = Number(req.headers["x-employee-id"] || 0);
    const targetId = Number(id);

    if (targetId > 0 && actorId === targetId) {
      return res.status(400).json({ error: "You cannot delete your own account." });
    }

    try {
      const { rowCount } = await db.query(
        "UPDATE employees SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        [targetId],
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Employee not found" });
      res.json({ message: "Employee archived" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Revoke a specific token by JTI (multi-tenant JWT only)
  app.post("/api/employees/:id/revoke-token", requireAnyPerm(["manage_employees", "all_access"]), async (req, res) => {
    const { id } = req.params;
    const { jti, reason } = req.body || {};
    if (!jti) return res.status(400).json({ error: "jti is required" });

    const revokedBy = Number(req.headers["x-employee-id"] || 0);

    try {
      await db.query(
        "INSERT INTO revoked_tokens (token_jti, employee_id, revoked_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [jti, Number(id), revokedBy, reason || null],
      );

      // Cleanup expired entries older than 2 days
      await db.query(
        "DELETE FROM revoked_tokens WHERE revoked_at < NOW() - INTERVAL '2 days'",
      );

      res.json({ message: "Token revoked", token_jti: jti });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Revoke all tokens for an employee (blanket revocation)
  app.post("/api/employees/:id/revoke-all-tokens", requireAnyPerm(["manage_employees", "all_access"]), async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};

    try {
      const { rowCount } = await db.query(
        "UPDATE employees SET tokens_revoked_before = NOW() WHERE id = $1",
        [Number(id)],
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Employee not found" });

      // Log to action_history
      const revokedBy = Number(req.headers["x-employee-id"] || 0);
      try {
        await db.query(
          `INSERT INTO action_history (action_type, entity_type, entity_id, employee_id, description)
           VALUES ('token_revocation', 'employee', $1, $2, $3)`,
          [Number(id), revokedBy, `All sessions revoked${reason ? ": " + reason : ""}`],
        );
      } catch { /* ignore if table doesn't exist */ }

      res.json({ message: "All tokens revoked for employee" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/employees/:id/set-password — admin sets password for an employee
  app.put("/api/employees/:id/set-password", requirePerm("all_access"), validate(SetPasswordSchema), async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    try {
      const password_hash = await bcrypt.hash(String(password), 10);
      const { rowCount } = await db.query(
        "UPDATE employees SET password_hash = $1 WHERE id = $2 AND deleted_at IS NULL",
        [password_hash, Number(id)]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Employee not found" });

      const actorId = Number(req.headers["x-employee-id"] || 0);
      try {
        await db.query(
          `INSERT INTO action_history (action_type, entity_type, entity_id, employee_id, description)
           VALUES ('password_set', 'employee', $1, $2, $3)`,
          [Number(id), actorId, `Password set for employee #${id}`]
        );
      } catch { /* best-effort */ }

      res.json({ message: "Password set successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/employees/:id/change-password — employee changes own password
  app.put("/api/employees/:id/change-password", validate(ChangePasswordSchema), async (req, res) => {
    const { id } = req.params;
    const actorId = Number(req.headers["x-employee-id"] || 0);

    if (actorId !== Number(id)) {
      return res.status(403).json({ error: "You can only change your own password" });
    }

    const { current_password, pin, new_password } = req.body;

    try {
      const { rows: [employee] } = await db.query(
        "SELECT id, password_hash, pin_hash, pin_code FROM employees WHERE id = $1 AND deleted_at IS NULL",
        [Number(id)]
      );
      if (!employee) return res.status(404).json({ error: "Employee not found" });

      let verified = false;
      if (current_password && employee.password_hash) {
        verified = await bcrypt.compare(String(current_password), employee.password_hash);
      } else if (pin) {
        if (employee.pin_hash) {
          verified = await bcrypt.compare(String(pin), employee.pin_hash);
        } else if (employee.pin_code) {
          verified = String(pin).trim() === String(employee.pin_code).trim();
        }
      }
      if (!verified) {
        return res.status(401).json({ error: "Current credentials are incorrect" });
      }

      const password_hash = await bcrypt.hash(String(new_password), 10);
      await db.query(
        "UPDATE employees SET password_hash = $1 WHERE id = $2",
        [password_hash, Number(id)]
      );

      res.json({ message: "Password changed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/employees/:id/change-pin — employee changes own PIN
  app.put("/api/employees/:id/change-pin", validate(ChangePinSchema), async (req, res) => {
    const { id } = req.params;
    const actorId = Number(req.headers["x-employee-id"] || 0);
    if (actorId !== Number(id)) {
      return res.status(403).json({ error: "You can only change your own PIN" });
    }

    const { current_pin, new_pin } = req.body;

    try {
      const { rows: [employee] } = await db.query(
        "SELECT id, pin_hash, pin_code FROM employees WHERE id = $1 AND deleted_at IS NULL",
        [Number(id)]
      );
      if (!employee) return res.status(404).json({ error: "Employee not found" });

      let verified = false;
      if (employee.pin_hash) {
        verified = await bcrypt.compare(String(current_pin), employee.pin_hash);
      } else if (employee.pin_code) {
        verified = String(current_pin).trim() === String(employee.pin_code).trim();
      }
      if (!verified) {
        return res.status(401).json({ error: "Current PIN is incorrect" });
      }

      if (await pinTakenByOther(db, new_pin, id)) return res.status(409).json(PIN_TAKEN);
      const pin_hash = await bcrypt.hash(String(new_pin), 10);
      await db.query(
        "UPDATE employees SET pin_hash = $1 WHERE id = $2",
        [pin_hash, Number(id)]
      );

      res.json({ message: "PIN changed successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2-G.16 Merchant home: self-service preferences — where the employee
  // lands on login. Writes to employees.home_page (added in v75). Any
  // authenticated employee can read/write their own row; no admin perm.
  app.get("/api/employees/me/preferences", async (req, res) => {
    const actorId = Number(req.headers["x-employee-id"] || 0);
    if (!actorId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const { rows } = await db.query(
        "SELECT home_page FROM employees WHERE id = $1 AND deleted_at IS NULL",
        [actorId],
      );
      if (!rows.length) return res.status(404).json({ error: "Employee not found" });
      res.json({ home_page: rows[0].home_page || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/employees/me/preferences", async (req, res) => {
    const actorId = Number(req.headers["x-employee-id"] || 0);
    if (!actorId) return res.status(401).json({ error: "Not authenticated" });
    const raw = req.body?.home_page;
    const home_page = raw == null || raw === "" ? null : String(raw);
    // Narrow allowlist — silently reject anything else so a malformed call
    // can't write arbitrary strings into an unbounded column.
    if (home_page != null && !["dashboard", "retail_home"].includes(home_page)) {
      return res.status(400).json({ error: "home_page must be 'dashboard', 'retail_home', or null" });
    }
    try {
      await db.query(
        "UPDATE employees SET home_page = $1 WHERE id = $2 AND deleted_at IS NULL",
        [home_page, actorId],
      );
      res.json({ home_page });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/employees/:id/send-reset — admin sends password reset email
  app.post("/api/employees/:id/send-reset", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const crypto = require("crypto");

    try {
      const { rows: [employee] } = await db.query(
        "SELECT id, name, email FROM employees WHERE id = $1 AND deleted_at IS NULL",
        [Number(id)]
      );
      if (!employee) return res.status(404).json({ error: "Employee not found" });
      if (!employee.email) return res.status(400).json({ error: "Employee has no email address set" });

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await db.query(
        "INSERT INTO password_reset_tokens (employee_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [employee.id, tokenHash, expiresAt]
      );

      const frontendUrl = process.env.CORS_ORIGIN?.split(",")[0] || "http://localhost:5173";
      let resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

      let storeName = "SanoPOS";
      try {
        const { rows: [co] } = await db.query("SELECT company_name FROM company_profile WHERE id = 1");
        if (co?.company_name) storeName = co.company_name;
      } catch { /* best-effort */ }

      if (process.env.MULTI_TENANT === "1" && req.tenantSlug) {
        resetLink += `&tenant=${req.tenantSlug}`;
      }

      const { sendPasswordResetEmail } = require("../utils/resendEmail");
      await sendPasswordResetEmail({
        toEmail: employee.email,
        employeeName: employee.name,
        resetLink,
        storeName,
      });

      const actorId = Number(req.headers["x-employee-id"] || 0);
      try {
        await db.query(
          `INSERT INTO action_history (action_type, entity_type, entity_id, employee_id, description)
           VALUES ('password_reset_sent', 'employee', $1, $2, $3)`,
          [Number(id), actorId, `Password reset email sent to ${employee.email}`]
        );
      } catch { /* best-effort */ }

      res.json({ message: `Password reset email sent to ${employee.email}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
