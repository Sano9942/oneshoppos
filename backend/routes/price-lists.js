/**
 * Price list standalone routes — supplements the existing CRUD in products.js
 * with assignment-aware detail views and bulk item management.
 */
module.exports = function registerPriceListRoutes(app, deps) {
  const { db, requirePerm } = deps;

  // GET /api/price-lists/:id — single price list with items and assignments
  app.get("/api/price-lists/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rows: plRows } = await db.query(
        `SELECT pl.*, COUNT(pli.id)::int AS item_count
         FROM price_lists pl
         LEFT JOIN price_list_items pli ON pli.price_list_id = pl.id
         WHERE pl.id = $1
         GROUP BY pl.id`,
        [id]
      );
      if (!plRows.length) return res.status(404).json({ error: "Price list not found" });

      const { rows: items } = await db.query(
        `SELECT pli.*,
                p.name AS product_name, p.sku, p.price AS default_price,
                pv.sku AS variant_name, pv.sku AS variant_sku, pv.price AS variant_price
         FROM price_list_items pli
         JOIN products p ON p.id = pli.product_id
         LEFT JOIN product_variants pv ON pv.id = pli.variant_id
         WHERE pli.price_list_id = $1
         ORDER BY p.name ASC, pv.sku ASC`,
        [id]
      );

      const { rows: assignments } = await db.query(
        `SELECT pla.*, o.name AS outlet_name
         FROM price_list_assignments pla
         LEFT JOIN outlets o ON pla.scope_type = 'outlet' AND pla.scope_id = o.id
         WHERE pla.price_list_id = $1
         ORDER BY pla.priority DESC`,
        [id]
      );

      res.json({ priceList: plRows[0], items, assignments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
