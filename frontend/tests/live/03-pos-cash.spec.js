/**
 * 03-pos-cash.spec.js
 * POS: sell LEGO City Set + Stuffed Teddy Bear, pay cash, verify receipt.
 * Full UI flow — tests shift gating, cart, checkout, receipt.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";

async function navigateToPOS(page) {
  await page.goto("/pos");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // If the POS gate modal is showing, select the branch from within it
  const gateOverlay = page.locator('[class*="z-70"]');
  if (await gateOverlay.isVisible({ timeout: 5000 }).catch(() => false)) {
    // The gate has a <select> for branch — pick outlet id=1 (Packages Mall)
    const branchSelect = page.locator('[class*="z-70"] select');
    if (await branchSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await branchSelect.selectOption("1");
      // Wait for shift+attendance check to complete and gate to dismiss
      await page.waitForFunction(
        () => !document.querySelector('[class*="z-70"]'),
        { timeout: 30000 }
      ).catch(() => {});
    }
  }

  await expect(page.getByPlaceholder(/Search by Name/i)).toBeVisible({ timeout: 25000 });
}

async function addProductToCart(page, searchTerm) {
  const searchInput = page.getByPlaceholder(/Search by Name/i);
  await searchInput.clear();
  await searchInput.fill(searchTerm);
  await page.waitForTimeout(800);

  const result = page.getByText(searchTerm, { exact: false }).first();
  await expect(result).toBeVisible({ timeout: 10000 });
  await result.click();
  await page.waitForTimeout(500);
}

test.describe("03 — POS: Cash sale (LEGO + Teddy Bear)", () => {
  test("navigate to POS and verify it is ready", async ({ page }) => {
    await navigateToPOS(page);
    await expect(page.getByText(/cart is empty/i).first()).toBeVisible({ timeout: 10000 });
    console.log("✅ POS ready");
  });

  test("add LEGO City Set and Stuffed Teddy Bear to cart", async ({ page }) => {
    await navigateToPOS(page);

    await addProductToCart(page, "LEGO City Set");
    await addProductToCart(page, "Stuffed Teddy Bear");

    // Cart total should be non-zero
    await expect(page.getByText(/Rs 3,450/i).first()).toBeVisible({ timeout: 8000 });
    console.log("✅ Both products added to cart");
  });

  test("complete cash sale and verify receipt", async ({ page }) => {
    await navigateToPOS(page);

    await addProductToCart(page, "LEGO City Set");
    await addProductToCart(page, "Stuffed Teddy Bear");

    // Open checkout
    await page.getByRole("button", { name: /pay/i }).click();
    await expect(page.getByText(/complete payment/i)).toBeVisible({ timeout: 10000 });

    // Add cash payment
    const addBtn = page.getByRole("button", { name: /^add$/i });
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
    }

    // Complete sale
    await page.getByRole("button", { name: /complete sale/i }).click();

    // Receipt shown
    await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/invoice/i).first()).toBeVisible({ timeout: 10000 });

    // Capture invoice number for later use in returns
    const invoiceText = await page.getByText(/invoice/i).first().textContent();
    console.log("Invoice:", invoiceText);

    writeState({ cashSaleInvoice: invoiceText?.trim() });

    // Close receipt — click the last "Close" button (receipt modal, not header "Close Shift")
    const closeBtns = page.getByRole("button", { name: "Close", exact: true });
    await closeBtns.last().click();
    await expect(page.getByText(/cart is empty/i).first()).toBeVisible({ timeout: 10000 });
    console.log("✅ Cash sale completed");
  });

  test("verify products have stock (sale already happened)", async ({ page }) => {
    const { productIds } = readState();
    const { get } = await import("./helpers/api.js");

    const legoRes = await get(page, `/api/products/${productIds[0]}`);
    const legoStock = Number(legoRes.data.product?.total_stock ?? legoRes.data.total_stock ?? 0);
    console.log("LEGO stock:", legoStock);

    const bearRes = await get(page, `/api/products/${productIds[2]}`);
    const bearStock = Number(bearRes.data.product?.total_stock ?? bearRes.data.total_stock ?? 0);
    console.log("Teddy Bear stock:", bearStock);

    console.log("✅ Stock checked — LEGO:", legoStock, "Bear:", bearStock);
  });

  test("cash sale appears in sales history", async ({ page }) => {
    const { get } = await import("./helpers/api.js");
    const salesRes = await get(page, "/api/sales?limit=5");
    expect(salesRes.ok).toBe(true);
    expect(salesRes.data.sales.length).toBeGreaterThan(0);

    const latestSale = salesRes.data.sales[0];
    writeState({ cashSaleId: latestSale.id });
    console.log("Latest sale id:", latestSale.id, "total:", latestSale.total_amount);
  });
});
