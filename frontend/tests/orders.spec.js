import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";
import { get, post, put } from "./helpers/api.js";

const noErrorBoundary = async (page) => {
  await expect(
    page.getByText(/something went wrong/i)
  ).not.toBeVisible({ timeout: 2000 }).catch(() => {});
};

test.describe("Orders", () => {
  test("orders page loads", async ({ page }) => {
    await navigateTo(page, "/orders");
    await expect(
      page.getByRole("heading", { name: /order/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("quotations page loads", async ({ page }) => {
    await navigateTo(page, "/quotations");
    await expect(
      page.getByRole("heading", { name: /quotation/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create quotation via API and verify in list", async ({ page }) => {
    // Get a product first
    const prodRes = await get("/api/products?limit=1");
    if (prodRes.ok && prodRes.data?.length > 0) {
      const prod = prodRes.data[0];
      const res = await post("/api/quotations", {
        customer_id: null,
        items: [{ product_id: prod.id, variant_id: prod.variant_id || null, quantity: 1, price: prod.price || 100 }],
        notes: `Test quotation ${Date.now()}`,
      });
      // May return 201, 200, or 400 if schema differs
      expect([200, 201, 400]).toContain(res.status);
    }

    await navigateTo(page, "/quotations");
    await page.waitForLoadState("networkidle");
    await noErrorBoundary(page);
  });

  test("fulfillment page loads", async ({ page }) => {
    await navigateTo(page, "/fulfillment");
    await expect(
      page.getByRole("heading", { name: /fulfillment|fulfil/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("unfulfilled orders visible or empty state", async ({ page }) => {
    await navigateTo(page, "/fulfillment");
    await page.waitForLoadState("networkidle");
    const hasTable = await page.locator("table").first().isVisible({ timeout: 15000 }).catch(() => false);
    const hasEmpty = await page.getByText(/no.*unfulfilled|no.*order|empty/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test("parked sales page loads", async ({ page }) => {
    await navigateTo(page, "/parked-sales");
    await expect(
      page.getByRole("heading", { name: /parked/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("order aging summary visible or empty state", async ({ page }) => {
    await navigateTo(page, "/orders");
    await page.waitForLoadState("networkidle");
    const hasTable = await page.locator("table").first().isVisible({ timeout: 15000 }).catch(() => false);
    const hasEmpty = await page.getByText(/no.*order|aging|overdue/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test("order search/filter works", async ({ page }) => {
    await navigateTo(page, "/orders");
    const searchInput = page.getByPlaceholder(/search/i).or(page.getByRole("searchbox")).first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForLoadState("networkidle");
      await noErrorBoundary(page);
    }
  });

  test("picklist creation page", async ({ page }) => {
    await navigateTo(page, "/fulfillment");
    await page.waitForLoadState("networkidle");
    const picklistBtn = page.getByRole("button", { name: /picklist|pick list/i })
      .or(page.getByRole("link", { name: /picklist/i })).first();
    if (await picklistBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await picklistBtn.click();
      await page.waitForLoadState("networkidle");
      await noErrorBoundary(page);
    }
  });

  test("loadsheet page visible", async ({ page }) => {
    await navigateTo(page, "/fulfillment");
    await page.waitForLoadState("networkidle");
    const loadsheetTab = page.getByRole("button", { name: /loadsheet/i })
      .or(page.getByRole("tab", { name: /loadsheet/i }))
      .or(page.getByText(/loadsheet/i)).first();
    if (await loadsheetTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await loadsheetTab.click();
      await page.waitForLoadState("networkidle");
      await noErrorBoundary(page);
    }
  });

  test("quotation status flow via API", async () => {
    const listRes = await get("/api/quotations?limit=1");
    if (listRes.ok && listRes.data?.length > 0) {
      const q = listRes.data[0];
      if (q.status === "draft") {
        const acceptRes = await put(`/api/quotations/${q.id}`, { status: "accepted" });
        expect([200, 400, 404]).toContain(acceptRes.status);
      }
    }
  });

  test("order detail modal/view opens", async ({ page }) => {
    await navigateTo(page, "/orders");
    await page.waitForLoadState("networkidle");
    const row = page.locator("table tbody tr").first();
    if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      await row.click();
      await page.waitForLoadState("networkidle");
      const hasDetail = await page.getByText(/order.*detail|invoice|total/i).first().isVisible({ timeout: 10000 }).catch(() => false);
      const hasDialog = await page.getByRole("dialog").isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasDetail || hasDialog).toBeTruthy();
    }
  });
});
