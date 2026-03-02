import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("RBAC Access Control", () => {
  test("Cashier should not access Admin settings", async ({ page }) => {
    // 1. Login as Cashier (Cashier User / 3333)
    await page.goto("/login");
    await page.getByPlaceholder(/Employee name/i).fill("Cashier User");
    await page.locator('input[type="password"]').fill("3333");
    await page.getByRole("button", { name: /login/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.getByText(/ONESHOPPOS/i)).toBeVisible();

    // 2. Attempt to go to Inventory (Restricted for Cashier)
    await page.goto("/inventory");

    // 3. Verify Access Denied or redirection to dashboard
    // Wait for either the access denied text or a URL change back to dashboard
    await expect(async () => {
      const isAccessDenied = await page.getByText(/Access Denied/i).isVisible();
      const isDashboard = page.url().includes("dashboard");
      expect(isAccessDenied || isDashboard).toBeTruthy();
    }).toPass({ timeout: 10000 });
  });

  test("Admin should access all pages", async ({ page }) => {
    await loginAsAdmin(page);

    // 2. Go to Inventory
    await page.goto("/inventory");
    // Wait for the URL and heading to confirm the page loaded
    await expect(page).toHaveURL(/.*inventory/, { timeout: 15000 });
    await expect(page.getByText(/Inventory/i).first()).toBeVisible({
      timeout: 10000,
    });

    // 3. Go to Employees
    await page.goto("/employees");
    // Wait for the URL and heading to confirm the page loaded
    await expect(page).toHaveURL(/.*employees/, { timeout: 15000 });
    await expect(page.getByText(/Employees/i).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
