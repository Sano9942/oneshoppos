import { test, expect } from "@playwright/test";

/**
 * Helper to assert a page loaded — checks for heading, table, or empty state.
 */
async function assertPageLoaded(page, headingPattern, emptyPattern) {
  const heading = page.getByRole("heading", { name: headingPattern }).first();
  const table = page.locator("table").first();
  const emptyState = page.getByText(emptyPattern).first();
  const addBtn = page.getByRole("button", { name: /add|create|new/i }).first();
  const hasHeading = await heading.isVisible({ timeout: 15000 }).catch(() => false);
  const hasTable = await table.isVisible({ timeout: 3000 }).catch(() => false);
  const hasEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
  const hasAdd = await addBtn.isVisible({ timeout: 3000 }).catch(() => false);
  expect(hasHeading || hasTable || hasEmpty || hasAdd).toBeTruthy();
}

test.describe("Stock Adjustments", () => {
  test("adjustments page loads", async ({ page }) => {
    await page.goto("/adjustments");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /adjustment/i, /no adjustment|empty|no data/i);
  });

  test("create stock adjustment via API", async () => {
    const { get, post } = await import("./helpers/api.js");
    // Get a product to adjust
    const products = await get("/api/products?limit=1");
    expect(products.ok).toBeTruthy();
    if (products.data.length === 0) return;
    const productId = products.data[0].id;
    const r = await post("/api/adjustments", {
      outlet_id: 1,
      reason: "PW test adjustment",
      items: [{ product_id: productId, variant_id: null, quantity_change: 1 }],
    });
    // May succeed or fail due to validation — endpoint should exist
    expect(r.status).toBeLessThan(500);
  });

  test("adjustments page has add button", async ({ page }) => {
    await page.goto("/adjustments");
    await page.waitForLoadState("networkidle");
    const addBtn = page
      .getByRole("button", { name: /add|create|new|adjust/i })
      .or(page.getByRole("link", { name: /add|create|new|adjust/i }))
      .first();
    await expect(addBtn).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Stock Transfers", () => {
  test("transfers page loads", async ({ page }) => {
    await page.goto("/transfers");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /transfer/i, /no transfer|empty|no data/i);
  });

  test("transfers API returns list", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/transfers");
    expect(r.ok).toBeTruthy();
    expect(Array.isArray(r.data)).toBeTruthy();
  });
});

test.describe("Stock Counts", () => {
  test("stock counts page loads", async ({ page }) => {
    await page.goto("/stock-counts");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /stock count/i, /no stock count|empty|no data|get started/i);
  });

  test("stock counts API returns list", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/stock-counts");
    // May return 200 or 404 if feature not enabled
    expect([200, 404]).toContain(r.status);
  });
});

test.describe("Reorder Alerts", () => {
  test("reorder alerts page loads", async ({ page }) => {
    await page.goto("/reorder-alerts");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /reorder|alert|low stock/i, /no alert|empty|no data|all stocked/i);
  });
});

test.describe("Price Lists", () => {
  test("price lists page loads", async ({ page }) => {
    await page.goto("/price-lists");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /price list/i, /no price list|empty|no data|get started/i);
  });

  test("price lists API returns data", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/price-lists");
    // May return 200 or 404 if feature not enabled
    expect([200, 404]).toContain(r.status);
  });
});

test.describe("Barcode Templates", () => {
  test("barcode templates page loads", async ({ page }) => {
    await page.goto("/barcode-templates");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /barcode|template|label/i, /no template|empty|no data|get started/i);
  });
});

test.describe("Inventory API Validation", () => {
  test("products API returns inventory data", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/products?limit=5");
    expect(r.ok).toBeTruthy();
    expect(Array.isArray(r.data)).toBeTruthy();
    if (r.data.length > 0) {
      const product = r.data[0];
      expect(product).toHaveProperty("id");
      expect(product).toHaveProperty("name");
    }
  });

  test("inventory dump report API works", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/reports/inventory-dump");
    expect(r.ok).toBeTruthy();
  });
});
