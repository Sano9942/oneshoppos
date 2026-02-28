module.exports = function registerBrandRoutes(app, deps) {
  const { db } = deps;

  // Get all brands
  app.get("/api/brands", (req, res) => {
    db.all("SELECT * FROM brands ORDER BY name ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ brands: rows });
    });
  });

  // Add a new brand
  app.post("/api/brands", (req, res) => {
    const { name, description } = req.body;
    db.run(
      "INSERT INTO brands (name, description) VALUES (?, ?)",
      [name, description],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Brand name must be unique" });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, name, description });
      },
    );
  });

  // Update a brand
  app.put("/api/brands/:id", (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    db.run(
      "UPDATE brands SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
      [name, description, id],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Brand name must be unique" });
          }
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0)
          return res.status(404).json({ error: "Brand not found" });
        res.json({ message: "Brand updated successfully" });
      },
    );
  });

  // Delete a brand
  app.delete("/api/brands/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM brands WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Brand not found" });
      res.json({ message: "Brand deleted" });
    });
  });
};
