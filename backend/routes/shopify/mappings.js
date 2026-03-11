module.exports = function registerShopifyMappingRoutes(app, deps) {
  const {
    db,
    requirePerm,
    getActiveShopifyConnection,
    fetchShopifyVariantCatalog,
  } = deps;

  // --- PRODUCT MAPPINGS ---

  app.get(
    "/api/integrations/mappings/products",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT spm.*, p.name as product_name, pv.sku as variant_sku
           FROM shopify_product_map spm
           LEFT JOIN products p ON p.id = spm.product_id
           LEFT JOIN product_variants pv ON pv.id = spm.variant_id
           ORDER BY spm.id DESC`
        );
        res.json({ mappings: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/integrations/mappings/products/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const {
          product_id, variant_id, shopify_product_id,
          shopify_variant_id, shopify_inventory_item_id, is_active,
        } = req.body || {};
        await db.query(
          `INSERT INTO shopify_product_map (
            id, product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT(id) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            variant_id = EXCLUDED.variant_id,
            shopify_product_id = EXCLUDED.shopify_product_id,
            shopify_variant_id = EXCLUDED.shopify_variant_id,
            shopify_inventory_item_id = EXCLUDED.shopify_inventory_item_id,
            is_active = EXCLUDED.is_active,
            last_verified_at = NOW()`,
          [
            parseInt(id),
            product_id || null,
            variant_id || null,
            shopify_product_id || null,
            shopify_variant_id || null,
            shopify_inventory_item_id || null,
            is_active !== undefined ? (is_active ? true : false) : true,
          ]
        );
        res.json({ message: "Product mapping saved" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/integrations/mappings/products/auto",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT p.id as product_id, p.name, p.barcode, pv.id as variant_id, pv.sku
           FROM products p
           LEFT JOIN product_variants pv ON pv.product_id = p.id
           ORDER BY p.name ASC`
        );
        res.json({ candidates: rows || [], message: "Auto-map candidates generated" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.post(
    "/api/integrations/mappings/products/auto-live",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const limit = Math.min(10000, Math.max(1, parseInt(req.body?.limit || "500", 10)));
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });

        const remoteVariants = await fetchShopifyVariantCatalog(conn, limit);

        const { rows: localRows } = await db.query(
          `SELECT p.id as product_id, p.name as product_name, p.barcode as product_barcode,
                  pv.id as variant_id, pv.sku as variant_sku, NULL as variant_barcode
           FROM products p
           LEFT JOIN product_variants pv ON pv.product_id = p.id`
        );

        const { rows: mappedRows } = await db.query(
          `SELECT product_id, COALESCE(variant_id, -1) AS variant_key, shopify_variant_id
           FROM shopify_product_map WHERE is_active = true`
        );

        const existingLocalMap = new Map();
        for (const row of mappedRows || []) {
          existingLocalMap.set(
            `${row.product_id}:${row.variant_key}`,
            row.shopify_variant_id || ""
          );
        }

        const byBarcode = new Map();
        const bySku = new Map();
        for (const rv of remoteVariants) {
          const b = String(rv.barcode || "").trim().toLowerCase();
          const s = String(rv.sku || "").trim().toLowerCase();
          if (b && !byBarcode.has(b)) byBarcode.set(b, rv);
          if (s && !bySku.has(s)) bySku.set(s, rv);
        }

        const suggestions = [];
        for (const lr of localRows || []) {
          const localBarcode = String(lr.variant_barcode || lr.product_barcode || "").trim().toLowerCase();
          const localSku = String(lr.variant_sku || "").trim().toLowerCase();

          let match = null;
          let confidence = "";
          if (localBarcode && byBarcode.has(localBarcode)) {
            match = byBarcode.get(localBarcode);
            confidence = "exact_barcode";
          } else if (localSku && bySku.has(localSku)) {
            match = bySku.get(localSku);
            confidence = "exact_sku";
          }
          if (!match) continue;

          const localKey = `${lr.product_id}:${lr.variant_id || -1}`;
          const mappedShopifyVariantId = existingLocalMap.get(localKey) || "";
          if (mappedShopifyVariantId && mappedShopifyVariantId === String(match.variant_id || "")) {
            continue;
          }

          suggestions.push({
            product_id: lr.product_id,
            product_name: lr.product_name,
            variant_id: lr.variant_id || null,
            local_sku: lr.variant_sku || null,
            local_barcode: lr.variant_barcode || lr.product_barcode || null,
            shopify_product_id: match.product_id || null,
            shopify_variant_id: match.variant_id || null,
            shopify_inventory_item_id: match.inventory_item_id || null,
            shopify_title: match.display_name || match.product_title || null,
            confidence,
          });
        }

        return res.json({
          message: "Live mapping suggestions generated",
          remote_count: remoteVariants.length,
          suggestion_count: suggestions.length,
          suggestions,
        });
      } catch (e) {
        return res.status(400).json({ error: e.message || "Failed to generate live mappings" });
      }
    },
  );

  app.post(
    "/api/integrations/mappings/products/apply-suggestions",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const suggestions = Array.isArray(req.body?.suggestions) ? req.body.suggestions : [];
        if (suggestions.length === 0) {
          return res.status(400).json({ error: "suggestions array is required" });
        }

        let applied = 0;
        let skipped = 0;
        const conflicts = [];

        for (const s of suggestions) {
          const productId = s.product_id ? Number(s.product_id) : null;
          const variantId = s.variant_id ? Number(s.variant_id) : null;
          const shopifyProductId = s.shopify_product_id || null;
          const shopifyVariantId = s.shopify_variant_id || null;
          const shopifyInventoryItemId = s.shopify_inventory_item_id || null;

          if (!productId || !shopifyVariantId) {
            skipped += 1;
            continue;
          }

          // Check for conflicts
          const { rows: confRows } = await db.query(
            `SELECT id, product_id, variant_id
             FROM shopify_product_map
             WHERE shopify_variant_id = $1
               AND (product_id != $2 OR COALESCE(variant_id, -1) != COALESCE($3, -1))
             LIMIT 1`,
            [shopifyVariantId, productId, variantId]
          );
          if (confRows.length > 0) {
            skipped += 1;
            conflicts.push({
              product_id: productId,
              variant_id: variantId,
              shopify_variant_id: shopifyVariantId,
              reason: `Already mapped to local product ${confRows[0].product_id}/${confRows[0].variant_id || "no-variant"}`,
            });
            continue;
          }

          // Check for existing local mapping
          const { rows: localRows } = await db.query(
            `SELECT id FROM shopify_product_map
             WHERE product_id = $1 AND COALESCE(variant_id, -1) = COALESCE($2, -1)
             LIMIT 1`,
            [productId, variantId]
          );

          try {
            if (localRows[0]?.id) {
              await db.query(
                `UPDATE shopify_product_map
                 SET shopify_product_id = $1, shopify_variant_id = $2,
                     shopify_inventory_item_id = $3, is_active = true, last_verified_at = NOW()
                 WHERE id = $4`,
                [shopifyProductId, shopifyVariantId, shopifyInventoryItemId, localRows[0].id]
              );
            } else {
              await db.query(
                `INSERT INTO shopify_product_map (product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at)
                 VALUES ($1, $2, $3, $4, $5, true, NOW())`,
                [productId, variantId, shopifyProductId, shopifyVariantId, shopifyInventoryItemId]
              );
            }
            applied += 1;
          } catch (saveErr) {
            skipped += 1;
            conflicts.push({
              product_id: productId,
              variant_id: variantId,
              shopify_variant_id: shopifyVariantId,
              reason: saveErr.message,
            });
          }
        }

        res.json({
          message: "Suggestions processed",
          total: suggestions.length,
          applied,
          skipped,
          conflicts,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // --- LOCATION MAPPINGS ---

  app.get(
    "/api/integrations/mappings/locations",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT slm.*, o.name as outlet_name
           FROM shopify_location_map slm
           LEFT JOIN outlets o ON o.id = slm.outlet_id
           ORDER BY o.name ASC`
        );
        res.json({ mappings: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/integrations/mappings/locations/:outletId",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { outletId } = req.params;
        const { shopify_location_id, shopify_location_name } = req.body || {};
        if (!shopify_location_id) {
          return res.status(400).json({ error: "shopify_location_id is required" });
        }

        await db.transaction(async (client) => {
          await client.query("DELETE FROM shopify_location_map WHERE outlet_id = $1", [outletId]);
          await client.query(
            `INSERT INTO shopify_location_map (outlet_id, shopify_location_id, shopify_location_name)
             VALUES ($1, $2, $3)`,
            [outletId, String(shopify_location_id), shopify_location_name || null]
          );
        });

        res.json({ message: "Location mapping saved" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // --- CUSTOMER MAPPINGS ---

  app.get(
    "/api/integrations/mappings/customers",
    requirePerm("manage_orders"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT scm.*, c.name as customer_name, c.mobile, c.email
           FROM shopify_customer_map scm
           LEFT JOIN customers c ON c.id = scm.customer_id
           ORDER BY scm.id DESC`
        );
        res.json({ mappings: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  app.put(
    "/api/integrations/mappings/customers/:customerId",
    requirePerm("manage_orders"),
    async (req, res) => {
      try {
        const { customerId } = req.params;
        const { shopify_customer_id } = req.body || {};
        if (!shopify_customer_id) {
          return res.status(400).json({ error: "shopify_customer_id is required" });
        }
        await db.query(
          `INSERT INTO shopify_customer_map (customer_id, shopify_customer_id, last_synced_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT(shopify_customer_id) DO UPDATE SET
             customer_id = EXCLUDED.customer_id,
             last_synced_at = NOW()`,
          [customerId, String(shopify_customer_id)]
        );
        res.json({ message: "Customer mapping saved" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
