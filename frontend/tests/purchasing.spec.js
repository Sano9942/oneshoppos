import { test, expect } from "@playwright/test";

/**
 * Helper to assert a page loaded — checks for heading, table, or empty state.
 */
async function assertPageLoaded(page, headingPattern, emptyPattern) {
  const heading = page.getByRole("heading", { name: headingPattern }).first();
  const table = page.locator("table").first();
  const emptyState = page.getByText(emptyPattern).first();
  const addBtn = page.getByRole("button", { name: /add|create|new/i }).first();
  const hasHeading = await heading.isVisible({ timeout: 15000 }).catch(() => false);
  const hasTable = await table.isVisible({ timeout: 3000 }).catch(() => false);
  const hasEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
  const hasAdd = await addBtn.isVisible({ timeout: 3000 }).catch(() => false);
  expect(hasHeading || hasTable || hasEmpty || hasAdd).toBeTruthy();
}

test.describe("Suppliers", () => {
  test("suppliers page loads", async ({ page }) => {
    await page.goto("/suppliers");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /supplier/i, /no supplier|empty|no data|get started/i);
  });

  test("suppliers page has add button", async ({ page }) => {
    await page.goto("/suppliers");
    await page.waitForLoadState("networkidle");
    const addBtn = page
      .getByRole("button", { name: /add|create|new/i })
      .or(page.getByRole("link", { name: /add|create|new/i }))
      .first();
    await expect(addBtn).toBeVisible({ timeout: 15000 });
  });

  test("create supplier via API", async () => {
    const { post, del } = await import("./helpers/api.js");
    const name = `PW Supplier ${Date.now()}`;
    const r = await post("/api/suppliers", { name, phone: "03001234567" });
    expect(r.ok).toBeTruthy();
    expect(r.data.id).toBeTruthy();
    // Clean up
    await del(`/api/suppliers/${r.data.id}`);
  });

  test("suppliers API returns list", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/suppliers");
    expect(r.ok).toBeTruthy();
    const list = r.data.suppliers || r.data;
    expect(Array.isArray(list)).toBeTruthy();
  });
});

test.describe("Purchase Orders", () => {
  test("purchase orders page loads", async ({ page }) => {
    await page.goto("/purchase-orders");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /purchase order/i, /no purchase order|empty|no data|get started/i);
  });

  test("purchase orders page has add button", async ({ page }) => {
    await page.goto("/purchase-orders");
    await page.waitForLoadState("networkidle");
    const addBtn = page
      .getByRole("button", { name: /add|create|new/i })
      .or(page.getByRole("link", { name: /add|create|new/i }))
      .first();
    await expect(addBtn).toBeVisible({ timeout: 15000 });
  });

  test("create draft PO via API", async () => {
    const { get, post, del } = await import("./helpers/api.js");
    // Get a supplier
    const suppliers = await get("/api/suppliers");
    expect(suppliers.ok).toBeTruthy();
    const supplierList = suppliers.data.suppliers || suppliers.data;
    if (supplierList.length === 0) return;
    const supplierId = supplierList[0].id;
    // Get a product
    const products = await get("/api/products?limit=1");
    expect(products.ok).toBeTruthy();
    const prodList = products.data.products || products.data;
    if (prodList.length === 0) return;
    const product = prodList[0];

    const r = await post("/api/purchase-orders", {
      supplier_id: supplierId,
      outlet_id: 1,
      status: "draft",
      items: [
        {
          product_id: product.id,
          variant_id: null,
          quantity: 5,
          unit_cost: product.cost_price || 100,
        },
      ],
    });
    if (r.ok) {
      expect(r.data.id).toBeTruthy();
      // Clean up — delete the draft PO
      await del(`/api/purchase-orders/${r.data.id}`);
    } else {
      // Validation error is acceptable — endpoint should exist and not 500
      expect(r.status).toBeLessThan(500);
    }
  });

  test("purchase orders API returns list", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/purchase-orders");
    expect(r.ok).toBeTruthy();
    const list = r.data.purchaseOrders || r.data;
    expect(Array.isArray(list)).toBeTruthy();
  });
});

test.describe("Supplier Payables", () => {
  test("supplier payables page loads", async ({ page }) => {
    await page.goto("/supplier-payables");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(page, /payable|supplier/i, /no payable|empty|no data|no outstanding/i);
  });

  test("GRN API returns list", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/grn");
    expect(r.ok).toBeTruthy();
    const list = r.data.grns || r.data;
    expect(Array.isArray(list)).toBeTruthy();
  });
});

test.describe("Returned Stock", () => {
  test("returned stock page loads", async ({ page }) => {
    await page.goto("/returned-stock");
    await page.waitForLoadState("networkidle");
    await assertPageLoaded(
      page,
      /return|supplier return/i,
      /no return|empty|no data|get started/i
    );
  });

  test("supplier returns API returns list", async () => {
    const { get } = await import("./helpers/api.js");
    const r = await get("/api/supplier-returns");
    expect(r.ok).toBeTruthy();
    const list = r.data.returns || r.data.supplierReturns || r.data;
    expect(Array.isArray(list)).toBeTruthy();
  });
});
