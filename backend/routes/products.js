const {
  fetchEnrichedCategories,
  getCategoryById,
  getDescendantLeafIds,
} = require("../category-tree");

module.exports = function registerProductRoutes(app, deps) {
  const { db, multer, requirePerm, PRODUCT_UPLOADS_DIR, UPLOADS_DIR } = deps;

// --- ROUTES: PRODUCTS (INVENTORY) ---

  function normalizeProductMediaInput(media, image_urls) {
    const normalized = [];

    if (Array.isArray(media)) {
      media.forEach((item) => {
        if (!item) return;
        if (typeof item === "string") {
          const url = item.trim();
          if (url) normalized.push({ url, alt_text: null });
          return;
        }
        const url = String(item.url || "").trim();
        if (!url) return;
        normalized.push({
          url,
          alt_text: item.alt_text != null ? String(item.alt_text) : null,
        });
      });
    }

    if (Array.isArray(image_urls)) {
      image_urls.forEach((urlRaw) => {
        const url = String(urlRaw || "").trim();
        if (url) normalized.push({ url, alt_text: null });
      });
    }

    const seen = new Set();
    const deduped = [];
    normalized.forEach((m, idx) => {
      const key = m.url.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push({
        url: m.url,
        alt_text: m.alt_text,
        position: idx,
      });
    });

    return deduped;
  }

  function replaceProductMedia(productId, mediaItems, cb) {
    const media = Array.isArray(mediaItems) ? mediaItems : [];
    db.serialize(() => {
      db.run(
        "DELETE FROM product_media WHERE product_id = ? AND variant_id IS NULL",
        [productId],
        (delErr) => {
          if (delErr) {
            if (String(delErr.message || "").includes("no such table"))
              return cb(null);
            return cb(delErr);
          }
          if (media.length === 0) return cb(null);

          let pending = media.length;
          let failed = false;
          media.forEach((item, idx) => {
            if (failed) return;
            db.run(
              "INSERT INTO product_media (product_id, variant_id, url, alt_text, position) VALUES (?, NULL, ?, ?, ?)",
              [
                productId,
                item.url,
                item.alt_text || null,
                item.position != null ? item.position : idx,
              ],
              (insErr) => {
                if (failed) return;
                if (insErr) {
                  failed = true;
                  return cb(insErr);
                }
                pending -= 1;
                if (pending === 0) cb(null);
              },
            );
          });
        },
      );
    });
  }

  async function validateLeafCategory(categoryId) {
    if (categoryId == null || categoryId === "") return null;
    const category = await getCategoryById(db, categoryId);
    if (!category) return "Category not found";
    const leafIds = await getDescendantLeafIds(db, category.id);
    if (leafIds.length !== 1 || Number(leafIds[0]) !== Number(category.id)) {
      return "Products can only be assigned to leaf categories";
    }
    return null;
  }

  async function decorateProductsWithCategoryPaths(rows) {
    const categories = await fetchEnrichedCategories(db);
    const byId = new Map(categories.map((row) => [Number(row.id), row]));
    return (rows || []).map((row) => {
      const category = row.category_id ? byId.get(Number(row.category_id)) : null;
      return {
        ...row,
        category_name: category?.name || row.category_name || null,
        category_path_label:
          category?.path_label || row.category_name || row.category_path_label || null,
        category_parent_id: category?.parent_id ?? null,
        category_depth: category?.depth ?? null,
      };
    });
  }

  // Get all products (with aggregated stock, sort/filter/search support)
  app.get("/api/products", async (req, res) => {
    try {
    const { search, sort, order, status, category_id, outlet_id } = req.query;

    // Allowed sort columns (whitelist to prevent SQL injection)
    const sortMap = {
      name: "p.name",
      price: "p.price",
      stock: "total_stock",
      min_qty: "p.min_qty",
      created_at: "p.id",
    };
    const sortCol = sortMap[sort] || "p.name";
    const sortDir = order === "desc" ? "DESC" : "ASC";

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    if (status === "active" || status === "inactive") {
      conditions.push("p.status = ?");
      params.push(status);
    }
    if (category_id) {
      const leafIds = await getDescendantLeafIds(db, Number(category_id));
      if (!leafIds.length) {
        return res.json({ products: [] });
      }
      if (leafIds.length === 1) {
        conditions.push("p.category_id = ?");
        params.push(Number(leafIds[0]));
      } else {
        conditions.push(`p.category_id IN (${leafIds.map(() => "?").join(",")})`);
        params.push(...leafIds.map(Number));
      }
    }
    if (outlet_id) {
      conditions.push("os_loc.outlet_id = ?");
      params.push(Number(outlet_id));
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // If outlet_id is provided, we join specifically to that outlet's stock.
    // Otherwise, we sum up across all outlets.
    const stockExpr = outlet_id
      ? "COALESCE(os_loc.quantity, 0)"
      : "(COALESCE(os_sum.total, 0) + COALESCE(pv_sum.total, 0))";

    const sql = `
        SELECT p.*,
               c.name as category_name,
               t.name as tax_name, t.rate as tax_rate,
               s.name as supplier_name,
               b.name as brand_name,
               ${stockExpr} as total_stock
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN brands b ON p.brand_id = b.id
        ${outlet_id ? "LEFT JOIN outlet_stock os_loc ON p.id = os_loc.product_id" : ""}
        LEFT JOIN (
            SELECT product_id, SUM(quantity) as total FROM outlet_stock GROUP BY product_id
        ) os_sum ON p.id = os_sum.product_id
        LEFT JOIN (
            SELECT product_id, SUM(stock) as total FROM product_variants GROUP BY product_id
        ) pv_sum ON p.id = pv_sum.product_id
        ${where}
        ORDER BY ${sortCol} ${sortDir}
    `;

    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ products: await decorateProductsWithCategoryPaths(rows) });
    });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get variants for a specific product
  app.get("/api/products/:id/variants", (req, res) => {
    const { id } = req.params;

    db.all(
      `SELECT pv.*, 
            json_group_array(
               json_object('attribute_name', a.name, 'option_value', ao.value)
            ) as options_json
     FROM product_variants pv
     LEFT JOIN variant_option_values vov ON pv.id = vov.variant_id
     LEFT JOIN attributes a ON vov.attribute_id = a.id
     LEFT JOIN attribute_options ao ON vov.attribute_option_id = ao.id
     WHERE pv.product_id = ?
     GROUP BY pv.id`,
      [id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const variants = rows.map((r) => ({
          ...r,
          options: r.options_json
            ? JSON.parse(r.options_json).filter(
                (o) => o.attribute_name !== null,
              )
            : [],
        }));
        res.json({ variants });
      },
    );
  });

  // Get individual product stock across all outlets
  app.get("/api/products/:id/stock", (req, res) => {
    const { id } = req.params;
    db.all(
      `
        SELECT os.outlet_id, o.name as outlet_name, os.quantity 
        FROM outlet_stock os
        JOIN outlets o ON os.outlet_id = o.id
        WHERE os.product_id = ?
    `,
      [id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ stock: rows });
      },
    );
  });

  // Search products by name or barcode (for autocomplete and search)
  app.get("/api/products/search", (req, res) => {
    const { query, outlet_id, field } = req.query;

    if (!query) return res.json({ products: [] });

    const searchQuery = `%${query}%`;
    let whereClause =
      "p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ? OR CAST(p.price AS TEXT) LIKE ?";
    let params = [searchQuery, searchQuery, searchQuery, searchQuery];

    if (field === "barcode") {
      whereClause = "p.barcode LIKE ?";
      params = [searchQuery];
    } else if (field === "sku") {
      whereClause = "p.sku LIKE ?";
      params = [searchQuery];
    } else if (field === "price") {
      whereClause = "p.price = ?";
      params = [query];
    }

    let sql = `
        SELECT p.*, t.rate as tax_rate, t.name as tax_name,
               COALESCE(SUM(os.quantity), 0) as local_stock
        FROM products p
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = ${outlet_id}` : ""}
        WHERE ${whereClause}
        GROUP BY p.id
        ORDER BY p.name ASC
        LIMIT 50
    `;

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      // Normalize Tax Output for the POS Terminal
      const productsWithTax = rows.map((row) => {
        const effectiveTaxRate =
          row.tax_rate !== null ? row.tax_rate : row.gst !== null ? row.gst : 0;
        const effectiveTaxName =
          row.tax_name || (row.gst !== null ? "GST" : "No Tax");
        return {
          ...row,
          effectiveTaxRate,
          effectiveTaxName,
        };
      });

      res.json({ products: productsWithTax });
    });
  });

  // Scan/Find a product by barcode (Crucial for POS speed)
  app.get("/api/products/scan/:barcode", (req, res) => {
    const { barcode } = req.params;
    const outlet_id = req.query.outlet_id; // Pass outlet ID from POS to get local stock

    let query = `
        SELECT p.*, t.rate as tax_rate, t.name as tax_name,
               COALESCE(SUM(os.quantity), 0) as local_stock
        FROM products p
        LEFT JOIN taxes t ON p.tax_id = t.id
        LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = ${outlet_id}` : ""}
        WHERE p.barcode = ? OR p.sku = ?
        GROUP BY p.id
    `;

    db.get(query, [barcode, barcode], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Product not found" });

      // Normalize Tax Output for the POS Terminal
      // If it has a tax profile, use it. Otherwise fallback to legacy GST.
      const effectiveTaxRate =
        row.tax_rate !== null ? row.tax_rate : row.gst !== null ? row.gst : 0;
      const effectiveTaxName =
        row.tax_name || (row.gst !== null ? "GST" : "No Tax");

      const productWithTax = {
        ...row,
        effectiveTaxRate,
        effectiveTaxName,
      };

      res.json({ product: productWithTax });
    });
  });

  // Add a new product (and optionally set initial stock for a specific outlet)
  app.post("/api/products", async (req, res) => {
    const {
      barcode,
      sku,
      name,
      price,
      cost_price,
      gst,
      category_id,
      tax_id,
      brand_id,
      outlet_id,
      initial_stock,
      has_variants,
      attribute_set_id,
      variants, // Array of variant objects if has_variants is true
      min_qty,
      max_qty,
      unit,
      description_html,
      compare_at_price,
      product_type,
      vendor,
      tags,
      status,
      media,
      image_urls,
    } = req.body;
    try {
      const categoryError = await validateLeafCategory(category_id);
      if (categoryError) {
        return res.status(400).json({ error: categoryError });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    const productMediaItems = normalizeProductMediaInput(media, image_urls);

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(
        "INSERT INTO products (barcode, sku, name, price, cost_price, gst, stock, category_id, tax_id, brand_id, has_variants, attribute_set_id, min_qty, max_qty, unit, description_html, compare_at_price, product_type, vendor, tags, status) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          barcode,
          sku || null,
          name,
          price,
          cost_price || 0,
          gst === "" ? null : gst,
          category_id || null,
          tax_id || null,
          brand_id || null,
          has_variants ? 1 : 0,
          attribute_set_id || null,
          min_qty || 0,
          max_qty || 0,
          unit || "pcs",
          description_html || null,
          compare_at_price || 0,
          product_type || null,
          vendor || null,
          tags || null,
          status || "active",
        ],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            if (err.message.includes("UNIQUE constraint failed")) {
              return res.status(400).json({ error: "Barcode already exists" });
            }
            return res.status(500).json({ error: err.message });
          }
          const newProductId = this.lastID;

          // Helper function to successfully terminate the request
          const finishCreation = () => {
            replaceProductMedia(newProductId, productMediaItems, (mediaErr) => {
              if (mediaErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: mediaErr.message });
              }
              db.run("COMMIT");
              res.json({ id: newProductId, barcode, name, has_variants });
            });
          };

          // 1. If it has variants, process them
          if (has_variants && variants && variants.length > 0) {
            let pendingVariants = variants.length;
            let hasError = false;

            variants.forEach((variant) => {
              if (hasError) return;

              db.run(
                `INSERT INTO product_variants
                 (product_id, sku, barcode, price, cost_price, compare_at_price, weight, weight_unit, stock)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                [
                  newProductId,
                  variant.sku,
                  variant.barcode || null,
                  variant.price || price,
                  variant.cost_price || cost_price,
                  variant.compare_at_price || variant.price || price || 0,
                  variant.weight || 0,
                  variant.weight_unit || "kg",
                ],
                function (vErr) {
                  if (vErr) {
                    hasError = true;
                    db.run("ROLLBACK");
                    return res.status(500).json({
                      error: "Variant SKU constraint failed: " + vErr.message,
                    });
                  }
                  const variantId = this.lastID;

                  // Insert Outlet stock for variant if provided
                  if (outlet_id && variant.initial_stock) {
                    // TODO: Variant stock should probably be tracked in a outlet_variant_stock table in the future.
                    // For now we'll put it in the base variant table's stock column.
                    db.run(
                      "UPDATE product_variants SET stock = ? WHERE id = ?",
                      [variant.initial_stock, variantId],
                    );
                  }

                  const options = variant.options || [];
                  if (options.length === 0) {
                    pendingVariants--;
                    if (pendingVariants === 0 && !hasError) finishCreation();
                    return;
                  }

                  let pendingOptions = options.length;
                  options.forEach((opt) => {
                    if (hasError) return;
                    db.run(
                      "INSERT INTO variant_option_values (variant_id, attribute_id, attribute_option_id) VALUES (?, ?, ?)",
                      [variantId, opt.attribute_id, opt.attribute_option_id],
                      function (oErr) {
                        if (oErr) {
                          hasError = true;
                          db.run("ROLLBACK");
                          return res.status(500).json({ error: oErr.message });
                        }
                        pendingOptions--;
                        if (pendingOptions === 0) {
                          pendingVariants--;
                          if (pendingVariants === 0 && !hasError)
                            finishCreation();
                        }
                      },
                    );
                  });
                },
              );
            });
          } else {
            // 2. Simple product stock initialization
            if (outlet_id && initial_stock) {
              db.run(
                "INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (?, ?, ?)",
                [newProductId, outlet_id, initial_stock],
                function (stockErr) {
                  if (stockErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({
                      error:
                        "Failed to initialize outlet stock: " +
                        stockErr.message,
                    });
                  }
                  finishCreation();
                },
              );
            } else {
              finishCreation();
            }
          }
        },
      );
    });
  });

  // Bulk import products from CSV rows (upsert by barcode)
  app.post("/api/products/bulk-import", (req, res) => {
    const { rows } = req.body; // [{ barcode, name, price, ..., image_url, image_urls }]
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No rows provided" });
    }

    const results = [];

    const processNext = (index) => {
      if (index >= rows.length) {
        return res.json({ results });
      }
      const row = rows[index];
      const {
        barcode,
        name,
        price,
        cost_price,
        compare_at_price,
        description_html,
        product_type,
        vendor,
        tags,
        status,
        gst,
        stock,
        min_qty,
        max_qty,
        unit,
        image_url,
        image_urls,
      } = row;
      const productMediaItems = normalizeProductMediaInput(
        null,
        image_urls
          ? String(image_urls)
              .split("|")
              .map((s) => s.trim())
              .filter(Boolean)
          : image_url
            ? [String(image_url).trim()]
            : [],
      );

      if (!barcode || !name || !price) {
        results.push({
          barcode: barcode || "?",
          status: "error",
          message: "barcode, name, and price are required",
        });
        return processNext(index + 1);
      }

      db.get(
        "SELECT id FROM products WHERE barcode = ?",
        [barcode],
        (findErr, existing) => {
          if (findErr) {
            results.push({
              barcode,
              status: "error",
              message: findErr.message,
            });
            return processNext(index + 1);
          }

          db.run(
            `INSERT INTO products (barcode, name, price, cost_price, compare_at_price, description_html, product_type, vendor, tags, status, gst, stock, min_qty, max_qty, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(barcode) DO UPDATE SET
             name = excluded.name,
             price = excluded.price,
             cost_price = excluded.cost_price,
             compare_at_price = excluded.compare_at_price,
             description_html = excluded.description_html,
             product_type = excluded.product_type,
             vendor = excluded.vendor,
             tags = excluded.tags,
             status = excluded.status,
             gst = excluded.gst,
             stock = excluded.stock,
             min_qty = excluded.min_qty,
             max_qty = excluded.max_qty,
             unit = excluded.unit`,
            [
              barcode,
              name,
              parseFloat(price) || 0,
              parseFloat(cost_price) || 0,
              parseFloat(compare_at_price) || 0,
              description_html || null,
              product_type || null,
              vendor || null,
              tags || null,
              status || "active",
              gst !== "" && gst != null ? parseFloat(gst) : null,
              parseInt(stock) || 0,
              parseInt(min_qty) || 0,
              parseInt(max_qty) || 0,
              unit || "pcs",
            ],
            function (err) {
              if (err) {
                results.push({
                  barcode,
                  status: "error",
                  message: err.message,
                });
                return processNext(index + 1);
              }

              const productId = existing ? existing.id : this.lastID;
              replaceProductMedia(productId, productMediaItems, (mediaErr) => {
                if (mediaErr) {
                  results.push({
                    barcode,
                    status: "error",
                    message: mediaErr.message,
                  });
                } else {
                  results.push({
                    barcode,
                    name,
                    status: existing ? "updated" : "inserted",
                  });
                }
                processNext(index + 1);
              });
            },
          );
        },
      );
    };

    processNext(0);
  });

  // Update a product (Prices, Names, Categories... NOT Stock. Stock is handled via Adjustments/Transfers)
  app.put("/api/products/:id", async (req, res) => {
    const { id } = req.params;
    const {
      name,
      price,
      cost_price,
      gst,
      barcode,
      sku,
      category_id,
      tax_id,
      brand_id,
      min_qty,
      max_qty,
      unit,
      description_html,
      compare_at_price,
      product_type,
      vendor,
      tags,
      status,
      media,
      image_urls,
      variants, // Optional array of variants to update
    } = req.body;
    try {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "category_id")) {
        const categoryError = await validateLeafCategory(category_id);
        if (categoryError) {
          return res.status(400).json({ error: categoryError });
        }
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const shouldReplaceMedia =
      Object.prototype.hasOwnProperty.call(req.body || {}, "media") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "image_urls");
    const productMediaItems = normalizeProductMediaInput(media, image_urls);

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      // 1. Update main product
      db.run(
        "UPDATE products SET name = COALESCE(?, name), price = COALESCE(?, price), cost_price = COALESCE(?, cost_price), gst = ?, barcode = COALESCE(?, barcode), sku = COALESCE(?, sku), category_id = COALESCE(?, category_id), tax_id = COALESCE(?, tax_id), brand_id = COALESCE(?, brand_id), min_qty = COALESCE(?, min_qty), max_qty = COALESCE(?, max_qty), unit = COALESCE(?, unit), description_html = COALESCE(?, description_html), compare_at_price = COALESCE(?, compare_at_price), product_type = COALESCE(?, product_type), vendor = COALESCE(?, vendor), tags = COALESCE(?, tags), status = COALESCE(?, status) WHERE id = ?",
        [
          name,
          price,
          cost_price,
          gst === "" ? null : gst,
          barcode,
          sku || null,
          category_id || null,
          tax_id || null,
          brand_id || null,
          min_qty !== undefined ? min_qty : null,
          max_qty !== undefined ? max_qty : null,
          unit || null,
          description_html || null,
          compare_at_price !== undefined ? compare_at_price : null,
          product_type || null,
          vendor || null,
          tags || null,
          status || null,
          id,
        ],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            db.run("ROLLBACK");
            return res.status(404).json({ error: "Product not found" });
          }

          const finalizeUpdate = () => {
            if (shouldReplaceMedia) {
              replaceProductMedia(id, productMediaItems, (mediaErr) => {
                if (mediaErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: mediaErr.message });
                }
                db.run("COMMIT");
                res.json({ message: "Product updated successfully" });
              });
            } else {
              db.run("COMMIT");
              res.json({ message: "Product updated successfully" });
            }
          };

          // 2. Update variants if provided
          if (Array.isArray(variants) && variants.length > 0) {
            let pending = variants.length;
            let hasError = false;

            variants.forEach((v) => {
              if (hasError) return;
              // Only update existing variants for now (v.id)
              if (v.id && !String(v.id).startsWith("temp-")) {
                db.run(
                  "UPDATE product_variants SET sku = ?, barcode = ?, price = ?, cost_price = ?, compare_at_price = ?, weight = ?, weight_unit = ?, stock = ? WHERE id = ?",
                  [
                    v.sku,
                    v.barcode || null,
                    v.price || price,
                    v.cost_price || cost_price,
                    v.compare_at_price || v.price || price || 0,
                    v.weight || 0,
                    v.weight_unit || "kg",
                    v.stock || 0,
                    v.id,
                  ],
                  (vErr) => {
                    if (vErr) {
                      hasError = true;
                      db.run("ROLLBACK");
                      return res.status(500).json({ error: vErr.message });
                    }
                    pending--;
                    if (pending === 0 && !hasError) finalizeUpdate();
                  },
                );
              } else {
                // Ignore new variants in PUT for simplicity, or implement creation logic
                pending--;
                if (pending === 0 && !hasError) finalizeUpdate();
              }
            });
          } else {
            finalizeUpdate();
          }
        },
      );
    });
  });

  // Delete a product
  app.delete("/api/products/:id", (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM products WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ error: "Product not found" });
      res.json({ message: "Product deleted" });
    });
  });

  // Bulk delete products by IDs
  // Cleans up dependent rows; preserves sale/PO history (FK OFF so orphaned refs remain).
  app.post(
    "/api/products/bulk-delete",
    requirePerm("manage_inventory"),
    (req, res) => {
      const ids = (req.body?.ids || []).map(Number).filter(Boolean);
      if (!ids.length)
        return res.status(400).json({ error: "No product IDs provided." });

      const CHUNK = 400;
      const chunks = [];
      for (let i = 0; i < ids.length; i += CHUNK)
        chunks.push(ids.slice(i, i + CHUNK));

      let totalDeleted = 0;
      let chunkIdx = 0;

      db.run("PRAGMA foreign_keys = OFF", (fkErr) => {
        if (fkErr) return res.status(500).json({ error: fkErr.message });

        const finish = (err) => {
          db.run("PRAGMA foreign_keys = ON", () => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ deleted: totalDeleted });
          });
        };

        const processChunk = () => {
          if (chunkIdx >= chunks.length) return finish(null);
          const batch = chunks[chunkIdx++];
          const ph = batch.map(() => "?").join(",");
          db.run(
            `DELETE FROM shopify_product_map WHERE product_id IN (${ph})`,
            batch,
            (e1) => {
              if (e1) return finish(e1);
              db.run(
                `DELETE FROM outlet_stock WHERE product_id IN (${ph})`,
                batch,
                (e2) => {
                  if (e2) return finish(e2);
                  db.run(
                    `DELETE FROM stock_adjustments WHERE product_id IN (${ph})`,
                    batch,
                    (e3) => {
                      if (e3) return finish(e3);
                      db.run(
                        `DELETE FROM product_variants WHERE product_id IN (${ph})`,
                        batch,
                        (e4) => {
                          if (e4) return finish(e4);
                          db.run(
                            `DELETE FROM product_media WHERE product_id IN (${ph})`,
                            batch,
                            (e5) => {
                              if (e5) return finish(e5);
                              db.run(
                                `DELETE FROM products WHERE id IN (${ph})`,
                                batch,
                                function (e6) {
                                  if (e6) return finish(e6);
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
            },
          );
        };
        processChunk();
      });
    },
  );

  // Bulk update product status (active/inactive)
  app.post(
    "/api/products/bulk-status",
    requirePerm("manage_inventory"),
    (req, res) => {
      const ids = (req.body?.ids || []).map(Number).filter(Boolean);
      const { status } = req.body || {};
      if (!ids.length)
        return res.status(400).json({ error: "No product IDs provided." });
      if (status !== "active" && status !== "inactive")
        return res
          .status(400)
          .json({ error: "status must be 'active' or 'inactive'." });

      const CHUNK = 400;
      let updated = 0;
      let i = 0;
      const go = () => {
        if (i >= ids.length) return res.json({ updated });
        const batch = ids.slice(i, i + CHUNK);
        i += CHUNK;
        const ph = batch.map(() => "?").join(",");
        db.run(
          `UPDATE products SET status = ? WHERE id IN (${ph})`,
          [status, ...batch],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            updated += this.changes || 0;
            go();
          },
        );
      };
      go();
    },
  );

  // Bulk assign category to products
  app.post(
    "/api/products/bulk-category",
    requirePerm("manage_inventory"),
    async (req, res) => {
      const ids = (req.body?.ids || []).map(Number).filter(Boolean);
      const categoryId = Number(req.body?.category_id) || null;
      if (!ids.length)
        return res.status(400).json({ error: "No product IDs provided." });
      if (categoryId) {
        const categoryError = await validateLeafCategory(categoryId);
        if (categoryError) {
          return res.status(400).json({ error: categoryError });
        }
      }

      const CHUNK = 400;
      let updated = 0;
      let i = 0;
      const go = () => {
        if (i >= ids.length) return res.json({ updated });
        const batch = ids.slice(i, i + CHUNK);
        i += CHUNK;
        const ph = batch.map(() => "?").join(",");
        db.run(
          `UPDATE products SET category_id = ? WHERE id IN (${ph})`,
          [categoryId, ...batch],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });
            updated += this.changes || 0;
            go();
          },
        );
      };
      go();
    },
  );
};
