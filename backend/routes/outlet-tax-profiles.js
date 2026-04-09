module.exports = function registerOutletTaxProfileRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_outlet_tax");

  // GET /api/outlet-tax-profiles
  app.get("/api/outlet-tax-profiles", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT otp.*,
                o.name AS outlet_name,
                json_agg(json_build_object(
                  'id', otpl.id,
                  'category_id', otpl.category_id,
                  'product_id', otpl.product_id,
                  'tax_id', otpl.tax_id,
                  'priority', otpl.priority,
                  'tax_name', t.name,
                  'tax_rate', t.rate
                ) ORDER BY otpl.priority DESC) FILTER (WHERE otpl.id IS NOT NULL) AS lines
         FROM outlet_tax_profiles otp
         JOIN outlets o ON o.id = otp.outlet_id
         LEFT JOIN outlet_tax_profile_lines otpl ON otpl.profile_id = otp.id
         LEFT JOIN taxes t ON t.id = otpl.tax_id
         GROUP BY otp.id, o.name
         ORDER BY o.name`
      );
      res.json({ profiles: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/outlet-tax-profiles/:id
  app.get("/api/outlet-tax-profiles/:id", feat, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM outlet_tax_profiles WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Profile not found" });
      const profile = rows[0];

      const { rows: lines } = await db.query(
        `SELECT otpl.*, t.name AS tax_name, t.rate AS tax_rate
         FROM outlet_tax_profile_lines otpl
         JOIN taxes t ON t.id = otpl.tax_id
         WHERE otpl.profile_id = $1
         ORDER BY otpl.priority DESC`,
        [profile.id]
      );
      profile.lines = lines;
      res.json({ profile });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/outlet-tax-profiles/:outletId
  // Body: { name, is_active, lines: [{ category_id?, product_id?, tax_id, priority }] }
  app.put("/api/outlet-tax-profiles/:outletId", feat, requirePerm("all_access"), async (req, res) => {
    const { name, is_active, lines } = req.body;
    const outletId = req.params.outletId;
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO outlet_tax_profiles (outlet_id, name, is_active)
           VALUES ($1, $2, $3)
           ON CONFLICT (outlet_id) DO UPDATE SET
             name = COALESCE($2, outlet_tax_profiles.name),
             is_active = COALESCE($3, outlet_tax_profiles.is_active),
             updated_at = NOW()
           RETURNING *`,
          [outletId, name || "Default", is_active !== false]
        );
        const profile = rows[0];

        if (Array.isArray(lines)) {
          await client.query("DELETE FROM outlet_tax_profile_lines WHERE profile_id = $1", [profile.id]);
          for (const line of lines) {
            await client.query(
              `INSERT INTO outlet_tax_profile_lines (profile_id, category_id, product_id, tax_id, priority)
               VALUES ($1, $2, $3, $4, $5)`,
              [profile.id, line.category_id || null, line.product_id || null, line.tax_id, line.priority || 0]
            );
          }
        }
        return profile;
      });
      res.json({ profile: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/outlet-tax-profiles/:outletId
  app.delete("/api/outlet-tax-profiles/:outletId", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM outlet_tax_profiles WHERE outlet_id = $1", [req.params.outletId]);
      if (!rowCount) return res.status(404).json({ error: "No tax profile for this outlet" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/outlet-tax-profiles/resolve?outlet_id=X&product_id=Y&category_id=Z
  app.get("/api/outlet-tax-profiles/resolve", feat, async (req, res) => {
    const { outlet_id, product_id, category_id } = req.query;
    if (!outlet_id) return res.status(400).json({ error: "outlet_id required" });
    try {
      const { rows: profileLines } = await db.query(
        `SELECT otpl.*, t.name AS tax_name, t.rate AS tax_rate
         FROM outlet_tax_profiles otp
         JOIN outlet_tax_profile_lines otpl ON otpl.profile_id = otp.id
         LEFT JOIN taxes t ON t.id = otpl.tax_id
         WHERE otp.outlet_id = $1 AND otp.is_active = TRUE
           AND (otpl.product_id = $2 OR otpl.category_id = $3 OR (otpl.product_id IS NULL AND otpl.category_id IS NULL))
         ORDER BY otpl.priority DESC
         LIMIT 1`,
        [outlet_id, product_id || null, category_id || null]
      );

      if (profileLines.length) {
        return res.json({ tax: profileLines[0], source: "outlet_profile" });
      }

      if (product_id) {
        const { rows } = await db.query(
          `SELECT t.id AS tax_id, t.name AS tax_name, t.rate AS tax_rate
           FROM products p
           LEFT JOIN taxes t ON t.id = p.tax_id
           WHERE p.id = $1`,
          [product_id]
        );
        if (rows.length && rows[0].tax_id) {
          return res.json({ tax: rows[0], source: "product_default" });
        }
      }

      res.json({ tax: null, source: "none" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
