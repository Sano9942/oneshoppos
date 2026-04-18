// Phase 2-R.1 — 86'd items (menu availability).
//
// Restaurant managers flag individual products (or variants later) as
// sold-out. The public QR menu omits them; item-add refuses with 422.
// Retail tenants and restaurant tenants without the `phase4_restaurant_86`
// flag are unaffected — routes return 503 and public menu behaves as
// it did pre-v58.

module.exports = function registerRestaurantAvailabilityRoutes(app, deps) {
  const { requireFeature, requireMode } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");
  const { validate } = require("../../middleware/validate");
  const { soldOutSetSchema } = require("../../schemas/restaurant-availability");

  const gate = [
    requireMode("restaurant"),
    requireFeature("phase4_restaurant_86"),
    requirePerm("manage_restaurant"),
  ];

  // List currently sold-out products (variants stream included so the
  // admin page can un-86 at either level in one view).
  app.get("/api/restaurant/sold-out", ...gate, async (req, res) => {
    try {
      const { rows: products } = await deps.db.query(
        `SELECT p.id, p.name, p.sold_out_since, p.sold_out_until, p.sold_out_reason
         FROM products p
         WHERE p.is_sold_out = true AND p.deleted_at IS NULL
         ORDER BY p.sold_out_since DESC NULLS LAST, p.name`
      );
      const { rows: variants } = await deps.db.query(
        `SELECT v.id, v.sku, v.product_id, p.name AS product_name,
                v.sold_out_since, v.sold_out_until, v.sold_out_reason
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         WHERE v.is_sold_out = true
         ORDER BY v.sold_out_since DESC NULLS LAST, p.name`
      );
      res.json({ products, variants });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Mark a product sold-out. Reason required; `until` optional auto-clear.
  app.post(
    "/api/restaurant/products/:id/sold-out",
    ...gate,
    validate(soldOutSetSchema),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: "Invalid product id" });
        }
        const { reason, until } = req.body;
        const { rows: [row] } = await deps.db.query(
          `UPDATE products
             SET is_sold_out = true,
                 sold_out_since = NOW(),
                 sold_out_until = $2,
                 sold_out_reason = $3
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id, name, is_sold_out, sold_out_since, sold_out_until, sold_out_reason`,
          [id, until || null, reason]
        );
        if (!row) return res.status(404).json({ error: "Product not found" });

        try {
          await deps.db.query(
            "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
            [
              req.employee?.id || null,
              "restaurant_product_sold_out",
              JSON.stringify({ product_id: id, reason, until: until || null }),
            ]
          );
        } catch { /* audit logging is best-effort */ }

        res.status(201).json(row);
      } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    }
  );

  // Clear sold-out. Idempotent — clearing an already-available product is OK.
  app.delete("/api/restaurant/products/:id/sold-out", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid product id" });
      }
      const { rows: [row] } = await deps.db.query(
        `UPDATE products
           SET is_sold_out = false,
               sold_out_since = NULL,
               sold_out_until = NULL,
               sold_out_reason = NULL
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, name, is_sold_out`,
        [id]
      );
      if (!row) return res.status(404).json({ error: "Product not found" });

      try {
        await deps.db.query(
          "INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)",
          [
            req.employee?.id || null,
            "restaurant_product_unsold_out",
            JSON.stringify({ product_id: id }),
          ]
        );
      } catch { /* audit logging is best-effort */ }

      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
