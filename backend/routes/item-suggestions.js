module.exports = function registerItemSuggestionRoutes(app, deps) {
  const { db, requireFeature } = deps;
  const feat = requireFeature("phase2_item_suggestions");

  // GET /api/pos/suggestions?product_ids=1,2,3
  app.get("/api/pos/suggestions", feat, async (req, res) => {
    const { product_ids } = req.query;
    if (!product_ids) return res.json({ suggestions: [] });

    const ids = product_ids.split(",").map(Number).filter(Boolean);
    if (!ids.length) return res.json({ suggestions: [] });

    try {
      // 1. Manual affinities (highest priority)
      const { rows: manualRows } = await db.query(
        `SELECT DISTINCT pa.target_product_id AS product_id, pa.affinity_type, pa.score,
                p.name, p.price, p.image_url, p.barcode, 'manual' AS source
         FROM product_affinities pa
         JOIN products p ON p.id = pa.target_product_id
         WHERE pa.source_product_id = ANY($1)
           AND pa.target_product_id != ALL($1)
           AND p.deleted_at IS NULL AND p.status = 'active'
         ORDER BY pa.score DESC
         LIMIT 10`,
        [ids]
      );

      // 2. Co-purchase frequency (deterministic, from historical sales)
      const { rows: coPurchaseRows } = await db.query(
        `SELECT si2.product_id, COUNT(*) AS frequency,
                p.name, p.price, p.image_url, p.barcode, 'co_purchase' AS source
         FROM sale_items si1
         JOIN sale_items si2 ON si2.sale_id = si1.sale_id AND si2.product_id != si1.product_id
         JOIN products p ON p.id = si2.product_id
         WHERE si1.product_id = ANY($1)
           AND si2.product_id != ALL($1)
           AND p.deleted_at IS NULL AND p.status = 'active'
         GROUP BY si2.product_id, p.name, p.price, p.image_url, p.barcode
         ORDER BY frequency DESC
         LIMIT 10`,
        [ids]
      );

      // Deduplicate: manual affinities take priority
      const seen = new Set(manualRows.map(r => r.product_id));
      const merged = [...manualRows];
      for (const row of coPurchaseRows) {
        if (!seen.has(row.product_id)) {
          seen.add(row.product_id);
          merged.push({ ...row, score: Number(row.frequency) });
        }
      }

      res.json({ suggestions: merged.slice(0, 8) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Product Affinities CRUD (admin) ────────────────────────────────

  // GET /api/product-affinities?product_id=X
  app.get("/api/product-affinities", feat, async (req, res) => {
    const { product_id } = req.query;
    try {
      let where = "1=1";
      const params = [];
      if (product_id) { where = "pa.source_product_id = $1"; params.push(product_id); }

      const { rows } = await db.query(
        `SELECT pa.*, ps.name AS source_name, pt.name AS target_name
         FROM product_affinities pa
         JOIN products ps ON ps.id = pa.source_product_id
         JOIN products pt ON pt.id = pa.target_product_id
         WHERE ${where}
         ORDER BY pa.score DESC`,
        params
      );
      res.json({ affinities: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/product-affinities
  app.post("/api/product-affinities", feat, deps.requirePerm("all_access"), async (req, res) => {
    const { source_product_id, target_product_id, affinity_type, score } = req.body;
    if (!source_product_id || !target_product_id) {
      return res.status(400).json({ error: "source_product_id and target_product_id required" });
    }
    if (source_product_id === target_product_id) {
      return res.status(400).json({ error: "Source and target must be different products" });
    }
    try {
      const { rows } = await db.query(
        `INSERT INTO product_affinities (source_product_id, target_product_id, affinity_type, score, is_manual)
         VALUES ($1,$2,$3,$4,TRUE)
         ON CONFLICT (source_product_id, target_product_id, affinity_type) DO UPDATE SET
           score = $4
         RETURNING *`,
        [source_product_id, target_product_id, affinity_type || "frequently_bought_together", score || 1.0]
      );
      res.status(201).json({ affinity: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/product-affinities/:id
  app.delete("/api/product-affinities/:id", feat, deps.requirePerm("all_access"), async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM product_affinities WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Affinity not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/product-affinities/regenerate — rebuild affinities from sales history
  app.post("/api/product-affinities/regenerate", feat, deps.requirePerm("all_access"), async (req, res) => {
    try {
      await db.query("DELETE FROM product_affinities WHERE is_manual = FALSE");
      const { rowCount } = await db.query(`
        INSERT INTO product_affinities (source_product_id, target_product_id, affinity_type, score, is_manual)
        SELECT si1.product_id, si2.product_id, 'frequently_bought_together',
               COUNT(*)::numeric / 10.0, FALSE
        FROM sale_items si1
        JOIN sale_items si2 ON si2.sale_id = si1.sale_id AND si2.product_id > si1.product_id
        JOIN sales s ON s.id = si1.sale_id
        WHERE s.voided = FALSE AND s.timestamp >= NOW() - INTERVAL '90 days'
        GROUP BY si1.product_id, si2.product_id
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC
        LIMIT 500
        ON CONFLICT (source_product_id, target_product_id, affinity_type) DO UPDATE SET
          score = EXCLUDED.score
      `);
      res.json({ success: true, affinities_created: rowCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
