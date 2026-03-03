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
  // Creates/updates products matched by Shopify mapping > barcode > SKU.
  // Imports variants that have at least a barcode OR an SKU.
  // Variants with NEITHER identifier are skipped.
  // Barcode is stored in `barcode`, SKU is stored in `sku` — no cross-filling.
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

                      // Import variants that have at least a barcode OR an SKU.
                      // Variants with neither have no identifier for the POS and are skipped.
                      const importableVariants = sp.variants.filter(
                        (v) =>
                          (v.barcode && v.barcode.trim()) ||
                          (v.sku && v.sku.trim()),
                      );

                      if (importableVariants.length === 0) {
                        skipped += 1;
                        return processNext();
                      }

                      let vIdx = 0;
                      const processVariant = () => {
                        if (vIdx >= importableVariants.length)
                          return processNext();
                        const v = importableVariants[vIdx];
                        vIdx += 1;

                        // Safe string coercion: use String() instead of `|| ""`
                        // to prevent leading zeros from being lost if Shopify
                        // returned a numeric type (e.g., 2590 instead of "002590").
                        const rawBarcode = v.barcode;
                        const rawSku = v.sku;
                        const barcode =
                          rawBarcode != null
                            ? String(rawBarcode).trim() || null
                            : null;
                        const sku =
                          rawSku != null ? String(rawSku).trim() || null : null;
                        const name = sp.title || barcode || sku || "Unknown";

                        // Debug log — remove after confirming leading zeros are preserved
                        if (barcode && barcode !== String(rawBarcode).trim()) {
                          console.warn(
                            `[ShopifyImport] Leading zero loss detected! raw=${JSON.stringify(rawBarcode)} -> coerced=${barcode}`,
                          );
                        }
                        if (process.env.SHOPIFY_IMPORT_DEBUG === "1") {
                          console.log(
                            `[ShopifyImport] Variant barcode=${JSON.stringify(rawBarcode)} (${typeof rawBarcode}) -> "${barcode}" | sku=${JSON.stringify(rawSku)} (${typeof rawSku}) -> "${sku}"`,
                          );
                        }

                        // --- STEP 1: Multi-stage lookup to find an existing product ID ---
                        // Priority: Shopify mapping table > Barcode > SKU
                        const findExistingProduct = (cb) => {
                          // 1a. Check shopify_product_map (most reliable after first import)
                          db.get(
                            `SELECT product_id FROM shopify_product_map
                             WHERE shopify_variant_id = ? AND product_id IS NOT NULL LIMIT 1`,
                            [v.shopify_variant_id],
                            (mapErr, mapRow) => {
                              if (mapErr) return cb(mapErr);
                              if (mapRow?.product_id) {
                                return db.get(
                                  "SELECT id FROM products WHERE id = ?",
                                  [mapRow.product_id],
                                  (findErr, row) => cb(findErr, row),
                                );
                              }

                              // 1b. Fallback: match by barcode
                              if (barcode) {
                                return db.get(
                                  "SELECT id FROM products WHERE barcode = ?",
                                  [barcode],
                                  (findErr, row) => {
                                    if (findErr) return cb(findErr);
                                    if (row) return cb(null, row);

                                    // 1c. Fallback: match by SKU
                                    if (sku) {
                                      return db.get(
                                        "SELECT id FROM products WHERE sku = ? LIMIT 1",
                                        [sku],
                                        cb,
                                      );
                                    }
                                    return cb(null, null);
                                  },
                                );
                              }

                              // 1c. No barcode — try SKU only
                              if (sku) {
                                return db.get(
                                  "SELECT id FROM products WHERE sku = ? LIMIT 1",
                                  [sku],
                                  cb,
                                );
                              }

                              return cb(null, null);
                            },
                          );
                        };

                        // Resolve category from Shopify product_type if it matches a leaf
                        const productTypeName = (sp.product_type || "").trim();
                        const doImport = (existing, categoryId) => {
                          const saveMapAndStock = (productId) => {
                            // Upsert shopify_product_map
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

                            // Upsert shopify_product_metadata (fire-and-forget)
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
                                locationToOutlet[lvl.shopify_location_id] ||
                                defaultOutletId;
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
                          };

                          if (existing?.id) {
                            // --- UPDATE path: product already exists ---
                            db.run(
                              `UPDATE products SET
                                 name = ?,
                                 barcode = CASE WHEN ? IS NOT NULL THEN ? ELSE barcode END,
                                 sku = CASE WHEN ? IS NOT NULL THEN ? ELSE sku END,
                                 price = ?,
                                 compare_at_price = ?,
                                 description_html = ?,
                                 product_type = ?,
                                 vendor = ?,
                                 tags = ?,
                                 status = ?,
                                 cost_price = CASE WHEN ? > 0 THEN ? ELSE cost_price END,
                                 category_id = CASE WHEN ? IS NOT NULL THEN ? ELSE category_id END
                               WHERE id = ?`,
                              [
                                name,
                                barcode,
                                barcode,
                                sku,
                                sku,
                                v.price || 0,
                                v.compare_at_price || 0,
                                sp.description_html || null,
                                sp.product_type || null,
                                sp.vendor || null,
                                sp.tags || null,
                                sp.status || "active",
                                v.cost_price || 0,
                                v.cost_price || 0,
                                categoryId,
                                categoryId,
                                existing.id,
                              ],
                              (updateErr) => {
                                if (updateErr) {
                                  errors.push({
                                    barcode: barcode || sku,
                                    error: updateErr.message,
                                  });
                                  return processVariant();
                                }
                                updated += 1;
                                saveMapAndStock(existing.id);
                              },
                            );
                          } else {
                            // --- INSERT path: new product ---
                            db.run(
                              `INSERT INTO products (barcode, sku, name, price, compare_at_price, description_html, product_type, vendor, tags, status, cost_price, category_id, stock, unit)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pcs')`,
                              [
                                barcode,
                                sku,
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
                              function (insertErr) {
                                if (insertErr) {
                                  errors.push({
                                    barcode: barcode || sku,
                                    error: insertErr.message,
                                  });
                                  return processVariant();
                                }
                                created += 1;
                                saveMapAndStock(this.lastID);
                              },
                            );
                          }
                        };

                        // Find existing product, then resolve category, then do import
                        findExistingProduct((lookupErr, existing) => {
                          if (lookupErr) {
                            errors.push({
                              barcode: barcode || sku,
                              error: lookupErr.message,
                            });
                            return processVariant();
                          }
                          if (productTypeName) {
                            resolveImportCategoryId(
                              productTypeName,
                              (catErr, categoryId) => {
                                doImport(existing, catErr ? null : categoryId);
                              },
                            );
                          } else {
                            doImport(existing, null);
                          }
                        });
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
