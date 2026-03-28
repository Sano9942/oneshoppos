/**
 * Shared onboarding helpers for live E2E tests.
 * Used by 21-onboard-free, 22-onboard-starter, 23-onboard-pro specs.
 */
import { writeState, readState } from "./state.js";
import { BACKEND } from "./auth.js";

// ── Constants ────────────────────────────────────────────────────────────

export const TEST_EMAIL = "sano9942@hotmail.com";
export const TEST_PASSWORD = "TestOnboard2026!";
export const TEST_PIN = "1234";
export const TEST_OWNER = "Test Owner";
export const FRONTEND = "https://sanopos.com";

/**
 * Generate a unique store name and slug for a plan.
 * Slug uses timestamp to avoid conflicts with soft-deleted tenants.
 */
export function generateStoreInfo(plan) {
  const ts = Date.now();
  const name = `Test ${plan.charAt(0).toUpperCase() + plan.slice(1)} ${ts}`;
  // Slug generation mirrors backend: lowercase, non-alphanumeric → _, collapse, trim
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 30);
  return { name, slug, ts };
}

// ── Step 0: Health Check ─────────────────────────────────────────────────

export async function healthCheck() {
  const res = await fetch(`${BACKEND}/api/health`);
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

// ── Step 1: Verify Landing Page Pricing ──────────────────────────────────

export async function verifyPricingVisible(page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Scroll to pricing section
  await page.locator("#pricing").scrollIntoViewIfNeeded();

  // Wait for live pricing to load (should show PKR amounts, not "...")
  // The Starter and Pro cards should show real prices
  await page.waitForFunction(() => {
    const els = document.querySelectorAll("#pricing [class*='font-extrabold']");
    // At least one card should show a PKR price (not "..." or "Contact Us")
    return Array.from(els).some((el) => /PKR|Free/.test(el.textContent));
  }, { timeout: 15000 });
}

// ── Step 2: Signup ───────────────────────────────────────────────────────

export async function signup(page, { storeName, plan }) {
  await page.goto(`/signup?plan=${plan}`);
  await page.waitForLoadState("networkidle");

  // Fill form
  await page.locator('input[placeholder="My Awesome Store"]').fill(storeName);
  await page.locator('input[placeholder="John Doe"]').fill(TEST_OWNER);
  await page.locator('input[placeholder="you@example.com"]').fill(TEST_EMAIL);
  await page.locator('input[placeholder="Min 8 characters"]').fill(TEST_PASSWORD);

  // Select plan radio
  await page.locator(`input[value="${plan}"]`).check();

  // Submit
  await page.getByRole("button", { name: "Create Store" }).click();

  // Wait for success or error
  const success = page.getByText("Store Created!");
  const error = page.getByText("Signup Failed");
  const redirected = page.waitForURL(/\/setup\?token=/, { timeout: 30000 }).catch(() => null);

  // The page either redirects to /setup or shows success/error modal
  const result = await Promise.race([
    redirected.then(() => ({ type: "redirect" })),
    success.waitFor({ timeout: 30000 }).then(() => ({ type: "success" })),
    error.waitFor({ timeout: 30000 }).then(() => ({ type: "error" })),
  ]);

  if (result.type === "error") {
    const msg = await page.locator("text=Signup Failed").locator("..").textContent();
    throw new Error(`Signup failed: ${msg}`);
  }

  // Extract token and slug from URL (either redirected or we need to get them)
  const url = page.url();
  const urlObj = new URL(url);
  const token = urlObj.searchParams.get("token");
  const tenant = urlObj.searchParams.get("tenant");

  return { token, tenant };
}

// ── Step 3: Setup Wizard ─────────────────────────────────────────────────

export async function completeSetupWizard(page, { token, slug, storeName }) {
  // Navigate to setup page
  await page.goto(`/setup?token=${token}&tenant=${slug}`);
  await page.waitForLoadState("networkidle");

  // Step 1 of 4: Store Identity
  await page.waitForSelector('text="Step 1 of 4"', { timeout: 15000 });
  const storeNameInput = page.locator('input[placeholder="e.g. Sunrise Mart"]');
  await storeNameInput.clear();
  await storeNameInput.fill(storeName);

  // Select Pakistan as country
  const countrySelect = page.locator("select").first();
  await countrySelect.selectOption("Pakistan");

  await page.locator('input[placeholder="e.g. Lahore"]').fill("Lahore");
  await page.locator('input[placeholder="+92 300 0000000"]').fill("+92 300 1234567");
  await page.locator('input[placeholder="store@example.com"]').fill(TEST_EMAIL);

  await page.getByRole("button", { name: "Next" }).click();

  // Step 2 of 4: Time & Currency
  await page.waitForSelector('text="Step 2 of 4"', { timeout: 10000 });
  // Pakistan auto-populates: timezone=Asia/Karachi, currency=PKR, denominations
  // Just verify and move on
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3 of 4: First Outlet
  await page.waitForSelector('text="Step 3 of 4"', { timeout: 10000 });
  const outletInput = page.locator('input[placeholder="Main Store"]');
  await outletInput.clear();
  await outletInput.fill("Test Outlet");
  await page
    .locator('textarea[placeholder="123 Main Street, City"]')
    .fill("123 Test Street, Lahore");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 4 of 4: Admin Account
  await page.waitForSelector('text="Step 4 of 4"', { timeout: 10000 });
  await page.locator('input[placeholder="e.g. Hassan Ali"]').fill(TEST_OWNER);
  // PIN fields — both have placeholder "••••"
  const pinFields = page.locator('input[type="password"][placeholder="••••"]');
  await pinFields.nth(0).fill(TEST_PIN);
  await pinFields.nth(1).fill(TEST_PIN);

  await page.getByRole("button", { name: "Complete Setup" }).click();

  // Wait for success
  await page.waitForSelector('text="Setup complete!"', { timeout: 30000 });
}

// ── Step 4: First Login ──────────────────────────────────────────────────

export async function firstLogin(page, { slug }) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  // Store Code — landing page uses "e.g. aceshardware"
  await page.locator('input[placeholder="e.g. aceshardware"]').fill(slug);
  // Username
  await page.locator('input[placeholder="Employee name"]').fill(TEST_OWNER);
  // Password — landing page uses "Enter your password"
  await page.locator('input[placeholder="Enter your password"]').fill(TEST_PASSWORD);

  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for dashboard (may pass through context-select first)
  await page.waitForURL(/\/(dashboard|context-select)/, { timeout: 30000 });

  // If on context-select, wait for auto-redirect or click through
  if (page.url().includes("context-select")) {
    // Admin with single outlet usually auto-redirects; wait for it
    await page.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(async () => {
      // If no auto-redirect, there might be a button to select outlet
      const continueBtn = page.getByRole("button", { name: /continue|select|go/i });
      if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await continueBtn.click();
        await page.waitForURL(/\/dashboard/, { timeout: 15000 });
      }
    });
  }

  await page.waitForLoadState("networkidle");

  // Extract token for API calls
  const token = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("authSession") || "{}");
    return s.token || null;
  });

  return { token };
}

// ── Step 5: Verify Billing Page ──────────────────────────────────────────

export async function verifyBillingPage(page, expectedPlan) {
  await page.goto("/billing");
  await page.waitForLoadState("networkidle");

  // The plan name is shown in a capitalize badge
  await page.waitForSelector(`text="${expectedPlan}"`, { timeout: 15000 });
}

// ── Step 6: Verify Support Widget ────────────────────────────────────────

export async function verifySupportWidget(page) {
  // Navigate to dashboard where the widget should be visible
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  // The floating support button should be visible
  const supportBtn = page.locator('button[aria-label="Support"]');
  await supportBtn.waitFor({ state: "visible", timeout: 10000 });
}

// ── Step 7: Add Products via API ─────────────────────────────────────────

export async function addProducts(token, slug) {
  const products = [
    { name: "Test Product A", price: 500, stock: 100, sku: `TPA-${Date.now()}` },
    { name: "Test Product B", price: 1200, stock: 50, sku: `TPB-${Date.now()}` },
  ];

  const created = [];
  for (const product of products) {
    const res = await fetch(`${BACKEND}/api/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-outlet-id": "1",
        "x-scope-mode": "outlet",
      },
      body: JSON.stringify({
        name: product.name,
        price: product.price,
        cost_price: Math.round(product.price * 0.6),
        sku: product.sku,
        track_stock: true,
        stock: product.stock,
        category_id: null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Add product failed: ${JSON.stringify(data)}`);
    created.push({ ...product, id: data.id || data.product?.id });
  }

  return created;
}

// ── Step 8: Open Cash Shift via API ──────────────────────────────────────

export async function openShift(token) {
  const res = await fetch(`${BACKEND}/api/shifts/open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-outlet-id": "1",
      "x-scope-mode": "outlet",
    },
    body: JSON.stringify({
      outlet_id: 1,
      opening_float: 5000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Open shift failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Step 9: Clock In via API ─────────────────────────────────────────────

export async function clockIn(token, employeeId, slug) {
  // Use the authenticated checkin endpoint to create an attendance_sessions record
  // (required by POS checkout validation)
  const res = await fetch(`${BACKEND}/api/attendance/pin-checkin?tenant=${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pin_code: TEST_PIN,
      outlet_id: 1,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Clock in failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Step 10: Make a Sale via API ─────────────────────────────────────────

export async function makeSale(token, products) {
  const cartItems = products.map((p) => ({
    id: p.id,
    name: p.name,
    quantity: 1,
    price: p.price,
  }));

  const total = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const res = await fetch(`${BACKEND}/api/sales`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-outlet-id": "1",
      "x-scope-mode": "outlet",
    },
    body: JSON.stringify({
      cartItems,
      outlet_id: 1,
      paymentMethod: "Cash",
      payments: [{ method: "Cash", amount: total }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sale failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Step 11: Verify Sale via API ─────────────────────────────────────────

export async function verifySale(token, saleId) {
  const res = await fetch(`${BACKEND}/api/sales/${saleId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-outlet-id": "1",
      "x-scope-mode": "outlet",
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Verify sale failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Plan Limit Helpers ───────────────────────────────────────────────────

export async function createEmployee(token, name, pin) {
  const res = await fetch(`${BACKEND}/api/employees`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-outlet-id": "1",
      "x-scope-mode": "outlet",
    },
    body: JSON.stringify({
      name,
      pin_code: pin,
      role_id: 3, // Cashier
      outlet_ids: [1],
    }),
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

export async function createOutlet(token, name) {
  const res = await fetch(`${BACKEND}/api/outlets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-outlet-id": "1",
      "x-scope-mode": "outlet",
    },
    body: JSON.stringify({
      name,
      address: "Test Address",
    }),
  });
  const data = await res.json();
  return { status: res.status, ok: res.ok, data };
}

// ── State Helpers ────────────────────────────────────────────────────────

export function saveOnboardingState(plan, updates) {
  const key = `onboard_${plan}`;
  const current = readState();
  const planState = current[key] || {};
  writeState({ [key]: { ...planState, ...updates } });
}

export function getOnboardingState(plan) {
  const current = readState();
  return current[`onboard_${plan}`] || {};
}
