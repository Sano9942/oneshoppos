// Phase 2-G Wave 3 — 2-G.5 manager price override.
// Tenant-managed lookup of reason codes surfaced in the cashier override
// modal. Seed data ships in migration v64.
module.exports = function registerOverrideReasonRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  const feat = requireFeature("phase2g_price_override");

  app.get("/api/override-reasons", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, code, label, sort_order
           FROM override_reasons
          WHERE is_active = TRUE
          ORDER BY sort_order ASC, label ASC`
      );
      res.json({ reasons: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/override-reasons",
    feat,
    requirePerm("all_access"),
    async (req, res) => {
      const { code, label, sort_order } = req.body;
      if (!code || !label) {
        return res.status(400).json({ error: "code and label are required" });
      }
      try {
        const { rows } = await db.query(
          `INSERT INTO override_reasons (code, label, sort_order)
             VALUES ($1, $2, $3) RETURNING *`,
          [code, label, Number(sort_order) || 0]
        );
        res.status(201).json({ reason: rows[0] });
      } catch (err) {
        if (err.code === "23505") {
          return res.status(409).json({ error: "Reason code already exists" });
        }
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.put(
    "/api/override-reasons/:id",
    feat,
    requirePerm("all_access"),
    async (req, res) => {
      const { id } = req.params;
      const { label, sort_order, is_active } = req.body;
      try {
        const { rows, rowCount } = await db.query(
          `UPDATE override_reasons
              SET label = COALESCE($1, label),
                  sort_order = COALESCE($2, sort_order),
                  is_active = COALESCE($3, is_active)
            WHERE id = $4
            RETURNING *`,
          [label ?? null, sort_order ?? null, is_active ?? null, id]
        );
        if (rowCount === 0) {
          return res.status(404).json({ error: "Reason not found" });
        }
        res.json({ reason: rows[0] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.delete(
    "/api/override-reasons/:id",
    feat,
    requirePerm("all_access"),
    async (req, res) => {
      const { id } = req.params;
      try {
        const { rowCount } = await db.query(
          "UPDATE override_reasons SET is_active = FALSE WHERE id = $1",
          [id]
        );
        if (rowCount === 0) {
          return res.status(404).json({ error: "Reason not found" });
        }
        res.json({ message: "Reason deactivated" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
