import { test, expect } from "@playwright/test";

test.describe("Public Pages", () => {
  // No auth — these are public pages
  test.use({ storageState: undefined });

  test("landing page loads with login form", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Should see login fields or a CTA
    const loginForm = page.getByPlaceholder(/aceshardware/i)
      .or(page.getByPlaceholder(/employee name/i))
      .or(page.getByRole("button", { name: /sign in|login|get started/i }));
    await expect(loginForm.first()).toBeVisible({ timeout: 15000 });
  });

  test("landing page shows SanoPOS branding", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/sanopos/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("signup page loads with form fields", async ({ page }) => {
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    // Core signup fields
    const storeName = page.getByPlaceholder(/store name/i)
      .or(page.getByLabel(/store name/i));
    const ownerName = page.getByPlaceholder(/owner|your name/i)
      .or(page.getByLabel(/owner|your name/i));
    const email = page.getByPlaceholder(/email/i)
      .or(page.getByLabel(/email/i));
    const password = page.getByPlaceholder(/password/i)
      .or(page.getByLabel(/password/i));

    await expect(storeName.first()).toBeVisible({ timeout: 15000 });
    await expect(ownerName.first()).toBeVisible({ timeout: 10000 });
    await expect(email.first()).toBeVisible({ timeout: 10000 });
    await expect(password.first()).toBeVisible({ timeout: 10000 });
  });

  test("signup form shows plan selection", async ({ page }) => {
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    // Should show Free and Pro plan options
    await expect(
      page.getByText(/free/i).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(/pro/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("signup form validates required fields on empty submit", async ({ page }) => {
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    // Click submit without filling anything
    const submitBtn = page.getByRole("button", { name: /sign up|create|get started|register/i });
    await expect(submitBtn.first()).toBeVisible({ timeout: 15000 });
    await submitBtn.first().click();
    // Should show validation errors or HTML5 validation prevents submission
    const errorOrValidation = page.getByText(/required|please|enter|invalid|fill/i)
      .or(page.locator(":invalid"));
    await expect(errorOrValidation.first()).toBeVisible({ timeout: 10000 });
  });

  test("reset password page loads", async ({ page }) => {
    await page.goto("/reset-password");
    await page.waitForLoadState("networkidle");
    // Should show a form or an error (no token provided)
    const content = page.getByText(/reset|password|token|invalid|expired|enter/i)
      .or(page.getByPlaceholder(/password/i));
    await expect(content.first()).toBeVisible({ timeout: 15000 });
  });

  test("public receipt page handles missing invoice gracefully", async ({ page }) => {
    await page.goto("/receipt/NONEXISTENT-INVOICE-999");
    await page.waitForLoadState("networkidle");
    // Should show not found or error state
    const errorContent = page.getByText(/not found|error|invalid|no receipt|does not exist/i)
      .or(page.getByRole("heading", { name: /not found|error/i }));
    await expect(errorContent.first()).toBeVisible({ timeout: 15000 });
  });

  test("access denied page loads", async ({ page }) => {
    await page.goto("/access-denied");
    await page.waitForLoadState("networkidle");
    const content = page.getByText(/access denied|forbidden|not authorized|permission/i)
      .or(page.getByRole("heading", { name: /access|denied|forbidden/i }));
    await expect(content.first()).toBeVisible({ timeout: 15000 });
  });

  test("landing page login form fields accept input", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const storeCode = page.getByPlaceholder(/aceshardware/i);
    if (await storeCode.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCode.fill("teststore");
      await expect(storeCode).toHaveValue("teststore");
    }
    const username = page.getByPlaceholder(/employee name/i);
    if (await username.isVisible({ timeout: 3000 }).catch(() => false)) {
      await username.fill("testuser");
      await expect(username).toHaveValue("testuser");
    }
  });

  test("signup page has submit button", async ({ page }) => {
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    const submitBtn = page.getByRole("button", { name: /sign up|create|get started|register/i });
    await expect(submitBtn.first()).toBeVisible({ timeout: 15000 });
    await expect(submitBtn.first()).toBeEnabled();
  });
});
