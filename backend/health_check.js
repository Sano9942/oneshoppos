const API = "http://localhost:5000/api";

async function checkEndpoint(name, path) {
  process.stdout.write(`Checking ${name}... `);
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) {
      console.log(`❌ Failed (HTTP ${res.status})`);
      return false;
    }
    const data = await res.json();
    // Just checking if it returns a valid JSON and doesn't crash
    console.log(`✅ OK`);
    return true;
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
    return false;
  }
}

async function runComprehensiveHealthCheck() {
  console.log("=========================================");
  console.log("   OneShopPOS Comprehensive API Check    ");
  console.log("=========================================\n");

  const endpoints = [
    { name: "Categories", path: "/categories" },
    { name: "Brands", path: "/brands" },
    { name: "Taxes", path: "/taxes" },
    { name: "Outlets", path: "/outlets" },
    { name: "Employees", path: "/employees" },
    { name: "Products", path: "/products" },
    { name: "Customers", path: "/customers" },
    { name: "Suppliers", path: "/suppliers" },
    { name: "Purchase Orders", path: "/purchase-orders" },
    { name: "Goods Received Notes", path: "/grn" },
    { name: "Cash Shifts", path: "/shifts" },
    { name: "Employee Attendance", path: "/attendance" },
    { name: "Sales", path: "/sales" },
    { name: "Returns", path: "/returns" },
  ];

  let passed = 0;
  for (const ep of endpoints) {
    const isOk = await checkEndpoint(ep.name, ep.path);
    if (isOk) passed++;
  }

  console.log("\n=========================================");
  console.log(`   Results: ${passed}/${endpoints.length} Endpoints Passed`);
  console.log("=========================================");

  if (passed === endpoints.length) {
    console.log("🎉 ALL SYSTEMS GO!");
  } else {
    console.log("⚠️ SOME CHECKS FAILED. Please review the logs.");
  }
}

runComprehensiveHealthCheck();
