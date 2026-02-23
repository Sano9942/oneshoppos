const http = require("http");

function makeRequest(path, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const options = { method, headers: { "Content-Type": "application/json" } };
    const req = http.request("http://localhost:5000" + path, options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runAll() {
  console.log("=== Phase 6: E2E + RBAC Test Suite ===\n");
  let passed = 0,
    failed = 0;

  const check = (label, cond, info) => {
    if (cond) {
      console.log(`✅ PASS: ${label}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${label}`, info || "");
      failed++;
    }
  };

  // --- RBAC Tests ---
  try {
    // Test: Get role 1 (Admin) permissions
    const r1 = await makeRequest("/api/roles/1/permissions");
    check(
      "Admin role has permissions",
      r1.body.permissions?.length > 0,
      r1.body,
    );
    check(
      "Admin has all_access",
      r1.body.permissions?.includes("all_access"),
      r1.body.permissions,
    );

    // Test: Get role 3 (Cashier) permissions
    const r3 = await makeRequest("/api/roles/3/permissions");
    check(
      "Cashier role does NOT have all_access",
      !r3.body.permissions?.includes("all_access"),
    );

    // Test: Prevent deletion of system role 1
    const delRole1 = await makeRequest("/api/roles/1", "DELETE");
    check(
      "Cannot delete system role 1 (Admin)",
      delRole1.status === 400,
      `Got status ${delRole1.status}`,
    );

    // --- E2E Workflow Tests ---
    // Step 1: Check outlets
    const outlets = await makeRequest("/api/outlets");
    check("Outlets list available", outlets.body.outlets?.length > 0);
    const outletId = outlets.body.outlets[0].id;

    // Step 2: Check products
    const products = await makeRequest("/api/products");
    check("Products list available", products.body.products?.length > 0);
    const product = products.body.products[0];
    const initialStock = product.total_stock;
    console.log(
      `   ℹ Using product: "${product.name}" with stock: ${initialStock}`,
    );

    // Step 3: Validate PIN
    const pin = await makeRequest("/api/employees/validate-pin", "POST", {
      pin_code: "1234",
    });
    check(
      "Employee PIN validation works",
      pin.status === 200 || pin.status === 401,
      `Got ${pin.status}`,
    );
    // Note: 401 is OK if no employee has 1234 PIN

    // Step 4: Create a sale
    const saleRes = await makeRequest("/api/sales", "POST", {
      cartItems: [
        {
          id: product.id,
          name: product.name,
          price: product.price,
          quantity: 1,
          effectiveTaxRate: 0,
        },
      ],
      payments: [{ method: "Cash", amount: product.price }],
      outlet_id: outletId,
      employee_id: 1,
      discount_amount: 0,
      discount_type: "fixed",
      points_earned: 0,
      points_redeemed: 0,
    });
    check(
      "Sale creation returns 200",
      saleRes.status === 200,
      `Got ${saleRes.status}: ${JSON.stringify(saleRes.body).substring(0, 100)}`,
    );
    const saleId = saleRes.body.saleId;
    console.log(`   ℹ Sale ID created: ${saleId}`);

    // Step 5: Verify stock decremented
    const afterProducts = await makeRequest("/api/products");
    const afterProduct = afterProducts.body.products.find(
      (p) => p.id === product.id,
    );
    check(
      "Stock decremented after sale",
      afterProduct.total_stock < initialStock || afterProduct.total_stock === 0,
      `Before: ${initialStock}, After: ${afterProduct.total_stock}`,
    );

    // Step 6: Void the sale
    if (saleId) {
      const voidRes = await makeRequest(`/api/sales/${saleId}/void`, "PUT", {
        void_reason: "E2E Test Void",
      });
      check(
        "Sale void returns 200",
        voidRes.status === 200,
        `Got ${voidRes.status}: ${JSON.stringify(voidRes.body).substring(0, 100)}`,
      );

      // Step 7: Verify stock restored after void
      const restoreProducts = await makeRequest("/api/products");
      const restoredProduct = restoreProducts.body.products.find(
        (p) => p.id === product.id,
      );
      check(
        "Stock restored after void",
        restoredProduct.total_stock === initialStock,
        `Expected: ${initialStock}, Got: ${restoredProduct.total_stock}`,
      );
    }

    // Step 8: Check reports
    const reports = await makeRequest("/api/sales?limit=5");
    check(
      "Sales reports endpoint works",
      reports.status === 200,
      `Got ${reports.status}`,
    );

    // Step 9: Verify action history endpoint
    const history = await makeRequest("/api/action-history");
    check(
      "Action history endpoint works",
      history.status === 200,
      `Got ${history.status}`,
    );

    // Step 10: Verify supplier returns endpoint
    const rma = await makeRequest("/api/supplier-returns");
    check(
      "Supplier returns endpoint works",
      rma.status === 200,
      `Got ${rma.status}`,
    );
  } catch (err) {
    console.error("Test execution error:", err.message);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
}

runAll();
