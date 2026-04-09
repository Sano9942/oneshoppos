module.exports = function registerScheduledChangesRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_scheduled_changes");

  // GET /api/catalog/scheduled-changes
  app.get("/api/catalog/scheduled-changes", feat, async (req, res) => {
    const { status, change_type } = req.query;
    try {
      let where = "1=1";
      const params = [];
      let idx = 1;

      if (status) { where += ` AND scc.status = $${idx}`; params.push(status); idx++; }
      if (change_type) { where += ` AND scc.change_type = $${idx}`; params.push(change_type); idx++; }

      const { rows } = await db.query(
        `SELECT scc.*, e.name AS created_by_name
         FROM scheduled_catalog_changes scc
         LEFT JOIN employees e ON e.id = scc.created_by
         WHERE ${where}
         ORDER BY scc.scheduled_at ASC`,
        params
      );
      res.json({ changes: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/catalog/scheduled-changes
  app.post("/api/catalog/scheduled-changes", feat, requirePerm("all_access"), async (req, res) => {
    const { change_type, entity_type, entity_id, field_name, new_value, scheduled_at, notes } = req.body;
    if (!change_type || !entity_type || !entity_id || !field_name || !new_value || !scheduled_at) {
      return res.status(400).json({ error: "change_type, entity_type, entity_id, field_name, new_value, and scheduled_at are required" });
    }
    if (new Date(scheduled_at) <= new Date()) {
      return res.status(400).json({ error: "scheduled_at must be in the future" });
    }
    try {
      let old_value = null;
      if (entity_type === "product") {
        const { rows } = await db.query(`SELECT * FROM products WHERE id = $1`, [entity_id]);
        if (rows.length) old_value = String(rows[0][field_name] ?? "");
      } else if (entity_type === "variant") {
        const { rows } = await db.query(`SELECT * FROM product_variants WHERE id = $1`, [entity_id]);
        if (rows.length) old_value = String(rows[0][field_name] ?? "");
      }

      const { rows } = await db.query(
        `INSERT INTO scheduled_catalog_changes
         (change_type, entity_type, entity_id, field_name, old_value, new_value, scheduled_at, created_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [change_type, entity_type, entity_id, field_name, old_value, new_value, scheduled_at, req.employee?.id, notes || null]
      );
      res.status(201).json({ change: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/catalog/scheduled-changes/:id
  app.put("/api/catalog/scheduled-changes/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { new_value, scheduled_at, notes, status } = req.body;
    try {
      const { rows } = await db.query("SELECT * FROM scheduled_catalog_changes WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Scheduled change not found" });
      if (rows[0].status !== "pending") return res.status(400).json({ error: "Only pending changes can be edited" });

      const sets = [];
      const vals = [];
      let idx = 1;
      if (new_value !== undefined) { sets.push(`new_value = $${idx}`); vals.push(new_value); idx++; }
      if (scheduled_at !== undefined) { sets.push(`scheduled_at = $${idx}`); vals.push(scheduled_at); idx++; }
      if (notes !== undefined) { sets.push(`notes = $${idx}`); vals.push(notes); idx++; }
      if (status === "cancelled") { sets.push(`status = $${idx}`); vals.push("cancelled"); idx++; }

      if (!sets.length) return res.status(400).json({ error: "No fields to update" });

      vals.push(req.params.id);
      const { rows: updated } = await db.query(
        `UPDATE scheduled_catalog_changes SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
      );
      res.json({ change: updated[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
