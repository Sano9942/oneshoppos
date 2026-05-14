const { getCategoryById, getDescendantLeafIds } = require("../category-tree");

module.exports = function registerPromotionRoutes(app, deps) {
  const { db, requirePerm } = deps;


  async function validatePromotionCategory(categoryId) {
    if (!categoryId) return null;
    const category = await getCategoryById(db, categoryId);
    if (!category) return "Category not found";
    const leafIds = await getDescendantLeafIds(db, category.id);
    if (leafIds.length !== 1 || Number(leafIds[0]) !== Number(category.id)) {
      return "Promotions can only target leaf categories";
    }
    return null;
  }

// --- PROMOTIONS ENGINE ---

  // GET all promotions
  app.get("/api/promotions", async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM promotions ORDER BY created_at DESC",
      );
      res.json({ promotions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // v93 (Tier 1.3 wholesale schemes): validate tier_rules JSONB shape when
  // type='slab_percent'. Tiers must be a non-empty ascending array of
  // { qty_from, qty_to|null, value } with non-overlapping bands.
  function validateTierRules(type, tierRules) {
    if (type !== "slab_percent") return null;
    if (!Array.isArray(tierRules) || tierRules.length === 0) {
      return "slab_percent requires a non-empty tier_rules array";
    }
    let prevTo = -Infinity;
    for (const t of tierRules) {
      const from = Number(t?.qty_from);
      const to = t?.qty_to == null ? Infinity : Number(t.qty_to);
      const value = Number(t?.value);
      if (!Number.isFinite(from) || from < 0) return "qty_from must be non-negative";
      if (t?.qty_to != null && (!Number.isFinite(to) || to < from)) {
        return "qty_to must be >= qty_from";
      }
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return "tier value must be 0-100 (percent)";
      }
      if (from <= prevTo) return "tier bands must be non-overlapping and ascending";
      prevTo = to;
    }
    return null;
  }

  // POST create promotion
  app.post("/api/promotions", requirePerm("manage_inventory"), async (req, res) => {
    const {
      name,
      type,
      value,
      min_order_amount = 0,
      buy_qty = 0,
      get_qty = 0,
      applies_to = "all",
      product_id,
      category_id,
      brand_id,
      starts_at,
      ends_at,
      tier_rules,
      priority,
    } = req.body;
    if (!name || !type || value === undefined)
      return res.status(400).json({ error: "name, type, value are required" });
    if (applies_to === "category") {
      const categoryError = await validatePromotionCategory(category_id);
      if (categoryError) {
        return res.status(400).json({ error: categoryError });
      }
    }
    if (applies_to === "brand" && !brand_id) {
      return res.status(400).json({ error: "brand_id is required when applies_to='brand'" });
    }
    const tierErr = validateTierRules(type, tier_rules);
    if (tierErr) return res.status(400).json({ error: tierErr });
    try {
      const { rows } = await db.query(
        `INSERT INTO promotions (name, type, value, min_order_amount, buy_qty, get_qty, applies_to, product_id, category_id, brand_id, starts_at, ends_at, tier_rules, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          name,
          type,
          value,
          min_order_amount,
          buy_qty,
          get_qty,
          applies_to,
          product_id || null,
          category_id || null,
          brand_id || null,
          starts_at || null,
          ends_at || null,
          tier_rules ? JSON.stringify(tier_rules) : null,
          Number.isFinite(Number(priority)) ? Number(priority) : 0,
        ],
      );
      res.json({ message: "Promotion created", id: rows[0].id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update promotion
  app.put("/api/promotions/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const {
      name,
      type,
      value,
      min_order_amount = 0,
      buy_qty = 0,
      get_qty = 0,
      applies_to = "all",
      product_id,
      category_id,
      brand_id,
      active,
      starts_at,
      ends_at,
      tier_rules,
      priority,
    } = req.body;
    if (applies_to === "category") {
      const categoryError = await validatePromotionCategory(category_id);
      if (categoryError) {
        return res.status(400).json({ error: categoryError });
      }
    }
    if (applies_to === "brand" && !brand_id) {
      return res.status(400).json({ error: "brand_id is required when applies_to='brand'" });
    }
    const tierErr = validateTierRules(type, tier_rules);
    if (tierErr) return res.status(400).json({ error: tierErr });
    try {
      const { rowCount } = await db.query(
        `UPDATE promotions SET name=$1, type=$2, value=$3, min_order_amount=$4, buy_qty=$5, get_qty=$6,
       applies_to=$7, product_id=$8, category_id=$9, brand_id=$10, active=$11, starts_at=$12, ends_at=$13,
       tier_rules=$14, priority=$15 WHERE id=$16`,
        [
          name,
          type,
          value,
          min_order_amount,
          buy_qty,
          get_qty,
          applies_to,
          product_id || null,
          category_id || null,
          brand_id || null,
          active !== undefined ? active : true,
          starts_at || null,
          ends_at || null,
          tier_rules ? JSON.stringify(tier_rules) : null,
          Number.isFinite(Number(priority)) ? Number(priority) : 0,
          id,
        ],
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Promotion not found" });
      res.json({ message: "Promotion updated" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE promotion
  app.delete("/api/promotions/:id", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM promotions WHERE id = $1",
        [req.params.id],
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Promotion not found" });
      res.json({ message: "Promotion deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/promotions/quote — evaluate active promotions against a cart
  // Body: { items: [{product_id, category_id, quantity, price}], order_total }
  //
  // v93 (Tier 1.3): adds slab_percent evaluator + brand-scoped matching.
  // Brand_id is hydrated from products table when any active promo needs it
  // — caller does not have to pass brand_id per item.
  app.post("/api/promotions/quote", async (req, res) => {
    const { items = [], order_total = 0 } = req.body;
    const now = new Date().toISOString().slice(0, 10);

    try {
      const { rows: promos } = await db.query(
        `SELECT * FROM promotions WHERE active = true
       AND (starts_at IS NULL OR starts_at <= $1)
       AND (ends_at IS NULL OR ends_at >= $2)
       ORDER BY priority DESC, id ASC`,
        [now, now],
      );

      // Hydrate item.brand_id if any active promo is brand-scoped and the
      // caller didn't pass brand_id on cart items.
      const needsBrand = promos.some(
        (p) => p.applies_to === "brand" || (p.type === "slab_percent" && p.brand_id),
      );
      const missingBrandIds = items
        .filter((i) => needsBrand && i.brand_id == null)
        .map((i) => Number(i.product_id))
        .filter((id) => Number.isInteger(id) && id > 0);
      let brandMap = new Map();
      if (missingBrandIds.length) {
        const ids = Array.from(new Set(missingBrandIds));
        const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(",");
        const { rows: prodRows } = await db.query(
          `SELECT id, brand_id FROM products WHERE id IN (${placeholders})`,
          ids,
        );
        brandMap = new Map(prodRows.map((p) => [Number(p.id), p.brand_id]));
      }
      const hydratedItems = items.map((i) => ({
        ...i,
        brand_id:
          i.brand_id != null ? Number(i.brand_id) : brandMap.get(Number(i.product_id)) ?? null,
      }));

      const applied = [];
      let totalDiscount = 0;

      for (const promo of promos) {
        const itemMatches = (item) => {
          if (promo.applies_to === "all") return true;
          if (promo.applies_to === "product" && promo.product_id)
            return item.product_id === promo.product_id;
          if (promo.applies_to === "category" && promo.category_id)
            return item.category_id === promo.category_id;
          if (promo.applies_to === "brand" && promo.brand_id)
            return Number(item.brand_id) === Number(promo.brand_id);
          return false;
        };

        const matchedItems = hydratedItems.filter(itemMatches);
        const matchedTotal = matchedItems.reduce(
          (s, i) => s + i.price * i.quantity,
          0,
        );
        const matchedQty = matchedItems.reduce(
          (s, i) => s + Number(i.quantity || 0),
          0,
        );
        let discount = 0;
        let matchedTier = null;

        if (promo.type === "percent") {
          discount = matchedTotal * (promo.value / 100);
        } else if (promo.type === "fixed") {
          discount = Math.min(promo.value, matchedTotal);
        } else if (promo.type === "threshold_percent") {
          if (order_total >= promo.min_order_amount)
            discount = matchedTotal * (promo.value / 100);
        } else if (promo.type === "threshold_fixed") {
          if (order_total >= promo.min_order_amount)
            discount = Math.min(promo.value, matchedTotal);
        } else if (promo.type === "bxgy") {
          if (promo.buy_qty > 0 && promo.get_qty > 0) {
            const aggregated = {};
            matchedItems.forEach((item) => {
              const pid = item.product_id;
              if (!aggregated[pid]) {
                aggregated[pid] = { quantity: 0, totalValue: 0 };
              }
              aggregated[pid].quantity += item.quantity;
              aggregated[pid].totalValue += item.quantity * item.price;
            });
            Object.values(aggregated).forEach((agg) => {
              const sets = Math.floor(
                agg.quantity / (promo.buy_qty + promo.get_qty),
              );
              const avgPrice = agg.totalValue / agg.quantity;
              discount += sets * promo.get_qty * avgPrice;
            });
          }
        } else if (promo.type === "slab_percent") {
          // Volume slab: total matched qty determines which tier applies.
          // tier_rules is a JSONB array of { qty_from, qty_to|null, value }.
          // Pick the single highest-value matching tier (no stacking across
          // tiers).
          const tiers = Array.isArray(promo.tier_rules) ? promo.tier_rules : [];
          for (const t of tiers) {
            const from = Number(t.qty_from);
            const to = t.qty_to == null ? Infinity : Number(t.qty_to);
            if (matchedQty >= from && matchedQty <= to) {
              matchedTier = t;
              discount = matchedTotal * (Number(t.value) / 100);
              break;
            }
          }
        }

        if (discount > 0) {
          totalDiscount += discount;
          applied.push({
            promotion_id: promo.id,
            name: promo.name,
            type: promo.type,
            discount: parseFloat(discount.toFixed(2)),
            qty_qualifying: matchedQty,
            tier: matchedTier,
          });
        }
      }

      res.json({
        applied_promotions: applied,
        total_promotion_discount: parseFloat(totalDiscount.toFixed(2)),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
