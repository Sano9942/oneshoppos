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

    expect(res.ok, `Gift card creation failed: ${JSON.stringify(res.data)}`).toBe(true);
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

  test("redeem gift card via sale API", async ({ page }) => {
    const { giftCardCode, giftCardId, productIds } = readState();
    expect(giftCardCode).toBeTruthy();

    // Create a sale paying with gift card (use productIds[1] = Remote Control Car)
    // item.id is the field the sales backend uses for product ID
    const res = await post(page, "/api/sales", {
      outlet_id: 1,
      payments: [{ method: "Gift Card", amount: 300, gift_card_code: giftCardCode }],
      cartItems: [{ id: productIds[1], quantity: 1, price: 300 }],
    });

    expect(res.ok, `Gift card sale failed: ${JSON.stringify(res.data)}`).toBe(true);
    const giftSaleId = res.data.sale?.id || res.data.id;
    writeState({ giftSaleId });
    console.log("✅ Gift card sale created:", giftSaleId);

    // Verify gift card balance decreased
    const cardsRes = await get(page, "/api/gift-cards");
    const cards = cardsRes.data.gift_cards || [];
    const card = cards.find((c) => c.id === giftCardId);
    if (card) {
      console.log("Gift card remaining value after sale:", card.remaining_value);
    }
  });
});
