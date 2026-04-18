const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const {
  isProductAvailableNow,
  filterAvailableProducts,
} = require("../services/menu-schedule-resolver");
const { getFeatureFlagsMap } = require("../middleware/feature-flags");

module.exports = function registerPublicRestaurantRoutes(app, deps) {

  // GET /api/public/restaurant/menu/:token — public menu for QR
  app.get("/api/public/restaurant/menu/:token", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      // Validate token → resolves to outlet + table
      const { rows: [tokenRow] } = await db.query(
        `SELECT d.id AS draft_order_id, d.table_id, d.outlet_id, rt.label AS table_label
         FROM draft_orders d
         JOIN restaurant_tables rt ON rt.id = d.table_id
         WHERE d.source_token_id = $1 AND d.status = 'open' AND d.order_context IN ('dine_in','bar')`,
        [req.params.token]
      );

      let outletId, tableLabel;
      if (tokenRow) {
        outletId = tokenRow.outlet_id;
        tableLabel = tokenRow.table_label;
      } else {
        return res.status(404).json({ error: "No active session found for this QR code" });
      }

      // Fetch published menu items for outlet. 2-R.1: hide products that
      // have been 86'd (sold-out). Retail tenants unaffected because
      // is_sold_out defaults to false.
      const { rows: itemsRaw } = await db.query(
        `SELECT p.id, p.name, p.description_html AS description, p.price, p.image_url,
                c.name AS category_name, c.id AS category_id
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.status = 'active' AND p.deleted_at IS NULL
           AND p.is_sold_out = false
         ORDER BY c.sort_order, c.name, p.name`
      );

      // 2-R.6 day-parting filter. Flag-gated so non-restaurant tenants and
      // restaurant tenants without the flag see the full menu.
      let items = itemsRaw;
      try {
        const flags = await getFeatureFlagsMap(req.tenantId);
        if (flags.phase4_restaurant_day_parting) {
          items = await filterAvailableProducts(db, itemsRaw, outletId);
        }
      } catch { /* if flags fetch fails, fall through with full menu */ }

      // Get company profile for branding
      const { rows: [profile] } = await db.query(
        "SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1"
      );

      res.json({
        table_label: tableLabel,
        company_name: profile?.company_name || "",
        logo_url: profile?.logo_url || null,
        currency_symbol: profile?.currency_symbol || "Rs",
        items,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/public/restaurant/checks/:token/items — add item from QR
  app.post("/api/public/restaurant/checks/:token/items", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { product_id, quantity, notes } = req.body || {};
      if (!product_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: "product_id and quantity >= 1 required" });
      }

      // Find open order for token
      const { rows: [order] } = await db.query(
        "SELECT * FROM draft_orders WHERE source_token_id = $1 AND status = 'open'",
        [req.params.token]
      );
      if (!order) return res.status(404).json({ error: "No active check for this token" });

      // Get product. 2-R.1: refuse 86'd items with 422 so the guest UI can
      // show a friendly "unavailable" toast instead of a generic error.
      const { rows: [product] } = await db.query(
        "SELECT id, name, price, is_sold_out FROM products WHERE id = $1 AND status = 'active' AND deleted_at IS NULL",
        [product_id]
      );
      if (!product) return res.status(404).json({ error: "Product not found" });
      if (product.is_sold_out) {
        return res.status(422).json({ error: "Item is currently unavailable" });
      }

      // 2-R.6 — refuse off-schedule adds when the flag is on.
      try {
        const flags = await getFeatureFlagsMap(req.tenantId);
        if (flags.phase4_restaurant_day_parting) {
          const available = await isProductAvailableNow(db, product.id, order.outlet_id);
          if (!available) {
            return res.status(422).json({ error: "Item not available at this time" });
          }
        }
      } catch { /* fall through if flag check fails */ }

      // Add item
      const { rows: [item] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [order.id, product.id, product.name, quantity, product.price, notes || null]
      );

      // Recalculate totals
      const { recalcCheckTotals } = require("../services/restaurant-checks");
      await recalcCheckTotals(db, order.id);

      res.status(201).json(item);
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
