import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, closeDb, dbGet, dbAll } from "../helpers/createTestApp";
import { makeRequest, ADMIN_ID } from "../helpers/request";

describe("Reports Accuracy Integration Tests", () => {
  let app, db, deps;

  beforeEach(async () => {
    const setup = await createTestApp();
    app = setup.app;
    db = setup.db;
    deps = setup.deps;
  });

  afterEach(async () => {
    await closeDb(db);
  });

  const OUTLET_ID = 1;
  const CUSTOMER_ID = 1;

  it("Verify Bug B11: Discrepancy between Summary (Net) and Detail (Gross) reports", async () => {
    // 1. Perform a controlled sale with a discount.
    // Subtotal: 2 x 100 = 200. Discount: 20. Total: 180.
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, price: 100, quantity: 2 }],
        paymentMethod: "Cash",
        outlet_id: OUTLET_ID,
        employee_id: ADMIN_ID,
        customer_id: CUSTOMER_ID,
        discount_amount: 20,
        discount_type: "fixed",
      });

    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    // 2. Fetch Dashboard
    const dashboardRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/dashboard",
    );
    expect(dashboardRes.status).toBe(200);
    expect(dashboardRes.body.totalRevenueToday).toBe(180); // Net Revenue
    expect(dashboardRes.body.taxInclusive).toBe(200); // Gross Revenue (Bug/Feature: Dashboard separates tax_inclusive items)

    // 3. Fetch Sales Summary
    const summaryRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/sales-summary",
    );
    expect(summaryRes.status).toBe(200);
    const summarySale = summaryRes.body.sales.find((s) => s.id === saleId);
    expect(summarySale).toBeDefined();
    expect(summarySale.total_amount).toBe(180); // Net Total

    // 4. Fetch Sales Detail
    const detailRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/sales-detail",
    );
    expect(detailRes.status).toBe(200);
    const detailItems = detailRes.body.items.filter(
      (i) => i.sale_id === saleId,
    );
    const detailSum = detailItems.reduce((sum, i) => sum + i.line_total, 0);
    expect(detailSum).toBe(200); // Gross Total (Confirmed Bug B11: doesn't account for discounts per line)

    // 5. Fetch Item Wise
    const itemWiseRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/item-wise",
    );
    expect(itemWiseRes.status).toBe(200);
    const product1 = itemWiseRes.body.rows.find((r) => r.id === 1);
    expect(product1.revenue).toBe(200); // Gross Revenue
  });

  it("should maintain consistency between Category-wise and Item-wise reports", async () => {
    // 1. Perform multiple sales across different categories
    await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [
          { id: 1, price: 100, quantity: 1 }, // Category 1 (Beverages in seed)
          { id: 4, price: 50, quantity: 2 }, // Category 2 (Snacks in seed)
        ],
        paymentMethod: "Cash",
        outlet_id: OUTLET_ID,
      });

    // 2. Fetch Item Wise
    const itemWiseRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/item-wise",
    );
    expect(itemWiseRes.status).toBe(200);
    const itemTotalRevenue = itemWiseRes.body.rows.reduce(
      (sum, r) => sum + r.revenue,
      0,
    );

    // 3. Fetch Category Wise
    const catWiseRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/category-wise",
    );
    expect(catWiseRes.status).toBe(200);
    const catTotalRevenue = catWiseRes.body.data.reduce(
      (sum, r) => sum + r.revenue,
      0,
    );

    // 4. Cross-verify
    expect(itemTotalRevenue).toBe(catTotalRevenue);
    expect(itemTotalRevenue).toBe(200); // 100*1 + 50*2
  });

  it("should verify Dashboard inventory value matches Inventory Dump", async () => {
    // 1. Fetch Dashboard
    const dashboardRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/dashboard",
    );
    expect(dashboardRes.status).toBe(200);
    const dashValue = dashboardRes.body.inventoryValue.cost_value;

    // 2. Fetch Inventory Dump
    const dumpRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/inventory-dump",
    );
    expect(dumpRes.status).toBe(200);
    const dumpValue = dumpRes.body.rows.reduce(
      (sum, r) => sum + r.cost_value,
      0,
    );

    // 3. Cross-verify
    expect(dashValue).toBe(dumpValue);
  });

  it("should ensure voided sales are excluded from core revenue reports", async () => {
    // 1. Perform a sale
    const saleRes = await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, price: 100, quantity: 1 }],
        paymentMethod: "Cash",
        outlet_id: OUTLET_ID,
      });
    const saleId = saleRes.body.saleId;

    // 2. Void it
    await makeRequest(app, ADMIN_ID)
      .put(`/api/sales/${saleId}/void`)
      .send({ void_reason: "Mistake" });

    // 3. Check Dashboard
    const dashboardRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/dashboard",
    );
    expect(dashboardRes.status).toBe(200);

    // 4. Check Sales Summary
    const summaryRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/sales-summary",
    );
    expect(summaryRes.status).toBe(200);
    const summarySale = summaryRes.body.sales.find((s) => s.id === saleId);
    expect(summarySale).toBeUndefined(); // Voided sales excluded from summary

    // 5. Check Item Wise
    const itemWiseRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/item-wise",
    );
    expect(itemWiseRes.status).toBe(200);
    const itemRows = itemWiseRes.body.rows.filter((r) => r.id === 1);
    const totalSold = itemRows.reduce((sum, r) => sum + r.units_sold, 0);
    expect(totalSold).toBe(0); // If this was the only sale of product 1
  });
});
