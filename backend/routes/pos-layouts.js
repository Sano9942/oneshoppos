module.exports = function registerPOSLayoutRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_pos_layouts");

  // GET /api/pos-layouts — returns the best matching layout for current context
  app.get("/api/pos-layouts", feat, async (req, res) => {
    const { outlet_id, role_id, employee_id } = req.query;
    try {
      const { rows } = await db.query(
        `SELECT * FROM pos_layouts
         WHERE is_active = TRUE
         ORDER BY
           CASE scope_type
             WHEN 'employee' THEN 1
             WHEN 'role' THEN 2
             WHEN 'outlet' THEN 3
             WHEN 'global' THEN 4
           END,
           id DESC`
      );

      let layout = null;
      for (const row of rows) {
        if (row.scope_type === "employee" && row.scope_id === Number(employee_id)) { layout = row; break; }
        if (row.scope_type === "role" && row.scope_id === Number(role_id)) { layout = row; break; }
        if (row.scope_type === "outlet" && row.scope_id === Number(outlet_id)) { layout = row; break; }
        if (row.scope_type === "global") { layout = row; break; }
      }

      res.json({ layout: layout ? { ...layout, layout_json: JSON.parse(layout.layout_json) } : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/pos-layouts/all — admin list of all layouts
  app.get("/api/pos-layouts/all", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT pl.*, e.name AS created_by_name
         FROM pos_layouts pl
         LEFT JOIN employees e ON e.id = pl.created_by
         ORDER BY pl.scope_type, pl.name`
      );
      res.json({ layouts: rows.map(r => ({ ...r, layout_json: JSON.parse(r.layout_json) })) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/pos-layouts
  app.post("/api/pos-layouts", feat, requirePerm("all_access"), async (req, res) => {
    const { name, scope_type, scope_id, layout_json } = req.body;
    if (!name || !layout_json) return res.status(400).json({ error: "name and layout_json required" });
    try {
      const { rows } = await db.query(
        `INSERT INTO pos_layouts (name, scope_type, scope_id, layout_json, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, scope_type || "global", scope_id || null, JSON.stringify(layout_json), req.employee?.id]
      );
      res.status(201).json({ layout: { ...rows[0], layout_json: JSON.parse(rows[0].layout_json) } });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Layout already exists for this scope" });
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/pos-layouts/:id
  app.put("/api/pos-layouts/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { name, layout_json, is_active } = req.body;
    try {
      const sets = [];
      const vals = [];
      let idx = 1;
      if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
      if (layout_json !== undefined) { sets.push(`layout_json = $${idx}`); vals.push(JSON.stringify(layout_json)); idx++; }
      if (is_active !== undefined) { sets.push(`is_active = $${idx}`); vals.push(is_active); idx++; }
      sets.push(`updated_at = NOW()`);

      vals.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE pos_layouts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
      );
      if (!rows.length) return res.status(404).json({ error: "Layout not found" });
      res.json({ layout: { ...rows[0], layout_json: JSON.parse(rows[0].layout_json) } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pos-layouts/:id
  app.delete("/api/pos-layouts/:id", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM pos_layouts WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Layout not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
