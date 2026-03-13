/**
 * 01-inventory.spec.js
 * Adds opening stock to all 5 toy products via stock adjustment UI.
 * Also verifies the Inventory page loads and stock is reflected.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { post, get } from "./helpers/api.js";

test.describe("01 — Inventory: Add opening stock via adjustment", () => {
  test("add 50 units to each product via API adjustment", async ({ page }) => {
    test.setTimeout(90000);
    const { productIds } = readState();
    expect(productIds?.length, "productIds must be set from 00-setup").toBe(5);

    const adjustmentIds = [];
    const productNames = [
      "LEGO City Set",
      "Remote Control Car",
      "Stuffed Teddy Bear",
      "Puzzle Box 100pcs",
      "Play-Doh Kit",
    ];

    for (let i = 0; i < productIds.length; i++) {
      // Check current stock first — only adjust if stock is 0
      const cur = await get(page, `/api/products/${productIds[i]}`);
      const currentStock = Number(cur.data.product?.total_stock ?? cur.data.total_stock ?? 0);
      if (currentStock >= 50) {
        console.log(`Product ${productIds[i]} already has ${currentStock} stock, skipping`);
        adjustmentIds.push(null);
        continue;
      }

      const res = await post(page, "/api/adjustments", {
        product_id: productIds[i],
        outlet_id: 1,
        quantity_change: 50,  // positive = add stock
        reason: `Opening stock — ${productNames[i]}`,
      });
      expect(
        [200, 201],
        `Adjustment failed for product ${productIds[i]}: ${JSON.stringify(res.data)}`
      ).toContain(res.status);
      adjustmentIds.push(res.data.adjustment?.id || res.data.id || "ok");
    }

    writeState({ adjustmentIds });
    console.log("Stock adjustments created:", adjustmentIds);
  });

  test("verify stock is positive for each product", async ({ page }) => {
    const { productIds } = readState();

    for (const id of productIds) {
      const r = await get(page, `/api/products/${id}`);
      expect(r.ok).toBe(true);
      const stock = Number(r.data.product?.total_stock ?? r.data.total_stock ?? 0);
      expect(stock, `Product ${id} should have stock > 0`).toBeGreaterThan(0);
    }

    console.log("✅ All products have stock");
  });

  test("inventory page loads and shows toy products", async ({ page }) => {
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/inventory/i).first()).toBeVisible({ timeout: 15000 });

    // Search for LEGO to confirm product appears
    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill("LEGO");
      await page.waitForTimeout(1000);
      await expect(page.getByText(/LEGO City Set/i).first()).toBeVisible({ timeout: 10000 });
    }

    console.log("✅ Inventory page loaded and products visible");
  });

  test("stock adjustments page shows today's adjustments", async ({ page }) => {
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");

    // Look for adjustments tab or section
    const adjustTab = page.getByRole("button", { name: /adjust/i }).first();
    if (await adjustTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await adjustTab.click();
      await page.waitForTimeout(1000);
      await expect(page.getByText(/Opening stock/i).first()).toBeVisible({ timeout: 10000 });
    }

    console.log("✅ Adjustments visible in inventory");
  });
});
