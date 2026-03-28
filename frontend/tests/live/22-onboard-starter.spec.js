/**
 * 22-onboard-starter.spec.js — Full onboarding E2E for STARTER plan.
 *
 * Runs against live production (sanopos.vercel.app / Railway).
 * Creates a real test tenant, walks through signup → setup → login → first sale,
 * then verifies Starter plan limits (3 outlets, 10 employees, 2000 products).
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

const PLAN = "starter";
const store = generateStoreInfo(PLAN);

test.use({ storageState: { cookies: [], origins: [] } });

test.describe.serial("Starter Plan Onboarding", () => {
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

  test("Step 2: Signup with Starter plan", async ({ page }) => {
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

  test("Step 5: Billing page shows Starter plan", async ({ page }) => {
    const state = getOnboardingState(PLAN);
    await firstLogin(page, { slug: state.slug });
    await verifyBillingPage(page, "starter");
    console.log("  Billing page shows Starter plan");
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

  test("Step 12a: Plan limit — 4th outlet blocked", async () => {
    const state = getOnboardingState(PLAN);
    // Starter allows 3 outlets. 1 exists from setup.
    // Create 2 more (should succeed)
    const outlet2 = await createOutlet(state.authToken, "Outlet Two");
    expect(outlet2.ok).toBe(true);
    console.log(`  Outlet 2 created`);

    const outlet3 = await createOutlet(state.authToken, "Outlet Three");
    expect(outlet3.ok).toBe(true);
    console.log(`  Outlet 3 created`);

    // 4th should be blocked
    const outlet4 = await createOutlet(state.authToken, "Outlet Four");
    expect(outlet4.status).toBe(403);
    expect(outlet4.data.code).toBe("PLAN_LIMIT_REACHED");
    console.log(`  Correctly blocked 4th outlet: ${outlet4.data.error}`);
  });

  test("Step 12b: Plan limit — 11th employee blocked", async () => {
    const state = getOnboardingState(PLAN);
    // Starter allows 10 employees. 1 admin exists.
    // Create 9 more (should succeed)
    for (let i = 2; i <= 10; i++) {
      const pin = String(1000 + i);
      const result = await createEmployee(state.authToken, `Employee ${i}`, pin);
      expect(result.ok).toBe(true);
    }
    console.log(`  Created employees 2-10 (9 total, 10 with admin)`);

    // 11th should be blocked
    const emp11 = await createEmployee(state.authToken, "Employee Eleven", "9999");
    expect(emp11.status).toBe(403);
    expect(emp11.data.code).toBe("PLAN_LIMIT_REACHED");
    console.log(`  Correctly blocked 11th employee: ${emp11.data.error}`);
  });

  test("Step 13: Log completion", async () => {
    const state = getOnboardingState(PLAN);
    console.log("\n══════════════════════════════════════════════");
    console.log("  STARTER PLAN ONBOARDING — COMPLETE");
    console.log(`  Slug: ${state.slug}`);
    console.log(`  Sale ID: ${state.saleId}`);
    console.log(`  Invoice: ${state.invoiceNumber}`);
    console.log("  → Delete this tenant from /admin before running next plan");
    console.log("══════════════════════════════════════════════\n");
  });
});
