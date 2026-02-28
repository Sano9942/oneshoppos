module.exports = function registerCategoryRoutes(app, deps) {
  const { db } = deps;

  // Get all categories
  app.get("/api/categories", (req, res) => {
    db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ categories: rows });
    });
  });

  // Add a new category
  app.post("/api/categories", (req, res) => {
    const { name, description } = req.body;
    db.run(
      "INSERT INTO categories (name, description) VALUES (?, ?)",
      [name, description],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, description });
      },
    );
  });

  // Update a category
  app.put("/api/categories/:id", (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    db.run(
      "UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
      [name, description, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Category not found" });
        res.json({ message: "Category updated successfully" });
      },
    );
  });

  // Delete a category
  app.delete("/api/categories/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM categories WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Category not found" });
      res.json({ message: "Category deleted" });
    });
  });
};
