module.exports = function registerTaxRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Get all taxes
  app.get("/api/taxes", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM taxes ORDER BY name ASC");
      res.json({ taxes: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new tax
  app.post("/api/taxes", requirePerm("manage_inventory"), async (req, res) => {
    const { name, rate, is_default } = req.body;
    try {
      const { rows } = await db.query(
        "INSERT INTO taxes (name, rate, is_default) VALUES ($1, $2, $3) RETURNING id",
        [name, rate, is_default ? true : false]
      );
      res.json({ id: rows[0].id, name, rate, is_default });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update a tax
  app.put("/api/taxes/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const { name, rate, is_default } = req.body;
    try {
      const { rowCount } = await db.query(
        "UPDATE taxes SET name = COALESCE($1, name), rate = COALESCE($2, rate), is_default = COALESCE($3, is_default) WHERE id = $4",
        [name, rate, is_default !== undefined ? (is_default ? true : false) : null, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Tax not found" });
      res.json({ message: "Tax updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a tax
  app.delete("/api/taxes/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query("DELETE FROM taxes WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Tax not found" });
      res.json({ message: "Tax deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
