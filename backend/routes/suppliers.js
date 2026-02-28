module.exports = function registerSupplierRoutes(app, deps) {
  const { db } = deps;

  // Get all suppliers
  app.get("/api/suppliers", (req, res) => {
    db.all("SELECT * FROM suppliers ORDER BY name ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ suppliers: rows });
    });
  });

  // Add a new supplier
  app.post("/api/suppliers", (req, res) => {
    const { name, contact_person, phone, email, address } = req.body;
    db.run(
      "INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?)",
      [name, contact_person, phone, email, address],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          id: this.lastID,
          name,
          contact_person,
          phone,
          email,
          address,
        });
      },
    );
  });

  // Update a supplier
  app.put("/api/suppliers/:id", (req, res) => {
    const { id } = req.params;
    const { name, contact_person, phone, email, address } = req.body;

    db.run(
      "UPDATE suppliers SET name = COALESCE(?, name), contact_person = COALESCE(?, contact_person), phone = COALESCE(?, phone), email = COALESCE(?, email), address = COALESCE(?, address) WHERE id = ?",
      [name, contact_person, phone, email, address, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Supplier not found" });
        res.json({ message: "Supplier updated successfully" });
      },
    );
  });

  // Delete a supplier
  app.delete("/api/suppliers/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM suppliers WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Supplier not found" });
      res.json({ message: "Supplier deleted" });
    });
  });
};
