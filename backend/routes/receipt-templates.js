module.exports = function registerReceiptTemplateRoutes(app, deps) {
  const { db } = deps;

// --- RECEIPT TEMPLATES ---

  app.get("/api/receipt-templates", (req, res) => {
    db.all(
      "SELECT * FROM receipt_templates ORDER BY id DESC",
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ templates: rows });
      },
    );
  });

  app.get("/api/receipt-templates/active", (req, res) => {
    db.get(
      "SELECT * FROM receipt_templates WHERE is_active = 1 ORDER BY id DESC LIMIT 1",
      [],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ template: row || null });
      },
    );
  });

  app.post("/api/receipt-templates", (req, res) => {
    const {
      name,
      header_text,
      footer_text,
      show_barcode,
      show_logo,
      is_active,
    } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    db.serialize(() => {
      if (is_active) db.run("UPDATE receipt_templates SET is_active = 0");
      db.run(
        "INSERT INTO receipt_templates (name, header_text, footer_text, show_barcode, show_logo, is_active) VALUES (?, ?, ?, ?, ?, ?)",
        [
          name,
          header_text || "",
          footer_text || "",
          show_barcode ? 1 : 0,
          show_logo ? 1 : 0,
          is_active ? 1 : 0,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: this.lastID, message: "Template created" });
        },
      );
    });
  });

  app.put("/api/receipt-templates/:id", (req, res) => {
    const { id } = req.params;
    const {
      name,
      header_text,
      footer_text,
      show_barcode,
      show_logo,
      is_active,
    } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    db.serialize(() => {
      if (is_active) db.run("UPDATE receipt_templates SET is_active = 0");
      db.run(
        "UPDATE receipt_templates SET name=?, header_text=?, footer_text=?, show_barcode=?, show_logo=?, is_active=? WHERE id=?",
        [
          name,
          header_text || "",
          footer_text || "",
          show_barcode ? 1 : 0,
          show_logo ? 1 : 0,
          is_active ? 1 : 0,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Template not found" });
          res.json({ message: "Template updated" });
        },
      );
    });
  });

  app.delete("/api/receipt-templates/:id", (req, res) => {
    db.run(
      "DELETE FROM receipt_templates WHERE id = ?",
      [req.params.id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0)
          return res.status(404).json({ error: "Template not found" });
        res.json({ message: "Template deleted" });
      },
    );
  });

  // --- ACTION HISTORY ---

  app.post("/api/action-history", (req, res) => {
    const { user_name, action_type, description } = req.body;
    if (!action_type || !description) {
      return res.status(400).json({ error: "Missing action details" });
    }

    db.run(
      "INSERT INTO action_history (user_name, action_type, description) VALUES (?, ?, ?)",
      [user_name || "System", action_type, description],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: "Action logged" });
      },
    );
  });

  app.get("/api/action-history", (req, res) => {
    const { search } = req.query;
    let where = "";
    let params = [];

    if (search) {
      where =
        "WHERE user_name LIKE ? OR action_type LIKE ? OR description LIKE ?";
      params = [`%${search}%`, `%${search}%`, `%${search}%`];
    }

    db.all(
      `SELECT * FROM action_history ${where} ORDER BY timestamp DESC LIMIT 500`,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: rows });
      },
    );
  });
};
