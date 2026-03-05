module.exports = function registerOutletRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all outlets
  app.get("/api/outlets", (req, res) => {
    db.all("SELECT * FROM outlets ORDER BY name ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ outlets: rows });
    });
  });

  // Add a new outlet
  app.post("/api/outlets", requirePerm("all_access"), (req, res) => {
    const { name, address, phone } = req.body;
    db.run(
      "INSERT INTO outlets (name, address, phone) VALUES (?, ?, ?)",
      [name, address, phone],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, address, phone });
      },
    );
  });

  // Update an outlet
  app.put("/api/outlets/:id", requirePerm("all_access"), (req, res) => {
    const { id } = req.params;
    const { name, address, phone } = req.body;
    db.run(
      "UPDATE outlets SET name = COALESCE(?, name), address = COALESCE(?, address), phone = COALESCE(?, phone) WHERE id = ?",
      [name, address, phone, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Outlet not found" });
        res.json({ message: "Outlet updated successfully" });
      },
    );
  });

  // Delete an outlet — optionally reassign linked records to another outlet
  app.delete("/api/outlets/:id", requirePerm("all_access"), (req, res) => {
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

    const doDelete = () => {
      db.run("DELETE FROM outlets WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Outlet not found" });
        res.json({ message: "Outlet deleted" });
      });
    };

    if (!reassignTo) return doDelete();

    // Reassign all linked records then delete
    let pending = LINKED_TABLES.length;
    let failed = false;
    LINKED_TABLES.forEach((table) => {
      db.run(
        `UPDATE ${table} SET outlet_id = ? WHERE outlet_id = ?`,
        [reassignTo, id],
        (err) => {
          if (err && !failed) {
            failed = true;
            return res.status(500).json({ error: `Failed reassigning ${table}: ${err.message}` });
          }
          if (--pending === 0 && !failed) doDelete();
        }
      );
    });
  });
};
