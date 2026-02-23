const http = require("http");

const API = "http://localhost:5000";

function makeRequest(path, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(API + path, options, (res) => {
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

async function runTests() {
  console.log("Running backend edge-case tests...");
  let passed = 0;
  let failed = 0;

  try {
    // Test 1: Post negative stock adjustment
    const res1 = await makeRequest("/api/stock-adjustments", "POST", {
      product_id: 1,
      outlet_id: 1,
      employee_id: 1,
      quantity_change: "invalid",
      reason: "Test",
    });
    if (res1.status === 400 || res1.status === 500) {
      console.log("Test 1 Passed: Caught invalid qty type");
      passed++;
    } else {
      console.log("Test 1 Failed: Accepted invalid qty", res1);
      failed++;
    }

    // Test 2: Get invalid product route
    const res2 = await makeRequest("/api/products/999999", "GET");
    if (res2.status === 404) {
      console.log("Test 2 Passed: 404 on missing product");
      passed++;
    } else {
      console.log(
        "Test 2 Failed: Did not return 404 for missing ID",
        res2.status,
      );
      failed++;
    }

    // Test 3: SQL Injection attempt in search
    const res3 = await makeRequest(
      "/api/products/search?query=' OR 1=1--",
      "GET",
    );
    if (res3.status === 200) {
      console.log("Test 3 Passed: Parametrized search didn't crash");
      passed++;
    } else {
      console.log("Test 3 Failed: Search crashed under SQL format", res3);
      failed++;
    }
  } catch (err) {
    console.error("Test execution failed:", err);
  }

  console.log(`Finished: ${passed} passed, ${failed} failed.`);
}

runTests();
