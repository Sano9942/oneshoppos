module.exports = function registerShopifyImportRoutes(app, deps) {
  const {
    db,
    requirePerm,
    getActiveShopifyConnection,
    resolveImportCategoryId,
    fetchShopifyProductsFull,
    fetchInventoryLevel,
  } = deps;

  // --- IMPORT: Pull products from Shopify into POS ---
  // Creates/updates products by barcode (upsert). Also creates product mappings
  // and populates shopify_product_metadata with Shopify-native taxonomy.
  app.post(
    "/api/integrations/shopify/import/products",
    requirePerm("manage_inventory"),
    (req, res) => {
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        // Fetch all outlets to determine a default outlet for stock seeding
        db.all(
          "SELECT id FROM outlets ORDER BY id ASC LIMIT 1",
          [],
          (outErr, outRows) => {
            if (outErr) return res.status(500).json({ error: outErr.message });
            const defaultOutletId = outRows?.[0]?.id || null;

            // Fetch location mappings so we know which outlet maps to which Shopify location
            db.all(
              "SELECT outlet_id, shopify_location_id FROM shopify_location_map",
              [],
              (mapErr, locationMaps) => {
                if (mapErr)
                  return res.status(500).json({ error: mapErr.message });

                // Build a map: shopify_location_id -> outlet_id
                const locationToOutlet = {};
                (locationMaps || []).forEach((lm) => {
                  locationToOutlet[lm.shopify_location_id] = lm.outlet_id;
                });

                fetchShopifyProductsFull(conn, 10000)
                  .then((shopifyProducts) => {
                    if (!shopifyProducts || shopifyProducts.length === 0) {
                      return res.json({
                        created: 0,
                        updated: 0,
                        skipped: 0,
                        errors: [],
                      });
                    }

                    let created = 0;
                    let updated = 0;
                    let skipped = 0;
                    const errors = [];
                    let idx = 0;

                    const processNext = () => {
                      if (idx >= shopifyProducts.length) {
                        return res.json({ created, updated, skipped, errors });
                      }

                      const sp = shopifyProducts[idx];
                      idx += 1;

                      // Only import variants that have a barcode (needed for POS lookup)
                      const importableVariants = sp.variants.filter(
                        (v) => v.barcode && v.barcode.trim(),
                      );

                      if (importableVariants.length === 0) {
                        skipped += 1;
                        return processNext();
                      }

                      // Process each variant as a POS product (one product per barcode)
                      let vIdx = 0;
                      const processVariant = () => {
                        if (vIdx >= importableVariants.length)
                          return processNext();
                        const v = importableVariants[vIdx];
                        vIdx += 1;

                        const barcode = v.barcode.trim();
                        const name = sp.title || barcode;

                        // Check if product already exists
                        db.get(
                          "SELECT id FROM products WHERE barcode = ?",
                          [barcode],
                          (findErr, existing) => {
                            if (findErr) {
                              errors.push({ barcode, error: findErr.message });
                              return processVariant();
                            }

                            // Preserve Shopify product_type, but only assign category_id
                            // when it matches exactly one existing leaf category.
                            const productTypeName = (
                              sp.product_type || ""
                            ).trim();
                            const doUpsert = (categoryId) => {
                              db.run(
                                `INSERT INTO products (barcode, sku, name, price, compare_at_price, description_html, product_type, vendor, tags, status, cost_price, category_id, stock, unit)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pcs')
                             ON CONFLICT(barcode) DO UPDATE SET
                               sku = excluded.sku,
                               name = excluded.name,
                               price = excluded.price,
                               compare_at_price = excluded.compare_at_price,
                               description_html = excluded.description_html,
                               product_type = excluded.product_type,
                               vendor = excluded.vendor,
                               tags = excluded.tags,
                               status = excluded.status,
                               cost_price = CASE WHEN excluded.cost_price > 0 THEN excluded.cost_price ELSE products.cost_price END,
                               category_id = CASE WHEN excluded.category_id IS NOT NULL THEN excluded.category_id ELSE products.category_id END`,
                                [
                                  barcode,
                                  v.sku || null,
                                  name,
                                  v.price || 0,
                                  v.compare_at_price || 0,
                                  sp.description_html || null,
                                  sp.product_type || null,
                                  sp.vendor || null,
                                  sp.tags || null,
                                  sp.status || "active",
                                  v.cost_price || 0,
                                  categoryId,
                                ],
                                function (upsertErr) {
                                  if (upsertErr) {
                                    errors.push({
                                      barcode,
                                      error: upsertErr.message,
                                    });
                                    return processVariant();
                                  }

                                  const productId = existing
                                    ? existing.id
                                    : this.lastID;
                                  if (existing) updated += 1;
                                  else created += 1;

                                  // Upsert product mapping
                                  db.run(
                                    `INSERT INTO shopify_product_map (product_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at)
                                 VALUES (?, ?, ?, ?, 1, datetime('now','localtime'))
                                 ON CONFLICT(shopify_product_id, shopify_variant_id) DO UPDATE SET
                                   product_id = excluded.product_id,
                                   shopify_inventory_item_id = excluded.shopify_inventory_item_id,
                                   is_active = 1,
                                   last_verified_at = datetime('now','localtime')`,
                                    [
                                      productId,
                                      sp.shopify_product_id,
                                      v.shopify_variant_id,
                                      v.shopify_inventory_item_id,
                                    ],
                                  );

                                  // Upsert Shopify-native taxonomy metadata (fire-and-forget)
                                  db.run(
                                    `INSERT INTO shopify_product_metadata (
                                       product_id, shopify_product_id, shopify_handle,
                                       shopify_status, shopify_product_type, shopify_vendor,
                                       shopify_tags, last_imported_at
                                     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
                                     ON CONFLICT(product_id) DO UPDATE SET
                                       shopify_product_id   = excluded.shopify_product_id,
                                       shopify_handle       = COALESCE(excluded.shopify_handle, shopify_product_metadata.shopify_handle),
                                       shopify_status       = excluded.shopify_status,
                                       shopify_product_type = excluded.shopify_product_type,
                                       shopify_vendor       = excluded.shopify_vendor,
                                       shopify_tags         = excluded.shopify_tags,
                                       last_imported_at     = datetime('now','localtime')`,
                                    [
                                      productId,
                                      sp.shopify_product_id || null,
                                      sp.shopify_handle || null,
                                      sp.status || null,
                                      sp.product_type || null,
                                      sp.vendor || null,
                                      sp.tags || null,
                                    ],
                                  );

                                  // Seed outlet stock from Shopify inventory levels
                                  const levels = v.inventory_levels || [];
                                  if (levels.length === 0 && defaultOutletId) {
                                    db.run(
                                      `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                                   VALUES (?, ?, 0)
                                   ON CONFLICT(product_id, outlet_id) DO NOTHING`,
                                      [productId, defaultOutletId],
                                      () => processVariant(),
                                    );
                                    return;
                                  }

                                  let lIdx = 0;
                                  const processLevel = () => {
                                    if (lIdx >= levels.length)
                                      return processVariant();
                                    const lvl = levels[lIdx];
                                    lIdx += 1;
                                    const outletId =
                                      locationToOutlet[
                                        lvl.shopify_location_id
                                      ] || defaultOutletId;
                                    if (!outletId) return processLevel();
                                    db.run(
                                      `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                                   VALUES (?, ?, ?)
                                   ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = ?`,
                                      [
                                        productId,
                                        outletId,
                                        lvl.available,
                                        lvl.available,
                                      ],
                                      () => processLevel(),
                                    );
                                  };
                                  processLevel();
                                },
                              );
                            };

                            // Do not auto-create categories from Shopify product_type.
                            // That field is custom merchant data in Shopify and can be
                            // ambiguous against our internal hierarchy.
                            if (productTypeName) {
                              resolveImportCategoryId(
                                productTypeName,
                                (catErr, categoryId) => {
                                  doUpsert(catErr ? null : categoryId);
                                },
                              );
                            } else {
                              doUpsert(null);
                            }
                          },
                        );
                      };
                      processVariant();
                    };
                    processNext();
                  })
                  .catch((err) => {
                    res
                      .status(500)
                      .json({ error: `Shopify fetch failed: ${err.message}` });
                  });
              },
            );
          },
        );
      });
    },
  );

  // --- IMPORT: Sync inventory levels from Shopify into POS (mapped products only) ---
  // For every mapped product/location pair, SET the POS stock to Shopify's current quantity.
  app.post(
    "/api/integrations/shopify/import/inventory",
    requirePerm("manage_inventory"),
    (req, res) => {
      getActiveShopifyConnection((connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        // Load all active product mappings + location mappings
        db.all(
          `SELECT spm.product_id, spm.shopify_inventory_item_id,
                  slm.outlet_id, slm.shopify_location_id
           FROM shopify_product_map spm
           JOIN shopify_location_map slm ON 1=1
           WHERE spm.is_active = 1 AND spm.shopify_inventory_item_id IS NOT NULL AND spm.shopify_inventory_item_id != ''`,
          [],
          (mapErr, mappings) => {
            if (mapErr) return res.status(500).json({ error: mapErr.message });
            if (!mappings || mappings.length === 0) {
              return res.status(400).json({
                error:
                  "No active product+location mappings found. Map products and locations first.",
              });
            }

            let synced = 0;
            let failed = 0;
            const errors = [];
            let idx = 0;

            const processNext = () => {
              if (idx >= mappings.length) {
                return res.json({ synced, failed, errors });
              }

              const m = mappings[idx];
              idx += 1;

              fetchInventoryLevel(
                conn,
                m.shopify_inventory_item_id,
                m.shopify_location_id,
              )
                .then((lvl) => {
                  const qty = Number.isFinite(lvl.available)
                    ? lvl.available
                    : 0;
                  db.run(
                    `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
                     VALUES (?, ?, ?)
                     ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = ?`,
                    [m.product_id, m.outlet_id, qty, qty],
                    (stockErr) => {
                      if (stockErr) {
                        failed += 1;
                        errors.push({
                          product_id: m.product_id,
                          outlet_id: m.outlet_id,
                          error: stockErr.message,
                        });
                      } else {
                        synced += 1;
                      }
                      processNext();
                    },
                  );
                })
                .catch((fetchErr) => {
                  failed += 1;
                  errors.push({
                    product_id: m.product_id,
                    outlet_id: m.outlet_id,
                    error: fetchErr.message,
                  });
                  processNext();
                });
            };
            processNext();
          },
        );
      });
    },
  );

  // Delete all products that were imported from Shopify (have a shopify_product_map entry).
  // Also clears their dependent rows: shopify_product_map, outlet_stock, product_variants,
  // stock_adjustments. shopify_product_metadata rows cascade-deleted via ON DELETE CASCADE.
  // Temporarily disables FK enforcement so historic sale_items are not blocked.
  app.delete(
    "/api/integrations/shopify/import/products",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.all(
        "SELECT DISTINCT product_id FROM shopify_product_map WHERE product_id IS NOT NULL",
        [],
        (listErr, rows) => {
          if (listErr) return res.status(500).json({ error: listErr.message });
          const productIds = rows.map((r) => r.product_id).filter(Boolean);
          if (productIds.length === 0) {
            return res.json({
              deleted: 0,
              message: "No Shopify-imported products found.",
            });
          }
          // SQLite has a 999-parameter limit; chunk into batches of 400
          const CHUNK = 400;
          const chunks = [];
          for (let i = 0; i < productIds.length; i += CHUNK) {
            chunks.push(productIds.slice(i, i + CHUNK));
          }
          let totalDeleted = 0;
          let chunkIdx = 0;

          // Disable FK enforcement for this operation so historic sale_items
          // that reference these products don't block the delete.
          db.run("PRAGMA foreign_keys = OFF", (fkOffErr) => {
            if (fkOffErr)
              return res.status(500).json({ error: fkOffErr.message });

            const finish = (err) => {
              // Always re-enable FK enforcement before responding
              db.run("PRAGMA foreign_keys = ON", () => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                  deleted: totalDeleted,
                  message: `Deleted ${totalDeleted} Shopify-imported product(s).`,
                });
              });
            };

            const processChunk = () => {
              if (chunkIdx >= chunks.length) return finish(null);
              const ids = chunks[chunkIdx];
              chunkIdx += 1;
              const ph = ids.map(() => "?").join(",");
              db.run(
                `DELETE FROM shopify_product_map WHERE product_id IN (${ph})`,
                ids,
                (e1) => {
                  if (e1) return finish(e1);
                  db.run(
                    `DELETE FROM outlet_stock WHERE product_id IN (${ph})`,
                    ids,
                    (e2) => {
                      if (e2) return finish(e2);
                      db.run(
                        `DELETE FROM product_variants WHERE product_id IN (${ph})`,
                        ids,
                        (e3) => {
                          if (e3) return finish(e3);
                          db.run(
                            `DELETE FROM stock_adjustments WHERE product_id IN (${ph})`,
                            ids,
                            (e4) => {
                              if (e4) return finish(e4);
                              db.run(
                                `DELETE FROM products WHERE id IN (${ph})`,
                                ids,
                                function (e5) {
                                  if (e5) return finish(e5);
                                  totalDeleted += this.changes || 0;
                                  processChunk();
                                },
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              );
            };
            processChunk();
          });
        },
      );
    },
  );
};
