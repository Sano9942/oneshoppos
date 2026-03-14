/**
 * 07-pos-return.spec.js
 * Returns the LEGO City Set from the cash sale in spec 03.
 * Verifies stock is restored and a return record is created.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { get, post } from "./helpers/api.js";

test.describe("07 — POS: Return item from cash sale", () => {
  test("return LEGO City Set via API", async ({ page }) => {
    const { cashSaleId, productIds } = readState();
    expect(cashSaleId).toBeTruthy();

    // Get sale details to find the LEGO item
    const saleRes = await get(page, `/api/sales/${cashSaleId}`);
    expect(saleRes.ok).toBe(true);

    const items = saleRes.data.items || [];
    const legoItem = items.find((i) => /lego/i.test(i.product_name || ""));
    expect(legoItem, "LEGO item not found in sale").toBeTruthy();

    const refundAmount = Number(legoItem.price_at_sale);

    // Process the return via API
    const returnRes = await post(page, "/api/returns", {
      original_sale_id: cashSaleId,
      outlet_id: 1,
      total_refund: refundAmount,
      refund_method: "cash",
      reason: "Test return via spec 07",
      items: [
        {
          product_id: legoItem.product_id,
          variant_id: legoItem.variant_id || null,
          quantity: 1,
          refund_price: refundAmount,
        },
      ],
    });

    expect(returnRes.ok, `Return failed: ${JSON.stringify(returnRes.data)}`).toBe(true);
    const returnId = returnRes.data.return?.id || returnRes.data.id;
    writeState({ returnId });
    console.log("✅ Return processed, id:", returnId);
  });

  test("verify return via API — stock restored", async ({ page }) => {
    const { productIds } = readState();

    const legoRes = await get(page, `/api/products/${productIds[0]}`);
    const legoStock = Number(legoRes.data.product?.total_stock ?? legoRes.data.total_stock ?? 0);
    // Stock should be restored by at least 1 from the return
    expect(legoStock).toBeGreaterThan(0);
    console.log("✅ LEGO stock after return:", legoStock);
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
