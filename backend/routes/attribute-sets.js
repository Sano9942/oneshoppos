module.exports = function registerAttributeSetRoutes(app, deps) {
  const { db } = deps;

// --- ROUTES: ATTRIBUTE SETS ---

  // Get all attribute sets with nested attributes and options
  app.get("/api/attribute-sets", async (req, res) => {
    try {
      const { rows: sets } = await db.query(
        "SELECT * FROM attribute_sets ORDER BY name ASC",
      );
      if (!sets || sets.length === 0) return res.json({ attributeSets: [] });

      const { rows: attributes } = await db.query("SELECT * FROM attributes");
      const { rows: options } = await db.query("SELECT * FROM attribute_options");

      // Build nested structure
      const enrichedSets = sets.map((s) => {
        const setAttrs = attributes.filter(
          (a) => a.attribute_set_id === s.id,
        );
        const enrichedAttrs = setAttrs.map((a) => {
          return {
            ...a,
            options: options.filter((o) => o.attribute_id === a.id),
          };
        });
        return { ...s, attributes: enrichedAttrs };
      });

      res.json({ attributeSets: enrichedSets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create an attribute set with its attributes and options
  app.post("/api/attribute-sets", async (req, res) => {
    const { name, description, attributes } = req.body;

    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query(
          "INSERT INTO attribute_sets (name, description) VALUES ($1, $2) RETURNING id",
          [name, description],
        );
        const setId = rows[0].id;

        if (!attributes || attributes.length === 0) {
          return { id: setId, name, description, attributes: [] };
        }

        for (const attr of attributes) {
          const { rows: attrRows } = await client.query(
            "INSERT INTO attributes (name, attribute_set_id) VALUES ($1, $2) RETURNING id",
            [attr.name, setId],
          );
          const attrId = attrRows[0].id;
          const options = attr.options || [];
          for (const opt of options) {
            const optValue = typeof opt === "string" ? opt : opt.value;
            await client.query(
              "INSERT INTO attribute_options (attribute_id, value) VALUES ($1, $2)",
              [attrId, optValue],
            );
          }
        }

        return { id: setId };
      });

      res.json({ message: "Attribute set created", id: result.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update attribute set (full replace of attributes + options)
  app.put("/api/attribute-sets/:id", async (req, res) => {
    const { id } = req.params;
    const { name, description, attributes } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });

    try {
      await db.transaction(async (client) => {
        const { rowCount } = await client.query(
          "UPDATE attribute_sets SET name = $1, description = $2 WHERE id = $3",
          [name, description || null, id],
        );
        if (rowCount === 0) {
          throw Object.assign(new Error("Attribute set not found"), { statusCode: 404 });
        }

        // Delete old attributes (CASCADE removes attribute_options too)
        await client.query(
          "DELETE FROM attributes WHERE attribute_set_id = $1",
          [id],
        );

        if (!attributes || attributes.length === 0) return;

        for (const attr of attributes) {
          const { rows: attrRows } = await client.query(
            "INSERT INTO attributes (name, attribute_set_id) VALUES ($1, $2) RETURNING id",
            [attr.name, id],
          );
          const attrId = attrRows[0].id;
          const options = attr.options || [];
          for (const opt of options) {
            const optValue = typeof opt === "string" ? opt : opt.value;
            await client.query(
              "INSERT INTO attribute_options (attribute_id, value) VALUES ($1, $2)",
              [attrId, optValue],
            );
          }
        }
      });

      res.json({ message: "Attribute set updated", id });
    } catch (err) {
      if (err.statusCode === 404) return res.status(404).json({ error: err.message });
      if (err.constraint) {
        return res.status(400).json({ error: "Attribute set name must be unique" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Delete attribute set
  app.delete("/api/attribute-sets/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query("DELETE FROM attribute_sets WHERE id = $1", [id]);
      if (rowCount === 0)
        return res.status(404).json({ error: "Not found" });
      res.json({ message: "Deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
