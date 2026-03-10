module.exports = function registerRoleRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all roles
  app.get("/api/roles", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM roles ORDER BY id ASC");
      res.json({ roles: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new role
  app.post("/api/roles", requirePerm("all_access"), async (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Role name is required" });

    try {
      const { rows } = await db.query(
        "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
        [name, description]
      );
      res.json({ id: rows[0].id, name, description });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "Role name already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Update a role
  app.put("/api/roles/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    try {
      const { rowCount } = await db.query(
        "UPDATE roles SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3",
        [name, description, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Role not found" });
      res.json({ message: "Role updated successfully" });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "Role name already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a role
  app.delete("/api/roles/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;

    // Prevent deleting default roles (id 1, 2, 3)
    if (["1", "2", "3"].includes(id.toString())) {
      return res.status(400).json({
        error: "Cannot delete default system roles. You can only edit their names or permissions.",
      });
    }

    try {
      // Check if role is used by employees
      const { rows } = await db.query(
        "SELECT COUNT(*) as count FROM employees WHERE role_id = $1",
        [id]
      );
      if (Number(rows[0].count) > 0) {
        return res.status(400).json({
          error: `Cannot delete role. It is currently assigned to ${rows[0].count} employee(s).`,
        });
      }

      await db.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);
      const { rowCount } = await db.query("DELETE FROM roles WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Role not found" });
      res.json({ message: "Role deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get permissions for a specific role
  app.get("/api/roles/:id/permissions", async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await db.query(
        "SELECT permission FROM role_permissions WHERE role_id = $1",
        [id]
      );
      const permissions = rows.map((r) => r.permission);
      res.json({ permissions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update permissions for a specific role
  app.put("/api/roles/:id/permissions", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { permissions } = req.body;
    const perms = req.employeePerms || [];
    const isAdmin = perms.includes("all_access");

    // Only Administrator can edit the Administrator role (id 1) permissions
    if (String(id) === "1" && !isAdmin) {
      return res.status(403).json({ error: "Only an Administrator can modify Administrator permissions." });
    }
    // Block non-admins from granting all_access to any role
    if (!isAdmin && Array.isArray(permissions) && permissions.includes("all_access")) {
      return res.status(403).json({ error: "Only an Administrator can grant all_access." });
    }

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: "Permissions must be an array of strings" });
    }

    try {
      await db.transaction(async (client) => {
        await client.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);
        for (const perm of permissions) {
          await client.query(
            "INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)",
            [id, perm]
          );
        }
      });
      res.json({ message: permissions.length ? "Permissions updated successfully" : "Permissions cleared successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
