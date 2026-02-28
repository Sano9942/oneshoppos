module.exports = function registerEmployeeRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all employees
  app.get("/api/employees", (req, res) => {
    db.all(
      "SELECT e.id, e.name, e.pin_code, r.name as role, e.role_id FROM employees e LEFT JOIN roles r ON e.role_id = r.id ORDER BY e.name ASC",
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
    const { name, role_id, pin_code } = req.body;
    db.run(
      "INSERT INTO employees (name, role_id, pin_code) VALUES (?, ?, ?)",
      [name, role_id || 3, pin_code],
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
    const { name, role_id, pin_code } = req.body;

    let query =
      "UPDATE employees SET name = COALESCE(?, name), role_id = COALESCE(?, role_id)";
    let params = [name, role_id];

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
