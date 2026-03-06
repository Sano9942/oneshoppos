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

  app.post("/api/auth/logout", (req, res) => {
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
