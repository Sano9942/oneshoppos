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
    const { product_id, variant_id, outlet_id, channel_id, customer_id } = req.query;
    if (!product_id) return res.status(400).json({ error: "product_id is required" });
    try {
      const resolved = await resolvePriceForContext(db, {
        productId: Number(product_id),
        variantId: variant_id ? Number(variant_id) : null,
        outletId: outlet_id ? Number(outlet_id) : null,
        channelId: channel_id ? Number(channel_id) : null,
        customerId: customer_id ? Number(customer_id) : null,
      });
      res.json(resolved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

/**
 * Price resolution cascade:
 * 1. Outlet assignment → price_list_assignments WHERE scope_type='outlet'
 * 2. Channel assignment → price_list_assignments WHERE scope_type='channel'
 * 3. Customer or customer_group assignment
 * 4. Customer's direct price_list_id
 * 5. Product/variant base price
 */
async function resolvePriceForContext(db, { productId, variantId, outletId, channelId, customerId }) {
  const now = new Date().toISOString();

  // Build candidate scopes in priority order
  const scopes = [];
  if (outletId) scopes.push({ type: "outlet", id: outletId });
  if (channelId) scopes.push({ type: "channel", id: channelId });
  if (customerId) {
    scopes.push({ type: "customer", id: customerId });
    // Check customer group
    try {
      const { rows } = await db.query(
        "SELECT group_id FROM customer_group_members WHERE customer_id = $1 LIMIT 1",
        [customerId]
      );
      if (rows[0]) scopes.push({ type: "customer_group", id: rows[0].group_id });
    } catch (_) { /* table may not exist */ }
  }

  // Try assigned price lists
  for (const scope of scopes) {
    const { rows: assignments } = await db.query(
      `SELECT pla.price_list_id
       FROM price_list_assignments pla
       JOIN price_lists pl ON pl.id = pla.price_list_id AND pl.is_active = TRUE
       WHERE pla.scope_type = $1 AND pla.scope_id = $2 AND pla.is_active = TRUE
         AND (pla.starts_at IS NULL OR pla.starts_at <= $3)
         AND (pla.ends_at IS NULL OR pla.ends_at >= $4)
       ORDER BY pla.priority DESC LIMIT 1`,
      [scope.type, scope.id, now, now]
    );
    if (assignments[0]) {
      const plId = assignments[0].price_list_id;
      const price = await lookupPriceListPrice(db, plId, productId, variantId);
      if (price != null) {
        return { price: Number(price), source: `price_list_assignment:${scope.type}`, price_list_id: plId };
      }
    }
  }

  // Try customer's direct price_list_id
  if (customerId) {
    try {
      const { rows } = await db.query(
        "SELECT price_list_id FROM customers WHERE id = $1 AND price_list_id IS NOT NULL",
        [customerId]
      );
      if (rows[0]) {
        const price = await lookupPriceListPrice(db, rows[0].price_list_id, productId, variantId);
        if (price != null) {
          return { price: Number(price), source: "customer_price_list", price_list_id: rows[0].price_list_id };
        }
      }
    } catch (_) {}
  }

  // Fall back to product/variant base price
  const { rows: baseRows } = await db.query(
    `SELECT p.price AS product_price, pv.price AS variant_price
     FROM products p
     LEFT JOIN product_variants pv ON pv.id = $2 AND pv.product_id = p.id
     WHERE p.id = $1`,
    [productId, variantId]
  );
  if (baseRows[0]) {
    const base = baseRows[0].variant_price != null ? Number(baseRows[0].variant_price) : Number(baseRows[0].product_price);
    return { price: base, source: "base_price", price_list_id: null };
  }

  return { price: 0, source: "not_found", price_list_id: null };
}

async function lookupPriceListPrice(db, priceListId, productId, variantId) {
  const { rows } = await db.query(
    `SELECT price FROM price_list_items
     WHERE price_list_id = $1 AND product_id = $2
       AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
     ORDER BY min_qty ASC LIMIT 1`,
    [priceListId, productId, variantId || null]
  );
  return rows[0]?.price ?? null;
}
