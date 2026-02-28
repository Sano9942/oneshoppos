module.exports = function registerAttributeSetRoutes(app, deps) {
  const { db } = deps;

// --- ROUTES: ATTRIBUTE SETS ---

  // Get all attribute sets with nested attributes and options
  app.get("/api/attribute-sets", (req, res) => {
    db.all(
      "SELECT * FROM attribute_sets ORDER BY name ASC",
      [],
      (err, sets) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!sets || sets.length === 0) return res.json({ attributeSets: [] });

        db.all("SELECT * FROM attributes", [], (err, attributes) => {
          if (err) return res.status(500).json({ error: err.message });

          db.all("SELECT * FROM attribute_options", [], (err, options) => {
            if (err) return res.status(500).json({ error: err.message });

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
          });
        });
      },
    );
  });

  // Create an attribute set with its attributes and options
  app.post("/api/attribute-sets", (req, res) => {
    const { name, description, attributes } = req.body;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      db.run(
        "INSERT INTO attribute_sets (name, description) VALUES (?, ?)",
        [name, description],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }

          const setId = this.lastID;

          if (!attributes || attributes.length === 0) {
            db.run("COMMIT");
            return res.json({ id: setId, name, description, attributes: [] });
          }

          let pendingAttributes = attributes.length;
          let hasError = false;

          attributes.forEach((attr) => {
            if (hasError) return;

            db.run(
              "INSERT INTO attributes (name, attribute_set_id) VALUES (?, ?)",
              [attr.name, setId],
              function (err2) {
                if (err2) {
                  hasError = true;
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: err2.message });
                }

                const attrId = this.lastID;
                const options = attr.options || [];

                if (options.length === 0) {
                  pendingAttributes--;
                  if (pendingAttributes === 0 && !hasError) {
                    db.run("COMMIT");
                    res.json({ message: "Attribute set created", id: setId });
                  }
                  return;
                }

                let pendingOptions = options.length;
                options.forEach((opt) => {
                  if (hasError) return;
                  const optValue = typeof opt === "string" ? opt : opt.value;
                  db.run(
                    "INSERT INTO attribute_options (attribute_id, value) VALUES (?, ?)",
                    [attrId, optValue],
                    function (err3) {
                      if (err3) {
                        hasError = true;
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err3.message });
                      }
                      pendingOptions--;
                      if (pendingOptions === 0) {
                        pendingAttributes--;
                        if (pendingAttributes === 0 && !hasError) {
                          db.run("COMMIT");
                          res.json({
                            message: "Attribute set created",
                            id: setId,
                          });
                        }
                      }
                    },
                  );
                });
              },
            );
          });
        },
      );
    });
  });

  // Update attribute set (full replace of attributes + options)
  app.put("/api/attribute-sets/:id", (req, res) => {
    const { id } = req.params;
    const { name, description, attributes } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      db.run(
        "UPDATE attribute_sets SET name = ?, description = ? WHERE id = ?",
        [name, description || null, id],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            if (err.message.includes("UNIQUE constraint failed")) {
              return res
                .status(400)
                .json({ error: "Attribute set name must be unique" });
            }
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            db.run("ROLLBACK");
            return res.status(404).json({ error: "Attribute set not found" });
          }

          // Delete old attributes (CASCADE removes attribute_options too)
          db.run(
            "DELETE FROM attributes WHERE attribute_set_id = ?",
            [id],
            (err2) => {
              if (err2) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err2.message });
              }

              if (!attributes || attributes.length === 0) {
                db.run("COMMIT");
                return res.json({ message: "Attribute set updated", id });
              }

              let pendingAttributes = attributes.length;
              let hasError = false;

              attributes.forEach((attr) => {
                if (hasError) return;

                db.run(
                  "INSERT INTO attributes (name, attribute_set_id) VALUES (?, ?)",
                  [attr.name, id],
                  function (err3) {
                    if (err3) {
                      hasError = true;
                      db.run("ROLLBACK");
                      return res.status(500).json({ error: err3.message });
                    }

                    const attrId = this.lastID;
                    const options = attr.options || [];

                    if (options.length === 0) {
                      pendingAttributes--;
                      if (pendingAttributes === 0 && !hasError) {
                        db.run("COMMIT");
                        res.json({ message: "Attribute set updated", id });
                      }
                      return;
                    }

                    let pendingOptions = options.length;
                    options.forEach((opt) => {
                      if (hasError) return;
                      const optValue =
                        typeof opt === "string" ? opt : opt.value;
                      db.run(
                        "INSERT INTO attribute_options (attribute_id, value) VALUES (?, ?)",
                        [attrId, optValue],
                        function (err4) {
                          if (err4) {
                            hasError = true;
                            db.run("ROLLBACK");
                            return res
                              .status(500)
                              .json({ error: err4.message });
                          }
                          pendingOptions--;
                          if (pendingOptions === 0) {
                            pendingAttributes--;
                            if (pendingAttributes === 0 && !hasError) {
                              db.run("COMMIT");
                              res.json({
                                message: "Attribute set updated",
                                id,
                              });
                            }
                          }
                        },
                      );
                    });
                  },
                );
              });
            },
          );
        },
      );
    });
  });

  // Delete attribute set
  app.delete("/api/attribute-sets/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM attribute_sets WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Not found" });
      res.json({ message: "Deleted successfully" });
    });
  });
};
