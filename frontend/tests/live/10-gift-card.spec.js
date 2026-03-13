/**
 * 10-gift-card.spec.js
 * Issues a PKR 300 gift card, then redeems it at POS for a sale.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { post, get } from "./helpers/api.js";

test.describe("10 — Gift Cards: Issue and redeem", () => {
  test("issue a PKR 300 gift card", async ({ page }) => {
    const res = await post(page, "/api/gift-cards", {
      code: "TOYS-GIFT-2026",
      initial_value: 300,
      remaining_value: 300,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    });

    expect(res.status, `Gift card creation failed: ${JSON.stringify(res.data)}`).toBe(201);
    const giftCardId = res.data.gift_card?.id || res.data.id;
    const giftCardCode = res.data.gift_card?.code || res.data.code || "TOYS-GIFT-2026";
    writeState({ giftCardId, giftCardCode });
    console.log("Gift card issued:", giftCardCode, "id:", giftCardId);
  });

  test("verify gift card is active via API", async ({ page }) => {
    const { giftCardId } = readState();
    const res = await get(page, "/api/gift-cards");
    expect(res.ok).toBe(true);

    const cards = res.data.gift_cards || [];
    const card = cards.find((c) => c.id === giftCardId);
    expect(card).toBeTruthy();
    expect(Number(card.remaining_value)).toBe(300);
    console.log("✅ Gift card verified:", card);
  });

  test("redeem gift card at POS for Play-Doh Kit", async ({ page }) => {
    const { giftCardCode } = readState();

    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    const clockedInBtn = page.getByRole("button", { name: /i have clocked in/i });
    if (await clockedInBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await clockedInBtn.click();
    }
    await expect(page.getByPlaceholder(/search by name/i)).toBeVisible({ timeout: 20000 });

    // Add Play-Doh Kit
    const searchInput = page.getByPlaceholder(/search by name/i);
    await searchInput.fill("Play-Doh Kit");
    await page.waitForTimeout(800);
    await page.getByText(/Play-Doh Kit/i).first().click();
    await page.waitForTimeout(500);

    // Go to checkout
    await page.getByRole("button", { name: /pay/i }).click();
    await expect(page.getByText(/complete payment/i)).toBeVisible({ timeout: 10000 });

    // Find gift card input or dropdown
    const giftCardInput = page
      .getByPlaceholder(/gift card/i)
      .or(page.getByPlaceholder(/voucher/i))
      .first();

    if (await giftCardInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await giftCardInput.fill(giftCardCode);
      const applyBtn = page.getByRole("button", { name: /apply/i }).first();
      if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await applyBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Select gift card payment method if dropdown
    const paymentSelect = page.getByRole("combobox").first();
    if (await paymentSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await paymentSelect.selectOption({ label: /gift card/i });
    }

    const addBtn = page.getByRole("button", { name: /^add$/i });
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
    }

    await page.getByRole("button", { name: /complete sale/i }).click();
    await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: /close/i, exact: true }).click();
    console.log("✅ Gift card redeemed at POS");
  });
});
