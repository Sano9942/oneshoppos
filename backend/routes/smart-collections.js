const { validate } = require("../middleware/validate");
const { createCollectionSchema, updateCollectionSchema } = require("../schemas/smart-collections");

module.exports = function registerSmartCollectionRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const feat = requireFeature("phase2_smart_collections");

  // Build a WHERE clause from smart collection rules
  function buildRuleQuery(rules, disjunctive) {
    const clauses = [];
    const params = [];
    let idx = 1;

    for (const rule of rules) {
      const { field, operator, value } = rule;
      let col;
      switch (field) {
        case "category_id": col = "p.category_id"; break;
        case "brand_id": col = "p.brand_id"; break;
        case "product_type": col = "p.product_type"; break;
        case "vendor": col = "p.vendor"; break;
        case "tags": col = "p.tags"; break;
        case "price": col = "p.price"; break;
        case "stock": col = "p.stock"; break;
        case "status": col = "p.status"; break;
        case "created_at": col = "p.created_at"; break;
        default: continue;
      }

      switch (operator) {
        case "equals":
          clauses.push(`${col} = $${idx}`);
          params.push(value);
          idx++;
          break;
        case "not_equals":
          clauses.push(`${col} != $${idx}`);
          params.push(value);
          idx++;
          break;
        case "greater_than":
          clauses.push(`${col} > $${idx}`);
          params.push(value);
          idx++;
          break;
        case "less_than":
          clauses.push(`${col} < $${idx}`);
          params.push(value);
          idx++;
          break;
        case "contains":
          clauses.push(`${col} ILIKE $${idx}`);
          params.push(`%${value}%`);
          idx++;
          break;
        case "starts_with":
          clauses.push(`${col} ILIKE $${idx}`);
          params.push(`${value}%`);
          idx++;
          break;
        case "in":
          const vals = value.split(",").map(v => v.trim());
          clauses.push(`${col} = ANY($${idx})`);
          params.push(vals);
          idx++;
          break;
      }
    }

    const joiner = disjunctive ? " OR " : " AND ";
    return { where: clauses.length > 0 ? clauses.join(joiner) : "TRUE", params };
  }

  // GET /api/smart-collections
  app.get("/api/smart-collections", feat, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT sc.*, json_agg(json_build_object(
            'id', scr.id, 'field', scr.field, 'operator', scr.operator, 'value', scr.value
          ) ORDER BY scr.id) AS rules
         FROM smart_collections sc
         LEFT JOIN smart_collection_rules scr ON scr.collection_id = sc.id
         GROUP BY sc.id
         ORDER BY sc.name`
      );
      for (const row of rows) {
        if (row.rules && row.rules[0] && row.rules[0].id === null) {
          row.rules = [];
        }
      }
      res.json({ collections: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/smart-collections/:id — includes matched products
  app.get("/api/smart-collections/:id", feat, async (req, res) => {
    try {
      const { rows: cRows } = await db.query("SELECT * FROM smart_collections WHERE id = $1", [req.params.id]);
      if (!cRows.length) return res.status(404).json({ error: "Collection not found" });
      const collection = cRows[0];

      const { rows: ruleRows } = await db.query(
        "SELECT * FROM smart_collection_rules WHERE collection_id = $1 ORDER BY id", [collection.id]
      );
      collection.rules = ruleRows;

      if (ruleRows.length > 0) {
        const { where, params } = buildRuleQuery(ruleRows, collection.disjunctive);
        const sortMap = {
          manual: "p.id ASC",
          name_asc: "p.name ASC",
          name_desc: "p.name DESC",
          price_asc: "p.price ASC",
          price_desc: "p.price DESC",
          created_at_desc: "p.id DESC",
        };
        const orderClause = sortMap[collection.sort_order] || "p.name ASC";
        const { rows: products } = await db.query(
          `SELECT p.id, p.name, p.barcode, p.price, p.stock, p.status, p.image_url
           FROM products p
           WHERE p.deleted_at IS NULL AND (${where})
           ORDER BY ${orderClause}
           LIMIT 500`,
          params
        );
        collection.products = products;
        collection.product_count = products.length;
      } else {
        collection.products = [];
        collection.product_count = 0;
      }

      res.json({ collection });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/smart-collections
  app.post("/api/smart-collections", feat, requirePerm("all_access"), validate(createCollectionSchema), async (req, res) => {
    const { name, description, disjunctive, sort_order, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO smart_collections (name, description, disjunctive, sort_order)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [name, description || null, disjunctive, sort_order]
        );
        const collection = rows[0];

        for (const rule of rules) {
          await client.query(
            `INSERT INTO smart_collection_rules (collection_id, field, operator, value)
             VALUES ($1,$2,$3,$4)`,
            [collection.id, rule.field, rule.operator, rule.value]
          );
        }
        return collection;
      });
      res.status(201).json({ collection: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/smart-collections/:id
  app.put("/api/smart-collections/:id", feat, requirePerm("all_access"), validate(updateCollectionSchema), async (req, res) => {
    const { name, description, disjunctive, sort_order, is_active, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query("SELECT * FROM smart_collections WHERE id = $1", [req.params.id]);
        if (!rows.length) return null;

        const sets = [];
        const vals = [];
        let idx = 1;

        if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
        if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
        if (disjunctive !== undefined) { sets.push(`disjunctive = $${idx}`); vals.push(disjunctive); idx++; }
        if (sort_order !== undefined) { sets.push(`sort_order = $${idx}`); vals.push(sort_order); idx++; }
        if (is_active !== undefined) { sets.push(`is_active = $${idx}`); vals.push(is_active); idx++; }
        sets.push(`updated_at = NOW()`);

        vals.push(req.params.id);
        const { rows: updated } = await client.query(
          `UPDATE smart_collections SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
        );

        if (rules) {
          await client.query("DELETE FROM smart_collection_rules WHERE collection_id = $1", [req.params.id]);
          for (const rule of rules) {
            await client.query(
              `INSERT INTO smart_collection_rules (collection_id, field, operator, value)
               VALUES ($1,$2,$3,$4)`,
              [req.params.id, rule.field, rule.operator, rule.value]
            );
          }
        }

        return updated[0];
      });

      if (!result) return res.status(404).json({ error: "Collection not found" });
      res.json({ collection: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/smart-collections/:id
  app.delete("/api/smart-collections/:id", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM smart_collections WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Collection not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
