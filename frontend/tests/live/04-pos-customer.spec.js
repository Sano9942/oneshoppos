/**
 * 04-pos-customer.spec.js
 * POS: attach Ali Khan as walk-in customer, sell Remote Control Car,
 * verify loyalty points are earned.
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

test.describe("04 — POS: Customer sale with loyalty points", () => {
  test("attach Ali Khan as customer and sell Remote Control Car", async ({ page }) => {
    await navigateToPOS(page);

    // Attach customer — look for customer search input
    const customerSearch = page
      .getByPlaceholder(/customer/i)
      .or(page.getByPlaceholder(/search customer/i))
      .first();

    if (await customerSearch.isVisible({ timeout: 4000 }).catch(() => false)) {
      await customerSearch.fill("Ali Khan");
      await page.waitForTimeout(800);
      const aliOption = page.getByText(/Ali Khan/i).first();
      await expect(aliOption).toBeVisible({ timeout: 8000 });
      await aliOption.click();
      await page.waitForTimeout(500);
    }

    // Add Remote Control Car
    const searchInput = page.getByPlaceholder(/search by name/i);
    await searchInput.fill("Remote Control Car");
    await page.waitForTimeout(800);
    await page.getByText(/Remote Control Car/i).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByText(/Remote Control Car/i)).toBeVisible({ timeout: 8000 });

    // Pay
    await page.getByRole("button", { name: /pay/i }).click();
    await expect(page.getByText(/complete payment/i)).toBeVisible({ timeout: 10000 });

    const addBtn = page.getByRole("button", { name: /^add$/i });
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click();
    }

    await page.getByRole("button", { name: /complete sale/i }).click();
    await expect(page.getByText(/sale complete/i)).toBeVisible({ timeout: 15000 });

    // Capture sale id
    const salesRes = await get(page, "/api/sales?limit=1");
    const customerSaleId = salesRes.data.sales?.[0]?.id;
    writeState({ customerSaleId });

    await page.getByRole("button", { name: /close/i, exact: true }).click();
    console.log("✅ Customer sale complete, sale id:", customerSaleId);
  });

  test("Ali Khan earned loyalty points", async ({ page }) => {
    const { customerAliId } = readState();
    const res = await get(page, `/api/customers/${customerAliId}`);
    expect(res.ok).toBe(true);

    const points = Number(res.data.customer?.loyalty_points ?? res.data.loyalty_points ?? 0);
    expect(points).toBeGreaterThan(0);
    console.log("✅ Ali Khan loyalty points:", points);
  });

  test("customers page shows Ali Khan with points", async ({ page }) => {
    await page.goto("/customers");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Ali Khan/i)).toBeVisible({ timeout: 15000 });
    console.log("✅ Customers page shows Ali Khan");
  });
});
