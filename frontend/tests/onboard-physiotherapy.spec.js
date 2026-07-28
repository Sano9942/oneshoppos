import { test, expect } from "@playwright/test";
import { BACKEND } from "./helpers/auth.js";

// Physiotherapy onboarding E2E — mirror of onboard-dental-clinic with
// industry_type=physiotherapy. Same modes (treatment_plans + appointments).
test.describe.serial("Onboarding — Physiotherapy", () => {
  test.use({ storageState: undefined });
  test.setTimeout(180000);

  const ts = Date.now();
  const tenantName = `Test Physio ${ts}`;
  const ownerName = "Dr Test Physio";
  const email = `testphysio${ts}@test.example.com`;
  const password = "TestPass123!";
  let storeCode;
  let setupToken;

  test("1 — signup with Pro plan", async ({ page }) => {
    await page.goto("/signup?plan=pro");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder("My Awesome Store").fill(tenantName);
    await page.getByPlaceholder("John Doe").fill(ownerName);
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("Min 8 characters").fill(password);
    const signupResPromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/signup") && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Create Store" }).click();
    const signupRes = await signupResPromise;
    const body = await signupRes.json();
    expect(signupRes.ok()).toBeTruthy();
    storeCode = body.slug;
    setupToken = body.setupToken;
    expect(storeCode).toBeTruthy();
    expect(setupToken).toBeTruthy();
  });

  test("2 — complete setup with industry_type=physiotherapy via API", async ({ request }) => {
    test.skip(!storeCode || !setupToken, "No signup result");
    const res = await request.post(`${BACKEND}/api/setup/complete?tenant=${storeCode}`, {
      data: {
        token: setupToken,
        industry_type: "physiotherapy",
        company_name: tenantName,
        country_code: "PK",
        country: "Pakistan",
        city: "Karachi",
        timezone: "Asia/Karachi",
        currency_symbol: "Rs",
        currency_code: "PKR",
        outlet_name: "Main Clinic",
        admin_name: ownerName,
        admin_pin: "1234",
      },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("3 — verify Clinical + Appointments nav visible", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee (username|name)/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: /treatment plans?|clinic/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: /appointments?|bookings/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test("4 — cleanup placeholder", async () => {
    test.skip(true, "Manual cleanup via /admin");
  });
});
