const { getCategoryById, getDescendantLeafIds } = require("../category-tree");
const { evaluatePromotions } = require("../services/promo-engine");

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
  // Body: { items: [{product_id, category_id, brand_id?, quantity, price}], order_total }
  //
  // The engine itself lives in services/promo-engine.js — shared with the
  // storefront/portal quote path (services/quote.js) so POS, field-rep,
  // storefront, and portal reorder all apply the same schemes (priority
  // ordering, brand scope, slab_percent tiers included).
  app.post("/api/promotions/quote", async (req, res) => {
    const { items = [], order_total = 0 } = req.body;
    try {
      const { applied, totalDiscount } = await evaluatePromotions(db, items, order_total);
      res.json({
        applied_promotions: applied,
        total_promotion_discount: parseFloat(totalDiscount.toFixed(2)),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
