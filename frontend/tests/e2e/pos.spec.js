import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("POS Checkout Flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("should complete a cash sale successfully", async ({ page }) => {
    // 1. Navigate to POS
    await page.goto("/pos");

    // Wait for POS to load properly
    await expect(page.getByPlaceholder(/Search by Name, Barcode/i)).toBeVisible(
      { timeout: 15000 },
    );

    // 2. Search for a product (Widget A - PROD-001)
    const searchInput = page.getByPlaceholder(/Search by Name, Barcode/i);
    await searchInput.fill("PROD-001");

    // Wait for the dropdown and click the first result (Widget A)
    // The dropdown has a structure like: div > div > div:has-text("Widget A")
    const searchDropdownItem = page
      .locator('div:has-text("Widget A")')
      .locator("visible=true")
      .last();
    await expect(searchDropdownItem).toBeVisible({ timeout: 15000 });

    // Use force true to ensure the click registers even if a tooltip or focus state obscures it
    await searchDropdownItem.click({ force: true });

    // Give React a moment to update the cart state
    await page.waitForTimeout(1000);

    // 4. Verify item added to cart
    // The redesigned POS doesn't use a <table> for the cart. Look for the item name in the body.
    await expect(page.getByText("Widget A").last()).toBeVisible();

    // 5. Click Pay
    await page.getByRole("button", { name: /pay/i }).click();

    // 6. In Checkout Modal, add Cash payment
    // Wait for modal
    await expect(page.getByText(/Complete Payment/i)).toBeVisible();
    await page.getByRole("button", { name: /^add$/i }).click();

    // 7. Complete Sale
    await page.getByRole("button", { name: /complete sale/i }).click();

    // 8. Verify Success & Receipt
    await expect(page.getByText(/Sale Complete/i)).toBeVisible();
    await expect(page.getByText(/Invoice:/i)).toBeVisible();

    // 9. Close Receipt
    await page.getByRole("button", { name: /close/i }).click();
    await expect(page.getByText(/Cart is empty/i)).toBeVisible();
  });
});
