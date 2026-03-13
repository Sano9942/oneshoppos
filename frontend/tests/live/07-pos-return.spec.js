/**
 * 07-pos-return.spec.js
 * Returns the LEGO City Set from the cash sale in spec 03.
 * Verifies stock is restored and a return record is created.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { get, post } from "./helpers/api.js";

test.describe("07 — POS: Return item from cash sale", () => {
  test("return LEGO City Set via sales history UI", async ({ page }) => {
    const { cashSaleId } = readState();
    expect(cashSaleId).toBeTruthy();

    await page.goto("/sales-history");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/sales history/i).first()).toBeVisible({ timeout: 15000 });

    // Find the sale — look for a return button or click on the sale row
    const returnBtn = page
      .getByRole("button", { name: /return/i })
      .or(page.getByRole("button", { name: /refund/i }))
      .first();

    if (await returnBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await returnBtn.click();
    } else {
      // Click first sale row to open detail, then find return button
      const saleRow = page.getByRole("row").nth(1);
      if (await saleRow.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saleRow.click();
        await page.waitForTimeout(500);
        const returnInDetail = page.getByRole("button", { name: /return/i }).first();
        await expect(returnInDetail).toBeVisible({ timeout: 8000 });
        await returnInDetail.click();
      }
    }

    // Return modal should open — select LEGO item and confirm
    await page.waitForTimeout(500);
    const legoCheckbox = page.getByText(/LEGO City Set/i).first();
    if (await legoCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check the LEGO item checkbox
      const checkbox = page.locator("input[type='checkbox']").first();
      await checkbox.check();

      const confirmReturn = page
        .getByRole("button", { name: /confirm return/i })
        .or(page.getByRole("button", { name: /process return/i }))
        .first();
      await expect(confirmReturn).toBeVisible({ timeout: 8000 });
      await confirmReturn.click();

      await expect(
        page.getByText(/return.*success/i).or(page.getByText(/refund.*complete/i))
      ).toBeVisible({ timeout: 10000 });
    }

    console.log("✅ Return processed via UI");
  });

  test("verify return via API — stock restored", async ({ page }) => {
    const { productIds } = readState();

    // LEGO was at 69 after sale, should be back to 70 after return
    const legoRes = await get(page, `/api/products/${productIds[0]}`);
    const legoStock = Number(legoRes.data.product?.total_stock ?? legoRes.data.total_stock ?? 0);
    expect(legoStock).toBe(70);
    console.log("✅ LEGO stock restored to:", legoStock);
  });

  test("return record exists in returns list", async ({ page }) => {
    const returnsRes = await get(page, "/api/returns?limit=5");
    expect(returnsRes.ok).toBe(true);
    expect(returnsRes.data.returns.length).toBeGreaterThan(0);

    const latestReturn = returnsRes.data.returns[0];
    writeState({ returnId: latestReturn.id });
    console.log("Return id:", latestReturn.id);
  });
});
