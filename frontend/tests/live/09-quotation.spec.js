/**
 * 09-quotation.spec.js
 * Creates a quotation for Ali Khan (3 toy items),
 * then converts it to a sale.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { post, get } from "./helpers/api.js";

test.describe("09 — Quotations: Create and convert to sale", () => {
  test("create quotation for Ali Khan", async ({ page }) => {
    const { customerAliId, productIds } = readState();

    const res = await post(page, "/api/quotations", {
      customer_id: customerAliId,
      outlet_id: 1,
      valid_until: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      notes: "Quote for birthday toys",
      items: [
        { product_id: productIds[3], quantity: 2, unit_price: 650 },  // Puzzle Box
        { product_id: productIds[4], quantity: 1, unit_price: 750 },  // Play-Doh
      ],
    });

    expect(res.status, `Quotation failed: ${JSON.stringify(res.data)}`).toBe(201);
    const quoteId = res.data.quotation?.id || res.data.id;
    expect(quoteId).toBeTruthy();
    writeState({ quoteId });
    console.log("Quotation created:", quoteId);
  });

  test("quotations page shows the new quote", async ({ page }) => {
    await page.goto("/quotations");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/quotation/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Ali Khan/i)).toBeVisible({ timeout: 10000 });
    console.log("✅ Quotations page shows Ali Khan quote");
  });

  test("convert quotation to sale", async ({ page }) => {
    const { quoteId } = readState();

    await page.goto("/quotations");
    await page.waitForLoadState("networkidle");

    // Find convert button
    const convertBtn = page
      .getByRole("button", { name: /convert/i })
      .or(page.getByRole("button", { name: /to sale/i }))
      .first();

    if (await convertBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
      await convertBtn.click();
      await page.waitForTimeout(1000);

      // Confirm conversion if dialog
      const confirmBtn = page
        .getByRole("button", { name: /confirm|convert/i })
        .last();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      await expect(
        page.getByText(/converted|sale created/i)
      ).toBeVisible({ timeout: 10000 });
    } else {
      // Try via API
      const res = await post(page, `/api/quotations/${quoteId}/convert`, {});
      expect([200, 201]).toContain(res.status);
      console.log("Quotation converted via API:", res.data);
    }

    const salesRes = await get(page, "/api/sales?limit=1");
    writeState({ quoteSaleId: salesRes.data.sales?.[0]?.id });
    console.log("✅ Quotation converted to sale");
  });
});
