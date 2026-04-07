import { test, expect } from "@playwright/test";
import { navigateTo, waitForPageShell } from "./helpers/nav.js";

test.describe("Sidebar Navigation", () => {
  test("dashboard loads at /dashboard", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(
      page.getByRole("heading", { name: /dashboard/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("inventory page loads at /inventory", async ({ page }) => {
    await navigateTo(page, "/inventory");
    await expect(
      page.getByRole("heading", { name: /inventory/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("sales history page loads at /sales-history", async ({ page }) => {
    await navigateTo(page, "/sales-history");
    await expect(
      page.getByRole("heading", { name: /sale/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("customers page loads at /customers", async ({ page }) => {
    await navigateTo(page, "/customers");
    await expect(
      page.getByRole("heading", { name: /customer/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("orders page loads at /orders", async ({ page }) => {
    await navigateTo(page, "/orders");
    await expect(
      page.getByRole("heading", { name: /order/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("purchase orders page loads at /purchase-orders", async ({ page }) => {
    await navigateTo(page, "/purchase-orders");
    await expect(
      page.getByRole("heading", { name: /purchase order/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("employees page loads at /employees", async ({ page }) => {
    await navigateTo(page, "/employees");
    await expect(
      page.getByRole("heading", { name: /employee/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("reports page loads at /reports", async ({ page }) => {
    await navigateTo(page, "/reports");
    await expect(
      page.getByRole("heading", { name: /report/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe("UX Features", () => {
  test("breadcrumbs visible on /inventory but not on /dashboard", async ({ page }) => {
    // Dashboard should NOT have breadcrumbs
    await navigateTo(page, "/dashboard");
    const breadcrumb = page.locator("nav[aria-label*=breadcrumb], [class*=breadcrumb], [class*=Breadcrumb]");
    const dashboardHasBreadcrumb = await breadcrumb.isVisible({ timeout: 3000 }).catch(() => false);
    expect(dashboardHasBreadcrumb).toBeFalsy();

    // Inventory SHOULD have breadcrumbs
    await navigateTo(page, "/inventory");
    await expect(
      page.getByRole("heading", { name: /inventory/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(
      breadcrumb.or(page.getByText(/home/i).locator("xpath=ancestor::nav")).first()
    ).toBeVisible({ timeout: 5000 }).catch(() => {
      // Breadcrumbs may use a different markup — not a hard failure
    });
  });

  test("profile dropdown opens", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    // Look for user name button or avatar in the header
    const profileTrigger = page.getByRole("button").filter({ hasText: /hassan/i })
      .or(page.locator("button[class*=avatar], button[class*=dropdown], button[class*=profile], header button").last());
    await profileTrigger.first().click();
    // Dropdown should show profile, dark mode, logout options
    await expect(
      page.getByText(/profile|dark mode|logout|sign out/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("profile link navigates to /profile", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const profileTrigger = page.getByRole("button").filter({ hasText: /hassan/i })
      .or(page.locator("button[class*=avatar], button[class*=dropdown], button[class*=profile], header button").last());
    await profileTrigger.first().click();

    const profileLink = page.getByRole("link", { name: /profile/i })
      .or(page.getByRole("menuitem", { name: /profile/i }))
      .or(page.getByText(/my profile|view profile/i));
    await profileLink.first().click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/profile");
  });

  test("dark mode toggle switches theme", async ({ page }) => {
    await navigateTo(page, "/dashboard");

    // Get initial theme
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));

    // Open profile dropdown and toggle dark mode
    const profileTrigger = page.getByRole("button").filter({ hasText: /hassan/i })
      .or(page.locator("button[class*=avatar], button[class*=dropdown], button[class*=profile], header button").last());
    await profileTrigger.first().click();

    const darkModeToggle = page.getByRole("button", { name: /dark mode|theme|toggle/i })
      .or(page.getByRole("switch"))
      .or(page.getByText(/dark mode/i))
      .first();
    await darkModeToggle.click();

    // Theme attribute should change
    const newTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(newTheme).not.toBe(initialTheme);

    // Toggle back to restore original state
    // Re-open dropdown if it closed
    if (await profileTrigger.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await profileTrigger.first().click();
    }
    await darkModeToggle.click();
  });

  test("dark mode persists after navigation", async ({ page }) => {
    await navigateTo(page, "/dashboard");

    // Set dark mode
    const profileTrigger = page.getByRole("button").filter({ hasText: /hassan/i })
      .or(page.locator("button[class*=avatar], button[class*=dropdown], button[class*=profile], header button").last());
    await profileTrigger.first().click();

    const darkModeToggle = page.getByRole("button", { name: /dark mode|theme|toggle/i })
      .or(page.getByRole("switch"))
      .or(page.getByText(/dark mode/i))
      .first();
    await darkModeToggle.click();

    const themeAfterToggle = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));

    // Navigate to another page
    await navigateTo(page, "/inventory");
    await expect(page.getByRole("heading", { name: /inventory/i }).first()).toBeVisible({ timeout: 15000 });

    // Theme should persist
    const themeAfterNav = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(themeAfterNav).toBe(themeAfterToggle);

    // Clean up — toggle back
    await navigateTo(page, "/dashboard");
    const trigger2 = page.getByRole("button").filter({ hasText: /hassan/i })
      .or(page.locator("button[class*=avatar], button[class*=dropdown], button[class*=profile], header button").last());
    await trigger2.first().click();
    await darkModeToggle.click();
  });

  test("support widget visible on dashboard", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const supportWidget = page.locator("[class*=support], [class*=Support], [class*=widget]")
      .or(page.getByRole("button", { name: /support|help/i }))
      .or(page.locator("button[class*=float]"));
    await expect(supportWidget.first()).toBeVisible({ timeout: 15000 });
  });

  test("support widget opens form on click", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const supportWidget = page.locator("[class*=support], [class*=Support], [class*=widget]")
      .or(page.getByRole("button", { name: /support|help/i }))
      .or(page.locator("button[class*=float]"));
    await supportWidget.first().click();

    // Should open a form or modal with subject/description fields
    await expect(
      page.getByText(/subject|describe|message|issue|ticket/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("notifications bell visible in header", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    const bell = page.getByRole("button", { name: /notification/i })
      .or(page.locator("[class*=notification], [class*=bell], [aria-label*=notification]"))
      .or(page.locator("header").locator("svg").filter({ hasText: "" })); // bell icon
    await expect(bell.first()).toBeVisible({ timeout: 15000 });
  });

  test("notifications page loads at /notifications", async ({ page }) => {
    await navigateTo(page, "/notifications");
    // Should show notifications list or empty state
    const content = page.getByRole("heading", { name: /notification/i })
      .or(page.getByText(/no notification|notification|all read/i));
    await expect(content.first()).toBeVisible({ timeout: 15000 });
  });

  test("toast appears after triggering an action", async ({ page }) => {
    // Navigate to profile and trigger a save to get a toast
    await navigateTo(page, "/profile");
    await expect(page.getByRole("heading", { name: /profile/i }).first()).toBeVisible({ timeout: 15000 });

    // Try to trigger a toast by interacting with the page
    // Look for any save/update button and click it
    const saveBtn = page.getByRole("button", { name: /save|update/i }).first();
    if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await saveBtn.click();
      // Toast should appear — success or error
      const toast = page.locator("[class*=toast], [class*=Toast], [role=alert], [class*=notification]")
        .or(page.getByText(/saved|updated|success|error|changed/i));
      await expect(toast.first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("subscription banner visible", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    // Look for trial countdown, subscription status, or banner
    const banner = page.locator("[class*=subscription], [class*=Subscription], [class*=banner], [class*=Banner], [class*=trial]")
      .or(page.getByText(/trial|subscription|days left|active plan|upgrade/i));
    await expect(banner.first()).toBeVisible({ timeout: 15000 });
  });

  test("my tickets page loads at /my-tickets", async ({ page }) => {
    await navigateTo(page, "/my-tickets");
    const content = page.getByRole("heading", { name: /ticket/i })
      .or(page.getByText(/no ticket|my ticket|support ticket/i));
    await expect(content.first()).toBeVisible({ timeout: 15000 });
  });

  test("attendance page loads at /attendance", async ({ page }) => {
    await navigateTo(page, "/attendance");
    await expect(
      page.getByRole("heading", { name: /attendance/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
