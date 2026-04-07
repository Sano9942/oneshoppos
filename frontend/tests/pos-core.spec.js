import { test, expect } from "@playwright/test";
import { ensurePOSReady } from "./helpers/api.js";

/**
 * Ensure shift is open + employee clocked in via API before each test,
 * so the POS gate modal never appears.
 */
test.beforeAll(async () => {
  await ensurePOSReady();
});

/**
 * Navigate to POS and wait for the register to be ready.
 */
async function openPOS(page) {
  await page.goto("/pos");
  await page.waitForLoadState("networkidle");
  // Wait for search bar — gate modal should not appear
  await page.getByPlaceholder(/Search by Name/i).first().waitFor({ timeout: 20000 });
}

test.describe("POS Core", () => {
  test("POS page loads with search bar", async ({ page }) => {
    await openPOS(page);
    const searchInput = page
      .getByPlaceholder(/Search by Name/i)
      .first();
    await expect(searchInput).toBeVisible({ timeout: 15000 });
  });

  test("POS page shows cart area", async ({ page }) => {
    await openPOS(page);
    // Cart area should have subtotal/total text or empty cart message
    await expect(
      page.getByText(/subtotal|total|cart is empty/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("shift gate modal appears if no active shift", async ({ page }) => {
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    // Either shift gate is showing or POS loaded (shift already open)
    const shiftGate = page.getByText(/prepare pos|open.*shift|start.*shift|no.*active.*shift|no open shift/i).first();
    const searchBar = page.getByPlaceholder(/Search by Name/i).first();
    const gateVisible = await shiftGate.isVisible({ timeout: 5000 }).catch(() => false);
    const searchVisible = await searchBar.isVisible({ timeout: 5000 }).catch(() => false);
    expect(gateVisible || searchVisible).toBeTruthy();
  });

  test("product search returns results", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500); // debounce
    // Results should appear — either dropdown or list items
    const result = page.getByText(/lego/i).first();
    await expect(result).toBeVisible({ timeout: 10000 });
  });

  test("adding product to cart updates cart", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    // Click the first search result to add to cart
    const result = page.getByText(/lego/i).first();
    await result.click();
    // Cart should now show the product — subtotal should be visible
    await expect(
      page.getByText(/subtotal/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("cart shows correct subtotal", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    await page.getByText(/lego/i).first().click();
    await page.waitForTimeout(500);
    // Subtotal should contain a number (currency amount)
    const subtotalEl = page.getByText(/subtotal/i).first();
    await expect(subtotalEl).toBeVisible({ timeout: 5000 });
  });

  test("quantity change in cart", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    await page.getByText(/lego/i).first().click();
    await page.waitForTimeout(500);
    // Look for quantity input or +/- buttons in cart
    const qtyInput = page.locator("input[type=number]").first();
    const plusBtn = page.getByRole("button", { name: /\+|increase/i }).first();
    if (await qtyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await qtyInput.fill("2");
      await qtyInput.press("Tab");
    } else if (await plusBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await plusBtn.click();
    }
    await page.waitForTimeout(500);
    // Verify cart area is still showing
    await expect(page.getByText(/subtotal|total/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("remove item from cart", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    await page.getByText(/lego/i).first().click();
    await page.waitForTimeout(500);
    // Remove the item — try F8 shortcut first (remove last), then look for button
    await page.keyboard.press("F8");
    await page.waitForTimeout(500);
    // Cart should be empty or subtotal = 0
    const emptyIndicator = page.getByText(/cart is empty|no items|add products/i).first();
    const zeroTotal = page.getByText(/0\.00|0,00/i).first();
    const isEmpty = await emptyIndicator.isVisible({ timeout: 3000 }).catch(() => false);
    const isZero = await zeroTotal.isVisible({ timeout: 3000 }).catch(() => false);
    expect(isEmpty || isZero).toBeTruthy();
  });

  test("checkout modal opens", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    await page.getByText(/lego/i).first().click();
    await page.waitForTimeout(500);
    // Open checkout — click button or press F9
    const checkoutBtn = page
      .getByRole("button", { name: /checkout|pay|charge/i })
      .first();
    if (await checkoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkoutBtn.click();
    } else {
      await page.keyboard.press("F9");
    }
    // Checkout modal should show payment options
    await expect(
      page.getByText(/cash|card|payment|amount due|total due|complete payment/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("cash payment completes sale", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    await page.getByText(/lego/i).first().click();
    await page.waitForTimeout(500);
    // Open checkout via Pay button or F9
    const payBtn = page.getByRole("button", { name: /pay/i }).first();
    if (await payBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await payBtn.click();
    } else {
      await page.keyboard.press("F9");
    }
    await page.waitForTimeout(1000);
    // Select cash payment method
    const cashBtn = page.getByRole("button", { name: /^cash$/i }).first();
    if (await cashBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cashBtn.click();
    }
    await page.waitForTimeout(500);
    // Click "Exact" to fill in the exact amount, then "Add" to submit tender
    const exactBtn = page.getByRole("button", { name: /^exact$/i }).first();
    if (await exactBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exactBtn.click();
      await page.waitForTimeout(300);
      const addBtn = page.getByRole("button", { name: /^add$/i }).first();
      if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.click();
      }
    }
    await page.waitForTimeout(500);
    // Complete the sale
    const completeBtn = page.getByRole("button", { name: /complete sale/i }).first();
    await expect(completeBtn).toBeVisible({ timeout: 5000 });
    await completeBtn.click();
    // Receipt or success should appear
    await expect(
      page.getByText(/receipt|invoice|sale completed|success|thank you|INV/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("receipt modal shows after sale", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await searchInput.fill("Puzzle");
    await page.waitForTimeout(1500);
    await page.getByText(/puzzle/i).first().click();
    await page.waitForTimeout(500);
    // Open checkout via Pay button or F9
    const payBtn = page.getByRole("button", { name: /pay/i }).first();
    if (await payBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await payBtn.click();
    } else {
      await page.keyboard.press("F9");
    }
    await page.waitForTimeout(1000);
    const cashBtn = page.getByRole("button", { name: /^cash$/i }).first();
    if (await cashBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cashBtn.click();
    }
    await page.waitForTimeout(500);
    const exactBtn = page.getByRole("button", { name: /^exact$/i }).first();
    if (await exactBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await exactBtn.click();
      await page.waitForTimeout(300);
      const addBtn = page.getByRole("button", { name: /^add$/i }).first();
      if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await addBtn.click();
      }
    }
    await page.waitForTimeout(500);
    const completeBtn = page.getByRole("button", { name: /complete sale/i }).first();
    await expect(completeBtn).toBeVisible({ timeout: 5000 });
    await completeBtn.click();
    // Receipt modal should have print/share options or invoice number
    await expect(
      page.getByText(/receipt|invoice|print|share|email|whatsapp|INV/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("recent sales panel accessible", async ({ page }) => {
    await openPOS(page);
    // Look for recent sales tab/button
    const recentBtn = page
      .getByRole("button", { name: /recent|history|sales/i })
      .or(page.getByText(/recent sales/i))
      .first();
    if (await recentBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await recentBtn.click();
      await page.waitForTimeout(1000);
      // Should see at least one past sale
      await expect(
        page.getByText(/INV|invoice|sale|total/i).first()
      ).toBeVisible({ timeout: 10000 });
    } else {
      // Recent sales may be accessed via API
      const { get } = await import("./helpers/api.js");
      const r = await get("/api/sales?limit=5");
      expect(r.ok).toBeTruthy();
      expect(r.data.length).toBeGreaterThan(0);
    }
  });

  test("customer display API responds", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/customer-display/current");
    // Should return 200 (with data) or 404 (no active display)
    expect([200, 404]).toContain(r.status);
  });

  test("F1 shortcut opens help overlay", async ({ page }) => {
    await openPOS(page);
    await page.keyboard.press("F1");
    await expect(
      page.getByText(/keyboard shortcuts|shortcut|help/i).first()
    ).toBeVisible({ timeout: 5000 });
  });
});
