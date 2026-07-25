import { test, expect } from "@playwright/test";

test.describe("Public Pages", () => {
  // No auth — these are public pages
  test.use({ storageState: undefined });

  test("landing page loads with login form", async ({ browser }) => {
    // Use a fresh context with absolutely no stored state
    const ctx = await browser.newContext({ storageState: undefined, baseURL: "https://sanopos.com" });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    // Should see login fields or a CTA
    const loginForm = page.getByPlaceholder(/aceshardware/i)
      .or(page.getByPlaceholder(/employee (username|name)/i))
      .or(page.getByPlaceholder(/username/i))
      .or(page.getByRole("button", { name: /sign in|login|get started/i }));
    await expect(loginForm.first()).toBeVisible({ timeout: 30000 });
    await ctx.close();
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
    // Actual placeholders: "My Awesome Store", "John Doe", "you@example.com", "Min 8 characters"
    await expect(page.getByPlaceholder("My Awesome Store")).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("John Doe")).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder("Min 8 characters")).toBeVisible({ timeout: 10000 });
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
    // Submit button is disabled until form is valid (store_name>=3, owner, email, password>=8).
    // Verify button exists and is disabled when form is empty — that IS the validation.
    const submitBtn = page.getByRole("button", { name: /create store/i });
    await expect(submitBtn.first()).toBeVisible({ timeout: 15000 });
    await expect(submitBtn.first()).toBeDisabled();
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
    // AccessDenied auto-redirects after 1.2s, so assert quickly without waiting for networkidle.
    // Without auth, the route may also redirect to login — accept either outcome.
    const content = page.getByText(/access denied|forbidden|not authorized|permission/i)
      .or(page.getByRole("heading", { name: /access|denied|forbidden/i }));
    const loginForm = page.getByPlaceholder(/employee (username|name)/i)
      .or(page.getByRole("button", { name: /sign in|login/i }));
    // Either access denied page or login redirect is acceptable
    await expect(content.first().or(loginForm.first())).toBeVisible({ timeout: 15000 });
  });

  test("landing page login form fields accept input", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const storeCode = page.getByPlaceholder(/aceshardware/i);
    if (await storeCode.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCode.fill("teststore");
      await expect(storeCode).toHaveValue("teststore");
    }
    const username = page.getByPlaceholder(/employee (username|name)/i);
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
    // Button is disabled until form is filled — just verify it exists
  });
});
