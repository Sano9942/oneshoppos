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
  app.get("/api/promotions", (req, res) => {
    db.all(
      "SELECT * FROM promotions ORDER BY created_at DESC",
      [],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ promotions: rows });
      },
    );
  });

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
      starts_at,
      ends_at,
    } = req.body;
    if (!name || !type || value === undefined)
      return res.status(400).json({ error: "name, type, value are required" });
    if (applies_to === "category") {
      const categoryError = await validatePromotionCategory(category_id);
      if (categoryError) {
        return res.status(400).json({ error: categoryError });
      }
    }
    db.run(
      `INSERT INTO promotions (name, type, value, min_order_amount, buy_qty, get_qty, applies_to, product_id, category_id, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        starts_at || null,
        ends_at || null,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Promotion created", id: this.lastID });
      },
    );
  });

  // PUT update promotion
  app.put(
    "/api/promotions/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
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
        active,
        starts_at,
        ends_at,
      } = req.body;
      if (applies_to === "category") {
        const categoryError = await validatePromotionCategory(category_id);
        if (categoryError) {
          return res.status(400).json({ error: categoryError });
        }
      }
      db.run(
        `UPDATE promotions SET name=?, type=?, value=?, min_order_amount=?, buy_qty=?, get_qty=?,
     applies_to=?, product_id=?, category_id=?, active=?, starts_at=?, ends_at=? WHERE id=?`,
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
          active !== undefined ? active : 1,
          starts_at || null,
          ends_at || null,
          id,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Promotion not found" });
          res.json({ message: "Promotion updated" });
        },
      );
    },
  );

  // DELETE promotion
  app.delete(
    "/api/promotions/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.run(
        "DELETE FROM promotions WHERE id = ?",
        [req.params.id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0)
            return res.status(404).json({ error: "Promotion not found" });
          res.json({ message: "Promotion deleted" });
        },
      );
    },
  );

  // POST /api/promotions/quote — evaluate active promotions against a cart
  // Body: { items: [{product_id, category_id, quantity, price}], order_total }
  app.post("/api/promotions/quote", (req, res) => {
    const { items = [], order_total = 0 } = req.body;
    const now = new Date().toISOString().slice(0, 10);

    db.all(
      `SELECT * FROM promotions WHERE active = 1
     AND (starts_at IS NULL OR starts_at <= ?)
     AND (ends_at IS NULL OR ends_at >= ?)
     ORDER BY id ASC`,
      [now, now],
      (err, promos) => {
        if (err) return res.status(500).json({ error: err.message });

        const applied = [];
        let totalDiscount = 0;

        for (const promo of promos) {
          const itemMatches = (item) => {
            if (promo.applies_to === "all") return true;
            if (promo.applies_to === "product" && promo.product_id)
              return item.product_id === promo.product_id;
            if (promo.applies_to === "category" && promo.category_id)
              return item.category_id === promo.category_id;
            return false;
          };

          const matchedItems = items.filter(itemMatches);
          const matchedTotal = matchedItems.reduce(
            (s, i) => s + i.price * i.quantity,
            0,
          );
          let discount = 0;

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
              matchedItems.forEach((item) => {
                const sets = Math.floor(
                  item.quantity / (promo.buy_qty + promo.get_qty),
                );
                discount += sets * promo.get_qty * item.price;
              });
            }
          }

          if (discount > 0) {
            totalDiscount += discount;
            applied.push({
              promotion_id: promo.id,
              name: promo.name,
              type: promo.type,
              discount: parseFloat(discount.toFixed(2)),
            });
          }
        }

        res.json({
          applied_promotions: applied,
          total_promotion_discount: parseFloat(totalDiscount.toFixed(2)),
        });
      },
    );
  });
};
