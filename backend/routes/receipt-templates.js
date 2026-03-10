module.exports = function registerReceiptTemplateRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // Best-effort column additions (idempotent — Postgres will error if exists, which we ignore)
  (async () => {
    for (const col of ["entity_id INTEGER", "entity_type TEXT", "employee_id INTEGER"]) {
      try { await db.query(`ALTER TABLE action_history ADD COLUMN ${col}`); } catch {}
    }
  })();

// --- RECEIPT TEMPLATES ---

  app.get("/api/receipt-templates", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM receipt_templates ORDER BY id DESC");
      res.json({ templates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/receipt-templates/active", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM receipt_templates WHERE is_active = true ORDER BY id DESC LIMIT 1"
      );
      res.json({ template: rows[0] || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/receipt-templates", requirePerm("all_access"), async (req, res) => {
    const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    try {
      if (is_active) {
        await db.query("UPDATE receipt_templates SET is_active = false");
      }
      const { rows } = await db.query(
        "INSERT INTO receipt_templates (name, header_text, footer_text, show_barcode, show_logo, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [name, header_text || "", footer_text || "", show_barcode ? true : false, show_logo ? true : false, is_active ? true : false]
      );
      res.json({ id: rows[0].id, message: "Template created" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/receipt-templates/:id", requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { name, header_text, footer_text, show_barcode, show_logo, is_active } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    try {
      if (is_active) {
        await db.query("UPDATE receipt_templates SET is_active = false");
      }
      const { rowCount } = await db.query(
        "UPDATE receipt_templates SET name=$1, header_text=$2, footer_text=$3, show_barcode=$4, show_logo=$5, is_active=$6 WHERE id=$7",
        [name, header_text || "", footer_text || "", show_barcode ? true : false, show_logo ? true : false, is_active ? true : false, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Template not found" });
      res.json({ message: "Template updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/receipt-templates/:id", requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM receipt_templates WHERE id = $1", [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: "Template not found" });
      res.json({ message: "Template deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- ACTION HISTORY ---

  app.post("/api/action-history", async (req, res) => {
    const { user_name, action_type, description } = req.body;
    if (!action_type || !description) {
      return res.status(400).json({ error: "Missing action details" });
    }
    try {
      const { rows } = await db.query(
        "INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3) RETURNING id",
        [user_name || "System", action_type, description]
      );
      res.json({ id: rows[0].id, message: "Action logged" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/action-history/log", requirePerm("view_reports"), async (req, res) => {
    const { action_type, description, entity_id, entity_type } = req.body;
    if (!action_type || !description) {
      return res.status(400).json({ error: "action_type and description are required" });
    }
    const employee_id = req.body.employee_id || req.headers["x-employee-id"] || null;
    try {
      const { rows } = await db.query(
        `INSERT INTO action_history (action_type, description, entity_id, entity_type, employee_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [action_type, description, entity_id || null, entity_type || null, employee_id ? Number(employee_id) : null]
      );
      res.json({ success: true, id: rows[0].id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/action-history", async (req, res) => {
    const { search, date_from, date_to, action_type } = req.query;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(user_name ILIKE $${paramIdx} OR action_type ILIKE $${paramIdx + 1} OR description ILIKE $${paramIdx + 2})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIdx += 3;
    }
    if (date_from) {
      conditions.push(`date(timestamp) >= $${paramIdx}`);
      params.push(date_from);
      paramIdx++;
    }
    if (date_to) {
      conditions.push(`date(timestamp) <= $${paramIdx}`);
      params.push(date_to);
      paramIdx++;
    }
    if (action_type) {
      conditions.push(`action_type = $${paramIdx}`);
      params.push(action_type);
      paramIdx++;
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    try {
      const { rows } = await db.query(
        `SELECT * FROM action_history ${where} ORDER BY timestamp DESC LIMIT 500`,
        params
      );
      res.json({ logs: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
