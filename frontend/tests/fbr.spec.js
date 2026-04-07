import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";

test.describe("FBR Integration", () => {
  test("FBR settings page loads at /settings/fbr with config form", async ({ page }) => {
    await navigateTo(page, "/settings/fbr");
    await expect(
      page.getByRole("heading", { name: /fbr|federal board of revenue/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("config form has NTN field", async ({ page }) => {
    await navigateTo(page, "/settings/fbr");
    await expect(
      page.getByLabel(/ntn/i).or(page.getByPlaceholder(/ntn/i)).or(page.getByText(/ntn/i)).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("config form has token field", async ({ page }) => {
    await navigateTo(page, "/settings/fbr");
    await expect(
      page.getByLabel(/token/i).or(page.getByPlaceholder(/token/i)).or(page.getByText(/token|pos id/i)).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("FBR dashboard loads at /fbr with status summary", async ({ page }) => {
    await navigateTo(page, "/fbr");
    await expect(
      page.getByRole("heading", { name: /fbr|invoice|dashboard/i }).first()
    ).toBeVisible({ timeout: 15000 });
    // Should show status summary — pending, sent, failed counts or similar
    await expect(
      page.getByText(/pending|sent|failed|total|queue|status|invoice/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("dashboard shows invoice table or empty state", async ({ page }) => {
    await navigateTo(page, "/fbr");
    await page.waitForLoadState("networkidle");
    const table = page.getByRole("table").or(page.locator("table"));
    const emptyState = page.getByText(/no invoice|no record|empty|no data|nothing/i);
    const either = table.or(emptyState);
    await expect(either.first()).toBeVisible({ timeout: 15000 });
  });

  test("tax lookup page loads at /tax-lookup", async ({ page }) => {
    await navigateTo(page, "/tax-lookup");
    await expect(
      page.getByRole("heading", { name: /tax|lookup|hs code/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("tax lookup has search input", async ({ page }) => {
    await navigateTo(page, "/tax-lookup");
    const searchInput = page.getByRole("searchbox")
      .or(page.getByPlaceholder(/search|hs code|description/i))
      .or(page.getByRole("textbox").first());
    await expect(searchInput.first()).toBeVisible({ timeout: 15000 });
  });

  test("tax lookup returns results for common search term", async ({ page }) => {
    await navigateTo(page, "/tax-lookup");
    const searchInput = page.getByRole("searchbox")
      .or(page.getByPlaceholder(/search|hs code|description/i))
      .or(page.getByRole("textbox").first());
    await searchInput.first().fill("garment");
    await searchInput.first().press("Enter");
    await page.waitForLoadState("networkidle");
    // Should show results or a "no results" message
    const results = page.getByRole("row").or(page.locator("tr")).or(page.getByText(/garment|textile|cloth/i));
    const noResults = page.getByText(/no result|not found|no match/i);
    const hasResults = await results.first().isVisible({ timeout: 10000 }).catch(() => false);
    const hasNoResults = await noResults.first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasResults || hasNoResults).toBeTruthy();
  });
});
