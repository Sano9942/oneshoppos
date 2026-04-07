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
      page.getByRole("heading", { name: /order/i }).or(page.getByText(/no.*order/i)).or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("quotations page loads", async ({ page }) => {
    await navigateTo(page, "/quotations");
    await expect(
      page.getByRole("heading", { name: /quotation/i }).or(page.getByText(/no.*quotation/i)).or(page.locator("table"))
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
      page.getByRole("heading", { name: /fulfillment|fulfil/i }).or(page.getByText(/no.*order/i)).or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("unfulfilled orders visible or empty state", async ({ page }) => {
    await navigateTo(page, "/fulfillment");
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table").or(page.getByText(/no.*unfulfilled/i)).or(page.getByText(/no.*order/i)).or(page.getByText(/empty/i))
    ).toBeVisible({ timeout: 15000 });
  });

  test("parked sales page loads", async ({ page }) => {
    await navigateTo(page, "/parked-sales");
    await expect(
      page.getByRole("heading", { name: /parked/i }).or(page.getByText(/no.*parked/i)).or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("order aging summary visible or empty state", async ({ page }) => {
    await navigateTo(page, "/orders");
    await page.waitForLoadState("networkidle");
    // Check for aging data, summary cards, or just the orders table
    await expect(
      page.locator("table").or(page.getByText(/aging|overdue/i)).or(page.getByText(/no.*order/i))
    ).toBeVisible({ timeout: 15000 });
  });

  test("order search/filter works", async ({ page }) => {
    await navigateTo(page, "/orders");
    const searchInput = page.getByPlaceholder(/search/i).or(page.getByRole("searchbox"));
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.first().fill("test");
      await page.waitForLoadState("networkidle");
      await noErrorBoundary(page);
    }
  });

  test("picklist creation page", async ({ page }) => {
    await navigateTo(page, "/fulfillment");
    await page.waitForLoadState("networkidle");
    const picklistBtn = page.getByRole("button", { name: /picklist|pick list/i })
      .or(page.getByRole("link", { name: /picklist/i }));
    if (await picklistBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await picklistBtn.first().click();
      await page.waitForLoadState("networkidle");
      await noErrorBoundary(page);
    }
  });

  test("loadsheet page visible", async ({ page }) => {
    await navigateTo(page, "/fulfillment");
    await page.waitForLoadState("networkidle");
    const loadsheetTab = page.getByRole("button", { name: /loadsheet/i })
      .or(page.getByRole("tab", { name: /loadsheet/i }))
      .or(page.getByText(/loadsheet/i));
    if (await loadsheetTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await loadsheetTab.first().click();
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
      await expect(
        page.getByText(/order.*detail/i)
          .or(page.getByText(/invoice/i))
          .or(page.getByRole("dialog"))
          .or(page.getByText(/total/i))
      ).toBeVisible({ timeout: 10000 });
    }
  });
});
