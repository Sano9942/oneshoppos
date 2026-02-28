module.exports = function registerRoleRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all roles
  app.get("/api/roles", (req, res) => {
    db.all("SELECT * FROM roles ORDER BY id ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ roles: rows });
    });
  });

  // Add a new role
  app.post("/api/roles", requirePerm("manage_employees"), (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Role name is required" });

    db.run(
      "INSERT INTO roles (name, description) VALUES (?, ?)",
      [name, description],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Role name already exists" });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, name, description });
      },
    );
  });

  // Update a role
  app.put("/api/roles/:id", requirePerm("manage_employees"), (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    db.run(
      "UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
      [name, description, id],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Role name already exists" });
          }
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0)
          return res.status(404).json({ error: "Role not found" });
        res.json({ message: "Role updated successfully" });
      },
    );
  });

  // Delete a role
  app.delete("/api/roles/:id", requirePerm("manage_employees"), (req, res) => {
    const { id } = req.params;

    // Prevent deleting default roles (id 1, 2, 3)
    if (["1", "2", "3"].includes(id.toString())) {
      return res.status(400).json({
        error:
          "Cannot delete default system roles. You can only edit their names or permissions.",
      });
    }

    // Check if role is used by employees
    db.get(
      "SELECT COUNT(*) as count FROM employees WHERE role_id = ?",
      [id],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row.count > 0)
          return res.status(400).json({
            error: `Cannot delete role. It is currently assigned to ${row.count} employee(s).`,
          });

        db.run(
          "DELETE FROM role_permissions WHERE role_id = ?",
          [id],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });

            db.run("DELETE FROM roles WHERE id = ?", [id], function (err) {
              if (err) return res.status(500).json({ error: err.message });
              if (this.changes === 0)
                return res.status(404).json({ error: "Role not found" });
              res.json({ message: "Role deleted" });
            });
          },
        );
      },
    );
  });

  // Get permissions for a specific role
  app.get("/api/roles/:id/permissions", (req, res) => {
    const { id } = req.params;
    db.all(
      "SELECT permission FROM role_permissions WHERE role_id = ?",
      [id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const permissions = rows.map((r) => r.permission);
        res.json({ permissions });
      },
    );
  });

  // Update permissions for a specific role
  app.put(
    "/api/roles/:id/permissions",
    requirePerm("manage_employees"),
    (req, res) => {
      const { id } = req.params;
      const { permissions } = req.body;

      if (!Array.isArray(permissions)) {
        return res
          .status(400)
          .json({ error: "Permissions must be an array of strings" });
      }

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          "DELETE FROM role_permissions WHERE role_id = ?",
          [id],
          (err) => {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: err.message });
            }
          },
        );

        if (permissions.length > 0) {
          const placeholders = permissions.map(() => "(?, ?)").join(", ");
          const values = permissions.reduce(
            (acc, perm) => acc.concat([id, perm]),
            [],
          );

          db.run(
            `INSERT INTO role_permissions (role_id, permission) VALUES ${placeholders}`,
            values,
            (err) => {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }
              db.run("COMMIT");
              return res.json({ message: "Permissions updated successfully" });
            },
          );
        } else {
          db.run("COMMIT");
          return res.json({ message: "Permissions cleared successfully" });
        }
      });
    },
  );
};
