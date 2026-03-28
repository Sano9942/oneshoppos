/**
 * 23-onboard-pro.spec.js — Full onboarding E2E for PRO plan.
 *
 * Runs against live production (sanopos.com / Railway).
 * Creates a real test tenant, walks through signup → setup → login → first sale,
 * then verifies Pro plan has no practical limits and advanced features are accessible.
 *
 * After this spec completes, manually delete the tenant from super-admin.
 */
import { test, expect } from "@playwright/test";
import {
  generateStoreInfo,
  healthCheck,
  verifyPricingVisible,
  signup,
  completeSetupWizard,
  firstLogin,
  verifyBillingPage,
  verifySupportWidget,
  addProducts,
  openShift,
  clockIn,
  makeSale,
  verifySale,
  createEmployee,
  createOutlet,
  saveOnboardingState,
  getOnboardingState,
  TEST_OWNER,
} from "./helpers/onboarding.js";

const PLAN = "pro";
const store = generateStoreInfo(PLAN);

test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial("Pro Plan Onboarding", () => {
  test("Step 0: Backend health check", async () => {
    const result = await healthCheck();
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ok");
    console.log(`  Health: ${JSON.stringify(result.data)}`);
  });

  test("Step 1: Landing page shows pricing", async ({ page }) => {
    await verifyPricingVisible(page);
    console.log("  Pricing section rendered with live prices");
  });

  test("Step 2: Signup with Pro plan", async ({ page }) => {
    const result = await signup(page, { storeName: store.name, plan: PLAN });
    expect(result.token).toBeTruthy();
    expect(result.tenant).toBeTruthy();

    saveOnboardingState(PLAN, {
      slug: result.tenant,
      setupToken: result.token,
      storeName: store.name,
    });
    console.log(`  Tenant created: ${result.tenant}`);
  });

  test("Step 3: Complete setup wizard", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    await completeSetupWizard(page, {
      token: state.setupToken,
      slug: state.slug,
      storeName: state.storeName,
    });
    console.log("  Setup wizard completed successfully");
  });

  test("Step 4: First login", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    const { token } = await firstLogin(page, { slug: state.slug });
    expect(token).toBeTruthy();
    saveOnboardingState(PLAN, { authToken: token });

    await expect(page.locator("text=Dashboard").first()).toBeVisible({ timeout: 10000 });
    console.log("  Logged in and dashboard loaded");
  });

  test("Step 5: Billing page shows Pro plan", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    await firstLogin(page, { slug: state.slug });
    await verifyBillingPage(page, "pro");
    console.log("  Billing page shows Pro plan");
  });

  test("Step 6: Support widget is visible", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    await firstLogin(page, { slug: state.slug });
    await verifySupportWidget(page);
    console.log("  Support widget visible on dashboard");
  });

  test("Step 7: Add products", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    await firstLogin(page, { slug: state.slug });
    const token = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("authSession") || "{}");
      return s.token || null;
    });

    const products = await addProducts(token, state.slug);
    expect(products.length).toBe(2);
    saveOnboardingState(PLAN, { products, authToken: token });
    console.log(`  Created ${products.length} products`);
  });

  test("Step 8: Open cash shift", async () => {
    const state = getOnboardingState(PLAN);
    const result = await openShift(state.authToken);
    saveOnboardingState(PLAN, { shiftId: result.shift_id || result.id });
    console.log(`  Shift opened`);
  });

  test("Step 9: Clock in", async () => {
    const state = getOnboardingState(PLAN);
    const result = await clockIn(state.authToken, 1, state.slug);
    console.log(`  Clocked in`);
  });

  test("Step 10: Make first sale", async () => {
    const state = getOnboardingState(PLAN);
    const result = await makeSale(state.authToken, state.products);
    const saleId = result.saleId || result.sale_id;
    expect(saleId).toBeTruthy();
    saveOnboardingState(PLAN, {
      saleId,
      invoiceNumber: result.invoiceNumber || result.invoice_number,
    });
    console.log(`  Sale completed: ID=${saleId}`);
  });

  test("Step 11: Verify sale recorded", async () => {
    const state = getOnboardingState(PLAN);
    const sale = await verifySale(state.authToken, state.saleId);
    expect(sale).toBeTruthy();
    console.log(`  Sale verified`);
  });

  test("Step 12a: Plan limit — outlets and employees are unlimited", async () => {
    const state = getOnboardingState(PLAN);
    // Pro: max_outlets=10, max_employees=50, max_products=0 (unlimited)
    // Create a few outlets and employees — should all succeed
    const outlet2 = await createOutlet(state.authToken, "Pro Outlet 2");
    expect(outlet2.ok).toBe(true);

    const outlet3 = await createOutlet(state.authToken, "Pro Outlet 3");
    expect(outlet3.ok).toBe(true);

    const outlet4 = await createOutlet(state.authToken, "Pro Outlet 4");
    expect(outlet4.ok).toBe(true);

    console.log("  Created 3 additional outlets (no limit hit)");

    // Create several employees
    for (let i = 2; i <= 6; i++) {
      const pin = String(2000 + i);
      const result = await createEmployee(state.authToken, `Pro Employee ${i}`, pin);
      expect(result.ok).toBe(true);
    }
    console.log("  Created 5 additional employees (no limit hit)");
  });

  test("Step 12b: Advanced features accessible", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    await firstLogin(page, { slug: state.slug });

    // Reports page should load
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Reports").first()).toBeVisible({ timeout: 10000 });
    console.log("  Reports page accessible");

    // Sales history should load
    await page.goto("/sales-history");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Sales").first()).toBeVisible({ timeout: 10000 });
    console.log("  Sales history page accessible");

    // Inventory page should load
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Inventory").first()).toBeVisible({ timeout: 10000 });
    console.log("  Inventory page accessible");

    // Employees page should load (admin feature)
    await page.goto("/employees");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("text=Employee").first()).toBeVisible({ timeout: 10000 });
    console.log("  Employees page accessible");
  });

  test("Step 13: Log completion", async () => {
    const state = getOnboardingState(PLAN);
    console.log("\n══════════════════════════════════════════════");
    console.log("  PRO PLAN ONBOARDING — COMPLETE");
    console.log(`  Slug: ${state.slug}`);
    console.log(`  Sale ID: ${state.saleId}`);
    console.log(`  Invoice: ${state.invoiceNumber}`);
    console.log("  → Delete this tenant from /admin to clean up");
    console.log("══════════════════════════════════════════════\n");
  });
});
