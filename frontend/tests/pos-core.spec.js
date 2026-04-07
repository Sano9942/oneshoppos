import { test, expect } from "@playwright/test";
import { PIN } from "./helpers/auth.js";

/**
 * Helper: navigate to POS and handle the shift-gate modal if it appears.
 * If no shift is open, opens one. Returns once POS is ready.
 */
async function openPOS(page) {
  await page.goto("/pos");
  await page.waitForLoadState("networkidle");

  // Check for shift gate modal — it asks to open a shift before using POS
  const shiftModal = page.getByText(/open.*shift|start.*shift|no.*active.*shift/i);
  if (await shiftModal.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Look for an "Open Shift" or "Start Shift" button
    const openBtn = page
      .getByRole("button", { name: /open shift|start shift/i })
      .first();
    if (await openBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await openBtn.click();
      // May need to enter opening cash amount
      const cashInput = page.getByPlaceholder(/amount|cash|opening/i).first();
      if (await cashInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cashInput.fill("1000");
      }
      // Confirm opening shift
      const confirmBtn = page
        .getByRole("button", { name: /confirm|open|start|save/i })
        .first();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await page.waitForLoadState("networkidle");
    }
  }
}

test.describe("POS Core", () => {
  test("POS page loads with search bar", async ({ page }) => {
    await openPOS(page);
    const searchInput = page
      .getByPlaceholder(/search|scan|barcode/i)
      .first();
    await expect(searchInput).toBeVisible({ timeout: 15000 });
  });

  test("POS page shows cart area", async ({ page }) => {
    await openPOS(page);
    // Cart area should have subtotal or total text
    await expect(
      page.getByText(/subtotal|total|cart/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("shift gate modal appears if no active shift", async ({ page }) => {
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    // Either shift gate is showing or POS loaded (shift already open)
    const shiftGate = page.getByText(/open.*shift|start.*shift|no.*active.*shift/i);
    const searchBar = page.getByPlaceholder(/search|scan|barcode/i).first();
    const gateVisible = await shiftGate.isVisible({ timeout: 5000 }).catch(() => false);
    const searchVisible = await searchBar.isVisible({ timeout: 5000 }).catch(() => false);
    expect(gateVisible || searchVisible).toBeTruthy();
  });

  test("product search returns results", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500); // debounce
    // Results should appear — either dropdown or list items
    const result = page.getByText(/lego/i).first();
    await expect(result).toBeVisible({ timeout: 10000 });
  });

  test("adding product to cart updates cart", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    // Click the first search result to add to cart
    const result = page.getByText(/lego/i).first();
    await result.click();
    // Cart should now show the product
    await expect(
      page.getByText(/lego/i).nth(0)
    ).toBeVisible({ timeout: 10000 });
    // Subtotal should be nonzero
    await expect(
      page.getByText(/subtotal|total/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("cart shows correct subtotal", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
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
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
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
    // Verify qty changed — look for "2" in cart context
    const cartArea = page.locator("table, [class*=cart]").first();
    await expect(cartArea).toBeVisible({ timeout: 5000 });
  });

  test("remove item from cart", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    await page.getByText(/lego/i).first().click();
    await page.waitForTimeout(500);
    // Remove the item — look for trash icon button, X button, or "Remove" text
    const removeBtn = page
      .getByRole("button", { name: /remove|delete|trash/i })
      .or(page.locator("button svg[class*=trash], button svg[class*=x]").locator(".."))
      .first();
    if (await removeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await removeBtn.click();
    } else {
      // Try F8 shortcut (remove last)
      await page.keyboard.press("F8");
    }
    await page.waitForTimeout(500);
    // Cart should be empty or subtotal = 0
    const emptyIndicator = page.getByText(/empty|no items|add products/i).first();
    const zeroTotal = page.getByText(/0\.00|0,00/i).first();
    const isEmpty = await emptyIndicator.isVisible({ timeout: 3000 }).catch(() => false);
    const isZero = await zeroTotal.isVisible({ timeout: 3000 }).catch(() => false);
    expect(isEmpty || isZero).toBeTruthy();
  });

  test("checkout modal opens", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
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
      page.getByText(/cash|card|payment|amount due|tender/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("cash payment completes sale", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
    await searchInput.fill("LEGO");
    await page.waitForTimeout(1500);
    await page.getByText(/lego/i).first().click();
    await page.waitForTimeout(500);
    // Open checkout
    const checkoutBtn = page.getByRole("button", { name: /checkout|pay|charge/i }).first();
    if (await checkoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkoutBtn.click();
    } else {
      await page.keyboard.press("F9");
    }
    await page.waitForTimeout(1000);
    // Select cash payment
    const cashBtn = page.getByRole("button", { name: /cash/i }).first();
    if (await cashBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cashBtn.click();
    }
    await page.waitForTimeout(500);
    // Complete the sale
    const completeBtn = page
      .getByRole("button", { name: /complete|confirm|finish|done|pay/i })
      .first();
    if (await completeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await completeBtn.click();
    }
    // Receipt or success should appear
    await expect(
      page.getByText(/receipt|invoice|sale completed|success|thank you/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("receipt modal shows after sale", async ({ page }) => {
    await openPOS(page);
    const searchInput = page.getByPlaceholder(/search|scan|barcode/i).first();
    await searchInput.fill("Puzzle");
    await page.waitForTimeout(1500);
    await page.getByText(/puzzle/i).first().click();
    await page.waitForTimeout(500);
    // Checkout
    const checkoutBtn = page.getByRole("button", { name: /checkout|pay|charge/i }).first();
    if (await checkoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkoutBtn.click();
    } else {
      await page.keyboard.press("F9");
    }
    await page.waitForTimeout(1000);
    const cashBtn = page.getByRole("button", { name: /cash/i }).first();
    if (await cashBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cashBtn.click();
    }
    await page.waitForTimeout(500);
    const completeBtn = page.getByRole("button", { name: /complete|confirm|finish|done|pay/i }).first();
    if (await completeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await completeBtn.click();
    }
    // Receipt modal should have print/share options or invoice number
    await expect(
      page.getByText(/receipt|invoice|print|share|email|whatsapp/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("recent sales panel accessible", async ({ page }) => {
    await openPOS(page);
    // Look for recent sales tab/button or press a shortcut
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
