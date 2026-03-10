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

  const getEmployeeUsage = (employeeId, cb) => {
    const refs = [];
    let pending = EMPLOYEE_USAGE_CHECKS.length;
    if (!pending) return cb(null, refs);

    EMPLOYEE_USAGE_CHECKS.forEach(([table, column]) => {
      db.get(
        `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`,
        [employeeId],
        (err, row) => {
          if (err) {
            if (pending > 0) {
              pending = -1;
              cb(err);
            }
            return;
          }
          const count = Number(row?.count || 0);
          if (count > 0) refs.push({ table, column, count });
          pending -= 1;
          if (pending === 0) cb(null, refs);
        },
      );
    });
  };

  // Get all employees
  app.get("/api/employees", (req, res) => {
    db.all(
      "SELECT e.id, e.name, e.pin_code, e.salary_type, e.monthly_salary, e.hourly_rate, e.daily_rate, e.work_hours_per_day, r.name as role, e.role_id FROM employees e LEFT JOIN roles r ON e.role_id = r.id WHERE e.deleted_at IS NULL ORDER BY e.name ASC",
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ employees: rows });
      },
    );
  });

  // Validate PIN (For POS Login)
  app.post("/api/employees/validate-pin", async (req, res) => {
    const { pin_code } = req.body;
    if (!pin_code) return res.status(400).json({ error: "pin_code is required" });

    try {
      const employees = await new Promise((resolve, reject) => {
        db.all(
          "SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, r.name as role FROM employees e LEFT JOIN roles r ON e.role_id = r.id",
          [],
          (err, rows) => (err ? reject(err) : resolve(rows || []))
        );
      });

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
      const result = await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO employees (name, role_id, pin_code, pin_hash, salary_type, monthly_salary, hourly_rate, daily_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [name, role_id || 3, pin_code, pin_hash, salary_type || "monthly", Number(monthly_salary || 0), Number(hourly_rate || 0), Number(daily_rate || 0)],
          function (err) {
            if (err) return reject(err);
            resolve(this.lastID);
          }
        );
      });
      // Auto-assign new employee to all active outlets
      await new Promise((resolve) => {
        db.run(
          `INSERT OR IGNORE INTO employee_outlets (employee_id, outlet_id, is_primary)
           SELECT ?, o.id, CASE WHEN o.id = (SELECT MIN(id) FROM outlets WHERE is_active = 1) THEN 1 ELSE 0 END
           FROM outlets o WHERE o.is_active = 1`,
          [result],
          () => resolve()
        );
      });
      res.json({ id: result, name, role_id });
    } catch (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
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
      let query =
        "UPDATE employees SET name = COALESCE(?, name), role_id = COALESCE(?, role_id), salary_type = COALESCE(?, salary_type), monthly_salary = COALESCE(?, monthly_salary), hourly_rate = COALESCE(?, hourly_rate), daily_rate = COALESCE(?, daily_rate)";
      let params = [name, role_id, salary_type, monthly_salary != null ? Number(monthly_salary) : null, hourly_rate != null ? Number(hourly_rate) : null, daily_rate != null ? Number(daily_rate) : null];

      if (pin_code !== undefined && pin_code !== "") {
        const pin_hash = await bcrypt.hash(String(pin_code), 10);
        query += ", pin_code = ?, pin_hash = ?";
        params.push(pin_code, pin_hash);
      }

      query += " WHERE id = ?";
      params.push(id);

      const result = await new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
          if (err) return reject(err);
          resolve(this.changes);
        });
      });

      if (result === 0) return res.status(404).json({ error: "Employee not found" });
      res.json({ message: "Employee updated successfully" });
    } catch (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "PIN code must be unique" });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // --- Employee-outlet assignments ---

  // Get assigned outlets for an employee
  app.get(
    "/api/employees/:id/outlets",
    requirePerm("all_access"),
    (req, res) => {
      const { id } = req.params;
      db.all(
        `SELECT eo.outlet_id, o.name, o.branch_code, o.company_id, eo.is_primary
         FROM employee_outlets eo
         JOIN outlets o ON o.id = eo.outlet_id
         WHERE eo.employee_id = ?
         ORDER BY o.name`,
        [id],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ outlets: rows || [] });
        },
      );
    },
  );

  // Bulk-replace outlet assignments for an employee
  app.put(
    "/api/employees/:id/outlets",
    requirePerm("all_access"),
    (req, res) => {
      const { id } = req.params;
      const { outlet_ids, primary_outlet_id } = req.body || {};

      if (!Array.isArray(outlet_ids) || outlet_ids.length === 0) {
        return res
          .status(400)
          .json({ error: "outlet_ids must be a non-empty array" });
      }

      const numericIds = outlet_ids.map(Number).filter((n) => n > 0);
      if (numericIds.length === 0) {
        return res.status(400).json({ error: "No valid outlet IDs provided" });
      }

      const primaryId = primary_outlet_id
        ? Number(primary_outlet_id)
        : numericIds[0];

      db.get(
        "SELECT role_id FROM employees WHERE id = ?",
        [id],
        (empErr, empRow) => {
          if (empErr) return res.status(500).json({ error: empErr.message });
          if (!empRow)
            return res.status(404).json({ error: "Employee not found" });

          // Manager/Cashier are branch-fixed by policy: exactly one outlet.
          if (
            [2, 3].includes(Number(empRow.role_id)) &&
            numericIds.length !== 1
          ) {
            return res.status(400).json({
              error:
                "Manager/Cashier employees must be assigned to exactly one outlet.",
            });
          }

          db.serialize(() => {
            // Remove existing assignments
            db.run("DELETE FROM employee_outlets WHERE employee_id = ?", [id]);

            // Insert new assignments
            const stmt = db.prepare(
              "INSERT INTO employee_outlets (employee_id, outlet_id, is_primary) VALUES (?, ?, ?)",
            );
            for (const outletId of numericIds) {
              stmt.run(id, outletId, outletId === primaryId ? 1 : 0);
            }
            stmt.finalize((err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({
                message: "Outlet assignments updated",
                outlet_ids: numericIds,
                primary_outlet_id: primaryId,
              });
            });
          });
        },
      );
    },
  );

  // Archive an employee (soft delete)
  app.delete(
    "/api/employees/:id",
    requirePerm("all_access"),
    (req, res) => {
      const { id } = req.params;
      const actorId = Number(req.headers["x-employee-id"] || 0);
      const targetId = Number(id);

      if (targetId > 0 && actorId === targetId) {
        return res.status(400).json({ error: "You cannot delete your own account." });
      }

      db.run(
        "UPDATE employees SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
        [targetId],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Employee not found" });
          res.json({ message: "Employee archived" });
        },
      );
    },
  );

  // Revoke a specific token by JTI (multi-tenant JWT only)
  app.post(
    "/api/employees/:id/revoke-token",
    requireAnyPerm(["manage_employees", "all_access"]),
    (req, res) => {
      const { id } = req.params;
      const { jti, reason } = req.body || {};
      if (!jti) return res.status(400).json({ error: "jti is required" });

      const revokedBy = Number(req.headers["x-employee-id"] || 0);

      db.run(
        "INSERT OR IGNORE INTO revoked_tokens (token_jti, employee_id, revoked_by, reason) VALUES (?, ?, ?, ?)",
        [jti, Number(id), revokedBy, reason || null],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });

          // Cleanup expired entries older than 2 days
          db.run(
            "DELETE FROM revoked_tokens WHERE revoked_at < datetime('now', '-2 days')",
            () => {}
          );

          res.json({ message: "Token revoked", token_jti: jti });
        }
      );
    }
  );

  // Revoke all tokens for an employee (blanket revocation)
  app.post(
    "/api/employees/:id/revoke-all-tokens",
    requireAnyPerm(["manage_employees", "all_access"]),
    (req, res) => {
      const { id } = req.params;
      const { reason } = req.body || {};

      db.run(
        "UPDATE employees SET tokens_revoked_before = datetime('now') WHERE id = ?",
        [Number(id)],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Employee not found" });

          // Log to action_history if table exists
          const revokedBy = Number(req.headers["x-employee-id"] || 0);
          db.run(
            `INSERT INTO action_history (action_type, entity_type, entity_id, employee_id, description)
             VALUES ('token_revocation', 'employee', ?, ?, ?)`,
            [Number(id), revokedBy, `All sessions revoked${reason ? ": " + reason : ""}`],
            () => {} // ignore errors if table doesn't exist
          );

          res.json({ message: "All tokens revoked for employee" });
        }
      );
    }
  );
};
