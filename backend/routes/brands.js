module.exports = function registerBrandRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all brands
  app.get("/api/brands", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM brands ORDER BY name ASC");
      res.json({ brands: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new brand
  app.post("/api/brands", requirePerm("manage_inventory"), async (req, res) => {
    const { name, description } = req.body;
    try {
      const { rows } = await db.query(
        "INSERT INTO brands (name, description) VALUES ($1, $2) RETURNING id",
        [name, description]
      );
      res.json({ id: rows[0].id, name, description });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "Brand name must be unique" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Update a brand
  app.put("/api/brands/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    try {
      const { rowCount } = await db.query(
        "UPDATE brands SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3",
        [name, description, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Brand not found" });
      res.json({ message: "Brand updated successfully" });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "Brand name must be unique" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a brand
  app.delete("/api/brands/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query("DELETE FROM brands WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Brand not found" });
      res.json({ message: "Brand deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
