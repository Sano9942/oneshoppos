/**
 * OneShopPOS — Full API Health Check
 * Run: node health_check.js
 */

const BASE = "http://localhost:5000";
let passed = 0,
  failed = 0;

async function test(label, fn) {
  try {
    const result = await fn();
    if (result) {
      console.log(`  ✅  ${label}`);
      passed++;
    } else {
      console.log(`  ❌  ${label}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌  ${label} — ${e.message}`);
    failed++;
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

(async () => {
  console.log("\n🔍 OneShopPOS — API Health Check\n" + "═".repeat(45));

  // ── CORE INVENTORY ──
  console.log("\n📦 Inventory");
  await test("GET /api/products returns list", async () => {
    const d = await get("/api/products");
    return Array.isArray(d.products);
  });
  await test("GET /api/categories returns list", async () => {
    const d = await get("/api/categories");
    return Array.isArray(d.categories);
  });
  await test("GET /api/brands returns list", async () => {
    const d = await get("/api/brands");
    return Array.isArray(d.brands);
  });
  await test("GET /api/taxes returns list", async () => {
    const d = await get("/api/taxes");
    return Array.isArray(d.taxes);
  });

  // ── OUTLETS & EMPLOYEES ──
  console.log("\n🏪 Outlets & Employees");
  await test("GET /api/outlets returns list", async () => {
    const d = await get("/api/outlets");
    return Array.isArray(d.outlets);
  });
  await test("GET /api/employees returns list", async () => {
    const d = await get("/api/employees");
    return Array.isArray(d.employees);
  });

  // ── STOCK CONTROL ──
  console.log("\n📊 Stock Control");
  await test("GET /api/adjustments returns list", async () => {
    const d = await get("/api/adjustments");
    return Array.isArray(d);
  });
  await test("GET /api/transfers returns list", async () => {
    const d = await get("/api/transfers");
    return Array.isArray(d.transfers);
  });

  // ── SALES HISTORY ──
  console.log("\n🧾 Sales History");
  await test("GET /api/sales returns paginated", async () => {
    const d = await get("/api/sales");
    return Array.isArray(d.sales) && typeof d.total === "number";
  });
  await test("GET /api/sales has voided field", async () => {
    const d = await get("/api/sales");
    return d.sales.length === 0 || d.sales[0].hasOwnProperty("voided");
  });

  // ── VALIDATION CHECKS (business rules) ──
  console.log("\n🛡️  Business Rule Validation");
  await test("POST /api/sales rejects empty cart", async () => {
    const r = await post("/api/sales", { cartItems: [], outlet_id: 1 });
    return r.status === 400;
  });
  await test("POST /api/sales rejects missing outlet_id", async () => {
    const r = await post("/api/sales", { cartItems: [{ id: 1, quantity: 1 }] });
    return r.status === 400;
  });
  await test("POST /api/transfers rejects same outlet", async () => {
    const r = await post("/api/transfers", {
      product_id: 1,
      from_outlet_id: 1,
      to_outlet_id: 1,
      quantity: 1,
    });
    return r.status === 400;
  });
  await test("POST /api/transfers rejects zero qty", async () => {
    const r = await post("/api/transfers", {
      product_id: 1,
      from_outlet_id: 1,
      to_outlet_id: 2,
      quantity: 0,
    });
    return r.status === 400;
  });
  await test("PUT /api/sales/99999/void returns 404", async () => {
    const res = await fetch(`${BASE}/api/sales/99999/void`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ void_reason: "test" }),
    });
    return res.status === 404;
  });

  // ── REPORTS ──
  console.log("\n📈 Reports Dashboard");
  await test("GET /api/reports/dashboard returns data", async () => {
    const d = await get("/api/reports/dashboard");
    return d.hasOwnProperty("totalRevenueToday");
  });
  await test("Reports has inventoryValue from outlet_stock", async () => {
    const d = await get("/api/reports/dashboard");
    return d.hasOwnProperty("inventoryValue");
  });
  await test("Reports has lowStock array", async () => {
    const d = await get("/api/reports/dashboard");
    return Array.isArray(d.lowStock);
  });

  // ── RESULT ──
  const total = passed + failed;
  console.log("\n" + "═".repeat(45));
  console.log(`\n✨ Results: ${passed}/${total} tests passed\n`);
  if (failed > 0)
    console.log(`   ⚠️  ${failed} test(s) failed — review above\n`);
  else console.log("   🎉 All systems operational!\n");
})();
