import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
  test("should login successfully with valid credentials", async ({ page }) => {
    // 1. Go to login page
    await page.goto("/login");

    // 2. Enter Credentials (Hassan / 2580)
    await page.getByPlaceholder(/Employee name/i).fill("Hassan");
    const pinInput = page.locator('input[type="password"]');
    await pinInput.fill("2580");

    // 3. Click Login
    await page.getByRole("button", { name: /login/i }).click();

    // 4. Verify redirected to dashboard & bootstrapping finished
    await expect(page).toHaveURL(/.*dashboard/);
    // Wait for the main UI text to appear, indicating bootstrapping is done
    await expect(page.getByText(/ONESHOPPOS/i)).toBeVisible();
    await expect(page.getByText(/Hassan/i)).toBeVisible();
  });

  test("should logout successfully", async ({ page }) => {
    // 1. Login first
    await page.goto("/login");
    await page.getByPlaceholder(/Employee name/i).fill("Hassan");
    await page.locator('input[type="password"]').fill("2580");
    await page.getByRole("button", { name: /login/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.getByText(/Hassan/i)).toBeVisible();

    // 2. Click Logout
    // Use a more specific locator if the role is ambiguous
    await page.getByRole("button", { name: /logout/i }).click();

    // 3. Verify redirected to login
    await expect(page).toHaveURL(/.*login/);
    await expect(page.getByText(/Sign In/i)).toBeVisible();
  });
});
