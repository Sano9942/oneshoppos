module.exports = function registerOutletVisibilityRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_outlet_visibility");

  // GET /api/products/:id/outlet-visibility
  app.get("/api/products/:id/outlet-visibility", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT o.id AS outlet_id, o.name AS outlet_name,
                COALESCE(opv.is_visible, TRUE) AS is_visible,
                opv.updated_at
         FROM outlets o
         LEFT JOIN outlet_product_visibility opv ON opv.outlet_id = o.id AND opv.product_id = $1
         WHERE o.is_active = TRUE
         ORDER BY o.name`,
        [req.params.id]
      );
      res.json({ visibility: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/products/:id/outlet-visibility
  // Body: { outlets: [{ outlet_id, is_visible }] }
  app.put("/api/products/:id/outlet-visibility", feat, requirePerm("all_access"), async (req, res) => {
    const { outlets } = req.body;
    if (!Array.isArray(outlets)) return res.status(400).json({ error: "outlets array required" });
    try {
      await db.transaction(async (client) => {
        for (const { outlet_id, is_visible } of outlets) {
          await client.query(
            `INSERT INTO outlet_product_visibility (outlet_id, product_id, is_visible)
             VALUES ($1, $2, $3)
             ON CONFLICT (outlet_id, product_id)
             DO UPDATE SET is_visible = $3, updated_at = NOW()`,
            [outlet_id, req.params.id, is_visible !== false]
          );
        }
      });
      const { rows } = await db.query(
        `SELECT o.id AS outlet_id, o.name AS outlet_name,
                COALESCE(opv.is_visible, TRUE) AS is_visible
         FROM outlets o
         LEFT JOIN outlet_product_visibility opv ON opv.outlet_id = o.id AND opv.product_id = $1
         WHERE o.is_active = TRUE
         ORDER BY o.name`,
        [req.params.id]
      );
      res.json({ visibility: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/outlet-visibility/by-outlet/:outletId — list visible products for an outlet
  app.get("/api/outlet-visibility/by-outlet/:outletId", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT p.id, p.name, p.barcode, p.price, p.status,
                COALESCE(opv.is_visible, TRUE) AS is_visible
         FROM products p
         LEFT JOIN outlet_product_visibility opv ON opv.product_id = p.id AND opv.outlet_id = $1
         WHERE p.deleted_at IS NULL AND p.status = 'active'
         ORDER BY p.name`,
        [req.params.outletId]
      );
      res.json({ products: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/outlet-visibility/bulk — bulk set visibility for an outlet
  // Body: { outlet_id, product_ids: [1,2,3], is_visible: true/false }
  app.put("/api/outlet-visibility/bulk", feat, requirePerm("all_access"), async (req, res) => {
    const { outlet_id, product_ids, is_visible } = req.body;
    if (!outlet_id || !Array.isArray(product_ids)) {
      return res.status(400).json({ error: "outlet_id and product_ids array required" });
    }
    try {
      await db.transaction(async (client) => {
        for (const pid of product_ids) {
          await client.query(
            `INSERT INTO outlet_product_visibility (outlet_id, product_id, is_visible)
             VALUES ($1, $2, $3)
             ON CONFLICT (outlet_id, product_id)
             DO UPDATE SET is_visible = $3, updated_at = NOW()`,
            [outlet_id, pid, is_visible !== false]
          );
        }
      });
      res.json({ success: true, updated: product_ids.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
