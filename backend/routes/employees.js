module.exports = function registerEmployeeRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm } = deps;
  const bcrypt = require("bcryptjs");
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
  app.get("/api/employees", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT e.id, e.name, e.pin_code, e.salary_type, e.monthly_salary, e.hourly_rate, e.daily_rate, e.work_hours_per_day, r.name as role, e.role_id FROM employees e LEFT JOIN roles r ON e.role_id = r.id WHERE e.deleted_at IS NULL ORDER BY e.name ASC",
      );
      res.json({ employees: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Validate PIN (For POS Login)
  app.post("/api/employees/validate-pin", async (req, res) => {
    const { pin_code } = req.body;
    if (!pin_code) return res.status(400).json({ error: "pin_code is required" });

    try {
      const { rows: employees } = await db.query(
        "SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, r.name as role FROM employees e LEFT JOIN roles r ON e.role_id = r.id",
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
  app.post("/api/employees", requirePerm("all_access"), async (req, res) => {
    const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate } = req.body;
    try {
      const pin_hash = pin_code ? await bcrypt.hash(String(pin_code), 10) : null;
      const { rows } = await db.query(
        "INSERT INTO employees (name, role_id, pin_code, pin_hash, salary_type, monthly_salary, hourly_rate, daily_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [name, role_id || 3, pin_code, pin_hash, salary_type || "monthly", Number(monthly_salary || 0), Number(hourly_rate || 0), Number(daily_rate || 0)],
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
    const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate } = req.body;
    const perms = req.employeePerms || [];
    const isAdmin = perms.includes("all_access");

    // Block self-role changes
    if (role_id !== undefined && String(id) === String(req.headers["x-employee-id"])) {
      return res.status(403).json({ error: "You cannot change your own role." });
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
        const pin_hash = await bcrypt.hash(String(pin_code), 10);
        query += `, pin_code = $${paramIdx++}, pin_hash = $${paramIdx++}`;
        params.push(pin_code, pin_hash);
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

  // Get assigned outlets for an employee
  app.get("/api/employees/:id/outlets", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await db.query(
        `SELECT eo.outlet_id, o.name, o.branch_code, o.company_id, eo.is_primary
         FROM employee_outlets eo
         JOIN outlets o ON o.id = eo.outlet_id
         WHERE eo.employee_id = $1
         ORDER BY o.name`,
        [id],
      );
      res.json({ outlets: rows || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk-replace outlet assignments for an employee
  app.put("/api/employees/:id/outlets", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { outlet_ids, primary_outlet_id } = req.body || {};

    if (!Array.isArray(outlet_ids) || outlet_ids.length === 0) {
      return res.status(400).json({ error: "outlet_ids must be a non-empty array" });
    }

    const numericIds = outlet_ids.map(Number).filter((n) => n > 0);
    if (numericIds.length === 0) {
      return res.status(400).json({ error: "No valid outlet IDs provided" });
    }

    const primaryId = primary_outlet_id ? Number(primary_outlet_id) : numericIds[0];

    try {
      const { rows: empRows } = await db.query(
        "SELECT role_id FROM employees WHERE id = $1",
        [id],
      );
      if (!empRows.length)
        return res.status(404).json({ error: "Employee not found" });

      // Manager/Cashier are branch-fixed by policy: exactly one outlet.
      if ([2, 3].includes(Number(empRows[0].role_id)) && numericIds.length !== 1) {
        return res.status(400).json({
          error: "Manager/Cashier employees must be assigned to exactly one outlet.",
        });
      }

      await db.transaction(async (client) => {
        await client.query("DELETE FROM employee_outlets WHERE employee_id = $1", [id]);
        for (const outletId of numericIds) {
          await client.query(
            "INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES ($1, $2, $3)",
            [id, outletId, outletId === primaryId],
          );
        }
      });

      res.json({
        message: "Outlet assignments updated",
        outlet_ids: numericIds,
        primary_outlet_id: primaryId,
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
};
