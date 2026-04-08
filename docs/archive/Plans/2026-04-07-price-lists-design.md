# Price Lists / Multi-Price per Product — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add price list management (customer-specific and volume-based pricing) with full POS integration showing special prices in real time.

**Architecture:** Backend CRUD routes appended to `routes/products.js`. Frontend management page in `PriceListsRedesign.jsx`. POS price resolution is frontend-driven — when a customer with a `price_list_id` is selected, their price list items are fetched and cached in POSContext. Cart prices are overridden client-side with struck-through originals and "Special Price" badges.

**Tech Stack:** Express routes with `db.query()` (Postgres), React + Tailwind v4 frontend, POSContext state management.

---

### Task 1: Backend — Price List CRUD routes

**Files:**
- Modify: `backend/routes/products.js` (append before closing `};` at line 1024)

**Step 1: Add price list CRUD routes**

Append these routes before the closing `};` in `products.js`:

```javascript
  // ── Price Lists ──────────────────────────────────────────────────────

  app.get("/api/price-lists", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT pl.*, COUNT(pli.id)::int AS item_count
        FROM price_lists pl
        LEFT JOIN price_list_items pli ON pli.price_list_id = pl.id
        GROUP BY pl.id
        ORDER BY pl.name ASC
      `);
      res.json({ priceLists: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/price-lists", requirePerm("manage_inventory"), async (req, res) => {
    const { name, description, type, is_active } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    try {
      const { rows: [row] } = await db.query(
        "INSERT INTO price_lists (name, description, type, is_active) VALUES ($1, $2, $3, $4) RETURNING *",
        [name.trim(), description || null, type || "customer_group", is_active !== false]
      );
      res.status(201).json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/price-lists/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { name, description, type, is_active } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    try {
      const { rows: [row] } = await db.query(
        "UPDATE price_lists SET name=$1, description=$2, type=$3, is_active=$4 WHERE id=$5 RETURNING *",
        [name.trim(), description || null, type || "customer_group", is_active !== false, req.params.id]
      );
      if (!row) return res.status(404).json({ error: "Price list not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/price-lists/:id", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM price_lists WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Price list not found" });
      res.json({ message: "Deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Price List Items ─────────────────────────────────────────────────

  app.get("/api/price-lists/:id/items", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT pli.*,
               p.name AS product_name, p.price AS default_price, p.sku,
               pv.name AS variant_name, pv.sku AS variant_sku, pv.price AS variant_price
        FROM price_list_items pli
        JOIN products p ON p.id = pli.product_id
        LEFT JOIN product_variants pv ON pv.id = pli.variant_id
        WHERE pli.price_list_id = $1
        ORDER BY p.name ASC, pli.min_qty ASC
      `, [req.params.id]);
      res.json({ items: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/price-lists/:id/items", requirePerm("manage_inventory"), async (req, res) => {
    const { product_id, variant_id, price, min_qty } = req.body;
    if (!product_id || price == null) return res.status(400).json({ error: "product_id and price are required" });
    try {
      const { rows: [row] } = await db.query(
        `INSERT INTO price_list_items (price_list_id, product_id, variant_id, price, min_qty)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (price_list_id, product_id, variant_id, min_qty)
         DO UPDATE SET price = EXCLUDED.price
         RETURNING *`,
        [req.params.id, product_id, variant_id || null, price, min_qty || 1]
      );
      res.status(201).json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/price-list-items/:itemId", requirePerm("manage_inventory"), async (req, res) => {
    const { price, min_qty } = req.body;
    if (price == null) return res.status(400).json({ error: "price is required" });
    try {
      const { rows: [row] } = await db.query(
        "UPDATE price_list_items SET price=$1, min_qty=$2 WHERE id=$3 RETURNING *",
        [price, min_qty || 1, req.params.itemId]
      );
      if (!row) return res.status(404).json({ error: "Item not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/price-list-items/:itemId", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM price_list_items WHERE id=$1", [req.params.itemId]);
      if (!rowCount) return res.status(404).json({ error: "Item not found" });
      res.json({ message: "Deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/price-lists/:id/bulk-items", requirePerm("manage_inventory"), async (req, res) => {
    const items = req.body.items;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items array is required" });
    try {
      let upserted = 0;
      for (const item of items) {
        await db.query(
          `INSERT INTO price_list_items (price_list_id, product_id, variant_id, price, min_qty)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (price_list_id, product_id, variant_id, min_qty)
           DO UPDATE SET price = EXCLUDED.price`,
          [req.params.id, item.product_id, item.variant_id || null, item.price, item.min_qty || 1]
        );
        upserted++;
      }
      res.json({ upserted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 2: Verify — no test run needed but confirm no syntax errors**

Run: `node -e "require('./backend/routes/products')" 2>&1 | head -5`
Expected: No output (module exports a function, no crash)

---

### Task 2: Frontend — PriceListsRedesign.jsx (management page)

**Files:**
- Rewrite: `frontend/src/pages/redesign/PriceListsRedesign.jsx`

Full management page with:
- List view: name, type badge, item count, active/inactive toggle, edit/delete
- Detail panel (slide-down): product table showing product name, SKU, default price, special price, min qty, savings %
- Add item: product search dropdown + price + min_qty inputs
- Create/edit price list modal with name, description, type selector
- Patterns: follow PromotionsRedesign.jsx style (PageShell, SectionCard, api.get/post/put/del)

---

### Task 3: Frontend — Nav entry

**Files:**
- Modify: `frontend/src/ui/nav-config.js`

Add to Inventory group (after Promotions, line ~71):
```javascript
{ name: "Price Lists", path: "/price-lists", icon: Tag, requiredPerm: "manage_inventory" },
```

Note: `Tag` icon is already imported.

---

### Task 4: POS — Price list fetch + resolution in POSContext

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

Changes:
1. Add state: `const [priceListItems, setPriceListItems] = useState([]);`
2. Add effect: when `selectedCustomerId` changes, if customer has `price_list_id`, fetch `GET /api/price-lists/${id}/items`, store in `priceListItems`. If no customer or no `price_list_id`, clear it.
3. Add helper: `resolvePriceListPrice(productId, variantId, qty)` — finds best tier from `priceListItems` (highest `min_qty <= qty`). Returns `{ specialPrice, isSpecial }`.
4. Modify `addToCart`: attach `originalPrice` and `specialPrice` to cart item.
5. Modify `updateQty`: re-resolve volume pricing when quantity changes — update `item.price` and `item.specialPrice`.
6. Export `priceListItems` and `resolvePriceListPrice` from context.

Key resolution logic:
```javascript
const resolvePriceListPrice = useCallback((productId, variantId, qty) => {
  if (!priceListItems.length) return null;
  const matches = priceListItems
    .filter(i => i.product_id === productId && (i.variant_id || null) === (variantId || null) && i.min_qty <= qty)
    .sort((a, b) => b.min_qty - a.min_qty);
  return matches[0] || null;
}, [priceListItems]);
```

---

### Task 5: POS — Special price display in cart table

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSCartTable.jsx`

Changes to cart item rendering:
- If `item.originalPrice` and `item.originalPrice !== item.price`: show original struck through + special price
- Add "Special Price" badge (similar to existing "Bundle" badge, but in emerald green)
- Unit price column: `<span class="line-through text-slate-400 text-xs">{money(item.originalPrice)}</span> {money(item.price)}`

---

### Task 6: Commit

```bash
git add backend/routes/products.js frontend/src/pages/redesign/PriceListsRedesign.jsx frontend/src/pages/redesign/pos/POSContext.jsx frontend/src/pages/redesign/pos/POSCartTable.jsx frontend/src/ui/nav-config.js
git commit -m "feat(wave3): add price lists — multi-price CRUD, volume pricing, POS price resolution"
```
