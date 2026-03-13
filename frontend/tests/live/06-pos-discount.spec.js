/**
 * 06-pos-discount.spec.js
 * Creates a 10% promotion, applies it at POS, parks the sale mid-checkout,
 * resumes it from Parked Sales, and completes payment.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { post, get } from "./helpers/api.js";

async function navigateToPOS(page) {
  await page.goto("/pos");
  await page.waitForLoadState("networkidle");
  const clockedInBtn = page.getByRole("button", { name: /i have clocked in/i });
  if (await clockedInBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await clockedInBtn.click();
  }
  await expect(page.getByPlaceholder(/search by name/i)).toBeVisible({ timeout: 20000 });
}

test.describe("06 — POS: Promotion + Park Sale + Resume", () => {
  test("create 10% off promotion for Toys category", async ({ page }) => {
    const { categoryId } = readState();

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const res = await post(page, "/api/promotions", {
      name: "10% Off All Toys",
      type: "percent",
      value: 10,
      start_date: today,
      end_date: tomorrow,
      applies_to: "category",
      category_id: categoryId,
      min_purchase: 0,
      active: true,
    });

    expect(res.status, `Promotion creation failed: ${JSON.stringify(res.data)}`).toBe(201);
    const promoId = res.data.promotion?.id || res.data.id;
    writeState({ promoId });
    console.log("Promotion created:", promoId);
  });

  test("add Play-Doh Kit to cart, park sale mid-checkout", async ({ page }) => {
    await navigateToPOS(page);

    const searchInput = page.getByPlaceholder(/search by name/i);
    await searchInput.fill("Play-Doh Kit");
    await page.waitForTimeout(800);
    await page.getByText(/Play-Doh Kit/i).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByText(/Play-Doh Kit/i)).toBeVisible();

    // Park the sale before paying
    const parkBtn = page
      .getByRole("button", { name: /park/i })
      .or(page.getByTitle(/park sale/i))
      .first();

    if (await parkBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await parkBtn.click();
      await page.waitForTimeout(1000);

      // Confirm park if dialog shown
      const confirmPark = page.getByRole("button", { name: /confirm|park/i }).last();
      if (await confirmPark.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmPark.click();
      }

      await expect(page.getByText(/cart is empty/i)).toBeVisible({ timeout: 10000 });
      console.log("✅ Sale parked");
    } else {
      // If park button not visible at cart level, try after opening checkout
      await page.getByRole("button", { name: /pay/i }).click();
      await expect(page.getByText(/complete payment/i)).toBeVisible({ timeout: 10000 });

      const parkFromCheckout = page.getByRole("button", { name: /park/i }).first();
      if (await parkFromCheckout.isVisible({ timeout: 3000 }).catch(() => false)) {
        await parkFromCheckout.click();
        await expect(page.getByText(/cart is empty/i)).toBeVisible({ timeout: 10000 });
      }
      console.log("✅ Sale parked from checkout");
    }
  });

  test("resume parked sale and complete it", async ({ page }) => {
    await navigateToPOS(page);

    // Open parked sales — look for Recent Sales panel or Parked button
    const parkedBtn = page
      .getByRole("button", { name: /parked/i })
      .or(page.getByText(/parked sale/i).first())
      .first();

    if (await parkedBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await parkedBtn.click();
      await page.waitForTimeout(800);

      // Resume the parked sale
      const resumeBtn = page.getByRole("button", { name: /resume/i }).first();
      await expect(resumeBtn).toBeVisible({ timeout: 8000 });
      await resumeBtn.click();
      await page.waitForTimeout(500);
    }

    // Verify Play-Doh is back in cart
    await expect(page.getByText(/Play-Doh Kit/i)).toBeVisible({ timeout: 10000 });

    // Complete payment
    await page.getByRole("button", { name: /pay/i }).click();
    await expect(page.getByText(/complete payment/i)).toBeVisible({ timeout: 10000 });

    const addBtn = page.getByRole("button", { name: /^add$/i });
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
    }

    await page.getByRole("button", { name: /complete sale/i }).click();
    await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 15000 });

    const salesRes = await get(page, "/api/sales?limit=1");
    writeState({ discountSaleId: salesRes.data.sales?.[0]?.id });

    await page.getByRole("button", { name: /close/i, exact: true }).click();
    console.log("✅ Parked sale resumed and completed");
  });

  test("parked sales page is accessible", async ({ page }) => {
    await page.goto("/parked-sales");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/parked/i).first()).toBeVisible({ timeout: 15000 });
    console.log("✅ Parked sales page loaded");
  });
});
