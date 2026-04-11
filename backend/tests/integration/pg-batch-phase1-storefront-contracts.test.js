/**
 * pg-batch-phase1-storefront-contracts.test.js — Wave 3 Batch 3B regression coverage
 *
 * Covers two Phase 1 findings closed in review-fixes branch:
 *
 *   C1 — POST /api/orders/endless-aisle expected {items[], customerId,
 *        deliveryMethod, pickupOutletId, shippingAddress, customerContact}
 *        in camelCase but the EndlessAisleModal was sending a flat snake_case
 *        body with a completely different shape. Every endless-aisle order
 *        400'd at the first `if (!items || !items.length)` check. Also fixed
 *        a drive-by enum mismatch: modal state "pickup_at_store" vs.
 *        backend delivery_method "pickup".
 *
 *   C2 — GET /api/storefront/config returned camelCase keys
 *        ({companyName, logoUrl, currencySymbol, deliveryMethods, pickupEnabled})
 *        but all 7 storefront frontend pages read snake_case. Fix: rename
 *        the 5 response keys to snake_case.
 *
 * Tests hit real Postgres via createTestApp-pg.js. The storefront test
 * deletes process.env.MULTI_TENANT before first `require("../../routes/storefront")`
 * so public-tenant-context.js captures the single-tenant branch at module
 * load (same pattern as pg-batch13-restaurant.test.js lines 439-458).
 */

// Capture MULTI_TENANT now so we can restore it in afterAll. We can't delete
// here: createTestApp-pg.js transitively requires db-pg.js which reloads
// .env via dotenv, re-injecting MULTI_TENANT=1. The effective delete has to
// happen inside beforeAll AFTER createTestApp but BEFORE storefront's first
// require (which transitively loads public-tenant-context.js, whose
// IS_MULTI_TENANT constant is frozen at module-load time).
const origMultiTenant = process.env.MULTI_TENANT;

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

jest.setTimeout(60000);

describe("Wave 3 Batch 3B — Phase 1 storefront contracts", () => {
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

    // Delete MULTI_TENANT here — after createTestApp (which triggered
    // dotenv re-load via db-pg) and before the storefront require (which
    // transitively loads public-tenant-context.js for the first time).
    delete process.env.MULTI_TENANT;

    // Mount both routes. Orders route destructures many Shopify deps from
    // `deps` but the factory already stubs them via shopifyStubs.
    require("../../routes/orders")(app, deps);
    require("../../routes/storefront")(app, deps);

    // Populate company_profile with non-default values so the /storefront/config
    // response actually carries distinguishable data. The factory seeds the
    // row with just company_name; we UPDATE here to add logo_url + currency_symbol.
    await db.query(
      `UPDATE company_profile
         SET company_name = 'Batch 3B Test Store',
             logo_url = 'https://example.com/logo.webp',
             currency_symbol = 'XYZ'
       WHERE id = 1`
    );
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
    if (origMultiTenant !== undefined) process.env.MULTI_TENANT = origMultiTenant;
  });

  // ───────────────────────────────────────────────────────────────
  // C1 — endless-aisle accepts the frontend's fixed body shape
  // ───────────────────────────────────────────────────────────────
  describe("C1 — POST /api/orders/endless-aisle accepts the aligned body", () => {
    it("ship_to_customer branch: items[] + customerContact + shippingAddress object materializes web_order + allocation", async () => {
      // The factory seeds product 1 with outlet_stock at outlet 1 (qty 50)
      // and outlet 2 (qty 10). The endless-aisle route picks the outlet
      // with the most stock, so we expect outlet 1 to win.
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/orders/endless-aisle")
        .send({
          items: [{ productId: 1, variantId: null, qty: 2 }],
          customerId: 1,
          deliveryMethod: "ship_to_customer",
          pickupOutletId: null,
          shippingAddress: {
            line1: "123 Test Street",
            city: "Lahore",
            note: "Integration test order",
          },
          customerContact: {
            name: "Batch 3B Ship",
            phone: "0300-1111111",
            email: "ship@batch3b.test",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.orderId).toBeDefined();
      expect(res.body.externalOrderId).toMatch(/^ea_/);
      expect(res.body.publicOrderToken).toBeDefined();

      // Verify the web_order row landed with the expected snapshot fields.
      const { rows: [order] } = await db.query(
        "SELECT * FROM web_orders WHERE id = $1",
        [res.body.orderId]
      );
      expect(order).toBeDefined();
      expect(order.delivery_method).toBe("ship_to_customer");
      expect(order.customer_id).toBe(1);
      expect(order.customer_name_snapshot).toBe("Batch 3B Ship");
      expect(order.customer_phone_snapshot).toBe("0300-1111111");
      expect(order.customer_email_snapshot).toBe("ship@batch3b.test");
      expect(order.shipping_address_json).toBeDefined();
      const addr = typeof order.shipping_address_json === "string"
        ? JSON.parse(order.shipping_address_json)
        : order.shipping_address_json;
      expect(addr.line1).toBe("123 Test Street");
      expect(addr.city).toBe("Lahore");

      // Verify one allocation row with fulfillment_outlet_id = 1 (highest stock).
      const { rows: allocations } = await db.query(
        "SELECT * FROM web_order_allocations WHERE web_order_id = $1",
        [res.body.orderId]
      );
      expect(allocations).toHaveLength(1);
      expect(allocations[0].fulfillment_outlet_id).toBe(1);
      expect(Number(allocations[0].allocated_qty)).toBe(2);
    });

    it("pickup branch: deliveryMethod='pickup' + pickupOutletId routes allocation to that outlet", async () => {
      // Force a pickup to outlet 2 (which has qty 10 for product 1, enough
      // for a qty=3 order). This exercises the "pickup_at_store" → "pickup"
      // enum fix: if the modal state still used "pickup_at_store", the backend
      // validation at routes/orders.js:1086 would 400.
      const res = await makeRequest(app, ADMIN_ID)
        .post("/api/orders/endless-aisle")
        .send({
          items: [{ productId: 1, variantId: null, qty: 3 }],
          customerId: 1,
          deliveryMethod: "pickup",
          pickupOutletId: 2,
          shippingAddress: null,
          customerContact: {
            name: "Batch 3B Pickup",
            phone: "0300-2222222",
            email: null,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.orderId).toBeDefined();

      const { rows: [order] } = await db.query(
        "SELECT delivery_method, pickup_outlet_id FROM web_orders WHERE id = $1",
        [res.body.orderId]
      );
      expect(order.delivery_method).toBe("pickup");
      expect(order.pickup_outlet_id).toBe(2);

      const { rows: allocations } = await db.query(
        "SELECT fulfillment_outlet_id, allocated_qty FROM web_order_allocations WHERE web_order_id = $1",
        [res.body.orderId]
      );
      expect(allocations).toHaveLength(1);
      expect(allocations[0].fulfillment_outlet_id).toBe(2);
      expect(Number(allocations[0].allocated_qty)).toBe(3);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // C2 — storefront/config returns snake_case keys
  // ───────────────────────────────────────────────────────────────
  describe("C2 — GET /api/storefront/config returns snake_case keys", () => {
    it("response includes company_name, logo_url, currency_symbol (no camelCase keys)", async () => {
      // No auth header — storefront config is public.
      const res = await makeRequest(app).get("/api/storefront/config");

      expect(res.status).toBe(200);

      // Snake_case keys must be present with the seeded values.
      expect(res.body.company_name).toBe("Batch 3B Test Store");
      expect(res.body.logo_url).toBe("https://example.com/logo.webp");
      expect(res.body.currency_symbol).toBe("XYZ");
      expect(res.body.delivery_methods).toEqual(["pickup", "ship_to_customer"]);
      expect(res.body.pickup_enabled).toBe(true);
      expect(res.body.currency).toBe("PKR");

      // CamelCase variants must NOT be present — would indicate regression.
      expect(res.body.companyName).toBeUndefined();
      expect(res.body.logoUrl).toBeUndefined();
      expect(res.body.currencySymbol).toBeUndefined();
      expect(res.body.deliveryMethods).toBeUndefined();
      expect(res.body.pickupEnabled).toBeUndefined();
    });
  });
});
