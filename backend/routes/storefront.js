module.exports = function mountStorefrontRoutes(app, deps) {
  const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";

  /**
   * Resolve tenant DB for public storefront requests.
   * Reads tenant slug from query param or header.
   * Returns { db } or { error, status }.
   */
  async function resolveStorefrontDb(req) {
    if (!IS_MULTI_TENANT) return { db: deps.db };

    const tenantSlug =
      req.query.tenant || req.headers["x-tenant-slug"];
    if (!tenantSlug) {
      return { error: "tenant query param or x-tenant-slug header is required", status: 400 };
    }

    const masterDb = require("../master-db-pg");
    const tenantDbMgr = deps.tenantDbManager || require("../tenant-db-manager-pg");

    const {
      rows: [tenant],
    } = await masterDb.query(
      "SELECT id, slug, status FROM tenants WHERE slug = $1 AND status = 'active'",
      [String(tenantSlug).trim()]
    );
    if (!tenant) {
      return { error: "Store not found", status: 404 };
    }

    const db = await tenantDbMgr.getDb(tenant.id);
    return { db };
  }

  // ---------------------------------------------------------------------------
  // GET /api/storefront/config — tenant branding & storefront settings
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/config", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1"
      );
      const profile = rows[0] || {};

      res.json({
        companyName: profile.company_name || "",
        logoUrl: profile.logo_url || null,
        currency: "PKR",
        currencySymbol: profile.currency_symbol || "Rs",
        deliveryMethods: ["pickup", "ship_to_customer"],
        pickupEnabled: true,
      });
    } catch (err) {
      console.error("Storefront config error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/storefront/categories — categories with published storefront products
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/categories", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(`
        SELECT DISTINCT c.id, c.name, c.description, c.parent_id, c.sort_order
        FROM categories c
        JOIN products p ON p.category_id = c.id
        JOIN channel_publications cp ON cp.product_id = p.id
        JOIN sales_channels sc ON sc.id = cp.channel_id AND sc.code = 'storefront'
        WHERE cp.is_published = true AND c.is_active = true
        ORDER BY c.sort_order, c.name
      `);

      res.json({ categories: rows });
    } catch (err) {
      console.error("Storefront categories error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/storefront/products — paginated, filterable product listing
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/products", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const conditions = [
        "cp.is_published = true",
        "sc.code = 'storefront'",
      ];
      const params = [];
      let paramIdx = 0;

      // Category filter
      if (req.query.category) {
        paramIdx++;
        conditions.push(`p.category_id = $${paramIdx}`);
        params.push(parseInt(req.query.category, 10));
      }

      // Search filter
      if (req.query.search) {
        paramIdx++;
        const searchParam = `%${req.query.search}%`;
        conditions.push(`(p.name ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx} OR p.barcode ILIKE $${paramIdx})`);
        params.push(searchParam);
      }

      const whereClause = conditions.join(" AND ");

      // Sort
      let orderBy = "p.created_at DESC";
      switch (req.query.sort) {
        case "price_asc":
          orderBy = "p.price ASC";
          break;
        case "price_desc":
          orderBy = "p.price DESC";
          break;
        case "name_asc":
          orderBy = "p.name ASC";
          break;
        case "newest":
          orderBy = "p.created_at DESC";
          break;
      }

      // Count total
      const countQuery = `
        SELECT COUNT(DISTINCT p.id) AS total
        FROM products p
        JOIN channel_publications cp ON cp.product_id = p.id
        JOIN sales_channels sc ON sc.id = cp.channel_id
        WHERE ${whereClause}
      `;
      const { rows: countRows } = await db.query(countQuery, params);
      const total = parseInt(countRows[0].total, 10);

      // Fetch products
      const dataQuery = `
        SELECT
          p.id, p.name, p.sku, p.price, p.compare_at_price,
          p.image_url, p.category_id, c.name AS category_name,
          COALESCE((SELECT SUM(os.quantity) FROM outlet_stock os WHERE os.product_id = p.id), 0) > 0 AS in_stock
        FROM products p
        JOIN channel_publications cp ON cp.product_id = p.id
        JOIN sales_channels sc ON sc.id = cp.channel_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${whereClause}
        GROUP BY p.id, p.name, p.sku, p.price, p.compare_at_price,
                 p.image_url, p.category_id, c.name, p.created_at
        ORDER BY ${orderBy}
        LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}
      `;

      const { rows: products } = await db.query(dataQuery, [...params, limit, offset]);

      res.json({
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: parseFloat(p.price),
          compareAtPrice: p.compare_at_price ? parseFloat(p.compare_at_price) : null,
          imageUrl: p.image_url,
          categoryId: p.category_id,
          categoryName: p.category_name,
          inStock: p.in_stock,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error("Storefront products error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/storefront/products/:id — full product detail
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/products/:id", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const productId = parseInt(req.params.id, 10);
      if (isNaN(productId)) return res.status(400).json({ error: "Invalid product ID" });

      // Verify product is published on storefront channel
      const { rows: productRows } = await db.query(`
        SELECT
          p.id, p.name, p.description, p.sku, p.barcode,
          p.price, p.compare_at_price, p.image_url,
          p.category_id, c.name AS category_name,
          p.brand_id, b.name AS brand_name
        FROM products p
        JOIN channel_publications cp ON cp.product_id = p.id
        JOIN sales_channels sc ON sc.id = cp.channel_id AND sc.code = 'storefront'
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.id = $1 AND cp.is_published = true
        LIMIT 1
      `, [productId]);

      if (!productRows.length) {
        return res.status(404).json({ error: "Product not found" });
      }

      const product = productRows[0];

      // Fetch variants, images, reviews, pickup availability in parallel
      const [variantsRes, imagesRes, reviewsRes, stockRes] = await Promise.all([
        db.query(
          `SELECT id, name, sku, barcode, price,
                  COALESCE((SELECT SUM(os.quantity) FROM outlet_stock os WHERE os.product_id = $1 AND os.variant_id = pv.id), 0) AS stock
           FROM product_variants pv
           WHERE pv.product_id = $1 AND pv.is_active = true
           ORDER BY pv.id`,
          [productId]
        ),
        db.query(
          `SELECT id, url, alt_text, position
           FROM product_media
           WHERE product_id = $1
           ORDER BY position ASC`,
          [productId]
        ),
        db.query(
          `SELECT id, customer_name, rating, title, body, created_at
           FROM product_reviews
           WHERE product_id = $1 AND status = 'approved'
           ORDER BY created_at DESC
           LIMIT 20`,
          [productId]
        ),
        db.query(
          `SELECT o.id AS outlet_id, o.name AS outlet_name,
                  COALESCE(os.quantity, 0) > 0 AS in_stock
           FROM outlets o
           LEFT JOIN outlet_stock os ON os.outlet_id = o.id AND os.product_id = $1
           WHERE o.is_active = true
           ORDER BY o.name`,
          [productId]
        ),
      ]);

      // Compute average rating
      const reviews = reviewsRes.rows;
      const reviewCount = reviews.length;
      const averageRating =
        reviewCount > 0
          ? parseFloat((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount).toFixed(1))
          : null;

      res.json({
        id: product.id,
        name: product.name,
        description: product.description,
        sku: product.sku,
        barcode: product.barcode,
        price: parseFloat(product.price),
        compareAtPrice: product.compare_at_price ? parseFloat(product.compare_at_price) : null,
        imageUrl: product.image_url,
        categoryId: product.category_id,
        categoryName: product.category_name,
        brandId: product.brand_id,
        brandName: product.brand_name,
        variants: variantsRes.rows.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          barcode: v.barcode,
          price: parseFloat(v.price),
          stock: parseInt(v.stock, 10),
        })),
        images: imagesRes.rows.map((img) => ({
          id: img.id,
          url: img.url,
          altText: img.alt_text,
          position: img.position,
        })),
        reviews: reviews.map((r) => ({
          id: r.id,
          customerName: r.customer_name,
          rating: r.rating,
          title: r.title,
          body: r.body,
          createdAt: r.created_at,
        })),
        averageRating,
        reviewCount,
        pickupAvailability: stockRes.rows.map((s) => ({
          outletId: s.outlet_id,
          outletName: s.outlet_name,
          inStock: s.in_stock,
        })),
      });
    } catch (err) {
      console.error("Storefront product detail error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/storefront/pickup-locations — active outlets
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/pickup-locations", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        `SELECT id, name, address, phone
         FROM outlets
         WHERE is_active = true
         ORDER BY name`
      );

      res.json({
        locations: rows.map((o) => ({
          id: o.id,
          name: o.name,
          address: o.address || null,
          phone: o.phone || null,
          supportsCurbside: false,
        })),
      });
    } catch (err) {
      console.error("Storefront pickup locations error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
