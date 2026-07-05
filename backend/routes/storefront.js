const crypto = require("crypto");
const kitEngine = require("./../services/kit-engine");
const { getOrCreateCart, addItem, updateItem, removeItem, getCartWithItems } = require("../services/storefront-cart");
const { calculateQuote } = require("../services/quote");
const { allocateOrder } = require("../services/allocation");
const { resolvePublicTenantDb } = require("../services/public-tenant-context");
const { withVisibilityWhere } = require("../services/product-visibility");

// Tier 2.11 — resolve the storefront visitor's customer_id from the
// optional ?cart_token=. Anonymous (no token, no matching cart, no
// customer_id) returns null, which the visibility helper treats as
// "C2 default" — only products with visibility='all' are returned.
async function resolveStorefrontCustomerId(db, cartToken) {
  if (!cartToken) return null;
  try {
    const { rows } = await db.query(
      "SELECT customer_id FROM storefront_carts WHERE cart_token = $1",
      [cartToken]
    );
    return rows[0]?.customer_id || null;
  } catch {
    // visibility column / table may be missing on a not-yet-migrated tenant
    return null;
  }
}

module.exports = function mountStorefrontRoutes(app, deps) {

  // ---------------------------------------------------------------------------
  // GET /api/storefront/config — tenant branding & storefront settings
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/config", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT company_name, logo_url, currency_symbol FROM company_profile LIMIT 1"
      );
      const profile = rows[0] || {};

      res.json({
        company_name: profile.company_name || "",
        logo_url: profile.logo_url || null,
        currency: "PKR",
        currency_symbol: profile.currency_symbol || "Rs",
        delivery_methods: ["pickup", "ship_to_customer"],
        pickup_enabled: true,
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
      const resolved = await resolvePublicTenantDb(req, deps);
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

      // Return a bare array — StorefrontLayout.jsx checks `Array.isArray(catData)`
      // and falls back to [] otherwise. Wrapping in { categories } silently
      // empties the storefront category nav.
      res.json(rows);
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
      const resolved = await resolvePublicTenantDb(req, deps);
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

      // Tier 2.11 — visibility gate. The buyer is identified by the cart's
      // customer_id (set on the cart when a portal user reorders, or when
      // checkout fills it in). Anonymous = ungrouped = sees only 'all'.
      const sfCustomerId = await resolveStorefrontCustomerId(db, req.query.cart_token);
      await withVisibilityWhere(db, conditions, params, sfCustomerId);
      paramIdx = params.length;

      const whereClause = conditions.join(" AND ");

      // Sort (products table has no created_at — id DESC = newest first since SERIAL)
      let orderBy = "p.id DESC";
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
          orderBy = "p.id DESC";
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
      // Tier 2.2 — min_order_qty / order_increment exposed so storefront cards
      // can show "Min 12 · Case of 6" hints and pre-block bad add-to-cart
      // qtys before the server round-trip. Defaults 0/1 produce no hint.
      const dataQuery = `
        SELECT
          p.id, p.name, p.sku, p.price, p.compare_at_price,
          p.image_url, p.category_id, c.name AS category_name,
          COALESCE(p.min_order_qty, 0) AS min_order_qty,
          COALESCE(p.order_increment, 1) AS order_increment,
          COALESCE((SELECT SUM(os.quantity) FROM outlet_stock os WHERE os.product_id = p.id), 0) > 0 AS in_stock
        FROM products p
        JOIN channel_publications cp ON cp.product_id = p.id
        JOIN sales_channels sc ON sc.id = cp.channel_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${whereClause}
        GROUP BY p.id, p.name, p.sku, p.price, p.compare_at_price,
                 p.image_url, p.category_id, c.name,
                 p.min_order_qty, p.order_increment
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
          compare_at_price: p.compare_at_price ? parseFloat(p.compare_at_price) : null,
          image_url: p.image_url,
          category_id: p.category_id,
          category_name: p.category_name,
          in_stock: p.in_stock,
          min_order_qty: Number(p.min_order_qty || 0),
          order_increment: Number(p.order_increment || 1),
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
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const productId = parseInt(req.params.id, 10);
      if (isNaN(productId)) return res.status(400).json({ error: "Invalid product ID" });

      // Verify product is published on storefront channel
      // Tier 2.2 — pull MOQ columns so the detail page can show hints and
      // pre-block invalid quantities.
      // Tier 2.11 — apply visibility gate. If the visitor's cart links to a
      // customer who can't see this SKU, return 404 (same shape as a
      // missing product — don't leak that a SKU exists but is restricted).
      const sfCustomerId = await resolveStorefrontCustomerId(db, req.query.cart_token);
      const conditions = ["p.id = $1", "cp.is_published = true"];
      const params = [productId];
      await withVisibilityWhere(db, conditions, params, sfCustomerId);
      const { rows: productRows } = await db.query(`
        SELECT
          p.id, p.name, p.description_html AS description, p.sku, p.barcode,
          p.price, p.compare_at_price, p.image_url,
          p.category_id, c.name AS category_name,
          p.brand_id, b.name AS brand_name,
          COALESCE(p.min_order_qty, 0) AS min_order_qty,
          COALESCE(p.order_increment, 1) AS order_increment
        FROM products p
        JOIN channel_publications cp ON cp.product_id = p.id
        JOIN sales_channels sc ON sc.id = cp.channel_id AND sc.code = 'storefront'
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE ${conditions.join(" AND ")}
        LIMIT 1
      `, params);

      if (!productRows.length) {
        return res.status(404).json({ error: "Product not found" });
      }

      const product = productRows[0];

      // Fetch variants, images, reviews, pickup availability in parallel
      // (product_variants has no `name` or `is_active` columns; outlet_stock is product-level only)
      const [variantsRes, imagesRes, reviewsRes, stockRes] = await Promise.all([
        db.query(
          `SELECT id, sku, barcode, price, COALESCE(stock, 0) AS stock
           FROM product_variants pv
           WHERE pv.product_id = $1
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
        compare_at_price: product.compare_at_price ? parseFloat(product.compare_at_price) : null,
        image_url: product.image_url,
        category_id: product.category_id,
        category_name: product.category_name,
        brand_id: product.brand_id,
        brand_name: product.brand_name,
        min_order_qty: Number(product.min_order_qty || 0),
        order_increment: Number(product.order_increment || 1),
        variants: variantsRes.rows.map((v) => ({
          id: v.id,
          name: v.sku || `Variant ${v.id}`,
          sku: v.sku,
          barcode: v.barcode,
          price: parseFloat(v.price),
          stock: parseInt(v.stock, 10),
        })),
        images: imagesRes.rows.map((img) => ({
          id: img.id,
          url: img.url,
          alt_text: img.alt_text,
          position: img.position,
        })),
        // Reviews use the simpler { author, text } shape the frontend reads.
        reviews: reviews.map((r) => ({
          id: r.id,
          author: r.customer_name,
          rating: r.rating,
          title: r.title,
          text: r.body,
          created_at: r.created_at,
        })),
        average_rating: averageRating,
        review_count: reviewCount,
        // `availability` (not `pickupAvailability`) — matches frontend.
        availability: stockRes.rows.map((s) => ({
          outlet_id: s.outlet_id,
          outlet_name: s.outlet_name,
          in_stock: s.in_stock,
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
      const resolved = await resolvePublicTenantDb(req, deps);
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

  // ---------------------------------------------------------------------------
  // GET /api/storefront/shipping-methods — available couriers with flat rates
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/shipping-methods", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        `SELECT id, name, flat_shipping_rate, provider_category
         FROM courier_integrations
         WHERE enabled = true AND flat_shipping_rate IS NOT NULL
         ORDER BY flat_shipping_rate ASC, name ASC`
      );

      res.json({
        methods: rows.map((c) => ({
          courier_id: c.id,
          name: c.name,
          rate: Number(c.flat_shipping_rate),
          category: c.provider_category || "domestic",
        })),
        free_shipping_available: rows.length === 0,
      });
    } catch (err) {
      console.error("Storefront shipping methods error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/storefront/cart — create or retrieve a cart
  // ---------------------------------------------------------------------------
  app.post("/api/storefront/cart", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      let { cart_token } = req.body || {};

      // If no token provided, generate one
      if (!cart_token) {
        cart_token = crypto.randomUUID();
      }

      const cart = await getOrCreateCart(db, cart_token);
      const cartData = await getCartWithItems(db, cart.id);
      res.json({ token: cart.cart_token, ...cartData });
    } catch (err) {
      console.error("Storefront create cart error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/storefront/cart/:token — get cart with items
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/cart/:token", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });

      const result = await getCartWithItems(db, rows[0].id);
      res.json(result);
    } catch (err) {
      console.error("Storefront get cart error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/storefront/cart/:token/items — add item to cart
  // ---------------------------------------------------------------------------
  app.post("/api/storefront/cart/:token/items", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = rows[0];

      const { product_id, variant_id, quantity } = req.body || {};
      if (!product_id) return res.status(400).json({ error: "product_id is required" });
      if (!quantity || quantity < 1) return res.status(400).json({ error: "quantity must be >= 1" });

      await addItem(db, cart.id, product_id, variant_id || null, quantity);
      const result = await getCartWithItems(db, cart.id);
      res.json(result);
    } catch (err) {
      console.error("Storefront add item error:", err);
      if (err.message === "Product not found") {
        return res.status(404).json({ error: err.message });
      }
      if (err.code === "PRODUCT_NOT_VISIBLE") {
        // Same shape as "Product not found" — don't leak that the SKU
        // exists but is restricted to other accounts.
        return res.status(404).json({ error: "Product not found" });
      }
      if (err.code === "MOQ_VIOLATION") {
        return res.status(400).json({
          error: err.message,
          code: "MOQ_VIOLATION",
          violations: err.violations,
        });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /api/storefront/cart/:token/items/:itemId — update item quantity
  // ---------------------------------------------------------------------------
  app.put("/api/storefront/cart/:token/items/:itemId", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = rows[0];

      const { quantity } = req.body || {};
      if (quantity == null) return res.status(400).json({ error: "quantity is required" });

      await updateItem(db, cart.id, parseInt(req.params.itemId, 10), quantity);
      const result = await getCartWithItems(db, cart.id);
      res.json(result);
    } catch (err) {
      console.error("Storefront update item error:", err);
      if (err.message === "Cart item not found") {
        return res.status(404).json({ error: err.message });
      }
      if (err.code === "MOQ_VIOLATION") {
        return res.status(400).json({
          error: err.message,
          code: "MOQ_VIOLATION",
          violations: err.violations,
        });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/storefront/cart/:token/items/:itemId — remove item from cart
  // ---------------------------------------------------------------------------
  app.delete("/api/storefront/cart/:token/items/:itemId", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = rows[0];

      await removeItem(db, cart.id, parseInt(req.params.itemId, 10));
      const result = await getCartWithItems(db, cart.id);
      res.json(result);
    } catch (err) {
      console.error("Storefront remove item error:", err);
      if (err.message === "Cart item not found") {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/storefront/cart/:token/quote — run quote engine on cart
  // ---------------------------------------------------------------------------
  app.post("/api/storefront/cart/:token/quote", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = rows[0];

      const { delivery_method, pickup_outlet_id, courier_id } = req.body || {};
      const method = delivery_method || "pickup";

      // Load cart items for quote
      const cartData = await getCartWithItems(db, cart.id);
      const cartItems = cartData.items.map((i) => ({
        productId: i.product_id,
        variantId: i.variant_id,
        qty: i.quantity,
      }));

      // P13 — load tenant tax_mode so the storefront quote uses the same
      // resolution chain as POS sales (P8). Default to 'none' if missing.
      let taxMode = "none";
      try {
        const { rows: cp } = await db.query(
          "SELECT tax_mode FROM company_profile LIMIT 1"
        );
        if (cp[0]?.tax_mode) taxMode = cp[0].tax_mode;
      } catch { /* column may not exist on a not-yet-migrated tenant */ }

      const quote = await calculateQuote(
        db,
        cartItems,
        method,
        pickup_outlet_id || null,
        cart.channel_id,
        courier_id || null,
        { taxMode, tenantId: resolved.tenant?.id, customerId: cart.customer_id || null }
      );

      // Save quote snapshot to cart for later checkout reference
      await db.query(
        "UPDATE storefront_carts SET quote_payload = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(quote), cart.id]
      );

      res.json(quote);
    } catch (err) {
      console.error("Storefront quote error:", err);
      res.status(400).json({ error: err.message || "Quote failed" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/storefront/checkout — atomic checkout
  // ---------------------------------------------------------------------------
  app.post("/api/storefront/checkout", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const {
        cart_token,
        delivery_method,
        pickup_outlet_id,
        courier_id,
        customer_name,
        customer_phone,
        customer_email,
        shipping_address,
      } = req.body || {};

      if (!cart_token) return res.status(400).json({ error: "cart_token is required" });
      if (!delivery_method) return res.status(400).json({ error: "delivery_method is required" });
      if (!customer_name || !customer_phone) {
        return res.status(400).json({ error: "customer_name and customer_phone are required" });
      }
      if (delivery_method === "pickup" && !pickup_outlet_id) {
        return res.status(400).json({ error: "pickup_outlet_id is required for pickup orders" });
      }
      if (delivery_method === "ship_to_customer" && (!shipping_address || !shipping_address.address_line_1 || !shipping_address.city)) {
        return res.status(400).json({ error: "shipping_address with address_line_1 and city is required for shipping" });
      }

      // 1. Validate cart exists and has items
      const { rows: cartRows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [cart_token]
      );
      if (!cartRows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = cartRows[0];

      const cartData = await getCartWithItems(db, cart.id);
      if (!cartData.items.length) {
        return res.status(400).json({ error: "Cart is empty" });
      }

      // 2. Run final quote
      const cartItems = cartData.items.map((i) => ({
        productId: i.product_id,
        variantId: i.variant_id,
        qty: i.quantity,
      }));
      // P13 — propagate tenant tax_mode to checkout's final quote too. The
      // values written to web_orders.subtotal/tax_total/grand_total below
      // come from this snapshot, so they MUST match the live quote shown
      // on the cart page.
      let checkoutTaxMode = "none";
      try {
        const { rows: cp } = await db.query(
          "SELECT tax_mode FROM company_profile LIMIT 1"
        );
        if (cp[0]?.tax_mode) checkoutTaxMode = cp[0].tax_mode;
      } catch { /* not-yet-migrated tenant */ }

      const quote = await calculateQuote(
        db,
        cartItems,
        delivery_method,
        pickup_outlet_id || null,
        cart.channel_id,
        courier_id || null,
        { taxMode: checkoutTaxMode, tenantId: resolved.tenant?.id, customerId: cart.customer_id || null }
      );

      // 3. Check for availability errors
      if (quote.availabilityErrors && quote.availabilityErrors.length > 0) {
        return res.status(400).json({
          error: "Some items are unavailable",
          availabilityErrors: quote.availabilityErrors,
        });
      }

      // 4-13. Atomic transaction
      const result = await db.transaction(async (client) => {
        // 5-6. Generate tokens
        const externalOrderId = "sf_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
        const publicOrderToken = crypto.randomUUID();

        // 7. Look up storefront channel
        const { rows: chRows } = await client.query(
          "SELECT id FROM sales_channels WHERE code = 'storefront' LIMIT 1"
        );
        const channelId = chRows.length ? chRows[0].id : null;

        // Determine fulfillment outlet
        let fulfillmentOutletId = null;
        if (delivery_method === "pickup") {
          fulfillmentOutletId = pickup_outlet_id;
        }

        // 8. Insert web_orders
        const { rows: [order] } = await client.query(
          `INSERT INTO web_orders (
            source, external_order_id, channel_id,
            delivery_method, pickup_outlet_id, fulfillment_outlet_id,
            customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
            shipping_address_json,
            subtotal, discount_total, tax_total, shipping_total, grand_total,
            currency, payment_status, fulfillment_status, order_status,
            public_order_token, ordered_at
          ) VALUES (
            'storefront', $1, $2,
            $3, $4, $5,
            $6, $7, $8,
            $9,
            $10, $11, $12, $13, $14,
            'PKR', 'pending', 'unfulfilled', 'open',
            $15, NOW()
          ) RETURNING *`,
          [
            externalOrderId, channelId,
            delivery_method, pickup_outlet_id || null, fulfillmentOutletId,
            customer_name, customer_phone, customer_email || null,
            shipping_address ? JSON.stringify(shipping_address) : null,
            quote.subtotal, quote.discountTotal, quote.taxTotal, quote.shippingTotal, quote.grandTotal,
            publicOrderToken,
          ]
        );

        // 9. Insert web_order_items
        const insertedItems = [];
        for (const qi of quote.items) {
          const { rows: [orderItem] } = await client.query(
            `INSERT INTO web_order_items (
              web_order_id, product_id, variant_id, sku, title,
              qty, unit_price, discount, tax, line_total
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
              order.id, qi.productId, qi.variantId,
              null, qi.productName,
              qi.qty, qi.unitPrice, qi.discount, qi.taxAmount, qi.lineTotal,
            ]
          );
          insertedItems.push(orderItem);
        }

        // 10. Create inventory reservations (converted) and decrement stock
        for (let idx = 0; idx < quote.items.length; idx++) {
          const qi = quote.items[idx];
          const orderItem = insertedItems[idx];

          // Determine which outlet to decrement stock from
          let stockOutletId;
          if (delivery_method === "pickup") {
            stockOutletId = pickup_outlet_id;
          } else {
            // Ship-to-customer: pick outlet with most stock
            const { rows: stockRows } = await client.query(
              `SELECT os.outlet_id, os.quantity
               FROM outlet_stock os
               JOIN outlets o ON o.id = os.outlet_id AND o.is_active = true
               WHERE os.product_id = $1 AND os.quantity >= $2
               ORDER BY os.quantity DESC
               LIMIT 1`,
              [qi.productId, qi.qty]
            );
            if (!stockRows.length) {
              throw Object.assign(
                new Error(`Insufficient stock for ${qi.productName}`),
                { statusCode: 400 }
              );
            }
            stockOutletId = stockRows[0].outlet_id;
          }

          // F01: kits hold no stock of their own — the public storefront
          // checkout is not kit-aware yet, so hard-reject with a clear message
          // rather than the misleading "insufficient stock" (kit rows are empty).
          if ((await kitEngine.getBomType(client, qi.productId)) === "kit") {
            throw Object.assign(
              new Error(`"${qi.productName}" is a kit/bundle and can't be ordered online yet.`),
              { statusCode: 400, code: "kit_not_supported_online" }
            );
          }

          // Lock and decrement outlet_stock
          const { rows: lockRows } = await client.query(
            `SELECT id, quantity FROM outlet_stock
             WHERE outlet_id = $1 AND product_id = $2
             FOR UPDATE`,
            [stockOutletId, qi.productId]
          );

          if (!lockRows.length || lockRows[0].quantity < qi.qty) {
            throw Object.assign(
              new Error(`Insufficient stock for ${qi.productName}`),
              { statusCode: 400 }
            );
          }

          await client.query(
            `UPDATE outlet_stock SET quantity = quantity - $1
             WHERE outlet_id = $2 AND product_id = $3`,
            [qi.qty, stockOutletId, qi.productId]
          );

          // Insert reservation as 'converted' (already decremented)
          const reservationKey = `order_${order.id}_item_${orderItem.id}`;
          await client.query(
            `INSERT INTO inventory_reservations (
              reservation_key, channel_id, web_order_id, product_id, variant_id,
              outlet_id, quantity, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'converted', NOW(), NOW())`,
            [
              reservationKey, channelId, order.id,
              qi.productId, qi.variantId,
              stockOutletId, qi.qty,
            ]
          );

          // Update fulfillment_outlet_id on order if ship_to_customer and not yet set
          if (delivery_method === "ship_to_customer" && !fulfillmentOutletId) {
            fulfillmentOutletId = stockOutletId;
            await client.query(
              "UPDATE web_orders SET fulfillment_outlet_id = $1 WHERE id = $2",
              [fulfillmentOutletId, order.id]
            );
          }
        }

        // 11. Create allocations
        const allocItems = insertedItems.map((oi, idx) => ({
          webOrderItemId: oi.id,
          productId: quote.items[idx].productId,
          variantId: quote.items[idx].variantId,
          qty: quote.items[idx].qty,
        }));
        // allocateOrder uses its own transaction internally, but we need to use
        // the same client. Insert allocations directly here instead.
        for (const ai of allocItems) {
          let outletId;
          if (delivery_method === "pickup") {
            outletId = pickup_outlet_id;
          } else {
            // Use the outlet we already determined during stock decrement
            const { rows } = await client.query(
              `SELECT outlet_id FROM inventory_reservations
               WHERE web_order_id = $1 AND product_id = $2
               LIMIT 1`,
              [order.id, ai.productId]
            );
            outletId = rows.length ? rows[0].outlet_id : fulfillmentOutletId;
          }

          await client.query(
            `INSERT INTO web_order_allocations (
              web_order_id, web_order_item_id, fulfillment_outlet_id,
              fulfillment_method, status, allocated_qty
            ) VALUES ($1, $2, $3, $4, 'pending', $5)`,
            [order.id, ai.webOrderItemId, outletId, delivery_method, ai.qty]
          );
        }

        // 12. Delete the cart (cascade deletes cart items)
        await client.query("DELETE FROM storefront_carts WHERE id = $1", [cart.id]);

        // 13. Return result
        const paymentGateway = require("../services/payment-gateway");
        return {
          order_id: order.id,
          order_token: publicOrderToken,
          order_number: externalOrderId,
          grand_total: Number(order.grand_total),
          payment_enabled: paymentGateway.isEnabled(),
        };
      });

      res.status(201).json(result);
    } catch (err) {
      console.error("Storefront checkout error:", err);
      const status = err.statusCode || 500;
      res.status(status).json({ error: err.message || "Checkout failed" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/storefront/orders/:orderToken/pay — initiate payment for an order
  // ---------------------------------------------------------------------------
  app.post("/api/storefront/orders/:orderToken/pay", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const paymentGateway = require("../services/payment-gateway");
      if (!paymentGateway.isEnabled()) {
        return res.status(400).json({ error: "Online payments not configured", payment_enabled: false });
      }

      const { rows: [order] } = await db.query(
        `SELECT id, grand_total, payment_status, external_order_id, public_order_token
         FROM web_orders WHERE public_order_token = $1`,
        [req.params.orderToken]
      );
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.payment_status === "paid") {
        return res.status(400).json({ error: "Order is already paid" });
      }

      const amount = Number(order.grand_total);
      const tenantSlug = req.query.tenant;
      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.com";
      const returnUrl = `${frontendUrl}/store/${tenantSlug}/order/${order.public_order_token}?payment=success`;
      const cancelUrl = `${frontendUrl}/store/${tenantSlug}/order/${order.public_order_token}?payment=cancelled`;

      const { checkout_url, gateway_ref } = await paymentGateway.createCheckout({
        amount,
        currency: "PKR",
        reference: `storefront-${order.id}`,
        description: `Order ${order.external_order_id}`,
        returnUrl,
        cancelUrl,
      });

      const providerName = process.env.PAYMENT_GATEWAY || "manual";

      await db.query(
        `INSERT INTO storefront_payment_sessions
          (web_order_id, provider, provider_ref, amount, return_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, providerName, gateway_ref, amount, returnUrl]
      );

      res.json({ checkout_url, gateway_ref });
    } catch (err) {
      console.error("Storefront payment initiation error:", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Payment initiation failed" });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/storefront/orders/:orderToken — public order status lookup
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/orders/:orderToken", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows: orderRows } = await db.query(
        `SELECT wo.id, wo.external_order_id, wo.order_status, wo.payment_status, wo.fulfillment_status,
                wo.delivery_method, wo.grand_total, wo.subtotal, wo.tax_total, wo.shipping_total, wo.discount_total,
                wo.customer_name_snapshot, wo.customer_phone_snapshot, wo.customer_email_snapshot,
                wo.shipping_address_json, wo.created_at, wo.ordered_at,
                wo.pickup_ready_at, wo.picked_up_at, wo.curbside_arrived_at,
                wo.shipped_at, wo.delivered_at, wo.currency,
                po.name AS pickup_outlet_name, po.address AS pickup_outlet_address
         FROM web_orders wo
         LEFT JOIN outlets po ON po.id = wo.pickup_outlet_id
         WHERE wo.public_order_token = $1`,
        [req.params.orderToken]
      );

      if (!orderRows.length) return res.status(404).json({ error: "Order not found" });
      const order = orderRows[0];

      // Derive timeline status from the backend's timestamp-driven state.
      // The storefront UI expects an enum, but we track progress via columns
      // (pickup_ready_at, picked_up_at, shipped_at, delivered_at). Map to the
      // four-step enum the frontend timeline renders.
      let derivedStatus;
      if (order.order_status === "cancelled") {
        derivedStatus = "cancelled";
      } else if (order.delivery_method === "pickup") {
        if (order.picked_up_at) derivedStatus = "completed";
        else if (order.pickup_ready_at) derivedStatus = "ready_for_pickup";
        else derivedStatus = "processing";
      } else {
        if (order.delivered_at || order.fulfillment_status === "delivered") derivedStatus = "completed";
        else if (order.shipped_at || order.fulfillment_status === "shipped") derivedStatus = "shipped";
        else derivedStatus = "processing";
      }

      const { rows: items } = await db.query(
        `SELECT woi.id, woi.title, woi.qty, woi.unit_price, woi.discount, woi.tax, woi.line_total,
                woi.product_id, woi.variant_id, woi.sku
         FROM web_order_items woi
         WHERE woi.web_order_id = $1
         ORDER BY woi.id`,
        [order.id]
      );

      res.json({
        id: order.id,
        order_number: order.external_order_id,
        status: derivedStatus,
        payment_status: order.payment_status,
        fulfillment_status: order.fulfillment_status,
        delivery_method: order.delivery_method,
        total: Number(order.grand_total),
        subtotal: Number(order.subtotal),
        tax: Number(order.tax_total),
        shipping_fee: Number(order.shipping_total),
        discount_total: Number(order.discount_total),
        currency: order.currency,
        customer_name: order.customer_name_snapshot,
        customer_phone: order.customer_phone_snapshot,
        customer_email: order.customer_email_snapshot,
        shipping_address: order.shipping_address_json,
        pickup_outlet_name: order.pickup_outlet_name,
        pickup_outlet_address: order.pickup_outlet_address,
        created_at: order.created_at || order.ordered_at,
        pickup_ready_at: order.pickup_ready_at,
        picked_up_at: order.picked_up_at,
        curbside_arrived_at: order.curbside_arrived_at,
        items: items.map((i) => ({
          id: i.id,
          product_name: i.title,
          quantity: i.qty,
          unit_price: Number(i.unit_price),
          discount: Number(i.discount),
          tax: Number(i.tax),
          line_total: Number(i.line_total),
          product_id: i.product_id,
          variant_id: i.variant_id,
          sku: i.sku,
        })),
      });
    } catch (err) {
      console.error("Storefront order lookup error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/storefront/orders/:orderToken/arrive — curbside arrival signal
  // ---------------------------------------------------------------------------
  app.post("/api/storefront/orders/:orderToken/arrive", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        `SELECT id, delivery_method, curbside_arrived_at
         FROM web_orders
         WHERE public_order_token = $1`,
        [req.params.orderToken]
      );

      if (!rows.length) return res.status(404).json({ error: "Order not found" });

      const order = rows[0];
      if (order.delivery_method !== "pickup") {
        return res.status(400).json({ error: "Order is not a pickup order" });
      }

      if (order.curbside_arrived_at) {
        return res.json({ success: true, arrivedAt: order.curbside_arrived_at });
      }

      const { rows: updated } = await db.query(
        `UPDATE web_orders SET curbside_arrived_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING curbside_arrived_at`,
        [order.id]
      );

      res.json({ success: true, arrivedAt: updated[0].curbside_arrived_at });
    } catch (err) {
      console.error("Storefront curbside arrive error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
