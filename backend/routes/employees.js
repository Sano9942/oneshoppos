module.exports = function registerEmployeeRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all employees
  app.get("/api/employees", (req, res) => {
    db.all(
      "SELECT e.id, e.name, e.pin_code, e.salary_type, e.monthly_salary, e.hourly_rate, e.daily_rate, e.work_hours_per_day, r.name as role, e.role_id FROM employees e LEFT JOIN roles r ON e.role_id = r.id ORDER BY e.name ASC",
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ employees: rows });
      },
    );
  });

  // Validate PIN (For POS Login)
  app.post("/api/employees/validate-pin", (req, res) => {
    const { pin_code } = req.body;
    db.get(
      "SELECT e.id, e.name, e.role_id, r.name as role FROM employees e LEFT JOIN roles r ON e.role_id = r.id WHERE e.pin_code = ?",
      [pin_code],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: "Invalid PIN" });
        res.json({ employee: row });
      },
    );
  });

  // Add a new employee
  app.post("/api/employees", requirePerm("manage_employees"), (req, res) => {
    const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate } = req.body;
    db.run(
      "INSERT INTO employees (name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [name, role_id || 3, pin_code, salary_type || "monthly", Number(monthly_salary || 0), Number(hourly_rate || 0), Number(daily_rate || 0)],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "PIN code must be unique" });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, name, role_id });
      },
    );
  });

  // Update an employee
  app.put("/api/employees/:id", requirePerm("manage_employees"), (req, res) => {
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

    let query =
      "UPDATE employees SET name = COALESCE(?, name), role_id = COALESCE(?, role_id), salary_type = COALESCE(?, salary_type), monthly_salary = COALESCE(?, monthly_salary), hourly_rate = COALESCE(?, hourly_rate), daily_rate = COALESCE(?, daily_rate)";
    let params = [name, role_id, salary_type, monthly_salary != null ? Number(monthly_salary) : null, hourly_rate != null ? Number(hourly_rate) : null, daily_rate != null ? Number(daily_rate) : null];

    if (pin_code !== undefined && pin_code !== "") {
      query += ", pin_code = ?";
      params.push(pin_code);
    }

    query += " WHERE id = ?";
    params.push(id);

    db.run(query, params, function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "PIN code must be unique" });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0)
        return res.status(404).json({ error: "Employee not found" });
      res.json({ message: "Employee updated successfully" });
    });
  });

  // --- Employee-outlet assignments ---

  // Get assigned outlets for an employee
  app.get(
    "/api/employees/:id/outlets",
    requirePerm("manage_employees"),
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
    requirePerm("manage_employees"),
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

  // Delete an employee
  app.delete(
    "/api/employees/:id",
    requirePerm("manage_employees"),
    (req, res) => {
      const { id } = req.params;
      db.run("DELETE FROM employees WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Employee not found" });
        res.json({ message: "Employee deleted" });
      });
    },
  );
};
