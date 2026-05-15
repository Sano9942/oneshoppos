const {
  fetchEnrichedCategories,
  getCategoryById,
  getDescendantLeafIds,
} = require("../category-tree");

module.exports = function registerProductRoutes(app, deps) {
  const { db, multer, requirePerm, requireAnyPerm, requirePlanLimit, PRODUCT_UPLOADS_DIR, UPLOADS_DIR } = deps;
  const { validate } = require("../middleware/validate");
  const { CreateProductSchema, BulkDeleteSchema, BulkStatusSchema } = require("../schemas/products");


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

  /**
   * @swagger
   * /api/products:
   *   get:
   *     summary: List all products
   *     description: Returns product list with optional search, category, and status filters. Includes variant and outlet stock data.
   *     tags: [Products]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Search by name, SKU, or barcode
   *       - in: query
   *         name: category_id
   *         schema: { type: integer }
   *         description: Filter by category ID
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [active, inactive, all] }
   *         description: Filter by active status
   *       - in: query
   *         name: outlet_id
   *         schema: { type: integer }
   *         description: Filter stock by outlet
   *       - in: query
   *         name: sort
   *         schema: { type: string }
   *         description: Sort field (name, price, stock, created_at)
   *       - in: query
   *         name: order
   *         schema: { type: string, enum: [asc, desc] }
   *     responses:
   *       200:
   *         description: Array of products
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Product'
   *       401:
   *         description: Unauthorized
   */
  // Get all products (with aggregated stock, sort/filter/search support)
  app.get("/api/products", requireAnyPerm(["view_reports", "manage_inventory", "manage_field_sales", "all_access"]), async (req, res) => {
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
                 ${stockExpr} as total_stock,
                 COALESCE(opc.override_count, 0)::int as outlet_override_count
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
          LEFT JOIN (
              SELECT pli.product_id, COUNT(*) as override_count
              FROM price_list_items pli
              JOIN price_lists pl ON pl.id = pli.price_list_id
              WHERE pl.name LIKE '\\_\\_outlet\\_%' ESCAPE '\\'
              GROUP BY pli.product_id
          ) opc ON p.id = opc.product_id
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
  app.get("/api/products/search", requireAnyPerm(["view_reports", "manage_inventory", "all_access"]), async (req, res) => {
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
  app.get("/api/products/scan/:barcode", requireAnyPerm(["view_reports", "manage_inventory", "all_access"]), async (req, res) => {
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

  /**
   * @swagger
   * /api/products/{id}:
   *   get:
   *     summary: Get a product by ID
   *     description: Returns a single product with full details including variants, outlet stock, and category info.
   *     tags: [Products]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *         description: Product ID
   *     responses:
   *       200:
   *         description: Product details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Product'
   *       404:
   *         description: Product not found
   *       401:
   *         description: Unauthorized
   */
  // Get a single product by id
  app.get("/api/products/:id", requireAnyPerm(["view_reports", "manage_inventory", "all_access"]), async (req, res) => {
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

      // Attach bundle components if this is a bundle product
      if (row.is_bundle) {
        const { rows: components } = await db.query(
          `SELECT pb.id, pb.component_product_id, pb.component_variant_id, pb.quantity,
                  p.name as component_name, p.price as component_price, p.sku as component_sku,
                  pv.sku as variant_sku,
                  COALESCE(SUM(os.quantity), 0) as component_stock
           FROM product_bundles pb
           JOIN products p ON pb.component_product_id = p.id
           LEFT JOIN product_variants pv ON pb.component_variant_id = pv.id
           LEFT JOIN outlet_stock os ON pb.component_product_id = os.product_id
           WHERE pb.product_id = $1
           GROUP BY pb.id, p.name, p.price, p.sku, pv.sku`,
          [id]
        );
        row.bundle_components = components;
      }

      res.json({ product: row });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get variants for a specific product
  app.get("/api/products/:id/variants", requireAnyPerm(["view_reports", "manage_inventory", "all_access"]), async (req, res) => {
    try {
      const { id } = req.params;
      const outletId = req.query.outlet_id ? Number(req.query.outlet_id) : null;

      // 2-G.1: when ?outlet_id= is supplied, return per-outlet stock from
      // variant_outlet_stock. Falls back to product_variants.stock for rows
      // that don't yet have a variant_outlet_stock entry (pre-backfill, or
      // outlets never stocked). Legacy callers (no outlet_id) get the
      // cross-outlet rollup untouched.
      const params = [id];
      let stockSelect = "pv.stock AS stock_at_outlet";
      if (outletId) {
        params.push(outletId);
        stockSelect = `COALESCE(
          (SELECT vos.quantity
             FROM variant_outlet_stock vos
            WHERE vos.variant_id = pv.id AND vos.outlet_id = $2),
          pv.stock
        ) AS stock_at_outlet`;
      }

      const { rows } = await db.query(
        `SELECT pv.*,
                ${stockSelect},
                json_agg(
                   json_build_object('attribute_name', a.name, 'option_value', ao.value)
                ) FILTER (WHERE a.name IS NOT NULL) as options_json
           FROM product_variants pv
           LEFT JOIN variant_option_values vov ON pv.id = vov.variant_id
           LEFT JOIN attributes a ON vov.attribute_id = a.id
           LEFT JOIN attribute_options ao ON vov.attribute_option_id = ao.id
          WHERE pv.product_id = $1
          GROUP BY pv.id`,
        params
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
  app.get("/api/products/:id/stock", requireAnyPerm(["view_reports", "manage_inventory", "all_access"]), async (req, res) => {
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

  // Get bundle components for a product
  app.get("/api/products/:id/bundle-components", requireAnyPerm(["view_reports", "manage_inventory", "all_access"]), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows } = await db.query(
        `SELECT pb.id, pb.component_product_id, pb.component_variant_id, pb.quantity,
                p.name as component_name, p.price as component_price, p.sku as component_sku,
                p.barcode as component_barcode,
                pv.sku as variant_sku, pv.price as variant_price,
                COALESCE(SUM(os.quantity), 0) as component_stock
         FROM product_bundles pb
         JOIN products p ON pb.component_product_id = p.id
         LEFT JOIN product_variants pv ON pb.component_variant_id = pv.id
         LEFT JOIN outlet_stock os ON pb.component_product_id = os.product_id
         WHERE pb.product_id = $1
         GROUP BY pb.id, p.name, p.price, p.sku, p.barcode, pv.sku, pv.price`,
        [id]
      );
      res.json({ components: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/products:
   *   post:
   *     summary: Create a product
   *     description: Create a new product with optional variants and initial outlet stock. Subject to plan product limits.
   *     tags: [Products]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, price]
   *             properties:
   *               name: { type: string }
   *               sku: { type: string }
   *               barcode: { type: string }
   *               price: { type: number, format: double }
   *               cost_price: { type: number, format: double }
   *               category_id: { type: integer }
   *               brand_id: { type: integer }
   *               is_active: { type: boolean, default: true }
   *               initial_stock: { type: integer, description: "Initial stock for default outlet" }
   *               outlet_id: { type: integer, description: "Outlet for initial stock" }
   *               variants:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     name: { type: string }
   *                     sku: { type: string }
   *                     price: { type: number }
   *                     cost_price: { type: number }
   *     responses:
   *       201:
   *         description: Product created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Product'
   *       400:
   *         description: Validation error or plan limit reached
   *       401:
   *         description: Unauthorized
   */
  // Add a new product (and optionally set initial stock for a specific outlet)
  app.post("/api/products", requirePerm("manage_inventory"), requirePlanLimit("products"), validate(CreateProductSchema), async (req, res) => {
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
      is_bundle,
      bundle_components, // Array of { product_id, variant_id?, quantity } if is_bundle
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
      lead_time_days_override, // 2-G.8
      safety_stock_days,       // 2-G.8
      min_order_qty,           // Tier 2.2 wholesale MOQ
      order_increment,         // Tier 2.2 wholesale MOQ
    } = req.body;
    // Fall back through: explicit body field → header → session context → first outlet.
    // Without this, the Add Product form's Opening Stock value silently dropped
    // to 0: the form sends initial_stock but never an outlet_id, and the
    // stock-insert below is gated on `if (outlet_id && initial_stock)`.
    // Session context is also unreliable today — if the user auto-resolved
    // through /context-select without an explicit pick, JWT.oid stays null
    // and req.context.outletId comes back null. The "first outlet" SQL
    // fallback guarantees single-outlet tenants always get their initial
    // stock seeded; multi-outlet tenants who care about which outlet
    // continue to pass outlet_id explicitly.
    let outlet_id =
      req.body.outlet_id || req.headers["x-outlet-id"] || req.context?.outletId;
    if (!outlet_id && (_initial_stock || req.body.stock)) {
      const { rows: [first] } = await deps.db.query(
        "SELECT id FROM outlets ORDER BY id LIMIT 1"
      );
      if (first) outlet_id = first.id;
    }
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
          `INSERT INTO products (barcode, sku, name, price, cost_price, gst, stock, category_id, tax_id, brand_id, has_variants, attribute_set_id, min_qty, max_qty, unit, description_html, compare_at_price, product_type, vendor, tags, status, supplier_id, is_bundle, lead_time_days_override, safety_stock_days, min_order_qty, order_increment)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
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
            is_bundle ? true : false,
            lead_time_days_override != null && lead_time_days_override !== ""
              ? Number(lead_time_days_override)
              : null,
            safety_stock_days != null && safety_stock_days !== ""
              ? Number(safety_stock_days)
              : null,
            // Tier 2.2 — null/empty → DB default (0 = no min, 1 = no rule).
            min_order_qty != null && min_order_qty !== ""
              ? Math.max(0, Math.floor(Number(min_order_qty)))
              : 0,
            order_increment != null && order_increment !== ""
              ? Math.max(1, Math.floor(Number(order_increment)))
              : 1,
          ]
        );
        const newProductId = inserted.id;

        // 1a. If it's a bundle, insert component rows
        if (is_bundle && Array.isArray(bundle_components) && bundle_components.length > 0) {
          for (const comp of bundle_components) {
            await client.query(
              `INSERT INTO product_bundles (product_id, component_product_id, component_variant_id, quantity)
               VALUES ($1, $2, $3, $4)`,
              [newProductId, comp.product_id, comp.variant_id || null, comp.quantity || 1]
            );
          }
        }

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
      bundle_components, // Optional array of { product_id, variant_id?, quantity } for bundles
      lead_time_days_override, // 2-G.8: product-level lead time override
      safety_stock_days,       // 2-G.8: per-product safety stock
      min_order_qty,           // Tier 2.2 wholesale MOQ
      order_increment,         // Tier 2.2 wholesale MOQ
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
        // 2-G.8: lead-time / safety-stock overrides — patch only if caller
        // provided the key so omitted updates don't clobber existing values.
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "lead_time_days_override")) {
          updateFields.push(`lead_time_days_override = $${nextParam}`);
          updateParams.push(
            lead_time_days_override === "" || lead_time_days_override == null
              ? null
              : Number(lead_time_days_override)
          );
          nextParam++;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "safety_stock_days")) {
          updateFields.push(`safety_stock_days = $${nextParam}`);
          updateParams.push(
            safety_stock_days === "" || safety_stock_days == null
              ? null
              : Number(safety_stock_days)
          );
          nextParam++;
        }
        // Tier 2.2 — MOQ patches. Empty/null → reset to DB default (0 = no
        // minimum, 1 = no case-pack). NOT NULL constraint means we never
        // write NULL — we coerce to the default int.
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "min_order_qty")) {
          updateFields.push(`min_order_qty = $${nextParam}`);
          updateParams.push(
            min_order_qty === "" || min_order_qty == null
              ? 0
              : Math.max(0, Math.floor(Number(min_order_qty)))
          );
          nextParam++;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "order_increment")) {
          updateFields.push(`order_increment = $${nextParam}`);
          updateParams.push(
            order_increment === "" || order_increment == null
              ? 1
              : Math.max(1, Math.floor(Number(order_increment)))
          );
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

        // 3. Update bundle components if provided (delete + re-insert)
        if (Array.isArray(bundle_components)) {
          await client.query("DELETE FROM product_bundles WHERE product_id = $1", [id]);
          for (const comp of bundle_components) {
            await client.query(
              `INSERT INTO product_bundles (product_id, component_product_id, component_variant_id, quantity)
               VALUES ($1, $2, $3, $4)`,
              [id, comp.product_id, comp.variant_id || null, comp.quantity || 1]
            );
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
    validate(BulkDeleteSchema),
    async (req, res) => {
      try {
        const { ids } = req.body;

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
    validate(BulkStatusSchema),
    async (req, res) => {
      try {
        const { ids, status } = req.body;

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

  const { imageFileFilter } = require("../middleware/upload-validation");
  const productImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: imageFileFilter,
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

  // ── Price Lists ────────────────────────────────────────────────────────────

  // GET /api/price-lists
  // Hides system-managed lists (auto-created for per-product outlet overrides
  // by the Outlet Pricing UI on the product edit page; named like
  // `__outlet_<id>_overrides`). Tenants only see lists they explicitly created.
  app.get(
    "/api/price-lists",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT pl.*, COUNT(pli.id)::int AS item_count
           FROM price_lists pl
           LEFT JOIN price_list_items pli ON pli.price_list_id = pl.id
           WHERE pl.name NOT LIKE '\\_\\_outlet\\_%' ESCAPE '\\'
           GROUP BY pl.id
           ORDER BY pl.name ASC`,
        );
        res.json({ priceLists: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /api/price-lists
  app.post(
    "/api/price-lists",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { name, description, type, is_active } = req.body;
        if (!name || !name.trim()) {
          return res.status(400).json({ error: "name is required" });
        }
        const { rows } = await db.query(
          `INSERT INTO price_lists (name, description, type, is_active)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [name.trim(), description || null, type || "customer_group", is_active !== false],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // PUT /api/price-lists/:id
  app.put(
    "/api/price-lists/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { name, description, type, is_active } = req.body;
        if (!name || !name.trim()) {
          return res.status(400).json({ error: "name is required" });
        }
        const { rows } = await db.query(
          `UPDATE price_lists
           SET name = $1, description = $2, type = $3, is_active = $4
           WHERE id = $5
           RETURNING *`,
          [name.trim(), description || null, type || "customer_group", is_active !== false, req.params.id],
        );
        if (!rows.length) return res.status(404).json({ error: "Not found" });
        res.json(rows[0]);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // DELETE /api/price-lists/:id
  app.delete(
    "/api/price-lists/:id",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rowCount } = await db.query(
          `DELETE FROM price_lists WHERE id = $1`,
          [req.params.id],
        );
        if (!rowCount) return res.status(404).json({ error: "Not found" });
        res.json({ message: "Deleted" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // GET /api/price-lists/:id/items
  app.get(
    "/api/price-lists/:id/items",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT pli.*,
                  p.name AS product_name,
                  p.sku,
                  p.price AS default_price,
                  pv.sku AS variant_name,
                  pv.sku AS variant_sku,
                  pv.price AS variant_price
           FROM price_list_items pli
           JOIN products p ON p.id = pli.product_id
           LEFT JOIN product_variants pv ON pv.id = pli.variant_id
           WHERE pli.price_list_id = $1
           ORDER BY p.name ASC, pv.sku ASC`,
          [req.params.id],
        );
        res.json({ items: rows });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /api/price-lists/:id/items
  app.post(
    "/api/price-lists/:id/items",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { product_id, variant_id, price, min_qty } = req.body;
        const { rows } = await db.query(
          `INSERT INTO price_list_items (price_list_id, product_id, variant_id, price, min_qty)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (price_list_id, product_id, variant_id, min_qty)
           DO UPDATE SET price = EXCLUDED.price
           RETURNING *`,
          [req.params.id, product_id, variant_id || null, price, min_qty || 1],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // PUT /api/price-list-items/:itemId
  app.put(
    "/api/price-list-items/:itemId",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { price, min_qty } = req.body;
        const { rows } = await db.query(
          `UPDATE price_list_items
           SET price = $1, min_qty = $2
           WHERE id = $3
           RETURNING *`,
          [price, min_qty || 1, req.params.itemId],
        );
        if (!rows.length) return res.status(404).json({ error: "Not found" });
        res.json(rows[0]);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // DELETE /api/price-list-items/:itemId
  app.delete(
    "/api/price-list-items/:itemId",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { rowCount } = await db.query(
          `DELETE FROM price_list_items WHERE id = $1`,
          [req.params.itemId],
        );
        if (!rowCount) return res.status(404).json({ error: "Not found" });
        res.json({ message: "Deleted" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // POST /api/price-lists/:id/bulk-items
  app.post(
    "/api/price-lists/:id/bulk-items",
    requirePerm("manage_inventory"),
    async (req, res) => {
      try {
        const { items } = req.body;
        if (!Array.isArray(items) || !items.length) {
          return res.status(400).json({ error: "items array is required" });
        }
        let upserted = 0;
        for (const item of items) {
          const { rowCount } = await db.query(
            `INSERT INTO price_list_items (price_list_id, product_id, variant_id, price, min_qty)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (price_list_id, product_id, variant_id, min_qty)
             DO UPDATE SET price = EXCLUDED.price`,
            [req.params.id, item.product_id, item.variant_id || null, item.price, item.min_qty || 1],
          );
          upserted += rowCount;
        }
        res.json({ upserted });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // ── Product Reviews ─────────────────────────────────────────────────

  const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";
  const { reviewLimiter } = require("../middleware/rate-limit");

  async function recalcProductRating(dbConn, productId) {
    await dbConn.query(
      `UPDATE products SET
         avg_rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM product_reviews WHERE product_id = $1 AND status = 'approved'),
         review_count = (SELECT COUNT(*) FROM product_reviews WHERE product_id = $1 AND status = 'approved')
       WHERE id = $1`,
      [productId],
    );
  }

  // GET /api/products/:id/reviews — list reviews (approved only for non-admin, all for admin)
  app.get("/api/products/:id/reviews", async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const isAdmin = req.employeePerms?.includes("all_access");
      const statusFilter = isAdmin ? "" : "AND pr.status = 'approved'";
      const { rows } = await db.query(
        `SELECT pr.*, c.name AS customer_name_resolved
         FROM product_reviews pr
         LEFT JOIN customers c ON c.id = pr.customer_id
         WHERE pr.product_id = $1 ${statusFilter}
         ORDER BY pr.created_at DESC`,
        [productId],
      );
      const reviews = rows.map((r) => ({
        ...r,
        customer_name: r.customer_name_resolved || r.customer_name || "Anonymous",
      }));
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/products/:id/reviews — submit a review (public, rate-limited)
  app.post("/api/products/:id/reviews", reviewLimiter, async (req, res) => {
    try {
      let dbConn = db;

      // In MT mode without auth, resolve tenant from query param
      if (IS_MULTI_TENANT && !req.employee) {
        const tenantSlug = req.query.tenant || req.headers["x-tenant-slug"];
        if (!tenantSlug) {
          return res.status(400).json({ error: "tenant query param is required" });
        }
        const masterDb = require("../master-db-pg");
        const tenantDbMgr = deps.tenantDbManager || require("../tenant-db-manager-pg");
        const { rows: [tenant] } = await masterDb.query(
          "SELECT id, slug, status FROM tenants WHERE slug = $1 AND status = 'active'",
          [String(tenantSlug).trim()],
        );
        if (!tenant) return res.status(404).json({ error: "Store not found" });
        dbConn = await tenantDbMgr.getDb(tenant.id);
      }

      const productId = Number(req.params.id);
      const { rating, title, body, customer_id, customer_name } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be between 1 and 5" });
      }

      // Check verified purchase — did this customer buy this product?
      let saleId = null;
      if (customer_id) {
        const { rows: purchases } = await dbConn.query(
          `SELECT s.id FROM sales s
           JOIN sale_items si ON si.sale_id = s.id
           WHERE s.customer_id = $1 AND si.product_id = $2
           LIMIT 1`,
          [customer_id, productId],
        );
        if (purchases.length > 0) saleId = purchases[0].id;
      }

      const { rows: [review] } = await dbConn.query(
        `INSERT INTO product_reviews (product_id, customer_id, customer_name, rating, title, body, sale_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [productId, customer_id || null, customer_name || null, rating, title || null, body || null, saleId],
      );

      res.status(201).json(review);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reviews/pending — admin moderation queue
  app.get("/api/reviews/pending", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT pr.*, p.name AS product_name, c.name AS customer_name_resolved
         FROM product_reviews pr
         JOIN products p ON p.id = pr.product_id
         LEFT JOIN customers c ON c.id = pr.customer_id
         WHERE pr.status = 'pending'
         ORDER BY pr.created_at ASC`,
      );
      res.json(rows.map((r) => ({ ...r, customer_name: r.customer_name_resolved || r.customer_name || "Anonymous" })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/reviews — all reviews with optional status filter
  app.get("/api/reviews", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const status = req.query.status;
      const statusClause = status ? "WHERE pr.status = $1" : "";
      const params = status ? [status] : [];
      const { rows } = await db.query(
        `SELECT pr.*, p.name AS product_name, c.name AS customer_name_resolved
         FROM product_reviews pr
         JOIN products p ON p.id = pr.product_id
         LEFT JOIN customers c ON c.id = pr.customer_id
         ${statusClause}
         ORDER BY pr.created_at DESC`,
        params,
      );
      res.json(rows.map((r) => ({ ...r, customer_name: r.customer_name_resolved || r.customer_name || "Anonymous" })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/reviews/:id/moderate — approve or reject
  app.put("/api/reviews/:id/moderate", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const reviewId = Number(req.params.id);
      const { status } = req.body;
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
      }

      const { rows: [review] } = await db.query(
        `UPDATE product_reviews
         SET status = $1, moderated_by = $2, moderated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [status, req.employee.id, reviewId],
      );
      if (!review) return res.status(404).json({ error: "Review not found" });

      await recalcProductRating(db, review.product_id);

      res.json(review);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/reviews/:id — delete a review
  app.delete("/api/reviews/:id", requirePerm("manage_inventory"), async (req, res) => {
    try {
      const reviewId = Number(req.params.id);
      const { rows: [review] } = await db.query(
        "DELETE FROM product_reviews WHERE id = $1 RETURNING product_id",
        [reviewId],
      );
      if (!review) return res.status(404).json({ error: "Review not found" });
      await recalcProductRating(db, review.product_id);
      res.json({ message: "Review deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Channel Publications ────────────────────────────────────────────

  // GET /api/products/:id/channels — list publication state per channel
  app.get("/api/products/:id/channels", requirePerm("manage_products"), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const { rows: channels } = await db.query(
        `SELECT sc.id, sc.code, sc.name, sc.type,
                COALESCE(cp.is_published, false) AS is_published,
                cp.published_at
         FROM sales_channels sc
         LEFT JOIN channel_publications cp ON cp.channel_id = sc.id
           AND cp.product_id = $1 AND cp.variant_id IS NULL
         WHERE sc.is_active = true
         ORDER BY sc.name`,
        [productId],
      );
      res.json({ channels });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/products/:id/channels — update publication toggles
  app.put("/api/products/:id/channels", requirePerm("manage_products"), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const { channels } = req.body;
      if (!Array.isArray(channels)) {
        return res.status(400).json({ error: "channels array required" });
      }

      for (const ch of channels) {
        if (ch.isPublished) {
          await db.query(
            `INSERT INTO channel_publications (channel_id, product_id, is_published, published_at)
             VALUES ($1, $2, true, NOW())
             ON CONFLICT (channel_id, product_id, COALESCE(variant_id, 0))
             DO UPDATE SET is_published = true, published_at = NOW()`,
            [ch.channelId, productId],
          );
        } else {
          await db.query(
            `UPDATE channel_publications SET is_published = false
             WHERE channel_id = $1 AND product_id = $2 AND variant_id IS NULL`,
            [ch.channelId, productId],
          );
        }
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
