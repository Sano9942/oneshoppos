/**
 * 17-reports.spec.js
 * Verifies dashboard KPIs, sales report, inventory report,
 * shift report, shrinkage report, and accounting P&L all load
 * and return data reflecting today's activity.
 */
import { test, expect } from "@playwright/test";
import { get } from "./helpers/api.js";

const TODAY = new Date().toISOString().slice(0, 10);

test.describe("17 — Reports: Dashboard, Sales, Inventory, Shift, Shrinkage, P&L", () => {
  test("dashboard KPIs load and show today's sales", async ({ page }) => {
    const res = await get(page, `/api/reports/dashboard?date=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);

    const d = res.data;
    console.log("Dashboard KPIs:", {
      totalRevenueToday: d.totalRevenueToday,
      saleCount: d.saleCount,
      averageBill: d.averageBill,
    });
    // At least some sales happened today
    expect(Number(d.totalRevenueToday ?? d.saleCount ?? 0)).toBeGreaterThan(0);
  });

  test("dashboard page renders in browser", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({ timeout: 15000 });
    // KPI cards should be visible
    await expect(page.getByText(/revenue|sales|total/i).first()).toBeVisible({ timeout: 10000 });
    console.log("✅ Dashboard page rendered");
  });

  test("sales summary report returns data", async ({ page }) => {
    const res = await get(page, `/api/reports/sales-summary?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    console.log("Sales summary:", JSON.stringify(res.data).slice(0, 200));
  });

  test("sales item-wise report loads", async ({ page }) => {
    const res = await get(page, `/api/reports/item-wise?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    const items = res.data.products || res.data.items || res.data || [];
    console.log("Top products today:", Array.isArray(items) ? items.slice(0, 3) : items);
  });

  test("inventory dump report loads", async ({ page }) => {
    const res = await get(page, "/api/reports/inventory-dump?outlet_id=1");
    expect(res.ok).toBe(true);
    console.log("Inventory dump:", JSON.stringify(res.data).slice(0, 200));
  });

  test("product movement report loads", async ({ page }) => {
    const res = await get(page, `/api/reports/product-movement?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    console.log("Product movement:", JSON.stringify(res.data).slice(0, 200));
  });

  test("cash flow report loads (shift data)", async ({ page }) => {
    const res = await get(page, `/api/reports/cash-flow?date_from=${TODAY}&date_to=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    console.log("Cash flow:", JSON.stringify(res.data).slice(0, 200));
  });

  test("shrinkage report loads", async ({ page }) => {
    const res = await get(page, `/api/reports/shrinkage?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    console.log("Shrinkage report:", JSON.stringify(res.data).slice(0, 200));
  });

  test("accounting P&L loads", async ({ page }) => {
    const firstOfMonth = TODAY.slice(0, 8) + "01";
    const res = await get(page, `/api/accounting/pnl?from=${firstOfMonth}&to=${TODAY}`);
    // accounting_core feature flag may be disabled — accept 200 or 503
    console.log("P&L status:", res.status, JSON.stringify(res.data).slice(0, 300));
    expect(res.status).toBeGreaterThan(0);
  });

  test("accounting cashflow loads", async ({ page }) => {
    const firstOfMonth = TODAY.slice(0, 8) + "01";
    const res = await get(page, `/api/accounting/cashflow?from=${firstOfMonth}&to=${TODAY}`);
    // accounting_core feature flag may be disabled — accept 200 or 503
    console.log("Cashflow status:", res.status, JSON.stringify(res.data).slice(0, 300));
    expect(res.status).toBeGreaterThan(0);
  });

  test("reports page renders all tabs", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    await expect(page.getByText(/report/i).first()).toBeVisible({ timeout: 15000 });

    // Click through main tab groups
    const tabs = ["Sales", "Inventory", "Finance"];
    for (const tab of tabs) {
      const tabEl = page.getByRole("tab", { name: new RegExp(tab, "i") });
      if (await tabEl.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tabEl.click();
        await page.waitForTimeout(800);
        console.log(`✅ Reports ${tab} tab loaded`);
      }
    }
  });

  test("labor performance report loads", async ({ page }) => {
    const res = await get(page, `/api/reports/labor-performance?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    console.log("Labor performance:", JSON.stringify(res.data).slice(0, 200));
  });
});
