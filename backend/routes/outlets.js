module.exports = function registerOutletRoutes(app, deps) {
  const { db } = deps;

  // Get all outlets
  app.get("/api/outlets", (req, res) => {
    db.all("SELECT * FROM outlets ORDER BY name ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ outlets: rows });
    });
  });

  // Add a new outlet
  app.post("/api/outlets", (req, res) => {
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
  app.put("/api/outlets/:id", (req, res) => {
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

  // Delete an outlet
  app.delete("/api/outlets/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM outlets WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Outlet not found" });
      res.json({ message: "Outlet deleted" });
    });
  });
};
