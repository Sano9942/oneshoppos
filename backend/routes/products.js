const {
  fetchEnrichedCategories,
  getCategoryById,
  getDescendantLeafIds,
} = require("../category-tree");

module.exports = function registerProductRoutes(app, deps) {
  const { db, multer, requirePerm, requirePlanLimit, PRODUCT_UPLOADS_DIR, UPLOADS_DIR } = deps;


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

  async function replaceProductMedia(client, productId, mediaItems) {
    const media = Array.isArray(mediaItems) ? mediaItems : [];
    try {
      await client.query(
        "DELETE FROM product_media WHERE product_id = $1 AND variant_id IS NULL",
        [productId]
      );
    } catch (err) {
      if (String(err.message || "").includes("does not exist")) return;
      throw err;
    }
    for (let idx = 0; idx < media.length; idx++) {
      const item = media[idx];
      await client.query(
        "INSERT INTO product_media (product_id, variant_id, url, alt_text, position) VALUES ($1, NULL, $2, $3, $4)",
        [
          productId,
          item.url,
          item.alt_text || null,
          item.position != null ? item.position : idx,
        ]
      );
    }
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

      const conditions = ["p.deleted_at IS NULL"];
      const params = [];
      let paramIdx = 0;

      if (search) {
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        conditions.push(`(p.name ILIKE $${++paramIdx} OR p.barcode ILIKE $${++paramIdx} OR p.sku ILIKE $${++paramIdx})`);
      }
      if (status === "active" || status === "inactive") {
        params.push(status);
        conditions.push(`p.status = $${++paramIdx}`);
      }
      if (category_id) {
        const leafIds = await getDescendantLeafIds(db, Number(category_id));
        if (!leafIds.length) {
          return res.json({ products: [] });
        }
        if (leafIds.length === 1) {
          params.push(Number(leafIds[0]));
          conditions.push(`p.category_id = $${++paramIdx}`);
        } else {
          const placeholders = leafIds.map((lid) => {
            params.push(Number(lid));
            return `$${++paramIdx}`;
          });
          conditions.push(`p.category_id IN (${placeholders.join(",")})`);
        }
      }
      if (outlet_id) {
        params.push(Number(outlet_id));
        conditions.push(`os_loc.outlet_id = $${++paramIdx}`);
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

      const { rows } = await db.query(sql, params);
      res.json({ products: await decorateProductsWithCategoryPaths(rows) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Search products by name or barcode (for autocomplete and search)
  // NOTE: must be registered BEFORE /:id to prevent Express matching "search" as an id param
  app.get("/api/products/search", async (req, res) => {
    try {
      const { query, outlet_id, field } = req.query;

      if (!query) return res.json({ products: [] });

      const searchQuery = `%${query}%`;
      let whereClause;
      let params;

      if (field === "barcode") {
        whereClause = "p.barcode ILIKE $1";
        params = [searchQuery];
      } else if (field === "sku") {
        whereClause = "p.sku ILIKE $1";
        params = [searchQuery];
      } else if (field === "price") {
        whereClause = "CAST(p.price AS TEXT) ILIKE $1";
        params = [searchQuery];
      } else {
        whereClause =
          "p.name ILIKE $1 OR p.barcode ILIKE $2 OR p.sku ILIKE $3 OR CAST(p.price AS TEXT) ILIKE $4 OR p.description_html ILIKE $5";
        params = [searchQuery, searchQuery, searchQuery, searchQuery, searchQuery];
      }

      // Build outlet join condition with safe parameterized value
      let outletJoinCondition = "";
      if (outlet_id) {
        params.push(Number(outlet_id));
        outletJoinCondition = `AND os.outlet_id = $${params.length}`;
      }

      const sql = `
          SELECT p.*, t.rate as tax_rate, t.name as tax_name,
                 COALESCE(SUM(os.quantity), 0) as local_stock
          FROM products p
          LEFT JOIN taxes t ON p.tax_id = t.id
          LEFT JOIN outlet_stock os ON p.id = os.product_id ${outletJoinCondition}
          WHERE p.deleted_at IS NULL AND (${whereClause})
          GROUP BY p.id, t.rate, t.name
          ORDER BY p.name ASC
          LIMIT 50
      `;

      const { rows } = await db.query(sql, params);

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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Scan/Find a product by barcode (Crucial for POS speed)
  // NOTE: must be registered BEFORE /:id to prevent Express matching "scan" as an id param
  app.get("/api/products/scan/:barcode", async (req, res) => {
    try {
      const { barcode } = req.params;
      const outlet_id = req.query.outlet_id; // Pass outlet ID from POS to get local stock

      let outletJoinCondition = "";
      const params = [barcode, barcode];
      if (outlet_id) {
        params.push(Number(outlet_id));
        outletJoinCondition = `AND os.outlet_id = $${params.length}`;
      }

      const sql = `
          SELECT p.*, t.rate as tax_rate, t.name as tax_name,
                 COALESCE(SUM(os.quantity), 0) as local_stock
          FROM products p
          LEFT JOIN taxes t ON p.tax_id = t.id
          LEFT JOIN outlet_stock os ON p.id = os.product_id ${outletJoinCondition}
          WHERE p.deleted_at IS NULL AND (p.barcode = $1 OR p.sku = $2)
          GROUP BY p.id, t.rate, t.name
      `;

      const { rows: [row] } = await db.query(sql, params);
      if (!row) return res.status(404).json({ error: "Product not found" });

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
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get a single product by id
  app.get("/api/products/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [row] } = await db.query(
        `SELECT p.*, COALESCE(SUM(os.quantity), 0) as total_stock
         FROM products p
         LEFT JOIN outlet_stock os ON p.id = os.product_id
         WHERE p.id = $1 AND p.deleted_at IS NULL
         GROUP BY p.id`,
        [id]
      );
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ product: row });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get variants for a specific product
  app.get("/api/products/:id/variants", async (req, res) => {
    try {
      const { id } = req.params;

      const { rows } = await db.query(
        `SELECT pv.*,
              json_agg(
                 json_build_object('attribute_name', a.name, 'option_value', ao.value)
              ) FILTER (WHERE a.name IS NOT NULL) as options_json
       FROM product_variants pv
       LEFT JOIN variant_option_values vov ON pv.id = vov.variant_id
       LEFT JOIN attributes a ON vov.attribute_id = a.id
       LEFT JOIN attribute_options ao ON vov.attribute_option_id = ao.id
       WHERE pv.product_id = $1
       GROUP BY pv.id`,
        [id]
      );

      const variants = rows.map((r) => ({
        ...r,
        options: r.options_json || [],
      }));
      res.json({ variants });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get individual product stock across all outlets
  app.get("/api/products/:id/stock", async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await db.query(
        `SELECT os.outlet_id, o.name as outlet_name, os.quantity
        FROM outlet_stock os
        JOIN outlets o ON os.outlet_id = o.id
        WHERE os.product_id = $1`,
        [id]
      );
      res.json({ stock: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new product (and optionally set initial stock for a specific outlet)
  app.post("/api/products", requirePerm("manage_inventory"), requirePlanLimit("products"), async (req, res) => {
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
      initial_stock: _initial_stock,
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
      supplier_id,
    } = req.body;
    const outlet_id = req.body.outlet_id || req.headers["x-outlet-id"];
    try {
      const categoryError = await validateLeafCategory(category_id);
      if (categoryError) {
        return res.status(400).json({ error: categoryError });
      }

      const parsedPrice = Number(price);
      if (!price || isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({ error: "Sale price is required and must be greater than zero" });
      }
      const initial_stock = _initial_stock || req.body.stock;

      const productMediaItems = normalizeProductMediaInput(media, image_urls);

      const result = await db.transaction(async (client) => {
        const { rows: [inserted] } = await client.query(
          `INSERT INTO products (barcode, sku, name, price, cost_price, gst, stock, category_id, tax_id, brand_id, has_variants, attribute_set_id, min_qty, max_qty, unit, description_html, compare_at_price, product_type, vendor, tags, status, supplier_id)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
           RETURNING id`,
          [
            barcode || null,
            sku || null,
            name,
            parsedPrice,
            cost_price || 0,
            gst === "" ? null : gst,
            category_id || null,
            tax_id || null,
            brand_id || null,
            has_variants ? true : false,
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
            supplier_id || null,
          ]
        );
        const newProductId = inserted.id;

        // 1. If it has variants, process them
        if (has_variants && variants && variants.length > 0) {
          for (const variant of variants) {
            const { rows: [vRow] } = await client.query(
              `INSERT INTO product_variants
               (product_id, sku, barcode, price, cost_price, compare_at_price, weight, weight_unit, stock)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
               RETURNING id`,
              [
                newProductId,
                variant.sku,
                variant.barcode || null,
                variant.price || price,
                variant.cost_price || cost_price,
                variant.compare_at_price || variant.price || price || 0,
                variant.weight || 0,
                variant.weight_unit || "kg",
              ]
            );
            const variantId = vRow.id;

            // Insert Outlet stock for variant if provided
            if (outlet_id && variant.initial_stock) {
              await client.query(
                "UPDATE product_variants SET stock = $1 WHERE id = $2",
                [variant.initial_stock, variantId]
              );
            }

            const options = variant.options || [];
            for (const opt of options) {
              await client.query(
                "INSERT INTO variant_option_values (variant_id, attribute_id, attribute_option_id) VALUES ($1, $2, $3)",
                [variantId, opt.attribute_id, opt.attribute_option_id]
              );
            }
          }
        } else {
          // 2. Simple product stock initialization
          if (outlet_id && initial_stock) {
            await client.query(
              "INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES ($1, $2, $3)",
              [newProductId, outlet_id, initial_stock]
            );
          }
        }

        await replaceProductMedia(client, newProductId, productMediaItems);

        return { id: newProductId, barcode, name, has_variants };
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk import products from CSV rows (upsert by barcode)
  app.post("/api/products/bulk-import", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rows } = req.body; // [{ barcode, name, price, outlet_id, stock, ..., image_url, image_urls }]
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "No rows provided" });
      }

      const results = [];

      for (const row of rows) {
        const {
          barcode,
          sku,
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
          outlet_id,
          supplier_name,
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

        const parsedBulkPrice = parseFloat(price);
        if (!name || isNaN(parsedBulkPrice) || parsedBulkPrice <= 0) {
          results.push({
            barcode: barcode || "?",
            name: name || "?",
            status: "error",
            message: "name and a sale price greater than zero are required",
          });
          continue;
        }

        const parsedStock = parseInt(stock) || 0;
        const parsedOutletId = outlet_id ? parseInt(outlet_id) || null : null;
        const trimmedSupplierName = supplier_name ? String(supplier_name).trim() : "";

        try {
          // Resolve supplier: if name given, find existing or create new
          let resolvedSupplierId = null;
          if (trimmedSupplierName) {
            const { rows: [existing] } = await db.query(
              "SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1)",
              [trimmedSupplierName]
            );
            if (existing) {
              resolvedSupplierId = existing.id;
            } else {
              const { rows: [newSup] } = await db.query(
                "INSERT INTO suppliers (name) VALUES ($1) RETURNING id",
                [trimmedSupplierName]
              );
              resolvedSupplierId = newSup.id;
            }
          }

          const { rows: [inserted] } = await db.query(
            `INSERT INTO products (barcode, sku, name, price, cost_price, compare_at_price, description_html, product_type, vendor, tags, status, gst, stock, min_qty, max_qty, unit, supplier_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
             RETURNING id`,
            [
              barcode || null,
              sku || null,
              name,
              parsedBulkPrice,
              parseFloat(cost_price) || 0,
              parseFloat(compare_at_price) || 0,
              description_html || null,
              product_type || null,
              vendor || null,
              tags || null,
              status || "active",
              gst !== "" && gst != null ? parseFloat(gst) : null,
              parsedOutletId ? 0 : parsedStock,
              parseInt(min_qty) || 0,
              parseInt(max_qty) || 0,
              unit || "pcs",
              resolvedSupplierId || null,
            ]
          );

          const productId = inserted.id;

          if (parsedOutletId && parsedStock > 0) {
            await db.query(
              `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
               VALUES ($1, $2, $3)
               ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
              [productId, parsedOutletId, parsedStock, parsedStock]
            );
          }

          // replaceProductMedia needs a client-like object; use db directly (not in transaction)
          await replaceProductMedia(db, productId, productMediaItems);

          results.push({ barcode: barcode || "?", name, status: "inserted", message: null });
        } catch (err) {
          results.push({ barcode: barcode || "?", name, status: "error", message: err.message });
        }
      }

      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update a product (Prices, Names, Categories... NOT Stock. Stock is handled via Adjustments/Transfers)
  app.put("/api/products/:id", requirePerm("manage_inventory"), async (req, res) => {
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
      supplier_id,
    } = req.body;
    try {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "category_id")) {
        const categoryError = await validateLeafCategory(category_id);
        if (categoryError) {
          return res.status(400).json({ error: categoryError });
        }
      }

      const shouldReplaceMedia =
        Object.prototype.hasOwnProperty.call(req.body || {}, "media") ||
        Object.prototype.hasOwnProperty.call(req.body || {}, "image_urls");
      const productMediaItems = normalizeProductMediaInput(media, image_urls);

      // Fetch old price/cost_price/name for audit log comparison
      const { rows: [oldProduct] } = await db.query(
        "SELECT price, cost_price, name FROM products WHERE id = $1",
        [id]
      );

      await db.transaction(async (client) => {
        // 1. Update main product
        const imageUrlProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "image_url");
        const barcodeValue = barcode === "" ? null : (barcode || null);

        const updateFields = [
          "name = COALESCE($1, name)",
          "price = COALESCE($2, price)",
          "cost_price = COALESCE($3, cost_price)",
          "gst = $4",
          "barcode = $5",
          "sku = $6",
          "category_id = $7",
          "tax_id = COALESCE($8, tax_id)",
          "brand_id = $9",
          "min_qty = COALESCE($10, min_qty)",
          "max_qty = COALESCE($11, max_qty)",
          "unit = COALESCE($12, unit)",
          "description_html = COALESCE($13, description_html)",
          "compare_at_price = COALESCE($14, compare_at_price)",
          "product_type = $15",
          "vendor = $16",
          "tags = $17",
          "status = COALESCE($18, status)",
          "supplier_id = $19",
        ];
        const updateParams = [
          name,
          price,
          cost_price,
          gst === "" ? null : gst,
          barcodeValue,
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
          supplier_id !== undefined ? (supplier_id || null) : null,
        ];

        let nextParam = 20;
        if (imageUrlProvided) {
          updateFields.push(`image_url = $${nextParam}`);
          updateParams.push(req.body.image_url || null);
          nextParam++;
        }
        updateParams.push(id);
        const idParam = `$${nextParam}`;

        const { rowCount } = await client.query(
          `UPDATE products SET ${updateFields.join(", ")} WHERE id = ${idParam}`,
          updateParams
        );

        if (rowCount === 0) {
          // Throw to trigger transaction rollback and 404 response
          const err = new Error("Product not found");
          err.statusCode = 404;
          throw err;
        }

        // 2. Update variants if provided
        if (Array.isArray(variants) && variants.length > 0) {
          for (const v of variants) {
            // Only update existing variants for now (v.id)
            if (v.id && !String(v.id).startsWith("temp-")) {
              await client.query(
                `UPDATE product_variants SET sku = $1, barcode = $2, price = $3, cost_price = $4, compare_at_price = $5, weight = $6, weight_unit = $7, stock = $8 WHERE id = $9`,
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
                ]
              );
            }
            // Ignore new variants in PUT for simplicity
          }
        }

        // Log price/cost changes to action_history if either changed
        const priceChanged = oldProduct && price !== undefined && Number(price) !== Number(oldProduct.price);
        const costChanged = oldProduct && cost_price !== undefined && Number(cost_price) !== Number(oldProduct.cost_price);
        if (priceChanged || costChanged) {
          const employeeId = Number(req.headers["x-employee-id"] || 0) || null;
          let employeeName = "Unknown";
          if (employeeId) {
            const { rows: [emp] } = await client.query(
              "SELECT name FROM employees WHERE id = $1",
              [employeeId]
            );
            if (emp) employeeName = emp.name;
          }
          const parts = [];
          if (priceChanged) parts.push(`price changed from ${oldProduct.price} to ${price}`);
          if (costChanged) parts.push(`cost changed from ${oldProduct.cost_price} to ${cost_price}`);
          const description = `Product '${oldProduct.name}' — ${parts.join(", ")}`;
          await client.query(
            "INSERT INTO action_history (user_name, action_type, description) VALUES ($1, $2, $3)",
            [employeeName, "price_change", description]
          );
        }

        if (shouldReplaceMedia) {
          await replaceProductMedia(client, id, productMediaItems);
        }
      });

      res.json({ message: "Product updated successfully" });
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Archive a product (soft delete)
  app.delete("/api/products/:id", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { id } = req.params;
      const { rowCount } = await db.query(
        "UPDATE products SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
        [id]
      );
      if (rowCount === 0)
        return res.status(404).json({ error: "Product not found" });
      res.json({ message: "Product archived" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk archive products by IDs (soft delete)
  app.post(
    "/api/products/bulk-delete",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const ids = (req.body?.ids || []).map(Number).filter(Boolean);
        if (!ids.length)
          return res.status(400).json({ error: "No product IDs provided." });

        const CHUNK = 400;
        let totalDeleted = 0;

        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = ids.slice(i, i + CHUNK);
          const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(",");
          const { rowCount } = await db.query(
            `UPDATE products SET deleted_at = NOW() WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
            batch
          );
          totalDeleted += rowCount;
        }

        res.json({ deleted: totalDeleted });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Bulk update product status (active/inactive)
  app.post(
    "/api/products/bulk-status",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
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

        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = ids.slice(i, i + CHUNK);
          const placeholders = batch.map((_, idx) => `$${idx + 2}`).join(",");
          const { rowCount } = await db.query(
            `UPDATE products SET status = $1 WHERE id IN (${placeholders})`,
            [status, ...batch]
          );
          updated += rowCount;
        }

        res.json({ updated });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // Upload a product image — resized to 800x800 WebP, uploaded to R2 (or local fallback)
  const { uploadToR2 } = require("../utils/r2");
  const sharp = require("sharp");

  const productImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!file || !file.mimetype) return cb(new Error("Invalid file"));
      if (!file.mimetype.startsWith("image/")) {
        return cb(new Error("Only image uploads are allowed"));
      }
      cb(null, true);
    },
  });

  app.post(
    "/api/uploads/product-image",
    requirePerm("manage_inventory"),
    productImageUpload.single("image"),
    async (req, res) => {
      if (!req.file) return res.status(400).json({ error: "Image file is required" });
      try {
        const resized = await sharp(req.file.buffer)
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        const filename = `product_${Date.now()}_${Math.round(Math.random() * 1e6)}.webp`;
        const key = `products/${filename}`;
        const url = await uploadToR2(resized, key, "image/webp");
        res.json({ url, filename, original_name: req.file.originalname, size: resized.length });
      } catch (err) {
        res.status(500).json({ error: "Upload failed: " + err.message });
      }
    },
  );

  // Bulk assign category to products
  app.post(
    "/api/products/bulk-category",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
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

        for (let i = 0; i < ids.length; i += CHUNK) {
          const batch = ids.slice(i, i + CHUNK);
          const placeholders = batch.map((_, idx) => `$${idx + 2}`).join(",");
          const { rowCount } = await db.query(
            `UPDATE products SET category_id = $1 WHERE id IN (${placeholders})`,
            [categoryId, ...batch]
          );
          updated += rowCount;
        }

        res.json({ updated });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
};
