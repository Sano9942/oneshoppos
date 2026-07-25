import { test, expect } from "@playwright/test";
import { STORE_CODE, USERNAME, PASSWORD, PIN, loginMT } from "./helpers/auth.js";

test.describe("Authentication", () => {
  test("login page renders with store code, username, password fields", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined, baseURL: "https://sanopos.com" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page.getByPlaceholder(/aceshardware/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder(/employee (username|name)/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await ctx.close();
  });

  test("login with valid credentials redirects to dashboard", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined, baseURL: "https://sanopos.com" });
    const page = await ctx.newPage();
    await loginMT(page);
    await expect(page).toHaveURL(/dashboard/);
    await ctx.close();
  });

  test("login with wrong password shows error", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined, baseURL: "https://sanopos.com" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCode = page.getByPlaceholder(/aceshardware/i);
    if (await storeCode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await storeCode.fill(STORE_CODE);
    }
    await page.getByPlaceholder(/employee (username|name)/i).fill(USERNAME);
    await page.getByPlaceholder(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|incorrect|failed|error/i).first()).toBeVisible({ timeout: 10000 });
    await ctx.close();
  });

  test("login with wrong store code shows error", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined, baseURL: "https://sanopos.com" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCode = page.getByPlaceholder(/aceshardware/i);
    if (await storeCode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await storeCode.fill("nonexistent-store-xyz");
    }
    await page.getByPlaceholder(/employee (username|name)/i).fill(USERNAME);
    await page.getByPlaceholder(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/not found|invalid|error/i).first()).toBeVisible({ timeout: 10000 });
    await ctx.close();
  });

  test("forgot password link opens modal or navigates", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined, baseURL: "https://sanopos.com" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const forgotLink = page.getByText(/forgot password/i);
    if (await forgotLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await forgotLink.click();
      await expect(
        page.getByText(/reset link|reset password|email|send/i).first()
      ).toBeVisible({ timeout: 5000 });
    }
    await ctx.close();
  });

  test("logout redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    // Profile dropdown button shows "hassan"
    const profileTrigger = page.getByRole("button", { name: /hassan/i });
    if (await profileTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await profileTrigger.click();
      await page.waitForTimeout(300);
    }
    const logoutBtn = page.getByText(/logout|sign out/i).first();
    await logoutBtn.click();
    await expect(page).toHaveURL(/login/, { timeout: 15000 });
  });

  test("dashboard requires auth — unauthenticated redirects to login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    await page.goto("https://sanopos.com/dashboard");
    await expect(page).toHaveURL(/login/, { timeout: 15000 });
    await ctx.close();
  });

  test("kiosk page loads with PIN pad", async ({ page }) => {
    await page.goto(`/kiosk?tenant=${STORE_CODE}`);
    await page.waitForLoadState("networkidle");
    // PIN pad should have numeric buttons
    await expect(
      page.getByRole("button", { name: "1" }).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "5" }).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("context-select page is accessible", async ({ page }) => {
    await page.goto("/context-select");
    await page.waitForLoadState("networkidle");
    const url = page.url();
    const onContextPage = url.includes("context-select");
    const onDashboard = url.includes("dashboard");
    expect(onContextPage || onDashboard).toBeTruthy();
  });

  test("PIN validation works via API", async () => {
    const { post } = await import("./helpers/api.js");
    const r = await post("/api/employees/validate-pin", { pin_code: PIN });
    expect(r.ok).toBeTruthy();
  });
});
