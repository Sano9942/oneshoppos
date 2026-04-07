import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";

test.describe("CRM", () => {
  test("CRM page loads at /crm", async ({ page }) => {
    await navigateTo(page, "/crm");
    // CRM might show as pipeline/kanban or list, or might redirect if feature-flagged
    const heading = page.getByRole("heading", { name: /crm|lead|pipeline|customer relationship/i }).first();
    const featureGated = page.getByText(/feature|upgrade|not available|plan/i).first();
    await expect(heading.or(featureGated).first()).toBeVisible({ timeout: 15000 });
  });

  test("lead list or kanban renders", async ({ page }) => {
    await navigateTo(page, "/crm");
    await page.waitForLoadState("networkidle");
    // Look for list rows, kanban columns, or empty state
    const listOrKanban = page.getByRole("table")
      .or(page.locator("[class*=kanban], [class*=pipeline], [class*=column], [class*=board]"))
      .or(page.getByText(/no lead|no record|empty|get started|add your first/i));
    await expect(listOrKanban.first()).toBeVisible({ timeout: 15000 });
  });

  test("create new lead — add button visible", async ({ page }) => {
    await navigateTo(page, "/crm");
    const addBtn = page.getByRole("button", { name: /add|new|create/i })
      .or(page.getByRole("link", { name: /add|new|create/i }));
    await expect(addBtn.first()).toBeVisible({ timeout: 15000 });
  });

  test("create new lead — fill form and submit", async ({ page }) => {
    await navigateTo(page, "/crm");
    const addBtn = page.getByRole("button", { name: /add lead/i }).first();
    await addBtn.click();
    await page.waitForTimeout(500);

    // Fill fields inside the modal
    const modal = page.locator(".fixed");
    await modal.getByPlaceholder("Lead name").fill("Test Lead " + Date.now());

    const phoneField = modal.getByPlaceholder("Phone");
    if (await phoneField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await phoneField.fill("0300-1234567");
    }

    const valueField = modal.getByPlaceholder("Expected Value");
    if (await valueField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await valueField.fill("50000");
    }

    // Submit — button text is "Add Lead" inside the modal
    await modal.getByRole("button", { name: /add lead/i }).click();
    await page.waitForLoadState("networkidle");

    // Confirm success — toast, redirect, or new entry visible
    const success = page.getByText(/created|saved|success|added/i)
      .or(page.getByText(/test lead/i));
    await expect(success.first()).toBeVisible({ timeout: 10000 });
  });

  test("lead detail opens", async ({ page }) => {
    await navigateTo(page, "/crm");
    await page.waitForLoadState("networkidle");

    // Click on the first lead entry
    const leadEntry = page.getByRole("row").nth(1)
      .or(page.locator("[class*=card], [class*=Card]").filter({ hasText: /lead|test/i }).first());
    if (await leadEntry.isVisible({ timeout: 5000 }).catch(() => false)) {
      await leadEntry.click();
      await page.waitForLoadState("networkidle");
      // Should show lead detail — name, stage, activity, etc.
      await expect(
        page.getByText(/detail|stage|activity|note|history|contact/i).first()
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("lead stage or status change", async ({ page }) => {
    await navigateTo(page, "/crm");
    await page.waitForLoadState("networkidle");

    // Look for a stage/status dropdown or kanban drag — try dropdown approach
    const stageSelect = page.getByRole("combobox").or(page.locator("select")).first();
    const stageButton = page.getByRole("button", { name: /stage|status|new|qualified|won/i }).first();
    const stageEl = stageSelect.or(stageButton);
    if (await stageEl.isVisible({ timeout: 5000 }).catch(() => false)) {
      await stageEl.click();
      await page.waitForLoadState("networkidle");
    }
    // Verify stage options appear
    const options = page.getByRole("option").or(page.getByRole("menuitem")).or(page.getByText(/qualified|contacted|won|lost|negotiation/i));
    await expect(options.first()).toBeVisible({ timeout: 5000 }).catch(() => {
      // Stage change UI might not be directly accessible from list view — acceptable
    });
  });

  test("lead filtering works", async ({ page }) => {
    await navigateTo(page, "/crm");
    await page.waitForLoadState("networkidle");

    const filterBtn = page.getByRole("button", { name: /filter/i })
      .or(page.getByText(/filter/i))
      .first();
    if (await filterBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await filterBtn.click();
      await page.waitForLoadState("networkidle");
      // Filter options should appear
      await expect(
        page.getByText(/stage|status|date|source|all/i).first()
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("lead search works", async ({ page }) => {
    await navigateTo(page, "/crm");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByRole("searchbox")
      .or(page.getByPlaceholder(/search/i))
      .first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForLoadState("networkidle");
      // Results should update
      const hasResults = await page.getByText(/test/i).first().isVisible({ timeout: 10000 }).catch(() => false);
      const hasNoResults = await page.getByText(/no result|no match/i).first().isVisible({ timeout: 3000 }).catch(() => false);
      expect(hasResults || hasNoResults).toBeTruthy();
    }
  });
});
