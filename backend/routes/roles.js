const {
  PERMISSIONS_CATALOG,
  isKnownPermission,
} = require("../config/permissions-catalog");

module.exports = function registerRoleRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all roles.
  // Guard (PLAN.md business-modules Step 7): the only frontend consumers are
  // AdministratorRedesign and EmployeesRedesign, both behind
  // perm("all_access") routes — so the list itself is admin-only.
  app.get("/api/roles", requirePerm("all_access"), async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM roles ORDER BY id ASC");
      res.json({ roles: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The permission catalog backing the role editor (PLAN.md Step 7) —
  // replaces the stale hardcoded list in AdministratorRedesign.jsx.
  app.get(
    "/api/permissions-catalog",
    requirePerm("all_access"),
    (req, res) => {
      res.json({ permissions: PERMISSIONS_CATALOG });
    }
  );

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
      // Only the name-unique violation means a duplicate name — a pkey
      // violation here is a desynced roles_id_seq, not a name clash.
      if (err.code === "23505" && String(err.constraint || "").includes("name")) {
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
      // Only the name-unique violation means a duplicate name — a pkey
      // violation here is a desynced roles_id_seq, not a name clash.
      if (err.code === "23505" && String(err.constraint || "").includes("name")) {
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

  /**
   * Self-or-admin guard for reading a role's permission list (PLAN.md
   * business-modules Step 7). Every logged-in user — Cashier and Field Rep
   * included — reads their OWN role's permissions on boot via
   * AuthProvider.refreshPermissions (frontend/src/auth/AuthProvider.jsx),
   * so an admin-only guard here would break all non-admin logins. The rule:
   *   - all_access / manage_employees → any role
   *   - anyone else → only their own role (JWT req.employee.role_id when
   *     present; single-tenant/harness falls back to an employees lookup via
   *     the x-employee-id header, which is the ST trust model everywhere)
   */
  async function requireSelfRoleOrAdmin(req, res, next) {
    try {
      const perms = req.employeePerms || [];
      if (perms.includes("all_access") || perms.includes("manage_employees")) {
        return next();
      }
      const roleId = String(req.params.id);
      if (req.employee?.role_id != null) {
        if (String(req.employee.role_id) === roleId) return next();
      } else {
        const empId = parseInt(req.headers["x-employee-id"], 10);
        if (Number.isInteger(empId) && empId > 0) {
          const { rows } = await db.query(
            "SELECT role_id FROM employees WHERE id = $1",
            [empId]
          );
          if (rows[0] && String(rows[0].role_id) === roleId) return next();
        }
      }
      return res
        .status(403)
        .json({ error: "Forbidden: insufficient permissions" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Get permissions for a specific role
  app.get("/api/roles/:id/permissions", requireSelfRoleOrAdmin, async (req, res) => {
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

    // PLAN.md Step 7: every submitted string must be a registered permission —
    // stops silent drift (typos, stale UI lists) at the source.
    const unknown = permissions.filter(
      (p) => typeof p !== "string" || !isKnownPermission(p)
    );
    if (unknown.length > 0) {
      return res.status(400).json({
        error: `Unknown permission(s): ${unknown.join(", ")}`,
        unknown,
      });
    }

    // S4 (AUDIT §4A) — admin self-lockout guard. The built-in Administrator
    // role (id 1, seeded by the wizard) must always retain all_access, and no
    // update may leave the tenant with zero roles holding all_access — boot
    // re-seeding is the only accidental recovery path otherwise.
    if (String(id) === "1" && !permissions.includes("all_access")) {
      return res.status(400).json({
        error: "The Administrator role must retain all_access.",
        code: "CANNOT_REMOVE_LAST_ADMIN",
      });
    }

    try {
      await db.transaction(async (client) => {
        if (!permissions.includes("all_access")) {
          const { rows: [self] } = await client.query(
            "SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission = 'all_access' LIMIT 1",
            [id]
          );
          if (self) {
            const { rows: [other] } = await client.query(
              "SELECT 1 FROM role_permissions WHERE permission = 'all_access' AND role_id <> $1 LIMIT 1",
              [id]
            );
            if (!other) {
              const lockout = new Error(
                "This update would leave no role with all_access."
              );
              lockout.code = "CANNOT_REMOVE_LAST_ADMIN";
              throw lockout;
            }
          }
        }
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
      if (err.code === "CANNOT_REMOVE_LAST_ADMIN") {
        return res.status(400).json({ error: err.message, code: "CANNOT_REMOVE_LAST_ADMIN" });
      }
      res.status(500).json({ error: err.message });
    }
  });
};
