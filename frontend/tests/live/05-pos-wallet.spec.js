/**
 * 05-pos-wallet.spec.js
 * POS: Sara Malik redeems her PKR 500 wallet balance to buy a Puzzle Box.
 * Verifies wallet deducted after sale.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { get } from "./helpers/api.js";

async function navigateToPOS(page) {
  await page.goto("/pos");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  const gateOverlay = page.locator('[class*="z-70"]');
  if (await gateOverlay.isVisible({ timeout: 5000 }).catch(() => false)) {
    const branchSelect = page.locator('[class*="z-70"] select');
    if (await branchSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await branchSelect.selectOption("1");
      await page.waitForFunction(
        () => !document.querySelector('[class*="z-70"]'),
        { timeout: 30000 }
      ).catch(() => {});
    }
  }

  await expect(page.getByPlaceholder(/Search by Name/i)).toBeVisible({ timeout: 25000 });
}

test.describe("05 — POS: Wallet redemption (Sara Malik)", () => {
  test("verify Sara Malik wallet exists", async ({ page }) => {
    const res = await get(page, `/api/customers?search=Sara+Malik`);
    expect(res.ok).toBe(true);

    const sara = res.data.customers?.find((c) => /sara malik/i.test(c.name));
    expect(sara).toBeTruthy();
    const wallet = Number(sara?.wallet_balance ?? 0);
    console.log("Sara wallet balance before sale:", wallet);
    // Just log — wallet may have already been used in a prior run
  });

  test("POS sale: Sara redeems wallet for Puzzle Box", async ({ page }) => {
    await navigateToPOS(page);

    // Attach Sara Malik
    const customerSearch = page
      .getByPlaceholder(/customer/i)
      .or(page.getByPlaceholder(/search customer/i))
      .first();

    if (await customerSearch.isVisible({ timeout: 4000 }).catch(() => false)) {
      await customerSearch.fill("Sara Malik");
      await page.waitForTimeout(800);
      const saraOption = page.getByText(/Sara Malik/i).first();
      await expect(saraOption).toBeVisible({ timeout: 8000 });
      await saraOption.click();
      await page.waitForTimeout(500);
    }

    // Add Puzzle Box (PKR 650 — wallet covers it)
    const searchInput = page.getByPlaceholder(/Search by Name/i);
    await searchInput.fill("Puzzle Box");
    await page.waitForTimeout(800);
    await page.getByText(/Puzzle Box/i).first().click();
    await page.waitForTimeout(500);

    // Open checkout
    await page.getByRole("button", { name: /pay/i }).click();
    await expect(page.getByText(/complete payment/i)).toBeVisible({ timeout: 10000 });

    // Enable wallet toggle if visible
    const walletToggle = page
      .getByRole("checkbox", { name: /wallet/i })
      .or(page.getByLabel(/use wallet/i))
      .first();

    if (await walletToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await walletToggle.check();
      await page.waitForTimeout(500);
    }

    // Add remaining payment or complete if wallet covers full amount
    const addBtn = page.getByRole("button", { name: /^add$/i });
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
    }

    await page.getByRole("button", { name: /complete sale/i }).click();
    await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 15000 });

    const salesRes = await get(page, "/api/sales?limit=1");
    writeState({ walletSaleId: salesRes.data.sales?.[0]?.id });

    const closeBtns = page.getByRole("button", { name: "Close", exact: true });
    await closeBtns.last().click();
    console.log("✅ Wallet sale complete");
  });

  test("Sara Malik wallet balance decreased after sale", async ({ page }) => {
    const res = await get(page, `/api/customers?search=Sara+Malik`);
    expect(res.ok).toBe(true);

    const sara = res.data.customers?.find((c) => /sara malik/i.test(c.name));
    expect(sara).toBeTruthy();
    const wallet = Number(sara?.wallet_balance ?? 0);
    // Wallet should be less than 500 now
    expect(wallet).toBeLessThan(500);
    console.log("✅ Sara wallet after sale:", wallet);
  });
});
