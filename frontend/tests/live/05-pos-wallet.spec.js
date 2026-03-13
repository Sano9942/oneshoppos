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
  await page.waitForLoadState("networkidle");
  const clockedInBtn = page.getByRole("button", { name: /i have clocked in/i });
  if (await clockedInBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await clockedInBtn.click();
  }
  await expect(page.getByPlaceholder(/search by name/i)).toBeVisible({ timeout: 20000 });
}

test.describe("05 — POS: Wallet redemption (Sara Malik)", () => {
  test("verify Sara Malik wallet has PKR 500 before sale", async ({ page }) => {
    const { customerSaraId } = readState();
    const res = await get(page, `/api/customers/${customerSaraId}`);
    expect(res.ok).toBe(true);

    const wallet = Number(
      res.data.customer?.wallet_balance ?? res.data.wallet_balance ?? 0
    );
    expect(wallet).toBeGreaterThanOrEqual(500);
    console.log("Sara wallet balance:", wallet);
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
    const searchInput = page.getByPlaceholder(/search by name/i);
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

    await page.getByRole("button", { name: /close/i, exact: true }).click();
    console.log("✅ Wallet sale complete");
  });

  test("Sara Malik wallet balance decreased after sale", async ({ page }) => {
    const { customerSaraId } = readState();
    const res = await get(page, `/api/customers/${customerSaraId}`);
    const wallet = Number(
      res.data.customer?.wallet_balance ?? res.data.wallet_balance ?? 0
    );
    // Wallet should be less than 500 now
    expect(wallet).toBeLessThan(500);
    console.log("✅ Sara wallet after sale:", wallet);
  });
});
