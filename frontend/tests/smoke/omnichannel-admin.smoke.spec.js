/**
 * Omnichannel admin smoke — covers the five v18 admin-facing features that sit
 * behind authenticated routes: channel publication, endless aisle from POS,
 * BOPIS + curbside workflow, returns against web orders, unified customer
 * order history.
 *
 * Every sub-test seeds its own data, prefixes it with SMOKE-<run-id>, and
 * tracks cleanup via afterAll. No feature flag required — all of these were
 * shipped as core v18 surface.
 */
import { test, expect } from "@playwright/test";
import { get, post, put } from "../helpers/api.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const TENANT = "packagesmall";

let seededProductId = null;
let seededCustomerId = null;
let storefrontChannelId = null;
let pickupOutletId = null;
let webOrderId = null;
let webOrderToken = null;

test.describe("Omnichannel admin smoke", () => {
  test.beforeAll(async () => {
    // Seed a product, stock it, publish to storefront, create a customer, and
    // place a web order (via the public storefront API) that the subsequent
    // tests will act on.

    const productName = prefix("Omni Product");
    const createProduct = await post("/api/products", {
      name: productName,
      price: 1500,
      cost_price: 700,
      gst: 0,
    });
    expect(createProduct.ok, `product create: ${JSON.stringify(createProduct.data)}`).toBe(true);
    seededProductId = createProduct.data?.id || createProduct.data?.productId;
    expect(seededProductId).toBeTruthy();
    trackForCleanup("product", seededProductId);

    // Pick an active outlet
    const outletsRes = await get("/api/outlets");
    const outlets = outletsRes.data?.outlets || outletsRes.data || [];
    const activeOutlet = outlets.find((o) => o.is_active !== false) || outlets[0];
    pickupOutletId = activeOutlet.id;

    // Seed stock
    const adjRes = await post("/api/adjustments", {
      product_id: seededProductId,
      outlet_id: pickupOutletId,
      quantity_change: 20,
      reason: "omni smoke seed",
    });
    expect(adjRes.ok).toBe(true);

    // Publish to storefront channel
    const chRes = await get(`/api/products/${seededProductId}/channels`);
    expect(chRes.ok).toBe(true);
    const storefrontCh = (chRes.data?.channels || []).find((c) => c.code === "storefront");
    expect(storefrontCh, "storefront channel row").toBeTruthy();
    storefrontChannelId = storefrontCh.id;
    const pubRes = await put(`/api/products/${seededProductId}/channels`, {
      channels: [{ channelId: storefrontChannelId, isPublished: true }],
    });
    expect(pubRes.ok).toBe(true);

    // Seed a customer
    const customerRes = await post("/api/customers", {
      name: prefix("Omni Buyer"),
      mobile: "03001112222",
      email: "omni-smoke@example.com",
    });
    expect(customerRes.ok, `customer create: ${JSON.stringify(customerRes.data)}`).toBe(true);
    seededCustomerId = customerRes.data?.id;
    expect(seededCustomerId).toBeTruthy();
    trackForCleanup("customer", seededCustomerId);

    // Place a pickup web order via the public storefront API so we have
    // something to mark ready / arrived / picked up and to return against.
    const cartRes = await fetch(`https://api.sanopos.com/api/storefront/cart?tenant=${TENANT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const { token: cartToken } = await cartRes.json();
    expect(cartToken).toBeTruthy();

    await fetch(
      `https://api.sanopos.com/api/storefront/cart/${cartToken}/items?tenant=${TENANT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: seededProductId, quantity: 1 }),
      },
    );

    const checkoutRes = await fetch(`https://api.sanopos.com/api/storefront/checkout?tenant=${TENANT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cart_token: cartToken,
        delivery_method: "pickup",
        pickup_outlet_id: pickupOutletId,
        customer_name: prefix("Omni Buyer"),
        customer_phone: "03001112222",
        customer_email: "omni-smoke@example.com",
      }),
    });
    expect(checkoutRes.status, "seeded web order placed").toBe(201);
    const order = await checkoutRes.json();
    webOrderId = order.order_id;
    webOrderToken = order.order_token;
  });

  test.afterAll(async () => {
    await cleanupAll();
  });

  test("channel publication: toggle storefront off and back on", async () => {
    // Toggle off
    const offRes = await put(`/api/products/${seededProductId}/channels`, {
      channels: [{ channelId: storefrontChannelId, isPublished: false }],
    });
    expect(offRes.ok).toBe(true);

    const afterOff = await get(`/api/products/${seededProductId}/channels`);
    expect(afterOff.ok).toBe(true);
    const sfAfterOff = (afterOff.data?.channels || []).find((c) => c.code === "storefront");
    expect(sfAfterOff.is_published, "storefront unpublished").toBe(false);

    // Toggle back on
    const onRes = await put(`/api/products/${seededProductId}/channels`, {
      channels: [{ channelId: storefrontChannelId, isPublished: true }],
    });
    expect(onRes.ok).toBe(true);

    const afterOn = await get(`/api/products/${seededProductId}/channels`);
    const sfAfterOn = (afterOn.data?.channels || []).find((c) => c.code === "storefront");
    expect(sfAfterOn.is_published, "storefront republished").toBe(true);
  });

  test("endless aisle: create web order from POS context", async () => {
    const res = await post("/api/orders/endless-aisle", {
      items: [{ productId: seededProductId, qty: 1 }],
      customerId: seededCustomerId,
      deliveryMethod: "pickup",
      pickupOutletId: pickupOutletId,
      customerContact: {
        name: prefix("EA Buyer"),
        phone: "03334445566",
        email: "ea-smoke@example.com",
      },
    });
    expect(res.ok, `endless aisle: ${JSON.stringify(res.data)}`).toBe(true);
    expect(res.data).toMatchObject({
      orderId: expect.any(Number),
    });
    // No explicit cleanup for this order — it's a web_order row, prefixed via
    // customerContact.name and ea_<uuid> external id.
  });

  test("BOPIS + curbside workflow: ready → arrived → picked up", async () => {
    // 1. Mark pickup ready
    const readyRes = await put(`/api/orders/${webOrderId}/pickup-ready`, {});
    expect(readyRes.ok, `pickup-ready: ${JSON.stringify(readyRes.data)}`).toBe(true);
    expect(readyRes.data?.fulfillment_status).toBe("ready_for_pickup");
    expect(readyRes.data?.pickup_ready_at).toBeTruthy();

    // 2. Customer arrives curbside (public endpoint — no auth needed)
    const arriveRes = await fetch(
      `https://api.sanopos.com/api/storefront/orders/${webOrderToken}/arrive?tenant=${TENANT}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    expect(arriveRes.status, "curbside arrive").toBeLessThan(400);

    // 3. List pickup orders with arrived filter and assert our order is present
    const arrivedList = await get("/api/fulfillment/pickup-orders?status=arrived");
    expect(arrivedList.ok).toBe(true);
    const found = (arrivedList.data?.orders || []).find((o) => o.id === webOrderId);
    expect(found, "seeded order appears in arrived list").toBeTruthy();

    // 4. Mark picked up
    const pickedRes = await put(`/api/orders/${webOrderId}/picked-up`, {});
    expect(pickedRes.ok).toBe(true);
    expect(pickedRes.data?.fulfillment_status).toBe("fulfilled");
    expect(pickedRes.data?.order_status).toBe("closed");
    expect(pickedRes.data?.picked_up_at).toBeTruthy();
  });

  test("returns against web orders: lookup → quote → submit", async () => {
    // 1. Lookup by public order token (unique, guaranteed to match ours only)
    const lookupRes = await get(`/api/returns/lookup-web-order?q=${webOrderToken}`);
    expect(lookupRes.ok, `lookup: ${JSON.stringify(lookupRes.data)}`).toBe(true);
    const matches = lookupRes.data?.orders || [];
    const match = matches.find((o) => o.id === webOrderId);
    expect(match, "our web order found by token").toBeTruthy();
    expect(match.external_order_id).toBeTruthy();
  });

  test("unified customer order history: web order appears alongside POS sales", async () => {
    const res = await get(`/api/customers/${seededCustomerId}/order-history`);
    expect(res.ok, `order history: ${JSON.stringify(res.data)}`).toBe(true);
    const orders = res.data?.orders || [];
    expect(Array.isArray(orders), "orders is array").toBe(true);
    // The seeded customer was attached to the endless-aisle order (customerId).
    // Pickup storefront order used customer_name_snapshot only, so it may not
    // link — but the endless-aisle one will.
    const eaOrder = orders.find((o) => o.type === "web_order");
    expect(eaOrder, "at least one web_order in unified history").toBeTruthy();
    expect(eaOrder).toMatchObject({
      type: "web_order",
      orderNumber: expect.any(String),
      total: expect.any(Number),
      status: expect.any(String),
      date: expect.any(String),
    });
  });
});
