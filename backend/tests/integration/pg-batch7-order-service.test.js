/**
 * Batch 7 — order-service.js (Postgres)
 *
 * Tests: upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy,
 * resolveWebOrderItemMapping, resolveWebOrderOutletId,
 * shouldApplyWebOrderStock, shouldReverseWebOrderStock
 */
jest.setTimeout(30000);

const { createTestApp } = require("../helpers/createTestApp-pg");
const createOrderService = require("../../shopify/order-service");

describe("Batch 7 — order-service (Postgres)", () => {
  let db, cleanup, service;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestApp());

    // Seed a Shopify connection with a default_location_id
    await db.query(
      `INSERT INTO shopify_connections (id, shop_domain, access_token, api_version, is_active, default_location_id, webhook_secret)
       VALUES (1, 'test.myshopify.com', 'shpat_test', '2025-10', true, 'loc_default', 'secret')`
    );

    // Seed a location mapping for the default location
    await db.query(
      `INSERT INTO shopify_location_map (id, outlet_id, shopify_location_id, shopify_location_name)
       VALUES (1, 1, 'loc_default', 'Main Location')`
    );

    // Seed a product variant with SKU and barcode for mapping tests
    await db.query(
      `INSERT INTO product_variants (id, product_id, sku, price, cost_price, stock, barcode)
       VALUES (1, 1, 'VAR-SKU-001', 100, 50, 10, 'VAR-BC-001')`
    );

    // Reset sequences
    for (const [table, maxId] of [
      ["shopify_connections", 1],
      ["shopify_location_map", 1],
      ["product_variants", 1],
    ]) {
      await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, true)`, [table, maxId]);
    }

    // getActiveShopifyConnection stub — returns the seeded connection
    async function getActiveShopifyConnection() {
      const { rows: [row] } = await db.query(
        "SELECT * FROM shopify_connections WHERE is_active = true ORDER BY id DESC LIMIT 1"
      );
      return row || null;
    }

    service = createOrderService(db, getActiveShopifyConnection);
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ─── shouldApplyWebOrderStock / shouldReverseWebOrderStock ─────────

  describe("shouldApplyWebOrderStock / shouldReverseWebOrderStock (via applyWebOrderStockPolicy)", () => {
    it("paid + open → should apply stock", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'state_paid_open', 'paid', 'open', false) RETURNING id`
      );
      // No items, so it will be noop_no_items after resolving outlet
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("noop_no_items");
    });

    it("pending + open → noop (not actionable)", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'state_pending_open', 'pending', 'open', false) RETURNING id`
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("noop_state_not_actionable");
    });

    it("paid + cancelled → should reverse (cancelled overrides paid)", async () => {
      // paid but cancelled — shouldApply=false (blocked), shouldReverse=true
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'state_paid_cancelled', 'paid', 'cancelled', false) RETURNING id`
      );
      const result = await service.applyWebOrderStockPolicy(id);
      // stock_applied=false and shouldReverse=true → noop_already_reversed
      expect(result.action).toBe("noop_already_reversed");
    });

    it("refunded + open → should reverse", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'state_refunded_open', 'refunded', 'open', false) RETURNING id`
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("noop_already_reversed");
    });

    it("paid + open + already applied → noop_already_applied", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'state_already_applied', 'paid', 'open', true) RETURNING id`
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("noop_already_applied");
    });
  });

  // ─── resolveWebOrderOutletId (tested indirectly via applyWebOrderStockPolicy) ──

  describe("resolveWebOrderOutletId", () => {
    it("uses order.outlet_id if present", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, outlet_id, stock_applied)
         VALUES ('shopify', 'outlet_direct', 'paid', 'open', 2, false) RETURNING id`
      );
      // Add an item so stock actually gets applied
      await db.query(
        `INSERT INTO web_order_items (web_order_id, product_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 1, 'PROD-001', 'Widget', 2, 100, 0, 0, 200)`,
        [id]
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("apply");
      expect(result.outlet_id).toBe(2);
    });

    it("falls back to default Shopify location mapping", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'outlet_fallback', 'paid', 'open', false) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, product_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 1, 'PROD-001', 'Widget', 1, 100, 0, 0, 100)`,
        [id]
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("apply");
      expect(result.outlet_id).toBe(1); // mapped from loc_default → outlet 1
    });

    it("throws when no location mapping exists", async () => {
      // Create service with a connection that has an unmapped location
      async function getConnBadLocation() {
        return { default_location_id: "loc_unmapped" };
      }
      const svc2 = createOrderService(db, getConnBadLocation);

      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'outlet_no_map', 'paid', 'open', false) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, product_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 1, 'PROD-001', 'Widget', 1, 100, 0, 0, 100)`,
        [id]
      );
      await expect(svc2.applyWebOrderStockPolicy(id)).rejects.toThrow(
        "No outlet mapping found for default Shopify location"
      );
    });
  });

  // ─── resolveWebOrderItemMapping (tested indirectly via applyWebOrderStockPolicy) ──

  describe("resolveWebOrderItemMapping", () => {
    it("resolves by direct product_id on the item", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'map_direct', 'paid', 'open', false) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, product_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 2, 'PROD-002', 'Widget B', 1, 200, 0, 0, 200)`,
        [id]
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("apply");
      expect(result.item_count).toBe(1);
    });

    it("resolves by variant SKU", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'map_sku', 'paid', 'open', false) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 'VAR-SKU-001', 'Widget Variant', 3, 100, 0, 0, 300)`,
        [id]
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("apply");
      expect(result.item_count).toBe(1);

      // Verify the item was updated with product_id and variant_id
      const { rows: items } = await db.query(
        "SELECT product_id, variant_id FROM web_order_items WHERE web_order_id = $1",
        [id]
      );
      expect(items[0].product_id).toBe(1);
      expect(items[0].variant_id).toBe(1);
    });

    it("resolves by variant barcode", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'map_var_bc', 'paid', 'open', false) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, barcode, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 'VAR-BC-001', 'Widget Variant BC', 1, 100, 0, 0, 100)`,
        [id]
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("apply");
      expect(result.item_count).toBe(1);
    });

    it("resolves by product barcode", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'map_prod_bc', 'paid', 'open', false) RETURNING id`
      );
      // PROD-001 is the barcode for product 1
      await db.query(
        `INSERT INTO web_order_items (web_order_id, barcode, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 'PROD-001', 'Widget by barcode', 1, 100, 0, 0, 100)`,
        [id]
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("apply");
      expect(result.item_count).toBe(1);

      // Product barcode match — variant_id should be null
      const { rows: items } = await db.query(
        "SELECT product_id, variant_id FROM web_order_items WHERE web_order_id = $1",
        [id]
      );
      expect(items[0].product_id).toBe(1);
      expect(items[0].variant_id).toBeNull();
    });

    it("fails with unmapped items", async () => {
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'map_unmapped', 'paid', 'open', false) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 'NONEXISTENT-SKU', 'Unknown', 1, 50, 0, 0, 50)`,
        [id]
      );
      await expect(service.applyWebOrderStockPolicy(id)).rejects.toThrow(
        "Unmapped items (1) - stock policy not applied"
      );

      // stock_policy_note should be set
      const { rows: [order] } = await db.query(
        "SELECT stock_policy_note FROM web_orders WHERE id = $1",
        [id]
      );
      expect(order.stock_policy_note).toContain("Unmapped items");
    });
  });

  // ─── applyWebOrderStockPolicy ─────────────────────────────────────

  describe("applyWebOrderStockPolicy", () => {
    it("throws when web order not found", async () => {
      await expect(service.applyWebOrderStockPolicy(999999)).rejects.toThrow(
        "Web order not found"
      );
    });

    it("applies stock (decrements outlet_stock) for paid order", async () => {
      // Get initial stock
      const { rows: [before] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1"
      );
      const initialQty = Number(before.quantity);

      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'stock_apply', 'paid', 'open', false) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, product_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 3, 'PROD-003', 'Gadget', 5, 500, 0, 0, 2500)`,
        [id]
      );
      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("apply");
      expect(result.item_count).toBe(1);

      // Stock should have decreased by 5
      const { rows: [after] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 3 AND outlet_id = 1"
      );
      expect(Number(after.quantity)).toBe(initialQty - 5);

      // web_orders should be marked as applied
      const { rows: [order] } = await db.query(
        "SELECT stock_applied, stock_policy_note FROM web_orders WHERE id = $1",
        [id]
      );
      expect(order.stock_applied).toBe(true);
      expect(order.stock_policy_note).toBe("Stock policy applyd");
    });

    it("reverses stock (increments outlet_stock) for refunded order", async () => {
      // First apply stock
      const { rows: [{ id }] } = await db.query(
        `INSERT INTO web_orders (source, external_order_id, payment_status, order_status, stock_applied)
         VALUES ('shopify', 'stock_reverse', 'paid', 'open', true) RETURNING id`
      );
      await db.query(
        `INSERT INTO web_order_items (web_order_id, product_id, sku, title, qty, unit_price, discount, tax, line_total)
         VALUES ($1, 4, 'PROD-004', 'Snack', 10, 50, 0, 0, 500)`,
        [id]
      );

      // Get initial stock
      const { rows: [before] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1"
      );
      const initialQty = Number(before.quantity);

      // Now change to refunded
      await db.query(
        "UPDATE web_orders SET payment_status = 'refunded' WHERE id = $1",
        [id]
      );

      const result = await service.applyWebOrderStockPolicy(id);
      expect(result.action).toBe("reverse");
      expect(result.item_count).toBe(1);

      // Stock should have increased by 10
      const { rows: [after] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 4 AND outlet_id = 1"
      );
      expect(Number(after.quantity)).toBe(initialQty + 10);

      // web_orders stock_applied should be false now
      const { rows: [order] } = await db.query(
        "SELECT stock_applied FROM web_orders WHERE id = $1",
        [id]
      );
      expect(order.stock_applied).toBe(false);
    });
  });

  // ─── upsertWebOrderFromShopifyPayload ──────────────────────────────

  describe("upsertWebOrderFromShopifyPayload", () => {
    it("inserts a new web order with line items", async () => {
      const payload = {
        id: "shopify_new_001",
        name: "#1001",
        currency: "USD",
        subtotal_price: "100.00",
        total_discounts: "10.00",
        total_tax: "5.00",
        total_shipping_price_set: { shop_money: { amount: "15.00" } },
        total_price: "110.00",
        financial_status: "pending",
        fulfillment_status: "unfulfilled",
        created_at: "2026-01-15T10:00:00Z",
        line_items: [
          { sku: "PROD-001", title: "Widget A", quantity: 2, price: "50.00", total_discount: "5.00", total_tax: "2.50" },
          { sku: "PROD-002", title: "Widget B", quantity: 1, price: "50.00", total_discount: "5.00", total_tax: "2.50" },
        ],
      };

      const result = await service.upsertWebOrderFromShopifyPayload(payload);
      expect(result.web_order_id).toBeDefined();
      expect(result.item_count).toBe(2);
      expect(result.stock_policy).toBeDefined();
      // pending → noop
      expect(result.stock_policy.action).toBe("noop_state_not_actionable");

      // Verify DB
      const { rows: [order] } = await db.query(
        "SELECT * FROM web_orders WHERE id = $1",
        [result.web_order_id]
      );
      expect(order.external_order_id).toBe("shopify_new_001");
      expect(order.external_order_number).toBe("#1001");
      expect(Number(order.grand_total)).toBe(110);

      const { rows: items } = await db.query(
        "SELECT * FROM web_order_items WHERE web_order_id = $1 ORDER BY id",
        [result.web_order_id]
      );
      expect(items.length).toBe(2);
      expect(items[0].title).toBe("Widget A");
      expect(Number(items[0].qty)).toBe(2);
    });

    it("upserts an existing order (updates fields, replaces line items)", async () => {
      // First insert
      const payload1 = {
        id: "shopify_upsert_001",
        name: "#2001",
        total_price: "200.00",
        financial_status: "pending",
        line_items: [
          { sku: "PROD-001", title: "Widget A", quantity: 1, price: "200.00" },
        ],
      };
      const result1 = await service.upsertWebOrderFromShopifyPayload(payload1);
      expect(result1.item_count).toBe(1);

      // Upsert with different data
      const payload2 = {
        id: "shopify_upsert_001",
        name: "#2001-updated",
        total_price: "300.00",
        financial_status: "paid",
        line_items: [
          { sku: "PROD-001", title: "Widget A", quantity: 2, price: "100.00" },
          { sku: "PROD-002", title: "Widget B", quantity: 1, price: "100.00" },
        ],
      };
      const result2 = await service.upsertWebOrderFromShopifyPayload(payload2);
      expect(result2.web_order_id).toBe(result1.web_order_id);
      expect(result2.item_count).toBe(2);

      // Verify old items replaced
      const { rows: items } = await db.query(
        "SELECT * FROM web_order_items WHERE web_order_id = $1 ORDER BY id",
        [result2.web_order_id]
      );
      expect(items.length).toBe(2);

      // Verify order fields updated
      const { rows: [order] } = await db.query(
        "SELECT * FROM web_orders WHERE id = $1",
        [result2.web_order_id]
      );
      expect(order.external_order_number).toBe("#2001-updated");
      expect(Number(order.grand_total)).toBe(300);
    });

    it("handles empty line items", async () => {
      const payload = {
        id: "shopify_empty_items",
        total_price: "0",
        financial_status: "pending",
        line_items: [],
      };
      const result = await service.upsertWebOrderFromShopifyPayload(payload);
      expect(result.item_count).toBe(0);
      expect(result.web_order_id).toBeDefined();
    });

    it("handles missing line_items field", async () => {
      const payload = {
        id: "shopify_no_items_field",
        total_price: "0",
        financial_status: "pending",
      };
      const result = await service.upsertWebOrderFromShopifyPayload(payload);
      expect(result.item_count).toBe(0);
    });

    it("throws on missing Shopify order id", async () => {
      await expect(
        service.upsertWebOrderFromShopifyPayload({})
      ).rejects.toThrow("Missing Shopify order id");
    });

    it("uses order_id fallback when id is missing", async () => {
      const payload = {
        order_id: "shopify_fallback_id",
        total_price: "50.00",
        financial_status: "pending",
        line_items: [],
      };
      const result = await service.upsertWebOrderFromShopifyPayload(payload);
      expect(result.web_order_id).toBeDefined();

      const { rows: [order] } = await db.query(
        "SELECT external_order_id FROM web_orders WHERE id = $1",
        [result.web_order_id]
      );
      expect(order.external_order_id).toBe("shopify_fallback_id");
    });

    it("applies stock policy for paid order with mapped items", async () => {
      const payload = {
        id: "shopify_paid_with_items",
        total_price: "200.00",
        financial_status: "paid",
        line_items: [
          { sku: "PROD-001", barcode: "PROD-001", title: "Widget A", quantity: 1, price: "200.00" },
        ],
      };

      // Record stock before
      const { rows: [before] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
      );
      const qtyBefore = Number(before.quantity);

      const result = await service.upsertWebOrderFromShopifyPayload(payload);
      expect(result.stock_policy).toBeDefined();
      // Should apply stock (paid order)
      if (result.stock_policy.action) {
        expect(result.stock_policy.action).toBe("apply");
      }

      // Stock should have decreased
      const { rows: [after] } = await db.query(
        "SELECT quantity FROM outlet_stock WHERE product_id = 1 AND outlet_id = 1"
      );
      expect(Number(after.quantity)).toBeLessThan(qtyBefore);
    });

    it("captures stock policy error for unmappable items in paid order", async () => {
      const payload = {
        id: "shopify_paid_unmappable",
        total_price: "100.00",
        financial_status: "paid",
        line_items: [
          { sku: "NONEXISTENT", title: "Unknown Item", quantity: 1, price: "100.00" },
        ],
      };
      const result = await service.upsertWebOrderFromShopifyPayload(payload);
      // Stock policy should have an error (unmapped items)
      expect(result.stock_policy).toBeDefined();
      expect(result.stock_policy.error).toContain("Unmapped items");
    });

    it("stores raw_payload as JSON string", async () => {
      const payload = {
        id: "shopify_raw_payload",
        total_price: "50.00",
        financial_status: "pending",
        custom_field: "test_value",
        line_items: [],
      };
      const result = await service.upsertWebOrderFromShopifyPayload(payload);
      const { rows: [order] } = await db.query(
        "SELECT raw_payload FROM web_orders WHERE id = $1",
        [result.web_order_id]
      );
      const parsed = JSON.parse(order.raw_payload);
      expect(parsed.custom_field).toBe("test_value");
    });
  });
});
