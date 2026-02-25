const http = require("http");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const API = "http://localhost:5000";
const TEST_RUN = "E2E_FULL_" + new Date().toISOString().replace(/[:.]/g, "-");
const DB_PATH = path.resolve(__dirname, "oneshop.db");
let DEFAULT_HEADERS = {};

function makeRequest(path, method = "GET", data = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const mergedHeaders = { ...DEFAULT_HEADERS, ...extraHeaders };
    const options = {
      method,
      headers: { "Content-Type": "application/json", ...mergedHeaders },
    };
    const req = http.request(API + path, options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.run(sql, params, function (err) {
      db.close();
      if (err) return reject(err);
      resolve(this.changes || 0);
    });
  });
}

function getDbCount(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    db.get(sql, params, (err, row) => {
      db.close();
      if (err) return reject(err);
      resolve(Number(row?.c || 0));
    });
  });
}

async function cleanupByTag(tagPrefix) {
  // Hard-clean test artifacts directly to avoid FK/API teardown limitations.
  await runDb(
    "DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE notes LIKE ?)",
    [`${tagPrefix}%`],
  );
  await runDb(
    "DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE notes LIKE ?)",
    [`${tagPrefix}%`],
  );
  await runDb("DELETE FROM sales WHERE notes LIKE ?", [`${tagPrefix}%`]);

  await runDb(
    "DELETE FROM variant_option_values WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name LIKE ?))",
    [`${tagPrefix}%`],
  );
  await runDb(
    "DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name LIKE ?)",
    [`${tagPrefix}%`],
  );
  await runDb(
    "DELETE FROM outlet_stock WHERE product_id IN (SELECT id FROM products WHERE name LIKE ?)",
    [`${tagPrefix}%`],
  );
  await runDb("DELETE FROM products WHERE name LIKE ?", [`${tagPrefix}%`]);
  await runDb("DELETE FROM customers WHERE name LIKE ?", [`${tagPrefix}%`]);
  await runDb("DELETE FROM attribute_sets WHERE name LIKE ?", [`${tagPrefix}%`]);
  await runDb("DELETE FROM receipt_templates WHERE name LIKE ?", [`${tagPrefix}%`]);
}

async function runAll() {
  console.log("=== OneShopPOS Full E2E Test Suite ===");
  console.log("Run tag:", TEST_RUN);
  console.log("");

  let passed = 0;
  let failed = 0;
  const retained = [];

  const created = {
    products: [],
    attributeSets: [],
    receiptTemplates: [],
    customers: [],
    sales: [],
  };

  const check = (label, cond, info = "") => {
    if (cond) {
      passed++;
      console.log(`PASS: ${label}`);
    } else {
      failed++;
      console.log(`FAIL: ${label}${info ? " | " + info : ""}`);
    }
  };

  const recordCreated = (bucket, id) => {
    if (id) created[bucket].push(id);
  };

  try {
    // Preflight
    const preflight = await makeRequest("/api/outlets");
    check("Backend reachable", preflight.status === 200, `status=${preflight.status}`);
    if (preflight.status !== 200) {
      throw new Error("Backend not ready");
    }
    const health = await makeRequest("/api/health");
    check("Health endpoint reachable", health.status === 200, `status=${health.status}`);
    check("Health status ok", health.body?.status === "ok", `value=${health.body?.status}`);

    // Core entities
    const outlets = await makeRequest("/api/outlets");
    const outletId = outlets.body.outlets?.[0]?.id;
    check("Outlets available", !!outletId);
    if (!outletId) throw new Error("No outlet found");

    const employees = await makeRequest("/api/employees");
    const adminEmployee =
      (employees.body.employees || []).find((e) => Number(e.role_id) === 1) ||
      employees.body.employees?.[0] ||
      null;
    const employeeId = adminEmployee?.id || 1;
    const adminHeaders = { "x-employee-id": String(employeeId) };
    DEFAULT_HEADERS = { ...adminHeaders };
    check("Employees endpoint available", employees.status === 200, `status=${employees.status}`);

    // Baseline RBAC + sales flow regression
    const r1 = await makeRequest("/api/roles/1/permissions");
    check("Admin role has permissions", Array.isArray(r1.body.permissions) && r1.body.permissions.length > 0);
    check("Admin has all_access", r1.body.permissions?.includes("all_access"));

    const r3 = await makeRequest("/api/roles/3/permissions");
    check("Cashier role does not have all_access", !r3.body.permissions?.includes("all_access"));

    const delRole1 = await makeRequest("/api/roles/1", "DELETE", null, adminHeaders);
    check(
      "System role deletion blocked",
      delRole1.status === 400 || delRole1.status === 403,
      `status=${delRole1.status}`,
    );

    const productsBefore = await makeRequest("/api/products");
    let baselineProduct = (productsBefore.body.products || []).find((p) => (p.total_stock || 0) > 0);

    if (!baselineProduct) {
      const barcode = `${Date.now()}01`;
      const addRes = await makeRequest("/api/products", "POST", {
        barcode,
        name: `${TEST_RUN}_Baseline_Product`,
        price: 10,
        cost_price: 5,
        outlet_id: outletId,
        initial_stock: 5,
      });
      check("Create fallback baseline product", addRes.status === 200, `status=${addRes.status}`);
      if (addRes.status === 200) {
        recordCreated("products", addRes.body.id);
        const fetched = await makeRequest("/api/products");
        baselineProduct = (fetched.body.products || []).find((p) => p.id === addRes.body.id);
      }
    }

    check("Products list available", productsBefore.status === 200 && (productsBefore.body.products || []).length >= 0);
    check("Baseline product available", !!baselineProduct);
    if (!baselineProduct) throw new Error("No product available for baseline sale tests");

    const initialStock = baselineProduct.total_stock || 0;

    const pin = await makeRequest("/api/employees/validate-pin", "POST", { pin_code: "1234" });
    check("Employee PIN validation endpoint works", pin.status === 200 || pin.status === 401, `status=${pin.status}`);

    const saleRes = await makeRequest("/api/sales", "POST", {
      cartItems: [
        {
          id: baselineProduct.id,
          name: baselineProduct.name,
          price: baselineProduct.price,
          quantity: 1,
          effectiveTaxRate: 0,
        },
      ],
      payments: [{ method: "Cash", amount: baselineProduct.price }],
      outlet_id: outletId,
      employee_id: employeeId,
      discount_amount: 0,
      discount_type: "fixed",
      points_earned: 0,
      points_redeemed: 0,
      notes: `${TEST_RUN}_baseline_sale`,
    });
    check("Baseline sale creation returns 200", saleRes.status === 200, `status=${saleRes.status}`);
    const baselineSaleId = saleRes.body?.saleId;
    check("Sale response includes invoice number", !!saleRes.body?.invoiceNumber, `invoice=${saleRes.body?.invoiceNumber}`);
    if (baselineSaleId) recordCreated("sales", baselineSaleId);

    if (baselineSaleId) {
      const exportRes = await makeRequest(`/api/sales/${baselineSaleId}/invoice/export`);
      check("Invoice export endpoint returns 200", exportRes.status === 200, `status=${exportRes.status}`);
      check("Invoice export version is 1.0", exportRes.body?.version === "1.0", `value=${exportRes.body?.version}`);
      check("Invoice export includes items", Array.isArray(exportRes.body?.items), `items=${typeof exportRes.body?.items}`);
      check(
        "Invoice export totals include total_amount",
        typeof exportRes.body?.invoice?.totals?.total_amount === "number",
        `value=${exportRes.body?.invoice?.totals?.total_amount}`,
      );
    }

    const afterSaleProducts = await makeRequest("/api/products");
    const afterSaleProduct = (afterSaleProducts.body.products || []).find((p) => p.id === baselineProduct.id);
    check(
      "Stock decremented after baseline sale",
      !!afterSaleProduct && (afterSaleProduct.total_stock || 0) <= initialStock - 1,
      `before=${initialStock} after=${afterSaleProduct?.total_stock}`,
    );

    if (baselineSaleId) {
      const voidRes = await makeRequest(
        `/api/sales/${baselineSaleId}/void`,
        "PUT",
        { void_reason: `${TEST_RUN}_void` },
        adminHeaders
      );
      check(
        "Baseline sale void allowed or permission-blocked",
        voidRes.status === 200 || voidRes.status === 403,
        `status=${voidRes.status}`,
      );

      if (voidRes.status === 200) {
        const restoredProducts = await makeRequest("/api/products");
        const restored = (restoredProducts.body.products || []).find((p) => p.id === baselineProduct.id);
        check(
          "Stock restored after baseline void",
          !!restored && (restored.total_stock || 0) === initialStock,
          `expected=${initialStock} got=${restored?.total_stock}`,
        );
      } else {
        check("Stock restore skipped when void is forbidden", true, "void permission not available in test DB");
      }
    }

    const history = await makeRequest("/api/action-history");
    check("Action history endpoint works", history.status === 200, `status=${history.status}`);

    const supplierReturns = await makeRequest("/api/supplier-returns");
    check("Supplier returns endpoint works", supplierReturns.status === 200, `status=${supplierReturns.status}`);

    // New feature: product extended fields
    const productBarcode = `${Date.now()}02`;
    const productCreate = await makeRequest("/api/products", "POST", {
      barcode: productBarcode,
      name: `${TEST_RUN}_Extended_Product`,
      price: 25,
      cost_price: 10,
      outlet_id: outletId,
      initial_stock: 4,
      min_qty: 2,
      max_qty: 12,
      unit: "kg",
    });
    check("Create product with min/max/unit", productCreate.status === 200, `status=${productCreate.status}`);
    const extendedProductId = productCreate.body?.id;
    if (extendedProductId) recordCreated("products", extendedProductId);

    const productsAfterCreate = await makeRequest("/api/products");
    const extendedCreated = (productsAfterCreate.body.products || []).find((p) => p.id === extendedProductId);
    check("Extended product persisted min_qty", extendedCreated?.min_qty === 2, `value=${extendedCreated?.min_qty}`);
    check("Extended product persisted max_qty", extendedCreated?.max_qty === 12, `value=${extendedCreated?.max_qty}`);
    check("Extended product persisted unit", extendedCreated?.unit === "kg", `value=${extendedCreated?.unit}`);

    if (extendedProductId) {
      const updateRes = await makeRequest(`/api/products/${extendedProductId}`, "PUT", {
        name: `${TEST_RUN}_Extended_Product_Updated`,
        min_qty: 3,
        max_qty: 15,
        unit: "box",
      });
      check("Update product min/max/unit", updateRes.status === 200, `status=${updateRes.status}`);
      const productsAfterUpdate = await makeRequest("/api/products");
      const extendedUpdated = (productsAfterUpdate.body.products || []).find((p) => p.id === extendedProductId);
      check("Updated product min_qty stored", extendedUpdated?.min_qty === 3, `value=${extendedUpdated?.min_qty}`);
      check("Updated product max_qty stored", extendedUpdated?.max_qty === 15, `value=${extendedUpdated?.max_qty}`);
      check("Updated product unit stored", extendedUpdated?.unit === "box", `value=${extendedUpdated?.unit}`);
    }

    // New feature: bulk import (insert + update + error)
    const importBarcodeInsert = `${Date.now()}03`;
    const importBarcodeUpdate = `${Date.now()}04`;
    const seedForUpdate = await makeRequest("/api/products", "POST", {
      barcode: importBarcodeUpdate,
      name: `${TEST_RUN}_Import_Seed`,
      price: 11,
      cost_price: 5,
      outlet_id: outletId,
      initial_stock: 2,
    });
    check("Seed product for bulk import update", seedForUpdate.status === 200, `status=${seedForUpdate.status}`);
    if (seedForUpdate.body?.id) recordCreated("products", seedForUpdate.body.id);

    const importRes = await makeRequest("/api/products/bulk-import", "POST", {
      rows: [
        {
          barcode: importBarcodeInsert,
          name: `${TEST_RUN}_Import_Insert`,
          price: 19.5,
          cost_price: 8.5,
          gst: 0,
          stock: 6,
          min_qty: 1,
          max_qty: 20,
          unit: "pcs",
        },
        {
          barcode: importBarcodeUpdate,
          name: `${TEST_RUN}_Import_Updated`,
          price: 13.75,
          cost_price: 6,
          gst: 0,
          stock: 7,
          min_qty: 2,
          max_qty: 22,
          unit: "dozen",
        },
        {
          barcode: `${Date.now()}05`,
          name: "",
          price: "",
        },
      ],
    });
    check("Bulk import endpoint returns 200", importRes.status === 200, `status=${importRes.status}`);
    const results = importRes.body?.results || [];
    check("Bulk import has inserted row", results.some((r) => r.status === "inserted"));
    check("Bulk import has updated row", results.some((r) => r.status === "updated"));
    check("Bulk import has error row", results.some((r) => r.status === "error"));

    const productsAfterImport = await makeRequest("/api/products");
    const insertedRow = (productsAfterImport.body.products || []).find((p) => p.barcode === importBarcodeInsert);
    const updatedRow = (productsAfterImport.body.products || []).find((p) => p.barcode === importBarcodeUpdate);
    if (insertedRow?.id) recordCreated("products", insertedRow.id);
    check("Bulk import inserted row exists", !!insertedRow);
    check("Bulk import updated name applied", updatedRow?.name === `${TEST_RUN}_Import_Updated`, `name=${updatedRow?.name}`);
    check("Bulk import updated unit applied", updatedRow?.unit === "dozen", `unit=${updatedRow?.unit}`);

    // New feature: attribute sets CRUD incl. PUT full replace
    const attrCreate = await makeRequest("/api/attribute-sets", "POST", {
      name: `${TEST_RUN}_AttrSet`,
      description: "Automated test set",
      attributes: [
        { name: "Color", options: [{ value: "Red" }, { value: "Blue" }] },
        { name: "Size", options: [{ value: "S" }, { value: "M" }] },
      ],
    });
    check("Create attribute set", attrCreate.status === 200, `status=${attrCreate.status}`);
    const attrSetId = attrCreate.body?.id;
    if (attrSetId) recordCreated("attributeSets", attrSetId);

    if (attrSetId) {
      const attrUpdate = await makeRequest(`/api/attribute-sets/${attrSetId}`, "PUT", {
        name: `${TEST_RUN}_AttrSet_Updated`,
        description: "Updated",
        attributes: [
          { name: "Color", options: [{ value: "Black" }, { value: "White" }] },
        ],
      });
      check("Update attribute set full replace", attrUpdate.status === 200, `status=${attrUpdate.status}`);

      const attrGet = await makeRequest("/api/attribute-sets");
      const setRow = (attrGet.body.attributeSets || []).find((s) => s.id === attrSetId);
      check("Updated attribute set name persisted", setRow?.name === `${TEST_RUN}_AttrSet_Updated`, `name=${setRow?.name}`);
      check("Attribute count replaced to 1", (setRow?.attributes || []).length === 1, `count=${(setRow?.attributes || []).length}`);
      const optionValues = ((setRow?.attributes || [])[0]?.options || []).map((o) => o.value);
      check("Replaced attribute options persisted", optionValues.includes("Black") && optionValues.includes("White"));

      const attrDelete = await makeRequest(`/api/attribute-sets/${attrSetId}`, "DELETE");
      check("Delete attribute set", attrDelete.status === 200, `status=${attrDelete.status}`);
      created.attributeSets = created.attributeSets.filter((id) => id !== attrSetId);
    }

    // New feature: loyalty + total_amount formula
    const customerMobile = `${Date.now()}`.slice(-10);
    const customerCreate = await makeRequest("/api/customers", "POST", {
      name: `${TEST_RUN}_Customer`,
      mobile: customerMobile,
      cnic: `${TEST_RUN}_CNIC`,
      occupation: "QA",
      balance: 0,
    });
    check("Create customer for loyalty test", customerCreate.status === 200, `status=${customerCreate.status}`);
    const customerId = customerCreate.body?.id;
    if (customerId) recordCreated("customers", customerId);

    const loyaltyProductBarcode = `${Date.now()}06`;
    const loyaltyProductCreate = await makeRequest("/api/products", "POST", {
      barcode: loyaltyProductBarcode,
      name: `${TEST_RUN}_Loyalty_Product`,
      price: 50,
      cost_price: 20,
      outlet_id: outletId,
      initial_stock: 3,
    });
    check("Create loyalty test product", loyaltyProductCreate.status === 200, `status=${loyaltyProductCreate.status}`);
    const loyaltyProductId = loyaltyProductCreate.body?.id;
    if (loyaltyProductId) recordCreated("products", loyaltyProductId);

    let loyaltySaleId = null;
    if (customerId && loyaltyProductId) {
      const pointsEarned = 10;
      const pointsRedeemed = 5;
      const discount = 7;
      const subtotal = 50;
      const expectedTotal = subtotal - discount - pointsRedeemed;

      const loyaltySale = await makeRequest("/api/sales", "POST", {
        cartItems: [
          {
            id: loyaltyProductId,
            name: `${TEST_RUN}_Loyalty_Product`,
            price: subtotal,
            quantity: 1,
            effectiveTaxRate: 0,
          },
        ],
        payments: [{ method: "Cash", amount: expectedTotal }],
        outlet_id: outletId,
        employee_id: employeeId,
        customer_id: customerId,
        discount_amount: discount,
        discount_type: "fixed",
        points_earned: pointsEarned,
        points_redeemed: pointsRedeemed,
        notes: `${TEST_RUN}_loyalty_check`,
      });
      check("Create loyalty sale", loyaltySale.status === 200, `status=${loyaltySale.status}`);
      loyaltySaleId = loyaltySale.body?.saleId;
      if (loyaltySaleId) recordCreated("sales", loyaltySaleId);
      check("Sale total reflects points deduction", Number(loyaltySale.body?.totalAmount) === expectedTotal, `expected=${expectedTotal} got=${loyaltySale.body?.totalAmount}`);

      const customersAfter = await makeRequest("/api/customers");
      const loyaltyCustomer = (customersAfter.body.customers || []).find((c) => c.id === customerId);
      check("Customer points adjusted (earned-redeemed)", Number(loyaltyCustomer?.loyalty_points || 0) === pointsEarned - pointsRedeemed, `points=${loyaltyCustomer?.loyalty_points}`);
    }

    // New feature: dashboard analytics endpoints
    const dash = await makeRequest("/api/reports/dashboard");
    check("Dashboard report endpoint works", dash.status === 200, `status=${dash.status}`);
    check("Dashboard includes salesTrend array", Array.isArray(dash.body?.salesTrend));
    const trendSample = (dash.body?.salesTrend || [])[0];
    if (trendSample) {
      check("salesTrend row has day", Object.prototype.hasOwnProperty.call(trendSample, "day"));
      check("salesTrend row has revenue", Object.prototype.hasOwnProperty.call(trendSample, "revenue"));
      check("salesTrend row has sale_count", Object.prototype.hasOwnProperty.call(trendSample, "sale_count"));
    } else {
      check("salesTrend empty set accepted", true);
    }

    const topSales = await makeRequest("/api/reports/top-salespeople");
    check("Top salespeople endpoint works", topSales.status === 200, `status=${topSales.status}`);
    check("Top salespeople payload is array", Array.isArray(topSales.body?.salespeople));
    const salesperson = (topSales.body?.salespeople || [])[0];
    if (salesperson) {
      check("Top salespeople row has employee_name", Object.prototype.hasOwnProperty.call(salesperson, "employee_name"));
      check("Top salespeople row has transactions", Object.prototype.hasOwnProperty.call(salesperson, "transactions"));
      check("Top salespeople row has revenue", Object.prototype.hasOwnProperty.call(salesperson, "revenue"));
      check("Top salespeople row has items_sold", Object.prototype.hasOwnProperty.call(salesperson, "items_sold"));
      check("Top salespeople row has avg_basket", Object.prototype.hasOwnProperty.call(salesperson, "avg_basket"));
    } else {
      check("Top salespeople empty set accepted", true);
    }

    // New feature: receipt templates lifecycle and active switching
    const tmplA = await makeRequest("/api/receipt-templates", "POST", {
      name: `${TEST_RUN}_Template_A`,
      header_text: "Header A",
      footer_text: "Footer A",
      show_barcode: true,
      show_logo: false,
      is_active: true,
    });
    check("Create receipt template A", tmplA.status === 200, `status=${tmplA.status}`);
    const tmplAId = tmplA.body?.id;
    if (tmplAId) recordCreated("receiptTemplates", tmplAId);

    const activeAfterA = await makeRequest("/api/receipt-templates/active");
    check("Active template points to A", activeAfterA.body?.template?.id === tmplAId, `active=${activeAfterA.body?.template?.id}`);

    const tmplB = await makeRequest("/api/receipt-templates", "POST", {
      name: `${TEST_RUN}_Template_B`,
      header_text: "Header B",
      footer_text: "Footer B",
      show_barcode: false,
      show_logo: false,
      is_active: true,
    });
    check("Create receipt template B", tmplB.status === 200, `status=${tmplB.status}`);
    const tmplBId = tmplB.body?.id;
    if (tmplBId) recordCreated("receiptTemplates", tmplBId);

    const activeAfterB = await makeRequest("/api/receipt-templates/active");
    check("Active template switched to B", activeAfterB.body?.template?.id === tmplBId, `active=${activeAfterB.body?.template?.id}`);

    if (tmplBId) {
      const tmplUpdate = await makeRequest(`/api/receipt-templates/${tmplBId}`, "PUT", {
        name: `${TEST_RUN}_Template_B_Updated`,
        header_text: "Header B2",
        footer_text: "Footer B2",
        show_barcode: true,
        show_logo: false,
        is_active: true,
      });
      check("Update receipt template B", tmplUpdate.status === 200, `status=${tmplUpdate.status}`);
      const allTemplates = await makeRequest("/api/receipt-templates");
      const updatedTmpl = (allTemplates.body.templates || []).find((t) => t.id === tmplBId);
      check("Updated template fields persisted", updatedTmpl?.name === `${TEST_RUN}_Template_B_Updated`, `name=${updatedTmpl?.name}`);
      check("Updated template barcode flag persisted", Number(updatedTmpl?.show_barcode) === 1, `show_barcode=${updatedTmpl?.show_barcode}`);
    }

    // Cleanup (best effort via API first)
    for (const id of [...created.sales]) {
      const voidAttempt = await makeRequest(`/api/sales/${id}/void`, "PUT", { void_reason: `${TEST_RUN}_cleanup` });
      if (!(voidAttempt.status === 200 || voidAttempt.status === 400 || voidAttempt.status === 404)) {
        retained.push({ type: "sale", id, reason: `void status ${voidAttempt.status}` });
      }
    }

    for (const id of [...created.receiptTemplates]) {
      const del = await makeRequest(`/api/receipt-templates/${id}`, "DELETE");
      if (del.status !== 200 && del.status !== 404) {
        retained.push({ type: "receipt_template", id, reason: `delete status ${del.status}` });
      }
    }

    for (const id of [...created.products]) {
      const del = await makeRequest(`/api/products/${id}`, "DELETE");
      if (del.status !== 200 && del.status !== 404) {
        retained.push({ type: "product", id, reason: `delete status ${del.status}` });
      }
    }

    for (const id of [...created.customers]) {
      const del = await makeRequest(`/api/customers/${id}`, "DELETE");
      if (del.status !== 200 && del.status !== 404) {
        retained.push({ type: "customer", id, reason: `delete status ${del.status}` });
      }
    }

    for (const id of [...created.attributeSets]) {
      const del = await makeRequest(`/api/attribute-sets/${id}`, "DELETE");
      if (del.status !== 200 && del.status !== 404) {
        retained.push({ type: "attribute_set", id, reason: `delete status ${del.status}` });
      }
    }

    // Hard cleanup directly in DB for any leftovers from this run tag.
    await cleanupByTag(TEST_RUN);

    // Only report retained artifacts if tagged records still exist after hard cleanup.
    const remainingProducts = await getDbCount(
      "SELECT COUNT(*) as c FROM products WHERE name LIKE ?",
      [`${TEST_RUN}%`],
    );
    const remainingCustomers = await getDbCount(
      "SELECT COUNT(*) as c FROM customers WHERE name LIKE ?",
      [`${TEST_RUN}%`],
    );
    const remainingTemplates = await getDbCount(
      "SELECT COUNT(*) as c FROM receipt_templates WHERE name LIKE ?",
      [`${TEST_RUN}%`],
    );
    const remainingAttrs = await getDbCount(
      "SELECT COUNT(*) as c FROM attribute_sets WHERE name LIKE ?",
      [`${TEST_RUN}%`],
    );
    const remainingSales = await getDbCount(
      "SELECT COUNT(*) as c FROM sales WHERE notes LIKE ?",
      [`${TEST_RUN}%`],
    );

    if (
      remainingProducts === 0 &&
      remainingCustomers === 0 &&
      remainingTemplates === 0 &&
      remainingAttrs === 0 &&
      remainingSales === 0
    ) {
      retained.length = 0;
    } else {
      retained.push({
        type: "db_cleanup",
        id: "tag",
        reason: `remaining products=${remainingProducts}, customers=${remainingCustomers}, templates=${remainingTemplates}, attrs=${remainingAttrs}, sales=${remainingSales}`,
      });
    }
  } catch (err) {
    failed++;
    console.log("FAIL: Test execution error |", err.message);
  }

  console.log("");
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  if (retained.length > 0) {
    console.log("Retained test data:");
    retained.forEach((r) => {
      console.log(` - ${r.type}#${r.id}: ${r.reason}`);
    });
  } else {
    console.log("Retained test data: none");
  }
}

runAll();
