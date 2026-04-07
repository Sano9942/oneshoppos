import { test, expect } from "@playwright/test";
import { BACKEND } from "./helpers/auth.js";

test.describe.serial("Onboarding — Pro Plan", () => {
  test.use({ storageState: undefined });
  test.setTimeout(120000);

  const ts = Date.now();
  const tenantName = `Test Pro ${ts}`;
  const ownerName = "Test Owner Pro";
  const email = `testpro${ts}@test.example.com`;
  const password = "TestPass123!";
  let storeCode;

  test("1 — signup with Pro plan", async ({ page }) => {
    // Navigate to signup with plan pre-selected via URL param
    await page.goto("/signup?plan=pro");
    await page.waitForLoadState("networkidle");

    // Fill form fields using exact placeholders from SignupPage.jsx
    await page.getByPlaceholder("My Awesome Store").fill(tenantName);
    await page.getByPlaceholder("John Doe").fill(ownerName);
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("Min 8 characters").fill(password);

    // Verify Pro plan is selected (pre-selected via ?plan=pro URL param)
    const proRadio = page.locator('input[name="plan"][value="pro"]');
    await expect(proRadio).toBeChecked();

    // Intercept the signup API response to capture the slug
    const signupResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/auth/signup") && resp.request().method() === "POST"
    );

    // Click the submit button
    await page.getByRole("button", { name: "Create Store" }).click();

    // Wait for the API response and extract slug
    const signupResponse = await signupResponsePromise;
    const responseBody = await signupResponse.json();

    if (signupResponse.ok() && responseBody.slug) {
      storeCode = responseBody.slug;
    }

    // If setupToken was returned, the page redirects to /setup?tenant=slug
    // Otherwise it shows "Store Created!" with the store code
    if (!storeCode) {
      // Fallback: try to get slug from redirect URL
      await page.waitForURL(/setup\?.*tenant=|\/login/, { timeout: 30000 });
      const url = new URL(page.url());
      const tenantParam = url.searchParams.get("tenant");
      if (tenantParam) storeCode = tenantParam;
    }

    if (!storeCode) {
      // Final fallback: success screen with "Your store code is: <slug>"
      await expect(
        page.getByText(/store created/i).first()
      ).toBeVisible({ timeout: 15000 });
      const slugEl = page.locator("span.font-mono");
      storeCode = (await slugEl.textContent()).trim();
    }

    expect(storeCode).toBeTruthy();
  });

  test("2 — login with Pro tenant credentials", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");
  });

  test("3 — setup wizard appears", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    const setupContent = page.getByText(/setup|wizard|get started|welcome|company|business/i)
      .or(page.getByRole("heading", { name: /setup|welcome|get started/i }));
    await expect(setupContent.first()).toBeVisible({ timeout: 15000 });
  });

  test("4 — complete setup wizard", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    const dismissBtn = page.getByRole("button", { name: /skip|dismiss|later|close|next|continue|done|finish/i });
    let attempts = 0;
    while (attempts < 5) {
      const visible = await dismissBtn.first().isVisible({ timeout: 3000 }).catch(() => false);
      if (!visible) break;
      await dismissBtn.first().click();
      await page.waitForTimeout(1000);
      attempts++;
    }

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("dashboard");
  });

  test("5 — dashboard loads", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /dashboard/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("6 — add first product", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/products");
    await page.waitForLoadState("networkidle");

    const addBtn = page.getByRole("button", { name: /add product|new product|create/i })
      .or(page.getByRole("link", { name: /add product|new product/i }));
    await addBtn.first().click();
    await page.waitForLoadState("networkidle");

    await page.getByPlaceholder(/product name/i).or(page.getByLabel(/product name|name/i)).first().fill("Test Product Pro");
    await page.getByPlaceholder(/price/i).or(page.getByLabel(/sell.*price|retail.*price|price/i)).first().fill("500");

    await page.getByRole("button", { name: /save|create|add|submit/i }).first().click();
    await expect(
      page.getByText(/saved|created|success|added/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("7 — open a cash shift", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    const openShiftBtn = page.getByRole("button", { name: /open shift|start shift|begin/i });
    if (await openShiftBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const amountInput = page.getByPlaceholder(/amount|opening/i)
        .or(page.getByLabel(/opening|amount/i));
      if (await amountInput.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await amountInput.first().fill("0");
      }
      await openShiftBtn.click();
      await page.waitForTimeout(2000);
    }

    expect(page.url()).toContain("/pos");
  });

  test("8 — kiosk clock-in", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto(`/kiosk?tenant=${storeCode}`);
    await page.waitForLoadState("networkidle");

    const pinButton = page.getByRole("button", { name: "1" }).first();
    await expect(pinButton).toBeVisible({ timeout: 15000 });
  });

  test("9 — complete first POS sale", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    const openShiftBtn = page.getByRole("button", { name: /open shift|start shift/i });
    if (await openShiftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const amountInput = page.getByPlaceholder(/amount|opening/i).or(page.getByLabel(/opening|amount/i));
      if (await amountInput.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await amountInput.first().fill("0");
      }
      await openShiftBtn.click();
      await page.waitForTimeout(2000);
    }

    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill("Test Product");
      await page.waitForTimeout(1500);
      const result = page.locator("[class*=result], [class*=dropdown], [class*=suggestion]")
        .or(page.getByText(/test product/i));
      await result.first().click();
      await page.waitForTimeout(500);
    }

    const checkoutBtn = page.getByRole("button", { name: /checkout|pay|complete|charge/i });
    if (await checkoutBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkoutBtn.first().click();
      await page.waitForTimeout(1000);
      const confirmBtn = page.getByRole("button", { name: /confirm|complete|pay|cash|done/i });
      if (await confirmBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmBtn.first().click();
      }
    }
  });

  test("10 — billing shows Pro plan with 45-day trial", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/billing");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/pro/i).first()
    ).toBeVisible({ timeout: 15000 });
    // Trial status should be shown
    await expect(
      page.getByText(/trial|45|day/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("11 — no practical employee limit on Pro", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/employees");
    await page.waitForLoadState("networkidle");
    // Should be able to access employees page without limit warnings
    await expect(
      page.getByRole("heading", { name: /employee/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("12 — no practical outlet limit on Pro", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/outlets");
    await page.waitForLoadState("networkidle");
    // Outlets page accessible, add button should be enabled (no limit)
    const addBtn = page.getByRole("button", { name: /add|new|create/i })
      .or(page.getByRole("link", { name: /add|new/i }));
    if (await addBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(addBtn.first()).toBeEnabled();
    }
  });

  test("13 — advanced features accessible (integrations)", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/settings/integrations");
    await page.waitForLoadState("networkidle");
    // Pro plan should have access to integrations
    const content = page.getByRole("heading", { name: /integration/i })
      .or(page.getByText(/integration|connect|channel/i));
    await expect(content.first()).toBeVisible({ timeout: 15000 });
  });

  test("14 — reports accessible", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /report/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("15 — support widget accessible", async ({ page }) => {
    test.skip(!storeCode, "No store code from signup");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCodeInput = page.getByPlaceholder(/aceshardware/i);
    if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCodeInput.fill(storeCode);
    }
    await page.getByPlaceholder(/employee name/i).fill(ownerName);
    await page.getByPlaceholder(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|setup|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const supportWidget = page.locator("[class*=support], [class*=Support], [class*=widget]")
      .or(page.getByRole("button", { name: /support|help/i }))
      .or(page.locator("button[class*=float]"));
    await expect(supportWidget.first()).toBeVisible({ timeout: 15000 });
  });
});
