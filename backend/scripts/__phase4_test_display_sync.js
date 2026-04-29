// Test customer-display sync: POST as POS, GET as public display, see they line up.
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const API_BASE = "https://api.sanopos.com";
const TENANT = "livetest1";
const SHIFT_ID = 1;
const HASSAN_ID = 1;

(async () => {
  // 1. Auth as Hassan to get a JWT
  const loginRes = await fetch(`${API_BASE}/api/auth/mt-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_slug: TENANT, username: "hassan", password: "Danish11" }),
  });
  const loginBody = await loginRes.json();
  if (!loginRes.ok) { console.error("Login failed:", loginBody); process.exit(1); }
  const token = loginBody.access_token || loginBody.token;
  console.log("Got token:", token ? "yes" : "no");

  // 2. POST as POS — push a fake cart
  const postRes = await fetch(`${API_BASE}/api/pos/customer-display?tenant=${TENANT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "x-employee-id": String(HASSAN_ID),
      "x-tenant-slug": TENANT,
    },
    body: JSON.stringify({
      shift_id: SHIFT_ID,
      items: [{ name: "Phase 4 Display Test", qty: 2, price: 50, total: 100 }],
      subtotal: 95.24,
      tax: 4.76,
      total: 100,
      status: "active",
    }),
  });
  console.log("POST status:", postRes.status, await postRes.text());

  // 3. GET as public display
  const getRes = await fetch(`${API_BASE}/api/pos/customer-display?shift_id=${SHIFT_ID}&tenant=${TENANT}`);
  console.log("GET status:", getRes.status);
  console.log("GET body:", JSON.stringify(await getRes.json(), null, 2));
})();
