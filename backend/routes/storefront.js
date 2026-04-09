const crypto = require("crypto");
const { getOrCreateCart, addItem, updateItem, removeItem, getCartWithItems } = require("../services/storefront-cart");
const { calculateQuote } = require("../services/quote");
const { allocateOrder } = require("../services/allocation");

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

  // ---------------------------------------------------------------------------
  // POST /api/storefront/cart — create or retrieve a cart
  // ---------------------------------------------------------------------------
  app.post("/api/storefront/cart", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      let { cartToken } = req.body || {};

      // If no token provided, generate one
      if (!cartToken) {
        cartToken = crypto.randomUUID();
      }

      const cart = await getOrCreateCart(db, cartToken);
      res.json({ cartToken: cart.cart_token, cart });
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
      const resolved = await resolveStorefrontDb(req);
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
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = rows[0];

      const { productId, variantId, qty } = req.body || {};
      if (!productId) return res.status(400).json({ error: "productId is required" });
      if (!qty || qty < 1) return res.status(400).json({ error: "qty must be >= 1" });

      await addItem(db, cart.id, productId, variantId || null, qty);
      const result = await getCartWithItems(db, cart.id);
      res.json(result);
    } catch (err) {
      console.error("Storefront add item error:", err);
      if (err.message === "Product not found") {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // PUT /api/storefront/cart/:token/items/:itemId — update item quantity
  // ---------------------------------------------------------------------------
  app.put("/api/storefront/cart/:token/items/:itemId", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = rows[0];

      const { qty } = req.body || {};
      if (qty == null) return res.status(400).json({ error: "qty is required" });

      await updateItem(db, cart.id, parseInt(req.params.itemId, 10), qty);
      const result = await getCartWithItems(db, cart.id);
      res.json(result);
    } catch (err) {
      console.error("Storefront update item error:", err);
      if (err.message === "Cart item not found") {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/storefront/cart/:token/items/:itemId — remove item from cart
  // ---------------------------------------------------------------------------
  app.delete("/api/storefront/cart/:token/items/:itemId", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
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
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [req.params.token]
      );
      if (!rows.length) return res.status(404).json({ error: "Cart not found" });
      const cart = rows[0];

      const { deliveryMethod, pickupOutletId } = req.body || {};
      const method = deliveryMethod || "pickup";

      // Load cart items for quote
      const cartData = await getCartWithItems(db, cart.id);
      const cartItems = cartData.items.map((i) => ({
        productId: i.product_id,
        variantId: i.variant_id,
        qty: i.quantity,
      }));

      const quote = await calculateQuote(
        db,
        cartItems,
        method,
        pickupOutletId || null,
        cart.channel_id
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
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const {
        cartToken,
        deliveryMethod,
        pickupOutletId,
        customerContact,
        shippingAddress,
      } = req.body || {};

      if (!cartToken) return res.status(400).json({ error: "cartToken is required" });
      if (!deliveryMethod) return res.status(400).json({ error: "deliveryMethod is required" });
      if (!customerContact || !customerContact.name || !customerContact.phone) {
        return res.status(400).json({ error: "customerContact with name and phone is required" });
      }
      if (deliveryMethod === "pickup" && !pickupOutletId) {
        return res.status(400).json({ error: "pickupOutletId is required for pickup orders" });
      }
      if (deliveryMethod === "ship_to_customer" && (!shippingAddress || !shippingAddress.addressLine1 || !shippingAddress.city)) {
        return res.status(400).json({ error: "shippingAddress with addressLine1 and city is required for shipping" });
      }

      // 1. Validate cart exists and has items
      const { rows: cartRows } = await db.query(
        "SELECT * FROM storefront_carts WHERE cart_token = $1",
        [cartToken]
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
      const quote = await calculateQuote(
        db,
        cartItems,
        deliveryMethod,
        pickupOutletId || null,
        cart.channel_id
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
        if (deliveryMethod === "pickup") {
          fulfillmentOutletId = pickupOutletId;
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
            deliveryMethod, pickupOutletId || null, fulfillmentOutletId,
            customerContact.name, customerContact.phone, customerContact.email || null,
            shippingAddress ? JSON.stringify(shippingAddress) : null,
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
          if (deliveryMethod === "pickup") {
            stockOutletId = pickupOutletId;
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
          if (deliveryMethod === "ship_to_customer" && !fulfillmentOutletId) {
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
          if (deliveryMethod === "pickup") {
            outletId = pickupOutletId;
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
            [order.id, ai.webOrderItemId, outletId, deliveryMethod, ai.qty]
          );
        }

        // 12. Delete the cart (cascade deletes cart items)
        await client.query("DELETE FROM storefront_carts WHERE id = $1", [cart.id]);

        // 13. Return result
        return {
          orderId: order.id,
          orderToken: publicOrderToken,
          orderNumber: externalOrderId,
          grandTotal: Number(order.grand_total),
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
  // GET /api/storefront/orders/:orderToken — public order status lookup
  // ---------------------------------------------------------------------------
  app.get("/api/storefront/orders/:orderToken", async (req, res) => {
    try {
      const resolved = await resolveStorefrontDb(req);
      if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
      const { db } = resolved;

      const { rows: orderRows } = await db.query(
        `SELECT id, external_order_id, order_status, payment_status, fulfillment_status,
                delivery_method, grand_total, subtotal, tax_total, shipping_total, discount_total,
                customer_name_snapshot, ordered_at,
                pickup_ready_at, picked_up_at, curbside_arrived_at, currency
         FROM web_orders
         WHERE public_order_token = $1`,
        [req.params.orderToken]
      );

      if (!orderRows.length) return res.status(404).json({ error: "Order not found" });
      const order = orderRows[0];

      const { rows: items } = await db.query(
        `SELECT woi.id, woi.title, woi.qty, woi.unit_price, woi.discount, woi.tax, woi.line_total,
                woi.product_id, woi.variant_id, woi.sku
         FROM web_order_items woi
         WHERE woi.web_order_id = $1
         ORDER BY woi.id`,
        [order.id]
      );

      res.json({
        orderNumber: order.external_order_id,
        status: order.order_status,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        deliveryMethod: order.delivery_method,
        grandTotal: Number(order.grand_total),
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.tax_total),
        shippingTotal: Number(order.shipping_total),
        discountTotal: Number(order.discount_total),
        currency: order.currency,
        customerName: order.customer_name_snapshot,
        orderedAt: order.ordered_at,
        pickupReadyAt: order.pickup_ready_at,
        pickedUpAt: order.picked_up_at,
        curbsideArrivedAt: order.curbside_arrived_at,
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          qty: i.qty,
          unitPrice: Number(i.unit_price),
          discount: Number(i.discount),
          tax: Number(i.tax),
          lineTotal: Number(i.line_total),
          productId: i.product_id,
          variantId: i.variant_id,
          sku: i.sku,
        })),
      });
    } catch (err) {
      console.error("Storefront order lookup error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
