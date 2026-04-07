import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";
import { get } from "./helpers/api.js";

test.describe("Billing", () => {
  test("billing page loads", async ({ page }) => {
    await navigateTo(page, "/billing");
    await expect(
      page.getByRole("heading", { name: /billing|subscription|plan/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("current plan name is displayed", async ({ page }) => {
    await navigateTo(page, "/billing");
    await expect(
      page.getByText(/free|starter|pro|enterprise/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("subscription status is shown", async ({ page }) => {
    await navigateTo(page, "/billing");
    await expect(
      page.getByText(/trial|active|expired|grace|status/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("payment history section visible", async ({ page }) => {
    await navigateTo(page, "/billing");
    // Either a table with payment history or an empty state message
    const historySection = page.getByText(/payment history|no payment|transaction/i)
      .or(page.locator("table").first());
    await expect(historySection.first()).toBeVisible({ timeout: 15000 });
  });

  test("pricing information visible", async ({ page }) => {
    await navigateTo(page, "/billing");
    // Pricing cards or plan details with prices
    await expect(
      page.getByText(/pricing|price|month|pkr|free|upgrade/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("upgrade button or link visible", async ({ page }) => {
    await navigateTo(page, "/billing");
    const upgradeEl = page.getByRole("button", { name: /upgrade|change plan|subscribe/i })
      .or(page.getByRole("link", { name: /upgrade|change plan|subscribe/i }))
      .or(page.getByText(/upgrade|change plan/i));
    await expect(upgradeEl.first()).toBeVisible({ timeout: 15000 });
  });

  test("billing API returns status", async () => {
    const res = await get("/api/billing/status");
    expect(res.ok).toBeTruthy();
    expect(res.data).toBeTruthy();
  });
});
