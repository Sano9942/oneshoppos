module.exports = function registerTaxRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all taxes
  app.get("/api/taxes", (req, res) => {
    db.all("SELECT * FROM taxes ORDER BY name ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ taxes: rows });
    });
  });

  // Add a new tax
  app.post("/api/taxes", requirePerm("manage_inventory"), (req, res) => {
    const { name, rate, is_default } = req.body;
    db.run(
      "INSERT INTO taxes (name, rate, is_default) VALUES (?, ?, ?)",
      [name, rate, is_default ? 1 : 0],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, rate, is_default });
      },
    );
  });

  // Update a tax
  app.put("/api/taxes/:id", requirePerm("manage_inventory"), (req, res) => {
    const { id } = req.params;
    const { name, rate, is_default } = req.body;
    db.run(
      "UPDATE taxes SET name = COALESCE(?, name), rate = COALESCE(?, rate), is_default = COALESCE(?, is_default) WHERE id = ?",
      [name, rate, is_default ? 1 : 0, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Tax not found" });
        res.json({ message: "Tax updated successfully" });
      },
    );
  });

  // Delete a tax
  app.delete("/api/taxes/:id", requirePerm("manage_inventory"), (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM taxes WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Tax not found" });
      res.json({ message: "Tax deleted" });
    });
  });
};
