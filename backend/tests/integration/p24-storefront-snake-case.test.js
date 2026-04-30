/**
 * P24 — Storefront API response shapes must use snake_case to match what
 * the storefront frontend pages actually read.
 *
 * Context: Phase 7.3 walkthrough surfaced a systemic camelCase/snake_case
 * mismatch across multiple storefront endpoints. The frontend was written
 * against a snake_case shape (matching codebase convention), but the
 * storefront product/category routes returned camelCase. Result: every
 * storefront product image, strikethrough price, in-stock badge, pickup
 * availability table, and review row was silently broken on production.
 *
 * Same root-cause class as the Phase 1 C2 fix that already corrected
 * /api/storefront/config — see pg-batch-phase1-storefront-contracts.test.js.
 *
 * This regression test pins three endpoints:
 *   - GET /api/storefront/categories — must return an array (not wrapped)
 *   - GET /api/storefront/products    — list shape uses snake_case
 *   - GET /api/storefront/products/:id — detail shape uses snake_case
 *
 * Same MULTI_TENANT trickery as the Phase 1 contracts test.
 */
const origMultiTenant = process.env.MULTI_TENANT;

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest } = require("../helpers/request");

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("P24 — storefront response shapes (snake_case)", () => {
  let app;
  let db;
  let deps;
  let cleanup;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    deps = ctx.deps;
    cleanup = ctx.cleanup;

    // Same pattern as Phase 1 contracts test: delete MULTI_TENANT after
    // createTestApp triggers dotenv re-load and BEFORE the storefront
    // require (which freezes IS_MULTI_TENANT at module load).
    delete process.env.MULTI_TENANT;

    require("../../routes/storefront")(app, deps);

    // Seed a category, a product published to the storefront channel,
    // and a review for the detail endpoint.
    await db.query(
      `INSERT INTO categories (id, name, sort_order, is_active)
       VALUES (50, 'P24 Test Cat', 1, true)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, is_active = true`
    );

    await db.query(
      `INSERT INTO products (id, name, price, compare_at_price, image_url, category_id, status)
       VALUES (500, 'P24 Test Product', 199.99, 299.99,
               'https://api.example.com/r2/products/p24.webp', 50, 'active')
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             price = EXCLUDED.price,
             compare_at_price = EXCLUDED.compare_at_price,
             image_url = EXCLUDED.image_url,
             category_id = EXCLUDED.category_id,
             status = EXCLUDED.status`
    );

    // Stock so in_stock = true and pickup availability shows the outlet
    await db.query(
      `INSERT INTO outlet_stock (outlet_id, product_id, quantity)
       SELECT o.id, 500, 5 FROM outlets o
       ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 5`
    );

    // Publish to storefront channel
    const { rows: ch } = await db.query(
      `SELECT id FROM sales_channels WHERE code = 'storefront' LIMIT 1`
    );
    if (ch.length) {
      // No UNIQUE constraint on (product_id, channel_id); just insert.
      await db.query(
        `INSERT INTO channel_publications (product_id, channel_id, is_published)
         VALUES (500, $1, true)`,
        [ch[0].id]
      );
    }

    // Approved review for the detail endpoint
    await db.query(
      `INSERT INTO product_reviews (id, product_id, customer_name, rating, title, body, status, created_at)
       VALUES (5000, 500, 'Alice Tester', 4, 'Solid', 'Worked great', 'approved', NOW())
       ON CONFLICT (id) DO NOTHING`
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
    if (origMultiTenant !== undefined) process.env.MULTI_TENANT = origMultiTenant;
  });

  // ───────────────────────────────────────────────────────────────
  // /categories — response is a bare array (not { categories: [...] })
  // ───────────────────────────────────────────────────────────────
  describe("GET /api/storefront/categories", () => {
    it("returns a bare array of categories (not wrapped in an object)", async () => {
      const res = await makeRequest(app).get("/api/storefront/categories");
      expect(res.status).toBe(200);
      // Must be a top-level array — StorefrontLayout.jsx does `Array.isArray(catData)`
      // and falls back to [] otherwise (so wrapped shape silently empties the nav).
      expect(Array.isArray(res.body)).toBe(true);
      const cat = res.body.find((c) => c.id === 50);
      expect(cat).toBeDefined();
      expect(cat.name).toBe("P24 Test Cat");
    });
  });

  // ───────────────────────────────────────────────────────────────
  // /products (list) — snake_case keys, includes in_stock boolean
  // ───────────────────────────────────────────────────────────────
  describe("GET /api/storefront/products", () => {
    it("returns snake_case product list with in_stock boolean", async () => {
      const res = await makeRequest(app).get("/api/storefront/products");
      expect(res.status).toBe(200);
      const product = res.body.products.find((p) => p.id === 500);
      expect(product).toBeDefined();

      // Snake_case keys must be present
      expect(product.image_url).toBe("https://api.example.com/r2/products/p24.webp");
      expect(product.compare_at_price).toBe(299.99);
      expect(product.category_id).toBe(50);
      expect(product.category_name).toBe("P24 Test Cat");
      expect(product.in_stock).toBe(true);

      // CamelCase variants must NOT be present (regression guard)
      expect(product.imageUrl).toBeUndefined();
      expect(product.compareAtPrice).toBeUndefined();
      expect(product.categoryId).toBeUndefined();
      expect(product.categoryName).toBeUndefined();
      expect(product.inStock).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────
  // /products/:id (detail) — snake_case keys + frontend-shaped sub-objects
  // ───────────────────────────────────────────────────────────────
  describe("GET /api/storefront/products/:id", () => {
    it("returns snake_case product detail", async () => {
      const res = await makeRequest(app).get("/api/storefront/products/500");
      expect(res.status).toBe(200);
      const p = res.body;

      expect(p.image_url).toBe("https://api.example.com/r2/products/p24.webp");
      expect(p.compare_at_price).toBe(299.99);
      expect(p.category_id).toBe(50);
      expect(p.category_name).toBe("P24 Test Cat");

      // Regression guard
      expect(p.imageUrl).toBeUndefined();
      expect(p.compareAtPrice).toBeUndefined();
      expect(p.categoryId).toBeUndefined();
      expect(p.categoryName).toBeUndefined();
      expect(p.brandId).toBeUndefined();
      expect(p.brandName).toBeUndefined();
    });

    it("returns reviews[] using { author, text } shape that the frontend reads", async () => {
      const res = await makeRequest(app).get("/api/storefront/products/500");
      expect(res.status).toBe(200);
      const review = res.body.reviews.find((r) => r.id === 5000);
      expect(review).toBeDefined();
      expect(review.author).toBe("Alice Tester");
      expect(review.text).toBe("Worked great");
      expect(review.rating).toBe(4);
      // Regression guard — frontend reads `review.author` not `customerName`,
      // `review.text` not `body`.
      expect(review.customerName).toBeUndefined();
      expect(review.body).toBeUndefined();
    });

    it("returns availability[] (not pickupAvailability) with snake_case sub-keys", async () => {
      const res = await makeRequest(app).get("/api/storefront/products/500");
      expect(res.status).toBe(200);
      // StorefrontProductDetail.jsx reads `product.availability`, not `pickupAvailability`.
      expect(Array.isArray(res.body.availability)).toBe(true);
      expect(res.body.pickupAvailability).toBeUndefined();
      const loc = res.body.availability[0];
      expect(loc).toBeDefined();
      // Frontend reads `loc.outlet_name` and `loc.in_stock`.
      expect(typeof loc.outlet_name).toBe("string");
      expect(typeof loc.in_stock).toBe("boolean");
      expect(loc.outletName).toBeUndefined();
      expect(loc.inStock).toBeUndefined();
    });
  });
});
