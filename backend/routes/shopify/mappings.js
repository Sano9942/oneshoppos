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
    (req, res) => {
      db.all(
        `SELECT spm.*, p.name as product_name, pv.sku as variant_sku
     FROM shopify_product_map spm
     LEFT JOIN products p ON p.id = spm.product_id
     LEFT JOIN product_variants pv ON pv.id = spm.variant_id
     ORDER BY spm.id DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ mappings: rows || [] });
        },
      );
    },
  );

  app.put(
    "/api/integrations/mappings/products/:id",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { id } = req.params;
      const {
        product_id,
        variant_id,
        shopify_product_id,
        shopify_variant_id,
        shopify_inventory_item_id,
        is_active,
      } = req.body || {};
      db.run(
        `INSERT INTO shopify_product_map (
      id, product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(id) DO UPDATE SET
      product_id = excluded.product_id,
      variant_id = excluded.variant_id,
      shopify_product_id = excluded.shopify_product_id,
      shopify_variant_id = excluded.shopify_variant_id,
      shopify_inventory_item_id = excluded.shopify_inventory_item_id,
      is_active = excluded.is_active,
      last_verified_at = datetime('now','localtime')`,
        [
          parseInt(id),
          product_id || null,
          variant_id || null,
          shopify_product_id || null,
          shopify_variant_id || null,
          shopify_inventory_item_id || null,
          is_active !== undefined ? (is_active ? 1 : 0) : 1,
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Product mapping saved" });
        },
      );
    },
  );

  app.post(
    "/api/integrations/mappings/products/auto",
    requirePerm("manage_inventory"),
    (req, res) => {
      // Placeholder for later Shopify-aware auto-map.
      // For pre-integration phase, return local products/variants candidates.
      db.all(
        `SELECT p.id as product_id, p.name, p.barcode, pv.id as variant_id, pv.sku
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id
     ORDER BY p.name ASC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            candidates: rows || [],
            message: "Auto-map candidates generated",
          });
        },
      );
    },
  );

  app.post(
    "/api/integrations/mappings/products/auto-live",
    requirePerm("manage_inventory"),
    (req, res) => {
      const limit = Math.min(
        10000,
        Math.max(1, parseInt(req.body?.limit || "500", 10)),
      );
      getActiveShopifyConnection(async (connErr, conn) => {
        if (connErr) return res.status(500).json({ error: connErr.message });
        if (!conn)
          return res
            .status(400)
            .json({ error: "No active Shopify connection" });

        try {
          const remoteVariants = await fetchShopifyVariantCatalog(conn, limit);
          db.all(
            `SELECT p.id as product_id,
                p.name as product_name,
                p.barcode as product_barcode,
                pv.id as variant_id,
                pv.sku as variant_sku,
                NULL as variant_barcode
         FROM products p
         LEFT JOIN product_variants pv ON pv.product_id = p.id`,
            [],
            (localErr, localRows) => {
              if (localErr)
                return res.status(500).json({ error: localErr.message });
              db.all(
                `SELECT product_id,
                    COALESCE(variant_id, -1) AS variant_key,
                    shopify_variant_id
             FROM shopify_product_map
             WHERE is_active = 1`,
                [],
                (mappedErr, mappedRows) => {
                  if (mappedErr)
                    return res.status(500).json({ error: mappedErr.message });

                  const existingLocalMap = new Map();
                  for (const row of mappedRows || []) {
                    existingLocalMap.set(
                      `${row.product_id}:${row.variant_key}`,
                      row.shopify_variant_id || "",
                    );
                  }

                  const byBarcode = new Map();
                  const bySku = new Map();
                  for (const rv of remoteVariants) {
                    const b = String(rv.barcode || "")
                      .trim()
                      .toLowerCase();
                    const s = String(rv.sku || "")
                      .trim()
                      .toLowerCase();
                    if (b && !byBarcode.has(b)) byBarcode.set(b, rv);
                    if (s && !bySku.has(s)) bySku.set(s, rv);
                  }

                  const suggestions = [];
                  for (const lr of localRows || []) {
                    const localBarcode = String(
                      lr.variant_barcode || lr.product_barcode || "",
                    )
                      .trim()
                      .toLowerCase();
                    const localSku = String(lr.variant_sku || "")
                      .trim()
                      .toLowerCase();

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
                    const mappedShopifyVariantId =
                      existingLocalMap.get(localKey) || "";
                    if (
                      mappedShopifyVariantId &&
                      mappedShopifyVariantId === String(match.variant_id || "")
                    ) {
                      continue;
                    }

                    suggestions.push({
                      product_id: lr.product_id,
                      product_name: lr.product_name,
                      variant_id: lr.variant_id || null,
                      local_sku: lr.variant_sku || null,
                      local_barcode:
                        lr.variant_barcode || lr.product_barcode || null,
                      shopify_product_id: match.product_id || null,
                      shopify_variant_id: match.variant_id || null,
                      shopify_inventory_item_id:
                        match.inventory_item_id || null,
                      shopify_title:
                        match.display_name || match.product_title || null,
                      confidence,
                    });
                  }

                  return res.json({
                    message: "Live mapping suggestions generated",
                    remote_count: remoteVariants.length,
                    suggestion_count: suggestions.length,
                    suggestions,
                  });
                },
              );
            },
          );
        } catch (e) {
          return res
            .status(400)
            .json({ error: e.message || "Failed to generate live mappings" });
        }
      });
    },
  );

  app.post(
    "/api/integrations/mappings/products/apply-suggestions",
    requirePerm("manage_inventory"),
    (req, res) => {
      const suggestions = Array.isArray(req.body?.suggestions)
        ? req.body.suggestions
        : [];
      if (suggestions.length === 0) {
        return res.status(400).json({ error: "suggestions array is required" });
      }

      let idx = 0;
      let applied = 0;
      let skipped = 0;
      const conflicts = [];

      const next = () => {
        if (idx >= suggestions.length) {
          return res.json({
            message: "Suggestions processed",
            total: suggestions.length,
            applied,
            skipped,
            conflicts,
          });
        }

        const s = suggestions[idx];
        idx += 1;
        const productId = s.product_id ? Number(s.product_id) : null;
        const variantId = s.variant_id ? Number(s.variant_id) : null;
        const shopifyProductId = s.shopify_product_id || null;
        const shopifyVariantId = s.shopify_variant_id || null;
        const shopifyInventoryItemId = s.shopify_inventory_item_id || null;

        if (!productId || !shopifyVariantId) {
          skipped += 1;
          return next();
        }

        db.get(
          `SELECT id, product_id, variant_id
       FROM shopify_product_map
       WHERE shopify_variant_id = ?
         AND (
           product_id != ?
           OR COALESCE(variant_id, -1) != COALESCE(?, -1)
         )
       LIMIT 1`,
          [shopifyVariantId, productId, variantId],
          (confErr, conflict) => {
            if (confErr) {
              skipped += 1;
              conflicts.push({
                product_id: productId,
                variant_id: variantId,
                shopify_variant_id: shopifyVariantId,
                reason: confErr.message,
              });
              return next();
            }
            if (conflict) {
              skipped += 1;
              conflicts.push({
                product_id: productId,
                variant_id: variantId,
                shopify_variant_id: shopifyVariantId,
                reason: `Already mapped to local product ${conflict.product_id}/${conflict.variant_id || "no-variant"}`,
              });
              return next();
            }

            db.get(
              `SELECT id
           FROM shopify_product_map
           WHERE product_id = ?
             AND COALESCE(variant_id, -1) = COALESCE(?, -1)
           LIMIT 1`,
              [productId, variantId],
              (localErr, localExisting) => {
                if (localErr) {
                  skipped += 1;
                  conflicts.push({
                    product_id: productId,
                    variant_id: variantId,
                    shopify_variant_id: shopifyVariantId,
                    reason: localErr.message,
                  });
                  return next();
                }

                if (localExisting?.id) {
                  db.run(
                    `UPDATE shopify_product_map
                 SET shopify_product_id = ?,
                     shopify_variant_id = ?,
                     shopify_inventory_item_id = ?,
                     is_active = 1,
                     last_verified_at = datetime('now','localtime')
                 WHERE id = ?`,
                    [
                      shopifyProductId,
                      shopifyVariantId,
                      shopifyInventoryItemId,
                      localExisting.id,
                    ],
                    (upErr) => {
                      if (upErr) {
                        skipped += 1;
                        conflicts.push({
                          product_id: productId,
                          variant_id: variantId,
                          shopify_variant_id: shopifyVariantId,
                          reason: upErr.message,
                        });
                      } else {
                        applied += 1;
                      }
                      return next();
                    },
                  );
                  return;
                }

                db.run(
                  `INSERT INTO shopify_product_map (
                 product_id, variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active, last_verified_at
               ) VALUES (?, ?, ?, ?, ?, 1, datetime('now','localtime'))`,
                  [
                    productId,
                    variantId,
                    shopifyProductId,
                    shopifyVariantId,
                    shopifyInventoryItemId,
                  ],
                  (insErr) => {
                    if (insErr) {
                      skipped += 1;
                      conflicts.push({
                        product_id: productId,
                        variant_id: variantId,
                        shopify_variant_id: shopifyVariantId,
                        reason: insErr.message,
                      });
                    } else {
                      applied += 1;
                    }
                    return next();
                  },
                );
              },
            );
          },
        );
      };

      next();
    },
  );

  // --- LOCATION MAPPINGS ---

  app.get(
    "/api/integrations/mappings/locations",
    requirePerm("manage_inventory"),
    (req, res) => {
      db.all(
        `SELECT slm.*, o.name as outlet_name
     FROM shopify_location_map slm
     LEFT JOIN outlets o ON o.id = slm.outlet_id
     ORDER BY o.name ASC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ mappings: rows || [] });
        },
      );
    },
  );

  app.put(
    "/api/integrations/mappings/locations/:outletId",
    requirePerm("manage_inventory"),
    (req, res) => {
      const { outletId } = req.params;
      const { shopify_location_id, shopify_location_name } = req.body || {};
      if (!shopify_location_id) {
        return res
          .status(400)
          .json({ error: "shopify_location_id is required" });
      }
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          "DELETE FROM shopify_location_map WHERE outlet_id = ?",
          [outletId],
          function (deleteErr) {
            if (deleteErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: deleteErr.message });
            }
            const replaced_count = this.changes || 0;
            db.run(
              `INSERT INTO shopify_location_map (outlet_id, shopify_location_id, shopify_location_name)
         VALUES (?, ?, ?)`,
              [
                outletId,
                String(shopify_location_id),
                shopify_location_name || null,
              ],
              function (insertErr) {
                if (insertErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: insertErr.message });
                }
                db.run("COMMIT", (commitErr) => {
                  if (commitErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: commitErr.message });
                  }
                  res.json({
                    message: "Location mapping saved",
                    replaced_count,
                  });
                });
              },
            );
          },
        );
      });
    },
  );

  // --- CUSTOMER MAPPINGS ---

  app.get(
    "/api/integrations/mappings/customers",
    requirePerm("manage_orders"),
    (req, res) => {
      db.all(
        `SELECT scm.*, c.name as customer_name, c.mobile, c.email
     FROM shopify_customer_map scm
     LEFT JOIN customers c ON c.id = scm.customer_id
     ORDER BY scm.id DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ mappings: rows || [] });
        },
      );
    },
  );

  app.put(
    "/api/integrations/mappings/customers/:customerId",
    requirePerm("manage_orders"),
    (req, res) => {
      const { customerId } = req.params;
      const { shopify_customer_id } = req.body || {};
      if (!shopify_customer_id) {
        return res
          .status(400)
          .json({ error: "shopify_customer_id is required" });
      }
      db.run(
        `INSERT INTO shopify_customer_map (customer_id, shopify_customer_id, last_synced_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(shopify_customer_id) DO UPDATE SET
      customer_id = excluded.customer_id,
      last_synced_at = datetime('now','localtime')`,
        [customerId, String(shopify_customer_id)],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Customer mapping saved" });
        },
      );
    },
  );
};
