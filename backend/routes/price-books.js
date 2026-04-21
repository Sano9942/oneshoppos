/**
 * Phase 2-G Wave 2 — 2-G.4 customer-group price books.
 *
 * Thin CRUD over the existing price_lists + price_list_items tables,
 * scoped by customer_group_id. Design choice (plan confirmed with user):
 * reuse price_lists instead of a parallel `price_books` table so the
 * sales-side resolver has one path to walk.
 *
 * Routes:
 *   GET  /api/price-books/groups/:groupId          — return the list + items
 *   POST /api/price-books/groups/:groupId/items    — bulk upsert items
 *   PUT  /api/price-books/groups/:groupId/items/:itemId — update one
 *   DELETE /api/price-books/groups/:groupId/items/:itemId — remove one
 *   DELETE /api/price-books/groups/:groupId/items  — clear all items
 *
 * All routes feature-gated by phase2g_price_books and permission-gated
 * by manage_customers (same as customer-group CRUD — this is an
 * extension of that admin surface).
 */
module.exports = function registerPriceBookRoutes(app, deps) {
  const { db, requireAnyPerm, requireFeature } = deps;
  const guard = [
    requireFeature("phase2g_price_books"),
    requireAnyPerm(["manage_customers", "all_access"]),
  ];

  // Get-or-create the single group-scoped price_list row for a customer_group.
  // Exactly one per group keeps resolution simple (sales.js joins by group_id).
  async function ensureGroupPriceList(groupId) {
    const { rows: existing } = await db.query(
      `SELECT id, name, is_active FROM price_lists WHERE customer_group_id = $1 LIMIT 1`,
      [groupId],
    );
    if (existing.length > 0) return existing[0];

    const { rows: grp } = await db.query(
      `SELECT name FROM customer_groups WHERE id = $1`,
      [groupId],
    );
    if (!grp.length) return null;

    const listName = `${grp[0].name} Price Book`;
    const { rows: [row] } = await db.query(
      `INSERT INTO price_lists (name, type, customer_group_id, is_active)
       VALUES ($1, 'customer_group', $2, true)
       RETURNING id, name, is_active`,
      [listName, groupId],
    );
    return row;
  }

  // GET /api/price-books/groups/:groupId
  app.get("/api/price-books/groups/:groupId", ...guard, async (req, res) => {
    try {
      const groupId = Number(req.params.groupId);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({ error: "Invalid group id" });
      }
      const pl = await ensureGroupPriceList(groupId);
      if (!pl) return res.status(404).json({ error: "Customer group not found" });

      const { rows: items } = await db.query(
        `SELECT pli.id, pli.product_id, pli.variant_id, pli.price::numeric AS price,
                pli.min_qty,
                p.name AS product_name, p.sku, p.price::numeric AS default_price,
                pv.sku AS variant_sku
           FROM price_list_items pli
           JOIN products p ON p.id = pli.product_id
           LEFT JOIN product_variants pv ON pv.id = pli.variant_id
          WHERE pli.price_list_id = $1
          ORDER BY p.name ASC, pv.sku ASC NULLS FIRST`,
        [pl.id],
      );
      res.json({ priceList: pl, items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/price-books/groups/:groupId/items — bulk upsert.
  // Body: { items: [{ product_id, variant_id?, price, min_qty? }] }
  // Semantics: each row is upserted on (price_list_id, product_id,
  // variant_id, min_qty). Existing rows for the same key are updated;
  // new rows are inserted. Rows NOT in the payload are left alone
  // (use DELETE /items to clear).
  app.post("/api/price-books/groups/:groupId/items", ...guard, async (req, res) => {
    try {
      const groupId = Number(req.params.groupId);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({ error: "Invalid group id" });
      }
      const items = Array.isArray(req.body?.items) ? req.body.items : null;
      if (!items || items.length === 0) {
        return res.status(400).json({ error: "items array is required" });
      }
      const pl = await ensureGroupPriceList(groupId);
      if (!pl) return res.status(404).json({ error: "Customer group not found" });

      const upserted = await db.transaction(async (client) => {
        const results = [];
        for (const raw of items) {
          const productId = Number(raw.product_id);
          const variantId = raw.variant_id != null ? Number(raw.variant_id) : null;
          const price = Number(raw.price);
          const minQty = raw.min_qty != null ? Number(raw.min_qty) : 1;
          if (
            !Number.isInteger(productId) ||
            productId <= 0 ||
            !Number.isFinite(price) ||
            price < 0
          ) {
            throw Object.assign(new Error("Invalid item in payload"), {
              statusCode: 400,
            });
          }
          // Can't use ON CONFLICT here cleanly because the unique key
          // includes variant_id which can be NULL (NULLs don't collide
          // in Postgres unique indexes by default). Do a manual
          // update-or-insert.
          const { rows: existing } = await client.query(
            `SELECT id FROM price_list_items
              WHERE price_list_id = $1 AND product_id = $2
                AND variant_id IS NOT DISTINCT FROM $3
                AND min_qty = $4`,
            [pl.id, productId, variantId, minQty],
          );
          if (existing.length > 0) {
            await client.query(
              `UPDATE price_list_items SET price = $1 WHERE id = $2`,
              [price, existing[0].id],
            );
            results.push({ id: existing[0].id, updated: true });
          } else {
            const { rows: [inserted] } = await client.query(
              `INSERT INTO price_list_items
                 (price_list_id, product_id, variant_id, price, min_qty)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
              [pl.id, productId, variantId, price, minQty],
            );
            results.push({ id: inserted.id, created: true });
          }
        }
        return results;
      });

      res.json({ priceListId: pl.id, upserted });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/price-books/groups/:groupId/items/:itemId
  app.put(
    "/api/price-books/groups/:groupId/items/:itemId",
    ...guard,
    async (req, res) => {
      try {
        const groupId = Number(req.params.groupId);
        const itemId = Number(req.params.itemId);
        const price = Number(req.body?.price);
        const minQty = req.body?.min_qty != null ? Number(req.body.min_qty) : null;
        if (!Number.isFinite(price) || price < 0) {
          return res.status(400).json({ error: "price must be a non-negative number" });
        }
        const pl = await ensureGroupPriceList(groupId);
        if (!pl) return res.status(404).json({ error: "Customer group not found" });

        const fields = ["price = $1"];
        const params = [price];
        if (minQty != null) {
          fields.push(`min_qty = $${params.length + 1}`);
          params.push(minQty);
        }
        params.push(itemId, pl.id);
        const { rowCount } = await db.query(
          `UPDATE price_list_items SET ${fields.join(", ")}
             WHERE id = $${params.length - 1} AND price_list_id = $${params.length}`,
          params,
        );
        if (!rowCount) return res.status(404).json({ error: "Item not found" });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // DELETE /api/price-books/groups/:groupId/items/:itemId
  app.delete(
    "/api/price-books/groups/:groupId/items/:itemId",
    ...guard,
    async (req, res) => {
      try {
        const groupId = Number(req.params.groupId);
        const itemId = Number(req.params.itemId);
        const pl = await ensureGroupPriceList(groupId);
        if (!pl) return res.status(404).json({ error: "Customer group not found" });
        const { rowCount } = await db.query(
          `DELETE FROM price_list_items WHERE id = $1 AND price_list_id = $2`,
          [itemId, pl.id],
        );
        if (!rowCount) return res.status(404).json({ error: "Item not found" });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // DELETE /api/price-books/groups/:groupId/items — wipe all items
  app.delete(
    "/api/price-books/groups/:groupId/items",
    ...guard,
    async (req, res) => {
      try {
        const groupId = Number(req.params.groupId);
        const pl = await ensureGroupPriceList(groupId);
        if (!pl) return res.status(404).json({ error: "Customer group not found" });
        const { rowCount } = await db.query(
          `DELETE FROM price_list_items WHERE price_list_id = $1`,
          [pl.id],
        );
        res.json({ deleted: rowCount });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
