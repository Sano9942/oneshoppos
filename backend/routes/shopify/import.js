module.exports = function registerShopifyImportRoutes(app, deps) {
  const {
    db,
    requirePerm,
    getActiveShopifyConnection,
    resolveImportCategoryId,
    fetchShopifyProductsFull,
    fetchInventoryLevel,
  } = deps;

  app.post(
    "/api/integrations/shopify/import/products",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });

        // Fetch default outlet
        const { rows: outRows } = await db.query(
          "SELECT id FROM outlets ORDER BY id ASC LIMIT 1"
        );
        const defaultOutletId = outRows?.[0]?.id || null;

        // Fetch location mappings
        const { rows: locationMaps } = await db.query(
          "SELECT outlet_id, shopify_location_id FROM shopify_location_map"
        );
        const locationToOutlet = {};
        (locationMaps || []).forEach((lm) => {
          locationToOutlet[lm.shopify_location_id] = lm.outlet_id;
        });

        const shopifyProducts = await fetchShopifyProductsFull(conn, 10000);
        if (!shopifyProducts || shopifyProducts.length === 0) {
          return res.json({ created: 0, updated: 0, skipped: 0, errors: [] });
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;
        const errors = [];

        for (const sp of shopifyProducts) {
          const importableVariants = sp.variants.filter(
            (v) => (v.barcode && v.barcode.trim()) || (v.sku && v.sku.trim())
          );

          if (importableVariants.length === 0) {
            skipped += 1;
            continue;
          }

          for (const v of importableVariants) {
            const rawBarcode = v.barcode;
            const rawSku = v.sku;
            const barcode = rawBarcode != null ? String(rawBarcode).trim() || null : null;
            const sku = rawSku != null ? String(rawSku).trim() || null : null;
            const name = sp.title || barcode || sku || "Unknown";

            // Multi-stage lookup: mapping table > barcode > SKU
            let existing = null;
            try {
              // 1a. Check shopify_product_map
              const { rows: mapRows } = await db.query(
                "SELECT product_id FROM shopify_product_map WHERE shopify_variant_id = $1 AND product_id IS NOT NULL LIMIT 1",
                [v.shopify_variant_id]
              );
              if (mapRows[0]?.product_id) {
                const { rows: pRows } = await db.query(
                  "SELECT id FROM products WHERE id = $1", [mapRows[0].product_id]
                );
                existing = pRows[0] || null;
              }

              // 1b. Fallback: barcode
              if (!existing && barcode) {
                const { rows: bRows } = await db.query(
                  "SELECT id FROM products WHERE barcode = $1", [barcode]
                );
                existing = bRows[0] || null;
              }

              // 1c. Fallback: SKU
              if (!existing && sku) {
                const { rows: sRows } = await db.query(
                  "SELECT id FROM products WHERE sku = $1 LIMIT 1", [sku]
                );
                existing = sRows[0] || null;
              }
            } catch (lookupErr) {
              errors.push({ barcode: barcode || sku, error: lookupErr.message });
              continue;
            }

            // Resolve category
            const productTypeName = (sp.product_type || "").trim();
            let categoryId = null;
            if (productTypeName) {
              try {
                categoryId = await resolveImportCategoryId(productTypeName);
              } catch { /* ignore */ }
            }

            let productId;
            try {
              if (existing?.id) {
                // UPDATE path
                await db.query(
                  `UPDATE products SET
                     name = $1,
                     barcode = CASE WHEN $2 IS NOT NULL THEN $2 ELSE barcode END,
                     sku = CASE WHEN $3 IS NOT NULL THEN $3 ELSE sku END,
                     price = $4, compare_at_price = $5, description_html = $6,
                     product_type = $7, vendor = $8, tags = $9, status = $10,
                     cost_price = CASE WHEN $11 > 0 THEN $11 ELSE cost_price END,
                     category_id = CASE WHEN $12 IS NOT NULL THEN $12 ELSE category_id END
                   WHERE id = $13`,
                  [
                    name, barcode, sku,
                    v.price || 0, v.compare_at_price || 0, sp.description_html || null,
                    sp.product_type || null, sp.vendor || null, sp.tags || null,
                    sp.status || "active", v.cost_price || 0, categoryId, existing.id,
                  ]
                );
                updated += 1;
                productId = existing.id;
              } else {
                // INSERT path
                const { rows: insRows } = await db.query(
                  `INSERT INTO products (barcode, sku, name, price, compare_at_price, description_html, product_type, vendor, tags, status, cost_price, category_id, stock, unit)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 'pcs')
                   RETURNING id`,
                  [
                    barcode, sku, name, v.price || 0, v.compare_at_price || 0,
                    sp.description_html || null, sp.product_type || null,
                    sp.vendor || null, sp.tags || null, sp.status || "active",
                    v.cost_price || 0, categoryId,
                  ]
                );
                created += 1;
                productId = insRows[0].id;
              }
            } catch (saveErr) {
              errors.push({ barcode: barcode || sku, error: saveErr.message });
              continue;
            }

            // Upsert shopify_product_map (fire-and-forget)
            await db.query(
              `INSERT INTO shopify_product_map (product_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at)
               VALUES ($1, $2, $3, $4, true, NOW())
               ON CONFLICT(shopify_product_id, shopify_variant_id) DO UPDATE SET
                 product_id = EXCLUDED.product_id,
                 shopify_inventory_item_id = EXCLUDED.shopify_inventory_item_id,
                 is_active = true,
                 last_verified_at = NOW()`,
              [productId, sp.shopify_product_id, v.shopify_variant_id, v.shopify_inventory_item_id]
            ).catch(() => {});

            // Upsert shopify_product_metadata (fire-and-forget)
            await db.query(
              `INSERT INTO shopify_product_metadata (
                 product_id, shopify_product_id, shopify_handle,
                 shopify_status, shopify_product_type, shopify_vendor,
                 shopify_tags, last_imported_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
               ON CONFLICT(product_id) DO UPDATE SET
                 shopify_product_id   = EXCLUDED.shopify_product_id,
                 shopify_handle       = COALESCE(EXCLUDED.shopify_handle, shopify_product_metadata.shopify_handle),
                 shopify_status       = EXCLUDED.shopify_status,
                 shopify_product_type = EXCLUDED.shopify_product_type,
                 shopify_vendor       = EXCLUDED.shopify_vendor,
                 shopify_tags         = EXCLUDED.shopify_tags,
                 last_imported_at     = NOW()`,
              [
                productId, sp.shopify_product_id || null, sp.shopify_handle || null,
                sp.status || null, sp.product_type || null, sp.vendor || null, sp.tags || null,
              ]
            ).catch(() => {});

            // Seed outlet stock from inventory levels
            const levels = v.inventory_levels || [];
            if (levels.length === 0 && defaultOutletId) {
              await db.query(
                `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                 VALUES ($1, $2, 0) ON CONFLICT(product_id, outlet_id) DO NOTHING`,
                [productId, defaultOutletId]
              ).catch(() => {});
            } else {
              for (const lvl of levels) {
                const outletId = locationToOutlet[lvl.shopify_location_id] || defaultOutletId;
                if (!outletId) continue;
                await db.query(
                  `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                   VALUES ($1, $2, $3) ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = $3`,
                  [productId, outletId, lvl.available]
                ).catch(() => {});
              }
            }
          }
        }

        res.json({ created, updated, skipped, errors });
      } catch (err) {
        res.status(500).json({ error: `Shopify fetch failed: ${err.message}` });
      }
    },
  );

  // Sync inventory levels from Shopify into POS (mapped products only)
  app.post(
    "/api/integrations/shopify/import/inventory",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const conn = await getActiveShopifyConnection();
        if (!conn)
          return res.status(400).json({ error: "No active Shopify connection" });

        const { rows: mappings } = await db.query(
          `SELECT spm.product_id, spm.shopify_inventory_item_id,
                  slm.outlet_id, slm.shopify_location_id
           FROM shopify_product_map spm
           JOIN shopify_location_map slm ON true
           WHERE spm.is_active = true AND spm.shopify_inventory_item_id IS NOT NULL AND spm.shopify_inventory_item_id != ''`
        );

        if (!mappings || mappings.length === 0) {
          return res.status(400).json({
            error: "No active product+location mappings found. Map products and locations first.",
          });
        }

        let synced = 0;
        let failed = 0;
        const errors = [];

        for (const m of mappings) {
          try {
            const lvl = await fetchInventoryLevel(
              conn, m.shopify_inventory_item_id, m.shopify_location_id
            );
            const qty = Number.isFinite(lvl.available) ? lvl.available : 0;
            await db.query(
              `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
               VALUES ($1, $2, $3) ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = $3`,
              [m.product_id, m.outlet_id, qty]
            );
            synced += 1;
          } catch (fetchErr) {
            failed += 1;
            errors.push({
              product_id: m.product_id,
              outlet_id: m.outlet_id,
              error: fetchErr.message,
            });
          }
        }
        res.json({ synced, failed, errors });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Delete all Shopify-imported products
  app.delete(
    "/api/integrations/shopify/import/products",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          "SELECT DISTINCT product_id FROM shopify_product_map WHERE product_id IS NOT NULL"
        );
        const productIds = rows.map((r) => r.product_id).filter(Boolean);
        if (productIds.length === 0) {
          return res.json({ deleted: 0, message: "No Shopify-imported products found." });
        }

        // Postgres has no 999-param limit like SQLite, but let's still batch for safety
        let totalDeleted = 0;
        const CHUNK = 400;
        for (let i = 0; i < productIds.length; i += CHUNK) {
          const ids = productIds.slice(i, i + CHUNK);
          const ph = ids.map((_, j) => `$${j + 1}`).join(",");

          await db.query(`DELETE FROM inventory_reconciliation WHERE product_id IN (${ph})`, ids);
          await db.query(`DELETE FROM shopify_product_metadata WHERE product_id IN (${ph})`, ids);
          await db.query(`DELETE FROM shopify_product_map WHERE product_id IN (${ph})`, ids);
          await db.query(`DELETE FROM outlet_stock WHERE product_id IN (${ph})`, ids);
          await db.query(`DELETE FROM product_variants WHERE product_id IN (${ph})`, ids);
          await db.query(`DELETE FROM stock_adjustments WHERE product_id IN (${ph})`, ids);
          const { rowCount } = await db.query(
            `DELETE FROM products WHERE id IN (${ph})`, ids
          );
          totalDeleted += rowCount || 0;
        }

        res.json({
          deleted: totalDeleted,
          message: `Deleted ${totalDeleted} Shopify-imported product(s).`,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
