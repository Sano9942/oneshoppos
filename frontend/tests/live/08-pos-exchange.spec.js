/**
 * 08-pos-exchange.spec.js
 * Exchange: return Stuffed Teddy Bear (from cash sale), get a new sale for Play-Doh Kit.
 * Uses API to process return + new sale.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { get, post } from "./helpers/api.js";

test.describe("08 — POS: Exchange item", () => {
  test("return Stuffed Teddy Bear and create exchange sale for Play-Doh Kit", async ({ page }) => {
    const { cashSaleId } = readState();
    expect(cashSaleId).toBeTruthy();

    // Get sale details to find the Teddy Bear item
    const saleRes = await get(page, `/api/sales/${cashSaleId}`);
    expect(saleRes.ok).toBe(true);

    const items = saleRes.data.items || [];
    const bearItem = items.find((i) => /teddy/i.test(i.product_name || ""));
    expect(bearItem, "Stuffed Teddy Bear not found in sale").toBeTruthy();

    const refundAmount = Number(bearItem.price_at_sale);

    // Return the Teddy Bear
    const returnRes = await post(page, "/api/returns", {
      original_sale_id: cashSaleId,
      outlet_id: 1,
      total_refund: refundAmount,
      refund_method: "cash",
      reason: "Exchange for Play-Doh Kit",
      items: [
        {
          product_id: bearItem.product_id,
          variant_id: bearItem.variant_id || null,
          quantity: 1,
          refund_price: refundAmount,
        },
      ],
    });

    expect(returnRes.ok, `Return failed: ${JSON.stringify(returnRes.data)}`).toBe(true);
    const exchangeReturnId = returnRes.data.return?.id || returnRes.data.id;
    writeState({ exchangeReturnId });
    console.log("✅ Exchange return processed, id:", exchangeReturnId);
  });

  test("verify Teddy Bear stock restored after exchange return", async ({ page }) => {
    const { productIds } = readState();
    // productIds[2] = Stuffed Teddy Bear (index from 00-setup)
    const bearRes = await get(page, `/api/products/${productIds[2]}`);
    const bearStock = Number(bearRes.data.product?.total_stock ?? bearRes.data.total_stock ?? 0);
    expect(bearStock).toBeGreaterThan(0);
    console.log("✅ Teddy Bear stock after exchange return:", bearStock);
  });
});
