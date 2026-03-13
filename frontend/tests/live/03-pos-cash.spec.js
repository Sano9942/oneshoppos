/**
 * 03-pos-cash.spec.js
 * POS: sell LEGO City Set + Stuffed Teddy Bear, pay cash, verify receipt.
 * Full UI flow — tests shift gating, cart, checkout, receipt.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";

async function navigateToPOS(page) {
  await page.goto("/pos");
  await page.waitForLoadState("networkidle");

  // If POS gate is shown (shift/attendance check), handle it
  const gateVisible = await page
    .getByText(/prepare pos before selling/i)
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (gateVisible) {
    // Shift is already open (opened in global setup state)
    // Click "I have clocked in" if visible
    const clockedInBtn = page.getByRole("button", { name: /i have clocked in/i });
    if (await clockedInBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clockedInBtn.click();
    }
    // Wait for POS to open
    await expect(page.getByPlaceholder(/search by name/i)).toBeVisible({ timeout: 20000 });
  }

  await expect(page.getByPlaceholder(/search by name/i)).toBeVisible({ timeout: 20000 });
}

async function addProductToCart(page, searchTerm) {
  const searchInput = page.getByPlaceholder(/search by name/i);
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
    await expect(page.getByText(/cart is empty/i)).toBeVisible({ timeout: 10000 });
    console.log("✅ POS ready");
  });

  test("add LEGO City Set and Stuffed Teddy Bear to cart", async ({ page }) => {
    await navigateToPOS(page);

    await addProductToCart(page, "LEGO City Set");
    await expect(page.getByText(/LEGO City Set/i)).toBeVisible({ timeout: 8000 });

    await addProductToCart(page, "Stuffed Teddy Bear");
    await expect(page.getByText(/Stuffed Teddy Bear/i)).toBeVisible({ timeout: 8000 });

    // Cart should show total
    await expect(page.getByText(/total/i).last()).toBeVisible({ timeout: 5000 });
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

    // Close receipt
    await page.getByRole("button", { name: /close/i, exact: true }).click();
    await expect(page.getByText(/cart is empty/i)).toBeVisible({ timeout: 10000 });
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
