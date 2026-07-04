const { resolvePriceForContext } = require("../services/pricing");

module.exports = function registerPriceListAssignmentRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;

  const feat = requireFeature("phase2_outlet_pricing");

  // List assignments
  app.get("/api/price-list-assignments", feat, async (req, res) => {
    try {
      const { price_list_id, scope_type, scope_id } = req.query;
      let sql = `
        SELECT pla.*, pl.name AS price_list_name, o.name AS outlet_name
        FROM price_list_assignments pla
        JOIN price_lists pl ON pla.price_list_id = pl.id
        LEFT JOIN outlets o ON pla.scope_type = 'outlet' AND pla.scope_id = o.id
        WHERE pla.is_active = TRUE
      `;
      const params = [];
      let idx = 1;
      if (price_list_id) { sql += ` AND pla.price_list_id = $${idx++}`; params.push(price_list_id); }
      if (scope_type) { sql += ` AND pla.scope_type = $${idx++}`; params.push(scope_type); }
      if (scope_id) { sql += ` AND pla.scope_id = $${idx++}`; params.push(scope_id); }
      sql += " ORDER BY pla.priority DESC, pla.created_at DESC";
      const { rows } = await db.query(sql, params);
      res.json({ assignments: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create assignment
  app.post("/api/price-list-assignments", feat, requirePerm("manage_inventory"), async (req, res) => {
    const { price_list_id, scope_type, scope_id, priority, starts_at, ends_at } = req.body;
    if (!price_list_id || !scope_type || !scope_id) {
      return res.status(400).json({ error: "price_list_id, scope_type, and scope_id are required" });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO price_list_assignments (price_list_id, scope_type, scope_id, priority, starts_at, ends_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [price_list_id, scope_type, scope_id, priority || 0, starts_at || null, ends_at || null]
      );
      res.status(201).json({ assignment: rows[0] });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "This assignment already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Update assignment
  app.put("/api/price-list-assignments/:id", feat, requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const { priority, is_active, starts_at, ends_at } = req.body;
    try {
      const { rows, rowCount } = await db.query(
        `UPDATE price_list_assignments
         SET priority = COALESCE($1, priority),
             is_active = COALESCE($2, is_active),
             starts_at = $3,
             ends_at = $4
         WHERE id = $5 RETURNING *`,
        [priority, is_active, starts_at || null, ends_at || null, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Assignment not found" });
      res.json({ assignment: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete assignment
  app.delete("/api/price-list-assignments/:id", feat, requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query("DELETE FROM price_list_assignments WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Assignment not found" });
      res.json({ message: "Assignment removed" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Resolve price for a product in context (used by POS)
  app.get("/api/price-resolve", feat, async (req, res) => {
    const { product_id, variant_id, outlet_id, channel_id, customer_id, qty } = req.query;
    if (!product_id) return res.status(400).json({ error: "product_id is required" });
    try {
      const resolved = await resolvePriceForContext(db, {
        productId: Number(product_id),
        variantId: variant_id ? Number(variant_id) : null,
        outletId: outlet_id ? Number(outlet_id) : null,
        channelId: channel_id ? Number(channel_id) : null,
        customerId: customer_id ? Number(customer_id) : null,
        qty: qty ? Number(qty) : 1,
      });
      res.json(resolved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Per-product outlet price overrides ─────────────────────────────────────
  //
  // The product edit page shows an "Outlet Pricing" section (one row per
  // active outlet, blank input = base price, numeric = override). Behind the
  // scenes we use a hidden "system-managed" price list per outlet, named
  // `__outlet_<outletId>_overrides`, with a high-priority assignment so the
  // override always wins over any user-created bulk price list at the same
  // outlet. POS price resolution in useCart.js doesn't change — it already
  // sorts by priority DESC and picks the highest match.
  //
  // GET returns one row per active outlet, with the current override price
  // (or null = no override = uses base price).
  app.get("/api/products/:id/outlet-prices", feat, async (req, res) => {
    const productId = Number(req.params.id);
    if (!productId) return res.status(400).json({ error: "invalid product id" });
    try {
      const { rows } = await db.query(
        `SELECT o.id AS outlet_id,
                o.name AS outlet_name,
                pli.price
         FROM outlets o
         LEFT JOIN price_lists pl
                ON pl.name = '__outlet_' || o.id || '_overrides'
         LEFT JOIN price_list_items pli
                ON pli.price_list_id = pl.id
                AND pli.product_id = $1
                AND pli.variant_id IS NULL
                AND pli.min_qty = 1
         WHERE o.is_active = TRUE
         ORDER BY o.name`,
        [productId],
      );
      res.json({ prices: rows.map((r) => ({
        outlet_id: r.outlet_id,
        outlet_name: r.outlet_name,
        price: r.price == null ? null : Number(r.price),
      })) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT body: { prices: [{ outlet_id, price }] }
  // price === null OR price === "" → delete the override (revert to base).
  // price === number → upsert the override.
  // Auto-creates the system price list and its high-priority assignment per
  // outlet on first use. All within a single transaction.
  app.put(
    "/api/products/:id/outlet-prices",
    feat,
    requirePerm("manage_inventory"),
    async (req, res) => {
      const productId = Number(req.params.id);
      if (!productId) return res.status(400).json({ error: "invalid product id" });
      const { prices } = req.body || {};
      if (!Array.isArray(prices)) {
        return res.status(400).json({ error: "prices array is required" });
      }
      try {
        await db.transaction(async (client) => {
          for (const entry of prices) {
            const outletId = Number(entry.outlet_id);
            if (!outletId) continue;
            const rawPrice = entry.price;
            const isClearing = rawPrice === null || rawPrice === undefined || rawPrice === "";
            const numericPrice = isClearing ? null : Number(rawPrice);
            if (!isClearing && (!Number.isFinite(numericPrice) || numericPrice < 0)) {
              throw new Error(`Invalid price for outlet ${outletId}`);
            }

            // Look up or create the system list for this outlet.
            const listName = `__outlet_${outletId}_overrides`;
            const { rows: outletRows } = await client.query(
              `SELECT name FROM outlets WHERE id = $1 AND is_active = TRUE`,
              [outletId],
            );
            if (!outletRows.length) continue; // outlet missing or inactive — skip
            const outletName = outletRows[0].name;

            const { rows: existing } = await client.query(
              `SELECT id FROM price_lists WHERE name = $1`,
              [listName],
            );
            let listId;
            if (existing.length) {
              listId = existing[0].id;
            } else if (isClearing) {
              // Nothing to delete and no list yet — skip creation entirely.
              continue;
            } else {
              const { rows: created } = await client.query(
                `INSERT INTO price_lists (name, description, type, is_active)
                 VALUES ($1, $2, 'customer_group', TRUE)
                 RETURNING id`,
                [
                  listName,
                  `System-managed: per-product price overrides for outlet "${outletName}". Edited via the Outlet Pricing section on each product's page.`,
                ],
              );
              listId = created[0].id;
            }

            // Ensure the assignment exists (priority 1000 beats user lists).
            await client.query(
              `INSERT INTO price_list_assignments (price_list_id, scope_type, scope_id, priority, is_active)
               VALUES ($1, 'outlet', $2, 1000, TRUE)
               ON CONFLICT (price_list_id, scope_type, scope_id)
               DO UPDATE SET priority = 1000, is_active = TRUE`,
              [listId, outletId],
            );

            // Delete any existing override row for this product on this list.
            // (UNIQUE constraint includes variant_id, but Postgres treats
            // NULL != NULL for unique purposes — so we can't rely on
            // ON CONFLICT here. Delete-then-insert is the correct pattern.)
            await client.query(
              `DELETE FROM price_list_items
               WHERE price_list_id = $1
                 AND product_id = $2
                 AND variant_id IS NULL
                 AND min_qty = 1`,
              [listId, productId],
            );

            if (!isClearing) {
              await client.query(
                `INSERT INTO price_list_items (price_list_id, product_id, variant_id, price, min_qty)
                 VALUES ($1, $2, NULL, $3, 1)`,
                [listId, productId, numericPrice],
              );
            }
          }
        });

        // Return the fresh state so the client can re-render.
        const { rows } = await db.query(
          `SELECT o.id AS outlet_id,
                  o.name AS outlet_name,
                  pli.price
           FROM outlets o
           LEFT JOIN price_lists pl
                  ON pl.name = '__outlet_' || o.id || '_overrides'
           LEFT JOIN price_list_items pli
                  ON pli.price_list_id = pl.id
                  AND pli.product_id = $1
                  AND pli.variant_id IS NULL
                  AND pli.min_qty = 1
           WHERE o.is_active = TRUE
           ORDER BY o.name`,
          [productId],
        );
        res.json({ prices: rows.map((r) => ({
          outlet_id: r.outlet_id,
          outlet_name: r.outlet_name,
          price: r.price == null ? null : Number(r.price),
        })) });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};

// Price resolution now lives in services/pricing.js (shared with the
// storefront quote engine and the field-rep price quote) — one cascade,
// customer scope before outlet scope, qty-aware min_qty breaks.
