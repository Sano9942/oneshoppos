module.exports = function registerReturnPolicyRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  const feat = requireFeature("phase2_returns_policy");

  // ── Return Policies CRUD ──────────────────────────────────────────────────

  app.get("/api/return-policies", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM return_policies WHERE is_active = TRUE ORDER BY is_default DESC, name ASC"
      );
      res.json({ policies: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/return-policies", feat, requirePerm("all_access"), async (req, res) => {
    const { name, return_window_days, receipt_required, restocking_fee_percent, allowed_refund_methods, is_default } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    try {
      // If setting as default, unset other defaults
      if (is_default) {
        await db.query("UPDATE return_policies SET is_default = FALSE WHERE is_default = TRUE");
      }
      const { rows } = await db.query(
        `INSERT INTO return_policies (name, return_window_days, receipt_required, restocking_fee_percent, allowed_refund_methods, is_default)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [name, return_window_days || null, receipt_required !== false,
         restocking_fee_percent || 0, allowed_refund_methods || "{cash,card,store_credit}",
         is_default === true]
      );
      res.status(201).json({ policy: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/return-policies/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { name, return_window_days, receipt_required, restocking_fee_percent, allowed_refund_methods, is_default } = req.body;
    try {
      if (is_default) {
        await db.query("UPDATE return_policies SET is_default = FALSE WHERE is_default = TRUE AND id != $1", [id]);
      }
      const { rows, rowCount } = await db.query(
        `UPDATE return_policies
         SET name = COALESCE($1, name),
             return_window_days = $2,
             receipt_required = COALESCE($3, receipt_required),
             restocking_fee_percent = COALESCE($4, restocking_fee_percent),
             allowed_refund_methods = COALESCE($5, allowed_refund_methods),
             is_default = COALESCE($6, is_default),
             updated_at = NOW()
         WHERE id = $7 AND is_active = TRUE RETURNING *`,
        [name, return_window_days, receipt_required, restocking_fee_percent,
         allowed_refund_methods, is_default, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Policy not found" });
      res.json({ policy: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Return Reasons CRUD ───────────────────────────────────────────────────

  app.get("/api/return-reasons", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM return_reasons WHERE is_active = TRUE ORDER BY sort_order ASC, label ASC"
      );
      res.json({ reasons: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/return-reasons", feat, requirePerm("all_access"), async (req, res) => {
    const { code, label, requires_note, sort_order } = req.body;
    if (!code || !label) return res.status(400).json({ error: "code and label are required" });
    try {
      const { rows } = await db.query(
        `INSERT INTO return_reasons (code, label, requires_note, sort_order)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [code, label, requires_note === true, sort_order || 0]
      );
      res.status(201).json({ reason: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Reason code already exists" });
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/return-reasons/:id", feat, requirePerm("all_access"), async (req, res) => {
    const { id } = req.params;
    const { code, label, requires_note, sort_order } = req.body;
    try {
      const { rows, rowCount } = await db.query(
        `UPDATE return_reasons
         SET code = COALESCE($1, code), label = COALESCE($2, label),
             requires_note = COALESCE($3, requires_note), sort_order = COALESCE($4, sort_order)
         WHERE id = $5 AND is_active = TRUE RETURNING *`,
        [code, label, requires_note, sort_order, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Reason not found" });
      res.json({ reason: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
