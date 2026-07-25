/**
 * Storefront public smoke — regression guard for the Apr 9-11 2026 contract-mismatch
 * bug (commits 0a64e33, bc4ee08, f313daf, 4e73061). Walks the anonymous buyer path:
 * browse → product detail → add to cart → quote → checkout → order status lookup.
 *
 * Setup uses the authenticated admin context (default storageState) to seed one
 * SMOKE- prefixed product, stock it, and publish it to the storefront channel.
 * The actual buyer walk uses a separate anonymous browser context so the stored
 * auth.json cookies do NOT leak into the public flow.
 */
import { test, expect } from "@playwright/test";
import { STORE_CODE as TENANT } from "../helpers/auth.js";
import { get, post, put } from "../helpers/api.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const STORE_BASE = `/store/${TENANT}`;

let seededProductId = null;
let storefrontChannelId = null;
let pickupOutletId = null;

test.describe("Storefront public buyer flow smoke", () => {
  test.beforeAll(async () => {
    const productName = prefix("Storefront Product");
    const createRes = await post("/api/products", {
      name: productName,
      price: 999,
      cost_price: 500,
      gst: 0,
    });
    expect(createRes.ok, `product create: ${JSON.stringify(createRes.data)}`).toBe(true);
    seededProductId = createRes.data?.id || createRes.data?.productId || createRes.data?.product?.id;
    expect(seededProductId, "product id").toBeTruthy();
    trackForCleanup("product", seededProductId);

    const outletsRes = await get("/api/outlets");
    expect(outletsRes.ok, "outlets list").toBe(true);
    const outlets = outletsRes.data?.outlets || outletsRes.data || [];
    const activeOutlet = outlets.find((o) => o.is_active !== false) || outlets[0];
    expect(activeOutlet, "at least one outlet").toBeTruthy();
    pickupOutletId = activeOutlet.id;

    const adjRes = await post("/api/adjustments", {
      product_id: seededProductId,
      outlet_id: pickupOutletId,
      quantity_change: 10,
      reason: "smoke test stock seed",
    });
    expect(adjRes.ok, `stock seed: ${JSON.stringify(adjRes.data)}`).toBe(true);

    const channelsRes = await get(`/api/products/${seededProductId}/channels`);
    expect(channelsRes.ok, "product channels list").toBe(true);
    const storefrontChannel = (channelsRes.data?.channels || []).find((c) => c.code === "storefront");
    expect(storefrontChannel, "storefront channel row").toBeTruthy();
    storefrontChannelId = storefrontChannel.id;

    const pubRes = await put(`/api/products/${seededProductId}/channels`, {
      channels: [{ channelId: storefrontChannelId, isPublished: true }],
    });
    expect(pubRes.ok, `publish to storefront: ${JSON.stringify(pubRes.data)}`).toBe(true);
  });

  test.afterAll(async () => {
    await cleanupAll();
  });

  test("public storefront config returns expected shape", async () => {
    const res = await fetch(`https://api.sanopos.com/api/storefront/config?tenant=${TENANT}`);
    expect(res.status, "storefront config status").toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      companyName: expect.any(String),
      currency: expect.any(String),
    });
    expect(Array.isArray(data.deliveryMethods), "deliveryMethods is array").toBe(true);
  });

  test("full buyer walk: browse → detail → cart → quote → checkout → order status", async ({ browser }) => {
    const anon = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      baseURL: "https://sanopos.com",
    });
    const page = await anon.newPage();

    try {
      // 1. Landing page renders
      await page.goto(STORE_BASE);
      await page.waitForLoadState("networkidle");

      // 2. Browse products via API to locate the seeded product id
      const listRes = await fetch(
        `https://api.sanopos.com/api/storefront/products?tenant=${TENANT}&search=${encodeURIComponent(prefix("Storefront"))}`,
      );
      expect(listRes.status, "storefront products list status").toBe(200);
      const listData = await listRes.json();
      const listed = (listData.products || []).find((p) => p.id === seededProductId);
      expect(listed, "seeded product appears in public listing").toBeTruthy();
      expect(listed).toMatchObject({
        id: seededProductId,
        name: expect.any(String),
        price: expect.any(Number),
      });
      expect(typeof listed.inStock, "inStock is boolean").toBe("boolean");
      expect(listed.inStock, "seeded product is in stock").toBe(true);

      // 3. Product detail via API — verify camelCase contract
      const detailRes = await fetch(
        `https://api.sanopos.com/api/storefront/products/${seededProductId}?tenant=${TENANT}`,
      );
      expect(detailRes.status, "product detail status").toBe(200);
      const detail = await detailRes.json();
      expect(detail).toMatchObject({
        id: seededProductId,
        name: expect.any(String),
        price: expect.any(Number),
      });
      expect(Array.isArray(detail.pickupAvailability), "pickupAvailability is array").toBe(true);

      // 4. Create anonymous cart
      const cartCreate = await fetch(`https://api.sanopos.com/api/storefront/cart?tenant=${TENANT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(cartCreate.status, "cart create status").toBe(200);
      const cart = await cartCreate.json();
      expect(cart.token, "cart token returned").toBeTruthy();
      const cartToken = cart.token;

      // 5. Add item to cart
      const addItemRes = await fetch(
        `https://api.sanopos.com/api/storefront/cart/${cartToken}/items?tenant=${TENANT}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: seededProductId, quantity: 2 }),
        },
      );
      expect(addItemRes.status, "add item status").toBe(200);
      const cartAfterAdd = await addItemRes.json();
      expect(Array.isArray(cartAfterAdd.items), "cart.items array").toBe(true);
      expect(cartAfterAdd.items.length, "one line").toBe(1);

      // 6. Request quote — verifies price, tax, shipping wiring
      const quoteRes = await fetch(
        `https://api.sanopos.com/api/storefront/cart/${cartToken}/quote?tenant=${TENANT}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            delivery_method: "pickup",
            pickup_outlet_id: pickupOutletId,
          }),
        },
      );
      expect(quoteRes.status, "quote status").toBe(200);
      const quote = await quoteRes.json();
      expect(quote).toMatchObject({
        subtotal: expect.any(Number),
        discountTotal: expect.any(Number),
        taxTotal: expect.any(Number),
        shippingTotal: expect.any(Number),
        grandTotal: expect.any(Number),
      });
      expect(quote.grandTotal, "grandTotal > 0").toBeGreaterThan(0);

      // 7. Checkout — this is the call that was broken by the contract-mismatch bug
      const checkoutRes = await fetch(`https://api.sanopos.com/api/storefront/checkout?tenant=${TENANT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart_token: cartToken,
          delivery_method: "pickup",
          pickup_outlet_id: pickupOutletId,
          customer_name: prefix("Buyer"),
          customer_phone: "03001234567",
          customer_email: "smoke@example.com",
        }),
      });
      expect(checkoutRes.status, `checkout status (body: ${await checkoutRes.clone().text()})`).toBe(201);
      const order = await checkoutRes.json();
      expect(order).toMatchObject({
        order_id: expect.any(Number),
        order_token: expect.any(String),
        order_number: expect.any(String),
        grand_total: expect.any(Number),
        payment_enabled: expect.any(Boolean),
      });
      expect(order.grand_total, "order grand_total matches quote").toBe(quote.grandTotal);

      // 8. Order status lookup by public token
      const statusRes = await fetch(
        `https://api.sanopos.com/api/storefront/orders/${order.order_token}?tenant=${TENANT}`,
      );
      expect(statusRes.status, "order status lookup").toBe(200);
      const status = await statusRes.json();
      expect(status.id || status.order_id, "order id present").toBeTruthy();

      // 9. Order status page renders without error in the anonymous browser
      await page.goto(`${STORE_BASE}/order/${order.order_token}`);
      await page.waitForLoadState("networkidle");
      const body = await page.locator("body").innerText();
      expect(body.length, "order page has content").toBeGreaterThan(20);
      expect(body.toLowerCase(), "no JSON-parse or fetch error in page").not.toMatch(/unexpected token|failed to fetch/);
    } finally {
      await anon.close();
    }
  });
});
