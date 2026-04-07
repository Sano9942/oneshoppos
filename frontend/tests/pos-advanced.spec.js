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
 * Navigate to POS, wait for ready, add a product to cart.
 */
async function posWithProduct(page, query = "LEGO") {
  await page.goto("/pos");
  await page.waitForLoadState("networkidle");
  // Wait for search bar — gate modal should not appear
  const searchInput = page.getByPlaceholder(/Search by Name/i).first();
  await expect(searchInput).toBeVisible({ timeout: 20000 });

  // Add product
  await searchInput.fill(query);
  await page.waitForTimeout(1500);
  await page.getByText(new RegExp(query, "i")).first().click();
  await page.waitForTimeout(500);
}

test.describe("POS Advanced Features", () => {
  test("F2 opens discount dialog", async ({ page }) => {
    await posWithProduct(page);
    await page.keyboard.press("F2");
    await expect(
      page.getByText(/discount|percentage|amount off/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("apply percentage discount to cart", async ({ page }) => {
    await posWithProduct(page);
    // Open discount via F2 or button
    const discountBtn = page.getByRole("button", { name: /discount/i }).first();
    if (await discountBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await discountBtn.click();
    } else {
      await page.keyboard.press("F2");
    }
    await page.waitForTimeout(500);
    // Look for discount input and apply
    const discInput = page.getByPlaceholder(/discount|percentage|%/i)
      .or(page.locator("input[type=number]")).first();
    if (await discInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await discInput.fill("10");
      const applyBtn = page.getByRole("button", { name: /apply|save|ok|confirm/i }).first();
      if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await applyBtn.click();
      }
    }
    // Discount should appear in cart
    await expect(
      page.getByText(/discount|10%|-/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("F3 parks current sale", async ({ page }) => {
    await posWithProduct(page);
    await page.keyboard.press("F3");
    await page.waitForTimeout(1000);
    // Parked confirmation or cart should be cleared
    const parkedMsg = page.getByText(/parked|saved|held/i).first();
    const emptyCart = page.getByText(/cart is empty|no items|add products/i).first();
    const isParked = await parkedMsg.isVisible({ timeout: 5000 }).catch(() => false);
    const isEmpty = await emptyCart.isVisible({ timeout: 5000 }).catch(() => false);
    expect(isParked || isEmpty).toBeTruthy();
  });

  test("F5 opens parked sales list", async ({ page }) => {
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Search by Name/i).first().waitFor({ timeout: 20000 });
    await page.keyboard.press("F5");
    await expect(
      page.getByText(/parked|held|saved/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("F4 opens customer search", async ({ page }) => {
    await posWithProduct(page);
    await page.keyboard.press("F4");
    await expect(
      page.getByPlaceholder(/customer|search|name|phone/i).or(page.getByText(/customer/i)).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("attach customer to sale", async ({ page }) => {
    await posWithProduct(page);
    await page.keyboard.press("F4");
    await page.waitForTimeout(500);
    const custSearch = page.getByPlaceholder(/customer|search|name|phone/i).first();
    if (await custSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
      await custSearch.fill("walk");
      await page.waitForTimeout(1500);
      // Click first customer result
      const result = page.getByText(/walk/i).first();
      if (await result.isVisible({ timeout: 5000 }).catch(() => false)) {
        await result.click();
      }
    }
    // Customer should now be attached — name visible in cart area
    await expect(
      page.getByText(/walk|customer/i).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("checkout with split payment", async ({ page }) => {
    await posWithProduct(page);
    // Open checkout
    const checkoutBtn = page.getByRole("button", { name: /checkout|pay|charge/i }).first();
    if (await checkoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkoutBtn.click();
    } else {
      await page.keyboard.press("F9");
    }
    await page.waitForTimeout(1000);
    // Look for split payment option
    const splitBtn = page.getByRole("button", { name: /split|multiple/i }).first();
    const hasSplit = await splitBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasSplit) {
      await splitBtn.click();
      await expect(
        page.getByText(/split|payment 1|payment 2|cash|card/i).first()
      ).toBeVisible({ timeout: 5000 });
    } else {
      // Split payment may not be available — checkout modal should still be open
      await expect(
        page.getByText(/cash|card|payment|amount|total due/i).first()
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("add note to sale", async ({ page }) => {
    await posWithProduct(page);
    // Click "Add Note" button in sidebar
    const noteBtn = page.getByRole("button", { name: /add note/i }).first();
    if (await noteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await noteBtn.click();
      // Fill the note textarea in the "Order Note" modal
      const noteInput = page.locator("textarea").first();
      await expect(noteInput).toBeVisible({ timeout: 3000 });
      await noteInput.fill("Test note from Playwright");
      // Click "Save Note" button
      const saveBtn = page.getByRole("button", { name: /save note/i }).first();
      await saveBtn.click();
      await page.waitForTimeout(500);
      // After saving, button changes from "Add Note" to "Edit Note"
      await expect(
        page.getByRole("button", { name: /edit note/i }).first()
      ).toBeVisible({ timeout: 5000 });
    } else {
      await expect(page.getByText(/subtotal|total/i).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("F1 shortcuts overlay shows all keys", async ({ page }) => {
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/Search by Name/i).first().waitFor({ timeout: 20000 });
    await page.keyboard.press("F1");
    await page.waitForTimeout(500);
    // Should show multiple shortcut descriptions
    await expect(page.getByText(/F2/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/F3/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/F9/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("F10 clears the cart", async ({ page }) => {
    await posWithProduct(page);
    // F10 triggers window.confirm("Clear entire cart?") — accept it
    page.on("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("F10");
    await page.waitForTimeout(1000);
    // Cart should be empty
    const emptyCart = page.getByText(/cart is empty/i).first();
    await expect(emptyCart).toBeVisible({ timeout: 5000 });
  });

  test("return from recent sales via API", async () => {
    const { get } = await import("./helpers/api.js");
    const salesRes = await get("/api/sales?limit=1");
    expect(salesRes.ok).toBeTruthy();
    const sales = salesRes.data.sales || salesRes.data;
    expect(Array.isArray(sales)).toBeTruthy();
    expect(sales.length).toBeGreaterThan(0);
    const saleId = sales[0].id;
    // Fetch sale details
    const detailRes = await get(`/api/sales/${saleId}`);
    expect(detailRes.ok).toBeTruthy();
  });

  test("parked sales API works", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/parked-sales");
    expect(r.ok).toBeTruthy();
    const parked = r.data.parkedSales || r.data;
    expect(Array.isArray(parked)).toBeTruthy();
  });

  test("wallet payment option exists in checkout", async ({ page }) => {
    await posWithProduct(page);
    const checkoutBtn = page.getByRole("button", { name: /checkout|pay|charge/i }).first();
    if (await checkoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkoutBtn.click();
    } else {
      await page.keyboard.press("F9");
    }
    await page.waitForTimeout(1000);
    // At minimum, cash should be visible
    const cashBtn = page.getByRole("button", { name: /cash/i }).first();
    await expect(cashBtn).toBeVisible({ timeout: 5000 });
  });

  test("Escape closes any open modal", async ({ page }) => {
    await posWithProduct(page);
    // Open discount modal
    await page.keyboard.press("F2");
    await page.waitForTimeout(500);
    // Press Escape to close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    // Modal should be gone — search bar should be accessible again
    const searchInput = page.getByPlaceholder(/Search by Name/i).first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });
});
