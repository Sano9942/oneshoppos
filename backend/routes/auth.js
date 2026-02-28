module.exports = function registerAuthRoutes(app, deps) {
  const { db, authLimiter } = deps;

  app.post("/api/auth/login", authLimiter, (req, res) => {
    const { username, pin } = req.body || {};
    if (!username || !pin) {
      return res.status(400).json({ error: "username and pin are required" });
    }

    db.get(
      `SELECT e.id, e.name, e.role_id, r.name as role, NULL as outlet_id
     FROM employees e
     LEFT JOIN roles r ON e.role_id = r.id
     WHERE LOWER(e.name) = LOWER(?) AND e.pin_code = ?`,
      [String(username).trim(), String(pin).trim()],
      (err, employee) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!employee) {
          return res.status(401).json({ error: "Invalid username or PIN" });
        }

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

  app.post("/api/auth/logout", (req, res) => {
    res.json({ success: true });
  });

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
