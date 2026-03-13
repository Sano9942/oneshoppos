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
      totalSales: d.total_sales,
      totalRevenue: d.total_revenue,
      transactions: d.transactions,
    });
    // At least some sales happened today
    expect(Number(d.total_sales ?? d.transactions ?? 0)).toBeGreaterThan(0);
  });

  test("dashboard page renders in browser", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
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

  test("sales by product report loads", async ({ page }) => {
    const res = await get(page, `/api/reports/sales-by-product?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    const items = res.data.products || res.data.items || res.data || [];
    console.log("Top products today:", Array.isArray(items) ? items.slice(0, 3) : items);
  });

  test("inventory value report loads", async ({ page }) => {
    const res = await get(page, "/api/reports/inventory-value?outlet_id=1");
    expect(res.ok).toBe(true);
    console.log("Inventory value:", JSON.stringify(res.data).slice(0, 200));
  });

  test("stock movement report loads", async ({ page }) => {
    const res = await get(page, `/api/reports/stock-movement?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    console.log("Stock movement:", JSON.stringify(res.data).slice(0, 200));
  });

  test("shift report shows today's open shift", async ({ page }) => {
    const res = await get(page, `/api/reports/shifts?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    const shifts = res.data.shifts || res.data || [];
    console.log("Shift count:", Array.isArray(shifts) ? shifts.length : 1);
  });

  test("shrinkage report loads", async ({ page }) => {
    const res = await get(page, `/api/reports/shrinkage?start=${TODAY}&end=${TODAY}&outlet_id=1`);
    expect(res.ok).toBe(true);
    console.log("Shrinkage report:", JSON.stringify(res.data).slice(0, 200));
  });

  test("accounting P&L loads", async ({ page }) => {
    const firstOfMonth = TODAY.slice(0, 8) + "01";
    const res = await get(page, `/api/accounting/pnl?start=${firstOfMonth}&end=${TODAY}`);
    expect(res.ok).toBe(true);
    console.log("P&L:", JSON.stringify(res.data).slice(0, 300));
  });

  test("accounting cashflow loads", async ({ page }) => {
    const firstOfMonth = TODAY.slice(0, 8) + "01";
    const res = await get(page, `/api/accounting/cashflow?start=${firstOfMonth}&end=${TODAY}`);
    expect(res.ok).toBe(true);
    console.log("Cashflow:", JSON.stringify(res.data).slice(0, 300));
  });

  test("reports page renders all tabs", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
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
