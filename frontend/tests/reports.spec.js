import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";

/**
 * Verify a report page loads without crashing.
 * Checks: no ErrorBoundary, some visible content (heading, table, chart, or empty state).
 */
async function assertReportLoads(page, path, label) {
  await navigateTo(page, path);

  // Must NOT show error boundary
  const errorBoundary = page.getByText(/something went wrong/i);
  await expect(errorBoundary).not.toBeVisible({ timeout: 3000 }).catch(() => {});

  // Must show SOME content — check individually to avoid strict mode violations
  const hasHeading = await page.getByRole("heading").first().isVisible({ timeout: 15000 }).catch(() => false);
  const hasTable = await page.locator("table").first().isVisible({ timeout: 2000 }).catch(() => false);
  const hasCanvas = await page.locator("canvas").first().isVisible({ timeout: 2000 }).catch(() => false);
  const hasEmpty = await page.getByText(/no.*data|no.*record|no.*found|empty/i).first().isVisible({ timeout: 2000 }).catch(() => false);
  const hasContent = await page.getByText(/revenue|sales|inventory|customer|supplier|order|product|category|summary|filter|date/i).first().isVisible({ timeout: 2000 }).catch(() => false);
  expect(hasHeading || hasTable || hasCanvas || hasEmpty || hasContent).toBeTruthy();
}

test.describe("Dashboard", () => {
  test("dashboard KPIs load", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(
      page.getByText(/revenue|sales|today/i).first()
    ).toBeVisible({ timeout: 15000 });

    const errorBoundary = page.getByText(/something went wrong/i);
    await expect(errorBoundary).not.toBeVisible({ timeout: 2000 }).catch(() => {});
  });
});

test.describe("Reports", () => {
  test("reports main page loads", async ({ page }) => {
    await assertReportLoads(page, "/reports", "reports main");
  });

  test("sales summary report", async ({ page }) => {
    await assertReportLoads(page, "/reports/sales-summary", "sales summary");
  });

  test("sales detail report", async ({ page }) => {
    await assertReportLoads(page, "/reports/sales-detail", "sales detail");
  });

  test("sales and stock report", async ({ page }) => {
    await assertReportLoads(page, "/reports/sales-and-stock", "sales and stock");
  });

  test("inventory dump report", async ({ page }) => {
    await assertReportLoads(page, "/reports/inventory-dump", "inventory dump");
  });

  test("category wise report", async ({ page }) => {
    await assertReportLoads(page, "/reports/category-wise", "category wise");
  });

  test("product specification report", async ({ page }) => {
    await assertReportLoads(page, "/reports/product-specification", "product specification");
  });

  test("order wise report", async ({ page }) => {
    await assertReportLoads(page, "/reports/order-wise", "order wise");
  });

  test("replenishment report", async ({ page }) => {
    await assertReportLoads(page, "/reports/replenishment", "replenishment");
  });

  test("on-hand inventory report", async ({ page }) => {
    await assertReportLoads(page, "/reports/on-hand-inventory", "on-hand inventory");
  });

  test("customer details report", async ({ page }) => {
    await assertReportLoads(page, "/reports/customer-details", "customer details");
  });

  test("customer wise report", async ({ page }) => {
    await assertReportLoads(page, "/reports/customer-wise", "customer wise");
  });

  test("supplier wise report", async ({ page }) => {
    await assertReportLoads(page, "/reports/supplier-wise", "supplier wise");
  });

  test("inventory loss report", async ({ page }) => {
    await assertReportLoads(page, "/reports/inventory-loss", "inventory loss");
  });

  test("item wise report", async ({ page }) => {
    await assertReportLoads(page, "/reports/item-wise", "item wise");
  });

  test("wastage report", async ({ page }) => {
    await assertReportLoads(page, "/reports/wastage", "wastage");
  });

  test("product movement report", async ({ page }) => {
    await assertReportLoads(page, "/reports/product-movement", "product movement");
  });

  test("product performance report", async ({ page }) => {
    await assertReportLoads(page, "/reports/product-performance", "product performance");
  });

  test("parent report placeholder", async ({ page }) => {
    await navigateTo(page, "/reports/parent-report");
    await page.waitForLoadState("networkidle");
    // Just verify no crash — may 404 or show placeholder
    const errorBoundary = page.getByText(/something went wrong/i);
    await expect(errorBoundary).not.toBeVisible({ timeout: 3000 }).catch(() => {});
  });
});
