const { fetchRecentOrders } = require("./shopify/client");
const assert = require("assert");

async function withMockedFetch(mockFn, runner) {
  const originalFetch = global.fetch;
  global.fetch = mockFn;
  try {
    await runner();
  } finally {
    global.fetch = originalFetch;
  }
}

async function runOrderPullTest() {
  console.log("Running fetchRecentOrders Mock Test...");

  const mockConnection = {
    shop_domain: "test.myshopify.com",
    access_token: "test_token",
    api_version: "2025-10",
  };

  const mockResponse = {
    data: {
      orders: {
        edges: [
          {
            node: {
              id: "gid://shopify/Order/123",
              name: "#1001",
              currencyCode: "PKR",
              subtotalPriceSet: { shopMoney: { amount: "100.00" } },
              totalDiscountsSet: { shopMoney: { amount: "0.00" } },
              totalTaxSet: { shopMoney: { amount: "5.00" } },
              totalShippingPriceSet: { shopMoney: { amount: "10.00" } },
              totalPriceSet: { shopMoney: { amount: "115.00" } },
              financialStatus: "PAID",
              displayFulfillmentStatus: "UNFULFILLED",
              createdAt: "2026-02-26T10:00:00Z",
              lineItems: {
                edges: [
                  {
                    node: {
                      id: "gid://shopify/LineItem/1",
                      sku: "TEST-SKU",
                      title: "Test Product",
                      quantity: 2,
                      variant: { barcode: "123456" },
                      discountedUnitPriceSet: {
                        shopMoney: { amount: "50.00" },
                      },
                      totalDiscountSet: { shopMoney: { amount: "0.00" } },
                      taxLines: [
                        { priceSet: { shopMoney: { amount: "2.50" } } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  };

  await withMockedFetch(
    async () => {
      return {
        ok: true,
        json: async () => mockResponse,
      };
    },
    async () => {
      const orders = await fetchRecentOrders(mockConnection, 1);

      assert.strictEqual(orders.length, 1);
      const o = orders[0];
      assert.strictEqual(o.id, "gid://shopify/Order/123");
      assert.strictEqual(o.name, "#1001");
      assert.strictEqual(o.financial_status, "paid");
      assert.strictEqual(o.line_items.length, 1);

      const li = o.line_items[0];
      assert.strictEqual(li.sku, "TEST-SKU");
      assert.strictEqual(li.barcode, "123456");
      assert.strictEqual(li.quantity, 2);
      assert.strictEqual(li.price, "50.00");
      assert.strictEqual(li.total_tax, 2.5);

      console.log("✅ fetchRecentOrders Mock Test PASSED");
    },
  );
}

runOrderPullTest().catch((err) => {
  console.error("❌ Test FAILED:", err);
  process.exit(1);
});
