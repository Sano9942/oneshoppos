/**
 * 21-onboard-free.spec.js — Full onboarding E2E for FREE plan.
 *
 * Runs against live production (sanopos.vercel.app / Railway).
 * Creates a real test tenant, walks through signup → setup → login → first sale,
 * then verifies Free plan limits (1 outlet, 3 employees, 500 products).
 *
 * After this spec completes, manually delete the tenant from super-admin
 * before running the next plan spec.
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

const PLAN = "free";
const store = generateStoreInfo(PLAN);

// No global auth — these tests handle their own login
test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial("Free Plan Onboarding", () => {
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

  test("Step 2: Signup with Free plan", async ({ page }) => {
    const result = await signup(page, { storeName: store.name, plan: PLAN });
    expect(result.token).toBeTruthy();
    expect(result.tenant).toBeTruthy();

    saveOnboardingState(PLAN, {
      slug: result.tenant,
      setupToken: result.token,
      storeName: store.name,
    });
    console.log(`  Tenant created: ${result.tenant}`);
    console.log(`  Setup token: ${result.token.substring(0, 12)}...`);
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

    // Verify dashboard loaded
    await expect(page.locator("text=Dashboard").first()).toBeVisible({ timeout: 10000 });
    console.log("  Logged in and dashboard loaded");
  });

  test("Step 5: Billing page shows Free plan", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    // Need to login first since we have no stored session
    await firstLogin(page, { slug: state.slug });
    await verifyBillingPage(page, "free");
    console.log("  Billing page shows Free plan");
  });

  test("Step 6: Support widget is visible", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    await firstLogin(page, { slug: state.slug });
    await verifySupportWidget(page);
    console.log("  Support widget visible on dashboard");
  });

  test("Step 7: Add products", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    // Re-login to get fresh token
    await firstLogin(page, { slug: state.slug });
    const token = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("authSession") || "{}");
      return s.token || null;
    });

    const products = await addProducts(token, state.slug);
    expect(products.length).toBe(2);
    saveOnboardingState(PLAN, { products, authToken: token });
    console.log(`  Created ${products.length} products: ${products.map((p) => p.name).join(", ")}`);
  });

  test("Step 8: Open cash shift", async () => {
    const state = getOnboardingState(PLAN);
    const result = await openShift(state.authToken);
    saveOnboardingState(PLAN, { shiftId: result.shift_id || result.id });
    console.log(`  Shift opened: ${JSON.stringify(result)}`);
  });

  test("Step 9: Clock in", async () => {
    const state = getOnboardingState(PLAN);
    const result = await clockIn(state.authToken, 1);
    console.log(`  Clocked in: ${JSON.stringify(result)}`);
  });

  test("Step 10: Make first sale", async () => {
    const state = getOnboardingState(PLAN);
    const result = await makeSale(state.authToken, state.products);
    expect(result.saleId || result.sale_id).toBeTruthy();

    const saleId = result.saleId || result.sale_id;
    saveOnboardingState(PLAN, {
      saleId,
      invoiceNumber: result.invoiceNumber || result.invoice_number,
    });
    console.log(`  Sale completed: ID=${saleId}, Invoice=${result.invoiceNumber || result.invoice_number}`);
  });

  test("Step 11: Verify sale recorded", async () => {
    const state = getOnboardingState(PLAN);
    const sale = await verifySale(state.authToken, state.saleId);
    expect(sale).toBeTruthy();
    console.log(`  Sale verified: ${JSON.stringify(sale).substring(0, 200)}`);
  });

  test("Step 12a: Plan limit — 2nd outlet blocked", async () => {
    const state = getOnboardingState(PLAN);
    // Free plan allows 1 outlet (already created during setup)
    const result = await createOutlet(state.authToken, "Second Outlet");
    expect(result.status).toBe(403);
    expect(result.data.code).toBe("PLAN_LIMIT_REACHED");
    console.log(`  Correctly blocked: ${result.data.error}`);
  });

  test("Step 12b: Plan limit — 4th employee blocked", async () => {
    const state = getOnboardingState(PLAN);
    // Free plan allows 3 employees. 1 admin already exists from setup.
    // Create 2 more (should succeed)
    const emp2 = await createEmployee(state.authToken, "Employee Two", "5678");
    expect(emp2.ok).toBe(true);
    console.log(`  Employee 2 created: ${emp2.data.id || "ok"}`);

    const emp3 = await createEmployee(state.authToken, "Employee Three", "9012");
    expect(emp3.ok).toBe(true);
    console.log(`  Employee 3 created: ${emp3.data.id || "ok"}`);

    // 4th should be blocked
    const emp4 = await createEmployee(state.authToken, "Employee Four", "3456");
    expect(emp4.status).toBe(403);
    expect(emp4.data.code).toBe("PLAN_LIMIT_REACHED");
    console.log(`  Correctly blocked 4th employee: ${emp4.data.error}`);
  });

  test("Step 13: Log completion", async () => {
    const state = getOnboardingState(PLAN);
    console.log("\n══════════════════════════════════════════════");
    console.log("  FREE PLAN ONBOARDING — COMPLETE");
    console.log(`  Slug: ${state.slug}`);
    console.log(`  Sale ID: ${state.saleId}`);
    console.log(`  Invoice: ${state.invoiceNumber}`);
    console.log("  → Delete this tenant from /admin before running next plan");
    console.log("══════════════════════════════════════════════\n");
  });
});
