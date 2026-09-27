const {
  fetchEnrichedCategories,
  getCategoryById,
  getDescendantLeafIds,
} = require("../category-tree");
const kitEngine = require("../services/kit-engine");
const stockLedger = require("../services/stock-ledger");
const productHistory = require("../services/product-history");
const { decodeEmbeddedBarcode } = require("../services/embedded-barcode");

module.exports = function registerProductRoutes(app, deps) {
  const { db, multer, requirePerm, requireAnyPerm, requirePlanLimit, PRODUCT_UPLOADS_DIR, UPLOADS_DIR } = deps;
  const { validate } = require("../middleware/validate");
  const { CreateProductSchema, BulkDeleteSchema, BulkStatusSchema } = require("../schemas/products");


// --- ROUTES: PRODUCTS (INVENTORY) ---

  // F01: kits hold no stock of their own — their sellable quantity is
  // min(floor(component_stock / qty_per)) at the outlet. Enrich kit rows in POS
  // list/search/scan responses so the stock badge reflects what can actually be
  // sold. Cheap: only touches rows whose bom_type is 'kit' (rare).
  async function enrichKitAvailability(rows, outletId) {
    if (!outletId || !Array.isArray(rows)) return rows;
    for (const row of rows) {
      if (row && row.bom_type === "kit") {
        try {
          const avail = await kitEngine.kitAvailability(db, {
            productId: row.id,
            outletId: Number(outletId),
          });
          row.available_qty = avail;
          if ("local_stock" in row) row.local_stock = avail;
          if ("total_stock" in row) row.total_stock = avail;
        } catch {
          /* leave stock as-is on failure */
        }
      }
    }
    return rows;
  }

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
  // S5 (PLAN-V2 Step 4, REPORT-PERMS.md §7 mixed #6): product reads are a
  // POS-adjacency composite — a sales-class token keeps a working POS
  // (grid/search/scan/detail) but gets a POS-shaped response with cost
  // fields stripped. Cost visibility requires an inventory- or
  // financial-class perm (manage_inventory / view_inventory_reports /
  // view_financial_reports / all_access). Field-rep tokens are stripped too.
  const COST_FIELDS = ["cost_price", "component_cost"];
  function canSeeCost(req) {
    const perms = req.employeePerms || [];
    return [
      "all_access",
      "manage_inventory",
      "view_inventory_reports",
      "view_financial_reports",
    ].some((p) => perms.includes(p));
  }
  function stripCostFields(rowsOrRow, req) {
    if (canSeeCost(req)) return rowsOrRow;
    const rows = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
    for (const row of rows) {
      if (row && typeof row === "object") {
        for (const f of COST_FIELDS) delete row[f];
      }
    }
    return rowsOrRow;
  }

  // Get all products (with aggregated stock, sort/filter/search support)
  app.get("/api/products", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "manage_field_sales", "execute_field_sales", "all_access"]), async (req, res) => {
    try {
      const { search, sort, order, status, category_id, outlet_id } = req.query;

      // Tier 2.11 — field-rep visibility scope. When the caller is acting
      // for a specific customer (rep app passes ?customer_id=) AND is NOT
      // an admin/manager (no all_access/manage_inventory perm), filter the
      // catalog to what *that customer* is allowed to see. Admins/managers
      // always see everything regardless of ?customer_id — that's the
      // bypass we agreed on so they can configure visibility.
      const callerPerms = req.employeePerms || [];
      const isAdminScope =
        callerPerms.includes("all_access") || callerPerms.includes("manage_inventory");
      const fieldRepCustomerId =
        !isAdminScope && req.query.customer_id
          ? Number(req.query.customer_id)
          : null;

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

      // Tier 2.11 — visibility filter (field-rep scope only, see above).
      if (fieldRepCustomerId) {
        try {
          const { visibleProductSqlFragment } = require("../services/product-visibility");
          const frag = await visibleProductSqlFragment(db, fieldRepCustomerId);
          if (frag.params.length === 0) {
            conditions.push(frag.sql);
          } else {
            paramIdx++;
            conditions.push(frag.sql.replace("$PLACEHOLDER", `$${paramIdx}`));
            params.push(...frag.params);
          }
        } catch {
          // visibility column missing on pre-v96 tenant — fail open
        }
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
      await enrichKitAvailability(rows, outlet_id);
      res.json({ products: stripCostFields(await decorateProductsWithCategoryPaths(rows), req) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Search products by name or barcode (for autocomplete and search)
  // NOTE: must be registered BEFORE /:id to prevent Express matching "search" as an id param
  app.get("/api/products/search", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
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

      await enrichKitAvailability(productsWithTax, outlet_id);
      res.json({ products: stripCostFields(productsWithTax, req) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // The counter's offline copy of the catalogue (One Toy Store blocker 3a): every
  // live product and variant with the codes the POS scans and searches by and the
  // shelf price. No cost and no stock — the copy only has to find and price an
  // item; the server re-reads cost and checks stock when the sale syncs.
  // `version` is a hash of the catalogue: a counter whose copy is current sends
  // it back as ?version= (or If-None-Match) and gets a 304. It is in the body
  // because a browser can't read the ETag header from the API's other origin.
  // NOTE: must be registered BEFORE /:id.
  app.get("/api/products/catalogue", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
    try {
      const { rows: products } = await db.query(
        `SELECT p.id, p.name, p.barcode, p.sku, p.plu_code, p.price, p.gst, p.tax_id,
                t.rate AS tax_rate, t.name AS tax_name, p.category_id, p.brand_id,
                p.unit, p.product_type, p.status, p.has_variants, p.is_bundle, p.bom_type,
                p.serial_required, p.age_restricted, p.is_gift_card_sku
           FROM products p
           LEFT JOIN taxes t ON t.id = p.tax_id
          WHERE p.deleted_at IS NULL
          ORDER BY p.id`
      );
      for (const p of products) {
        p.effectiveTaxRate = p.tax_rate !== null ? p.tax_rate : p.gst !== null ? p.gst : 0;
        p.effectiveTaxName = p.tax_name || (p.gst !== null ? "GST" : "No Tax");
      }
      const { rows: variants } = await db.query(
        `SELECT pv.id, pv.product_id, pv.sku, pv.barcode, pv.price,
                COALESCE(
                  json_agg(json_build_object('attribute_name', a.name, 'option_value', ao.value)
                           ORDER BY a.id) FILTER (WHERE a.name IS NOT NULL),
                  '[]'::json
                ) AS options
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
           LEFT JOIN variant_option_values vov ON vov.variant_id = pv.id
           LEFT JOIN attributes a ON a.id = vov.attribute_id
           LEFT JOIN attribute_options ao ON ao.id = vov.attribute_option_id
          GROUP BY pv.id
          ORDER BY pv.id`
      );
      const content = JSON.stringify({ products, variants });
      const crypto = require("crypto");
      const version = crypto.createHash("sha1").update(content).digest("hex");
      const body = `{"version":"${version}",${content.slice(1)}`;
      // The ETag covers the whole body (not just `version`), so the browser's
      // own HTTP cache can never answer with a body of a different shape.
      const etag = `"${crypto.createHash("sha1").update(body).digest("hex")}"`;
      res.set("ETag", etag);
      res.set("Cache-Control", "private, no-cache");
      if (req.query.version === version || req.get("If-None-Match") === etag) return res.status(304).end();
      res.type("application/json").send(body);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Scan/Find a product by barcode (Crucial for POS speed)
  // NOTE: must be registered BEFORE /:id to prevent Express matching "scan" as an id param
  app.get("/api/products/scan/:barcode", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
    try {
      const { barcode } = req.params;
      const outlet_id = req.query.outlet_id; // Pass outlet ID from POS to get local stock

      // V01 grocery lane — AUTHORITATIVE price/weight-embedded EAN-13 decode.
      // A deli/scale label carries a 2x-prefix code whose middle digits are an
      // item code and whose tail is the pre-weighed price (or weight). Decode
      // against the tenant's scheme (company_profile.barcode_scheme, already on
      // req.company), then resolve the product by the item code via the scheme's
      // configured field. `not_embedded`/`disabled` fall through to the normal
      // barcode/sku/plu lookup; a decoded-but-unresolvable item code is a hard
      // "unmapped scale item" error, never a silent zero-price line.
      const decoded = decodeEmbeddedBarcode(barcode, req.company?.barcode_scheme);
      let lookupValue = barcode;
      let lookupField = null; // null → match barcode OR sku OR plu_code
      if (decoded.ok) {
        lookupValue = decoded.itemCode;
        lookupField = decoded.itemCodeField; // 'sku' | 'plu' | 'barcode'
      }

      let whereClause;
      let params;
      if (lookupField === "sku") {
        whereClause = "p.sku = $1";
        params = [lookupValue];
      } else if (lookupField === "plu") {
        whereClause = "p.plu_code = $1";
        params = [lookupValue];
      } else if (lookupField === "barcode") {
        whereClause = "p.barcode = $1";
        params = [lookupValue];
      } else {
        // Normal scan / PLU pad: match any identifier. plu_code lookup lights up
        // grocery PLU codes typed on the pad (omniInputRouter routes 4-5 digit
        // numerics here) without a separate endpoint.
        whereClause = "(p.barcode = $1 OR p.sku = $2 OR p.plu_code = $3)";
        params = [lookupValue, lookupValue, lookupValue];
      }

      if (outlet_id) params.push(Number(outlet_id));

      // outletParam: the $n placeholder holding outlet_id in the caller's params.
      const productSql = (where, outletParam) => `
          SELECT p.*, t.rate as tax_rate, t.name as tax_name,
                 COALESCE(SUM(os.quantity), 0) as local_stock
          FROM products p
          LEFT JOIN taxes t ON p.tax_id = t.id
          LEFT JOIN outlet_stock os ON p.id = os.product_id ${outlet_id ? `AND os.outlet_id = $${outletParam}` : ""}
          WHERE p.deleted_at IS NULL AND ${where}
          GROUP BY p.id, t.rate, t.name
      `;

      let { rows: [row] } = await db.query(productSql(whereClause, params.length), params);

      // A variant's own barcode/SKU (e.g. one car in a Hot Wheels assortment,
      // each with its own label). Resolve to the parent product and hand back
      // the variant so the POS adds that exact variant line.
      let scannedVariant = null;
      if (!row && !decoded.ok) {
        const vParams = [lookupValue];
        if (outlet_id) vParams.push(Number(outlet_id));
        const { rows: [v] } = await db.query(
          `SELECT pv.id, pv.product_id, pv.sku, pv.barcode, pv.price, pv.cost_price, pv.stock,
                  ${outlet_id ? "vos.quantity" : "NULL"} AS stock_at_outlet
             FROM product_variants pv
             JOIN products vp ON vp.id = pv.product_id AND vp.deleted_at IS NULL
             ${outlet_id ? "LEFT JOIN variant_outlet_stock vos ON vos.variant_id = pv.id AND vos.outlet_id = $2" : ""}
            WHERE pv.barcode = $1 OR pv.sku = $1
            ORDER BY (pv.barcode = $1) DESC, pv.id
            LIMIT 1`,
          vParams,
        );
        if (v) {
          scannedVariant = v;
          const idParams = [v.product_id];
          if (outlet_id) idParams.push(Number(outlet_id));
          ({ rows: [row] } = await db.query(productSql("p.id = $1", 2), idParams));
        }
      }

      if (!row) {
        // A decoded scale label that resolves to no product is a mis-mapped
        // scale PLU — surface it clearly so the cashier fixes the mapping,
        // never a silent zero-price sale.
        if (decoded.ok) {
          return res.status(404).json({
            error: `Unmapped scale item — no product for ${decoded.itemCodeField} ${decoded.itemCode}`,
            code: "unmapped_scale_item",
            item_code: decoded.itemCode,
            item_code_field: decoded.itemCodeField,
          });
        }
        return res.status(404).json({ error: "Product not found" });
      }

      const effectiveTaxRate =
        row.tax_rate !== null ? row.tax_rate : row.gst !== null ? row.gst : 0;
      const effectiveTaxName =
        row.tax_name || (row.gst !== null ? "GST" : "No Tax");

      const productWithTax = {
        ...row,
        effectiveTaxRate,
        effectiveTaxName,
      };

      // Attach the decoded scale reading so the POS builds the correct cart line:
      //   price → FINAL price, quantity 1, price_locked + tare_locked (excluded
      //           from % promos; tare already netted at the deli scale).
      //   weight → decoded net weight as quantity at the shelf unit-price,
      //           tare_locked (no double tare).
      if (decoded.ok) {
        productWithTax.embedded = {
          embed: decoded.embed,
          ...(decoded.embed === "price"
            ? { price: decoded.price, price_locked: true, tare_locked: true }
            : { weight: decoded.weight, tare_locked: true }),
        };
      }

      await enrichKitAvailability([productWithTax], outlet_id);
      res.json({
        product: stripCostFields(productWithTax, req),
        ...(scannedVariant ? { variant: stripCostFields(scannedVariant, req) } : {}),
      });
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
  app.get("/api/products/:id", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
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

      // Tier 2.11 — include the customer-group whitelist for restricted
      // products so the admin form can render the multi-select. Always
      // included (not gated on visibility='restricted') so toggling the
      // radio doesn't blank a previously-saved mapping.
      try {
        const { rows: cgpRows } = await db.query(
          "SELECT customer_group_id FROM customer_group_products WHERE product_id = $1",
          [id]
        );
        row.customer_group_ids = cgpRows.map((r) => Number(r.customer_group_id));
      } catch {
        row.customer_group_ids = [];
      }

      // Attach components if this is a kit or assembled product (F01: assembled
      // products carry a recipe too — the components a production run consumes).
      if (row.is_bundle || row.bom_type === "kit" || row.bom_type === "assembled") {
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

      res.json({ product: stripCostFields(row, req) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get variants for a specific product
  app.get("/api/products/:id/variants", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
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
      res.json({ variants: stripCostFields(variants, req) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get individual product stock across all outlets
  app.get("/api/products/:id/stock", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
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
  app.get("/api/products/:id/bundle-components", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
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

  // F01: canonical component/recipe endpoints (mirror the variant endpoints).
  // GET returns bom_type + the rich component set (with component cost for the
  // live plate-cost sum). PUT replaces the set through the shared engine, which
  // rejects self-reference / nested kits / non-positive qty.
  app.get("/api/products/:id/components", requireAnyPerm(["view_sales_reports", "view_inventory_reports", "manage_inventory", "all_access"]), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [prod] } = await db.query(
        "SELECT COALESCE(bom_type, 'standard') AS bom_type FROM products WHERE id = $1",
        [id]
      );
      if (!prod) return res.status(404).json({ error: "Product not found" });
      const { rows } = await db.query(
        `SELECT pb.id, pb.component_product_id, pb.component_variant_id, pb.quantity,
                pb.unit, pb.is_substitutable, pb.modifier_group_id,
                p.name AS component_name, p.sku AS component_sku, p.unit AS component_unit,
                p.cost_price AS component_cost, p.price AS component_price,
                pv.sku AS variant_sku,
                COALESCE(SUM(os.quantity), 0) AS component_stock
           FROM product_bundles pb
           JOIN products p ON pb.component_product_id = p.id
           LEFT JOIN product_variants pv ON pb.component_variant_id = pv.id
           LEFT JOIN outlet_stock os ON pb.component_product_id = os.product_id
          WHERE pb.product_id = $1
          GROUP BY pb.id, p.name, p.sku, p.unit, p.cost_price, p.price, pv.sku
          ORDER BY pb.component_product_id, pb.component_variant_id`,
        [id]
      );
      res.json({ bom_type: prod.bom_type, components: stripCostFields(rows, req) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/products/:id/components", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const { components } = req.body || {};
    try {
      await db.transaction(async (client) => {
        const { rows: [prod] } = await client.query(
          "SELECT COALESCE(bom_type, 'standard') AS bom_type FROM products WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (!prod) {
          throw Object.assign(new Error("Product not found"), { statusCode: 404 });
        }
        if (prod.bom_type === "standard") {
          throw Object.assign(
            new Error("Set the product type to kit or assembled before editing its recipe/components"),
            { statusCode: 400, code: "not_a_kit" }
          );
        }
        await kitEngine.replaceComponents(client, {
          parentProductId: Number(id),
          components: components || [],
        });
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
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
      visibility,              // Tier 2.11 wholesale visibility
      customer_group_ids,      // Tier 2.11 — groups that can see this restricted product
      track_batches,           // F07 batch/expiry opt-in
      shelf_life_days,         // F07 default expiry suggestion at GRN
      plu_code,                // V01 grocery — 4-5 digit PLU rapid-entry code
      age_restricted,          // V01 — POS cashier-attest age gate
    } = req.body;
    // Fall back through: explicit body field → resolved session context →
    // first outlet. Without this, the Add Product form's Opening Stock value
    // silently dropped to 0: the form sends initial_stock but never an
    // outlet_id, and the stock-insert below is gated on
    // `if (outlet_id && initial_stock)`. Step 9: req.context.outletId is fed
    // by the shared validated resolver (header → JWT oid → none) — the old
    // raw-header read here is gone. The "first outlet" SQL fallback
    // guarantees single-outlet tenants always get their initial stock
    // seeded; multi-outlet tenants who care about which outlet continue to
    // pass outlet_id explicitly.
    let outlet_id = req.body.outlet_id || req.context?.outletId;
    const variantOpeningStock = Array.isArray(variants) && variants.some((v) => Number(v?.initial_stock) > 0);
    if (!outlet_id && (_initial_stock || req.body.stock || variantOpeningStock)) {
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
          `INSERT INTO products (barcode, sku, name, price, cost_price, gst, stock, category_id, tax_id, brand_id, has_variants, attribute_set_id, min_qty, max_qty, unit, description_html, compare_at_price, product_type, vendor, tags, status, supplier_id, is_bundle, lead_time_days_override, safety_stock_days, min_order_qty, order_increment, visibility, track_batches, shelf_life_days, plu_code, age_restricted)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
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
            // Tier 2.11 — visibility column. Unknown/missing → 'all' default.
            visibility === "restricted" ? "restricted" : "all",
            // F07 — batch tracking opt-in + default shelf life.
            track_batches === true || track_batches === "true",
            shelf_life_days != null && shelf_life_days !== ""
              ? Math.max(0, Math.floor(Number(shelf_life_days)))
              : null,
            // V01 — PLU code (trimmed, empty→null so the partial-unique index
            // frees). age_restricted defaults false.
            plu_code != null && String(plu_code).trim() !== ""
              ? String(plu_code).trim()
              : null,
            age_restricted === true || age_restricted === "true",
          ]
        );
        const newProductId = inserted.id;

        // Tier 2.11 — write the group whitelist for restricted products.
        // Skipped silently if the join table doesn't exist yet (pre-v96).
        if (
          visibility === "restricted" &&
          Array.isArray(customer_group_ids) &&
          customer_group_ids.length > 0
        ) {
          try {
            for (const gid of customer_group_ids) {
              const n = Number(gid);
              if (!Number.isInteger(n) || n <= 0) continue;
              await client.query(
                `INSERT INTO customer_group_products (customer_group_id, product_id)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [n, newProductId]
              );
            }
          } catch (cgpErr) {
            console.warn("[products POST] customer_group_products skipped:", cgpErr.message);
          }
        }

        // 1a. F01: resolve consumption mode + write components through the shared
        // kit-engine (validates: no self-ref, no nested kits, qty > 0). is_bundle
        // stays synced as the legacy mirror (is_bundle = bom_type='kit').
        const resolvedBomType = ["standard", "kit", "assembled"].includes(req.body.bom_type)
          ? req.body.bom_type
          : (is_bundle ? "kit" : "standard");
        if (resolvedBomType !== "standard") {
          await client.query(
            "UPDATE products SET bom_type = $1, is_bundle = $2 WHERE id = $3",
            [resolvedBomType, resolvedBomType === "kit", newProductId]
          );
          if (Array.isArray(bundle_components) && bundle_components.length > 0) {
            await kitEngine.replaceComponents(client, {
              parentProductId: newProductId,
              components: bundle_components,
            });
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

            // Opening stock for the variant. Goes through the shared stock
            // helper so all three tables agree: the per-outlet variant row (the
            // one a sale checks), the product_variants rollup, and the
            // product's outlet_stock total (what on-hand / stock value read).
            // Writing only the rollup let the first sale create the per-outlet
            // row at −1 and refused every sale after it.
            if (outlet_id && Number(variant.initial_stock) > 0) {
              await stockLedger.incrementStock(client, {
                productId: newProductId,
                variantId,
                outletId: outlet_id,
                qty: Number(variant.initial_stock),
                manageBatch: false,
                refType: "opening_stock",
                refId: newProductId,
              });
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

        // OTS step 7: first price/cost and opening stock → History.
        await productHistory.tagChanges(client, { kind: "new_item", employeeId: productHistory.actorOf(req) });
        return { id: newProductId, barcode, name, has_variants };
      });

      res.json(result);
    } catch (err) {
      // Honor validation errors thrown by the kit-engine (nested kits, cycles).
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
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
      visibility,              // Tier 2.11 wholesale visibility
      customer_group_ids,      // Tier 2.11 — groups whitelist for restricted products
      track_batches,           // F07 batch/expiry opt-in
      shelf_life_days,         // F07 default expiry suggestion at GRN
      plu_code,                // V01 grocery — PLU rapid-entry code
      age_restricted,          // V01 — POS cashier-attest age gate
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
        // F07 — batch tracking opt-in + default shelf life.
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "track_batches")) {
          updateFields.push(`track_batches = $${nextParam}`);
          updateParams.push(track_batches === true || track_batches === "true");
          nextParam++;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "shelf_life_days")) {
          updateFields.push(`shelf_life_days = $${nextParam}`);
          updateParams.push(
            shelf_life_days === "" || shelf_life_days == null
              ? null
              : Math.max(0, Math.floor(Number(shelf_life_days)))
          );
          nextParam++;
        }
        // Tier 2.11 — visibility patch. Empty/missing → keep current value
        // by skipping. Explicit value → coerce to enum.
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "visibility")) {
          updateFields.push(`visibility = $${nextParam}`);
          updateParams.push(visibility === "restricted" ? "restricted" : "all");
          nextParam++;
        }
        // V01 — PLU code patch. Empty/null → NULL (frees the partial-unique index).
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "plu_code")) {
          updateFields.push(`plu_code = $${nextParam}`);
          updateParams.push(
            plu_code == null || String(plu_code).trim() === ""
              ? null
              : String(plu_code).trim()
          );
          nextParam++;
        }
        // V01 — age_restricted patch (NOT NULL, coerce to boolean).
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "age_restricted")) {
          updateFields.push(`age_restricted = $${nextParam}`);
          updateParams.push(age_restricted === true || age_restricted === "true");
          nextParam++;
        }
        // F01: bom_type + is_bundle sync. Patch only when the caller sends
        // bom_type or is_bundle so a partial update never clobbers the type.
        if (
          Object.prototype.hasOwnProperty.call(req.body || {}, "bom_type") ||
          Object.prototype.hasOwnProperty.call(req.body || {}, "is_bundle")
        ) {
          const resolvedBomType = ["standard", "kit", "assembled"].includes(req.body.bom_type)
            ? req.body.bom_type
            : (req.body.is_bundle ? "kit" : "standard");
          updateFields.push(`bom_type = $${nextParam}`);
          updateParams.push(resolvedBomType);
          nextParam++;
          updateFields.push(`is_bundle = $${nextParam}`);
          updateParams.push(resolvedBomType === "kit");
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

        // Tier 2.11 — replace customer_group_products mapping when the
        // caller explicitly sends customer_group_ids. Skipping the key
        // leaves the existing mapping untouched (partial-update safe).
        if (Object.prototype.hasOwnProperty.call(req.body || {}, "customer_group_ids")) {
          try {
            await client.query(
              "DELETE FROM customer_group_products WHERE product_id = $1",
              [id]
            );
            if (Array.isArray(customer_group_ids) && customer_group_ids.length > 0) {
              for (const gid of customer_group_ids) {
                const n = Number(gid);
                if (!Number.isInteger(n) || n <= 0) continue;
                await client.query(
                  `INSERT INTO customer_group_products (customer_group_id, product_id)
                   VALUES ($1, $2)
                   ON CONFLICT DO NOTHING`,
                  [n, id]
                );
              }
            }
          } catch (cgpErr) {
            console.warn("[products PUT] customer_group_products skipped:", cgpErr.message);
          }
        }

        // 2. Update variants if provided
        if (Array.isArray(variants) && variants.length > 0) {
          for (const v of variants) {
            // Only update existing variants for now (v.id)
            // Never stock (OTS D25): the edit screen sends the count it loaded,
            // so writing it back erased sales made meanwhile, and it only moved
            // the rollup, not the per-outlet row. Stock moves through sales,
            // receiving, adjustments and counts.
            if (v.id && !String(v.id).startsWith("temp-")) {
              await client.query(
                `UPDATE product_variants SET sku = $1, barcode = $2, price = $3, cost_price = $4, compare_at_price = $5, weight = $6, weight_unit = $7 WHERE id = $8`,
                [
                  v.sku,
                  v.barcode || null,
                  v.price || price,
                  v.cost_price || cost_price,
                  v.compare_at_price || v.price || price || 0,
                  v.weight || 0,
                  v.weight_unit || "kg",
                  v.id,
                ]
              );
            }
            // Ignore new variants in PUT for simplicity
          }
        }

        // 3. F01: replace components through the shared engine (validates
        // self-ref / nested kits / qty) when the caller sends bundle_components.
        if (Array.isArray(bundle_components)) {
          await kitEngine.replaceComponents(client, {
            parentProductId: Number(id),
            components: bundle_components,
          });
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
        await productHistory.tagChanges(client, { kind: "edit", employeeId: productHistory.actorOf(req) });
      });

      res.json({ message: "Product updated successfully" });
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ error: err.message });
      }
      // Honor kit-engine validation errors (nested kits, cycles, bad qty).
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
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
