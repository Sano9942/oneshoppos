/**
 * 00-setup.spec.js
 * Seeds all reference data needed for the full day simulation.
 * Idempotent: if an entity already exists (duplicate name error), looks it up by name.
 */
import { test, expect } from "@playwright/test";
import { post, get } from "./helpers/api.js";
import { writeState } from "./helpers/state.js";

/** Create or find an entity by name. Returns the id. */
async function createOrFind(page, createFn, listPath, matchFn) {
  const res = await createFn();
  if (res.status === 201 || res.status === 200) {
    return res.data.brand?.id || res.data.category?.id || res.data.supplier?.id ||
           res.data.customer?.id || res.data.employee?.id || res.data.product?.id ||
           res.data.id;
  }
  // On duplicate/conflict, search existing list
  const list = await get(page, listPath);
  const found = list.data && (
    list.data.brands || list.data.categories || list.data.suppliers ||
    list.data.customers || list.data.employees || list.data.products ||
    (Array.isArray(list.data) ? list.data : null)
  );
  if (found) {
    const match = found.find(matchFn);
    if (match) return match.id;
  }
  return null;
}

test.describe("00 — Setup: Seed toy shop data", () => {
  test("create or find brand: FunZone Toys", async ({ page }) => {
    const res = await post(page, "/api/brands", { name: "FunZone Toys" });
    let brandId;
    if (res.status === 201 || res.status === 200) {
      brandId = res.data.brand?.id || res.data.id;
    } else {
      // Already exists — find it
      const list = await get(page, "/api/brands");
      const found = list.data.brands?.find((b) => b.name === "FunZone Toys");
      expect(found, `Brand lookup failed: ${JSON.stringify(list.data)}`).toBeTruthy();
      brandId = found.id;
    }
    expect(brandId).toBeTruthy();
    writeState({ brandId });
    console.log("Brand id:", brandId);
  });

  test("create or find category: Toys", async ({ page }) => {
    const res = await post(page, "/api/categories", { name: "Toys", parent_id: null });
    let categoryId;
    if (res.status === 201 || res.status === 200) {
      categoryId = res.data.category?.id || res.data.id;
    } else {
      const list = await get(page, "/api/categories");
      const cats = list.data.categories || list.data;
      const found = cats?.find((c) => c.name === "Toys");
      expect(found, `Category lookup failed: ${JSON.stringify(list.data)}`).toBeTruthy();
      categoryId = found.id;
    }
    expect(categoryId).toBeTruthy();
    writeState({ categoryId });
    console.log("Category id:", categoryId);
  });

  test("create or find supplier: ToyWorld Distributors", async ({ page }) => {
    const res = await post(page, "/api/suppliers", {
      name: "ToyWorld Distributors",
      contact_person: "Ahmed Raza",
      phone: "03001234567",
      email: "toyworld@test.com",
      address: "123 Toy Street, Lahore",
      credit_limit: 100000,
      payment_terms: 30,
    });
    let supplierId;
    if (res.status === 201 || res.status === 200) {
      supplierId = res.data.supplier?.id || res.data.id;
    } else {
      const list = await get(page, "/api/suppliers");
      const found = list.data.suppliers?.find((s) => s.name === "ToyWorld Distributors");
      expect(found, `Supplier lookup failed: ${JSON.stringify(list.data)}`).toBeTruthy();
      supplierId = found.id;
    }
    expect(supplierId).toBeTruthy();
    writeState({ supplierId });
    console.log("Supplier id:", supplierId);
  });

  test("create or find 5 toy products", async ({ page }) => {
    test.setTimeout(90000);
    const { brandId, categoryId, supplierId } = (await import("./helpers/state.js")).readState();

    const skus = ["TOY-LEGO-001", "TOY-RC-002", "TOY-BEAR-003", "TOY-PZL-004", "TOY-PDH-005"];
    const products = [
      { name: "LEGO City Set",       sku: "TOY-LEGO-001", price: 2500, cost_price: 1800, barcode: "8901234567890" },
      { name: "Remote Control Car",  sku: "TOY-RC-002",   price: 1800, cost_price: 1200, barcode: "8901234567891" },
      { name: "Stuffed Teddy Bear",  sku: "TOY-BEAR-003", price: 950,  cost_price: 600,  barcode: "8901234567892" },
      { name: "Puzzle Box 100pcs",   sku: "TOY-PZL-004",  price: 650,  cost_price: 400,  barcode: "8901234567893" },
      { name: "Play-Doh Kit",        sku: "TOY-PDH-005",  price: 750,  cost_price: 500,  barcode: "8901234567894" },
    ];

    // Fetch existing products once — use these to avoid duplicate POSTs
    const existing = await get(page, "/api/products?limit=100");
    const existingList = existing.data.products || [];

    const productIds = [];
    for (const p of products) {
      // Check if already exists by SKU
      const alreadyExists = existingList.find((e) => e.sku === p.sku);
      if (alreadyExists) {
        productIds.push(alreadyExists.id);
        console.log(`Product ${p.name} already exists, id:`, alreadyExists.id);
        continue;
      }

      const res = await post(page, "/api/products", {
        ...p,
        brand_id: brandId,
        category_id: categoryId,
        supplier_id: supplierId,
        unit: "pcs",
        min_qty: 5,
        status: "active",
      });
      expect([200, 201], `Failed to create product ${p.name}: ${JSON.stringify(res.data)}`).toContain(res.status);
      const id = res.data.product?.id || res.data.id;
      expect(id).toBeTruthy();
      productIds.push(id);
    }

    writeState({ productIds });
    console.log("Product ids:", productIds);
  });

  test("create or find 2 customers", async ({ page }) => {
    const existing = await get(page, "/api/customers");
    const existingList = existing.data.customers || [];

    const aliExisting = existingList.find((c) => c.email === "ali.khan@test.com");
    let aliId = aliExisting?.id;
    if (!aliId) {
      const ali = await post(page, "/api/customers", {
        name: "Ali Khan",
        phone: "03111111111",
        email: "ali.khan@test.com",
        loyalty_points: 0,
      });
      expect([200, 201]).toContain(ali.status);
      aliId = ali.data.customer?.id || ali.data.id;
    }

    const saraExisting = existingList.find((c) => c.email === "sara.malik@test.com");
    let saraId = saraExisting?.id;
    if (!saraId) {
      const sara = await post(page, "/api/customers", {
        name: "Sara Malik",
        phone: "03222222222",
        email: "sara.malik@test.com",
        loyalty_points: 0,
      });
      expect([200, 201]).toContain(sara.status);
      saraId = sara.data.customer?.id || sara.data.id;
    }

    expect(aliId).toBeTruthy();
    expect(saraId).toBeTruthy();
    writeState({ customerAliId: aliId, customerSaraId: saraId });
    console.log("Customers — Ali:", aliId, "Sara:", saraId);
  });

  test("create or find cashier employee: Asad", async ({ page }) => {
    const rolesRes = await get(page, "/api/roles");
    expect(rolesRes.ok).toBe(true);
    const cashierRole = rolesRes.data.roles.find((r) =>
      r.name.toLowerCase().includes("cashier")
    );
    expect(cashierRole, "Cashier role must exist").toBeTruthy();

    const existing = await get(page, "/api/employees");
    const existingList = existing.data.employees || [];
    const existingAsad = existingList.find((e) => e.name === "Asad Test");

    let employeeAsadId = existingAsad?.id;
    if (!employeeAsadId) {
      const res = await post(page, "/api/employees", {
        name: "Asad Test",
        pin_code: "5555",
        role_id: cashierRole.id,
        salary_type: "monthly",
        monthly_salary: 25000,
      });
      expect([200, 201], `Employee creation failed: ${JSON.stringify(res.data)}`).toContain(res.status);
      employeeAsadId = res.data.employee?.id || res.data.id;
    }

    expect(employeeAsadId).toBeTruthy();
    writeState({ employeeAsadId, cashierRoleId: cashierRole.id });
    console.log("Cashier Asad id:", employeeAsadId);
  });

  test("fund Sara Malik wallet with PKR 500", async ({ page }) => {
    const { customerSaraId } = (await import("./helpers/state.js")).readState();
    expect(customerSaraId, "Sara's id must be in state").toBeTruthy();

    // Check current balance first
    const custRes = await get(page, `/api/customers/${customerSaraId}`);
    const balance = Number(custRes.data.customer?.balance ?? custRes.data?.balance ?? 0);
    console.log("Sara current balance:", balance);

    if (balance < 500) {
      const res = await post(page, `/api/customers/${customerSaraId}/wallet/topup`, {
        amount: 500,
        note: "Test wallet top-up",
      });
      expect([200, 201]).toContain(res.status);
      console.log("Sara wallet topped up:", res.data);
    } else {
      console.log("Sara already has sufficient balance, skipping top-up");
    }
  });

  test("verify all seeded data is retrievable", async ({ page }) => {
    const state = (await import("./helpers/state.js")).readState();

    expect(state.brandId, "brandId missing from state").toBeTruthy();
    expect(state.categoryId, "categoryId missing from state").toBeTruthy();
    expect(state.supplierId, "supplierId missing from state").toBeTruthy();
    expect(state.productIds?.length, "productIds missing from state").toBeGreaterThan(0);
    expect(state.customerAliId, "customerAliId missing from state").toBeTruthy();
    expect(state.customerSaraId, "customerSaraId missing from state").toBeTruthy();

    // Verify products exist
    for (const id of state.productIds) {
      const r = await get(page, `/api/products/${id}`);
      expect(r.ok, `Product ${id} not found`).toBe(true);
    }

    console.log("✅ All seed data verified");
    console.log("State:", JSON.stringify(state, null, 2));
  });
});
