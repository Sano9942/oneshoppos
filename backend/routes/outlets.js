module.exports = function registerOutletRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all outlets
  app.get("/api/outlets", async (req, res) => {
    try {
      const employeeId = Number(req.headers["x-employee-id"] || 0);
      const perms = req.employeePerms || [];
      const isAdmin = perms.includes("all_access");

      if (employeeId && !isAdmin) {
        const { rows } = await db.query(
          `SELECT o.*
           FROM outlets o
           JOIN employee_outlets eo ON eo.outlet_id = o.id
           WHERE eo.employee_id = $1
           ORDER BY o.name ASC`,
          [employeeId]
        );
        return res.json({ outlets: rows || [] });
      }

      const { rows } = await db.query("SELECT * FROM outlets ORDER BY name ASC");
      res.json({ outlets: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new outlet
  app.post("/api/outlets", requirePerm("all_access"), async (req, res) => {
    try {
      const { name, address, phone } = req.body;
      const { rows } = await db.query(
        "INSERT INTO outlets (name, address, phone) VALUES ($1, $2, $3) RETURNING id",
        [name, address, phone]
      );
      res.json({ id: rows[0].id, name, address, phone });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update an outlet
  app.put("/api/outlets/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, address, phone } = req.body;
      const { rowCount } = await db.query(
        "UPDATE outlets SET name = COALESCE($1, name), address = COALESCE($2, address), phone = COALESCE($3, phone) WHERE id = $4",
        [name, address, phone, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Outlet not found" });
      res.json({ message: "Outlet updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete an outlet — optionally reassign linked records to another outlet
  app.delete("/api/outlets/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { id } = req.params;
      const reassignTo = req.query.reassign_to ? Number(req.query.reassign_to) : null;

      const LINKED_TABLES = [
        "employee_attendance",
        "attendance_sessions",
        "sales",
        "shifts",
        "cash_drawer_logs",
        "inventory_transfers",
        "stock_adjustments",
        "purchase_orders",
        "parked_sales",
      ];

      if (reassignTo) {
        for (const table of LINKED_TABLES) {
          await db.query(
            `UPDATE ${table} SET outlet_id = $1 WHERE outlet_id = $2`,
            [reassignTo, id]
          );
        }
      }

      const { rowCount } = await db.query("DELETE FROM outlets WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Outlet not found" });
      res.json({ message: "Outlet deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
