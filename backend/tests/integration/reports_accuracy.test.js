const { createTestApp, closeDb, dbGet, dbAll, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

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
  const ADMIN_PIN = "2580";

  async function prepareCheckoutContext() {
    await makeRequest(app, ADMIN_ID)
      .post("/api/shifts/open")
      .send({
        outlet_id: OUTLET_ID,
        employee_id: ADMIN_ID,
        opening_float: 500,
      });

    await makeRequest(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: ADMIN_PIN, outlet_id: OUTLET_ID });
  }

  it("Verify Bug B11: Discrepancy between Summary (Net) and Detail (Gross) reports", async () => {
    await prepareCheckoutContext();

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

    // 3. Fetch Sales Summary
    const summaryRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/sales-summary",
    );
    expect(summaryRes.status).toBe(200);
    const summarySale = summaryRes.body.sales.find((s) => s.revenue === 180);
    expect(summarySale).toBeDefined();
    expect(summaryRes.body.total_revenue).toBe(180); // Net Total

    // 4. Fetch Sales Detail
    const detailRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/sales-detail",
    );
    expect(detailRes.status).toBe(200);
    const detailItems = detailRes.body.sales.filter(
      (i) => i.sale_id === saleId,
    );
    const detailSum = detailItems.reduce((sum, i) => sum + i.line_total, 0);
    expect(detailSum).toBe(180); // Net Total (B11 fix: discount distributed proportionally across lines)

    // 5. Fetch Item Wise
    const itemWiseRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/item-wise",
    );
    expect(itemWiseRes.status).toBe(200);
    const product1 = itemWiseRes.body.items.find((r) => r.id === 1);
    expect(product1.revenue).toBe(200); // Gross Revenue
  });

  it("should maintain consistency between Category-wise and Item-wise reports", async () => {
    await prepareCheckoutContext();

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
    const itemTotalRevenue = itemWiseRes.body.items.reduce(
      (sum, r) => sum + r.revenue,
      0,
    );

    // 3. Fetch Category Wise
    const catWiseRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/category-wise",
    );
    expect(catWiseRes.status).toBe(200);
    const catTotalRevenue = catWiseRes.body.items.reduce(
      (sum, r) => sum + r.revenue,
      0,
    );

    // 4. Cross-verify
    expect(itemTotalRevenue).toBe(catTotalRevenue);
    expect(itemTotalRevenue).toBe(200); // 100*1 + 50*2
  });

  it("should allow parent category filters to include descendant leaf categories", async () => {
    await prepareCheckoutContext();

    await dbRun(
      db,
      `INSERT INTO categories (id, name, description, parent_id, sort_order, is_active)
       VALUES (70, 'Parent Filter', '', NULL, 0, 1)`,
    );
    await dbRun(
      db,
      `INSERT INTO categories (id, name, description, parent_id, sort_order, is_active)
       VALUES (71, 'Leaf Filter', '', 70, 0, 1)`,
    );
    await dbRun(db, "UPDATE products SET category_id = 71 WHERE id = 1");

    await makeRequest(app, ADMIN_ID)
      .post("/api/sales")
      .send({
        cartItems: [{ id: 1, price: 100, quantity: 1 }],
        paymentMethod: "Cash",
        outlet_id: OUTLET_ID,
      });

    const res = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/category-wise?category_id=70",
    );

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].category).toBe("Parent Filter > Leaf Filter");
    expect(res.body.items[0].revenue).toBe(100);
  });

  it("should verify Dashboard inventory value matches Inventory Dump", async () => {
    // 1. Fetch Dashboard
    const dashboardRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/dashboard",
    );
    expect(dashboardRes.status).toBe(200);
    const dashboardProductCount = dashboardRes.body.inventory.total_products;

    // 2. Fetch Inventory Dump
    const dumpRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/inventory-dump",
    );
    expect(dumpRes.status).toBe(200);
    const inventoryProducts = await dbGet(
      db,
      "SELECT COUNT(*) AS total_products FROM products",
    );

    // 3. Cross-verify
    expect(dashboardProductCount).toBe(inventoryProducts.total_products);
    expect(dumpRes.body.items.length).toBeGreaterThan(0);
  });

  it("should ensure voided sales are excluded from core revenue reports", async () => {
    await prepareCheckoutContext();

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
    expect(summaryRes.body.total_revenue).toBe(0);

    // 5. Check Item Wise
    const itemWiseRes = await makeRequest(app, ADMIN_ID).get(
      "/api/reports/item-wise",
    );
    expect(itemWiseRes.status).toBe(200);
    const itemRows = itemWiseRes.body.items.filter((r) => r.id === 1);
    const totalSold = itemRows.reduce((sum, r) => sum + r.units_sold, 0);
    expect(totalSold).toBe(0); // If this was the only sale of product 1
  });

  it("GET /api/reports/sales-summary with outlet_id=1,2 returns 200 with rows", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .get("/api/reports/sales-summary?outlet_id=1,2&date_from=2020-01-01&date_to=2030-01-01");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("sales");
  });

  describe("buildReportFilterParts outlet multi-select", () => {
    it("emits IN clause for comma-separated outlet_id", async () => {
      const helpers = require("../../routes/reports/helpers")(db);
      const fakeReq = { query: { outlet_id: "1,2" }, company: { timezone: "UTC" } };
      const { where, params } = await helpers.buildReportFilterParts(fakeReq);
      expect(where.some(w => w.includes("IN (?,?)"))).toBe(true);
      expect(params).toContain(1);
      expect(params).toContain(2);
    });

    it("emits = clause for single outlet_id", async () => {
      const helpers = require("../../routes/reports/helpers")(db);
      const fakeReq = { query: { outlet_id: "3" }, company: { timezone: "UTC" } };
      const { where, params } = await helpers.buildReportFilterParts(fakeReq);
      expect(where.some(w => w.includes("outlet_id = ?"))).toBe(true);
      expect(params).toContain(3);
    });

    it("emits no outlet clause when outlet_id is empty", async () => {
      const helpers = require("../../routes/reports/helpers")(db);
      const fakeReq = { query: {}, company: { timezone: "UTC" } };
      const { where, params } = await helpers.buildReportFilterParts(fakeReq);
      expect(where.every(w => !w.includes("outlet_id"))).toBe(true);
    });
  });
});
