import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("Authentication Flow", () => {
  test("should login successfully with valid credentials", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText(/Hassan/i)).toBeVisible();
  });

  test("should logout successfully", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText(/Hassan/i)).toBeVisible();

    // 2. Click Logout
    // Use a more specific locator if the role is ambiguous
    await page.getByRole("button", { name: /logout/i }).click();

    // 3. Verify redirected to login
    await expect(page).toHaveURL(/.*login/);
    await expect(page.getByText(/Sign In/i)).toBeVisible();
  });
});
