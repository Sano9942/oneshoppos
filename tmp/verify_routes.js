const http = require("http");

const endpoints = [
  "/api/outlets",
  "/api/customers",
  "/api/products/search?query=test",
  "/api/reports/dashboard/summary",
  "/api/reports/sales/summary",
  "/api/notifications/unread",
  "/api/company-profile",
  "/api/accounting/pnl",
  "/api/hr/leave-requests",
  "/api/crm/leads",
];

const checkEndpoint = (path) => {
  return new Promise((resolve) => {
    const options = {
      hostname: "localhost",
      port: 5000,
      path: path,
      method: "GET",
      headers: {
        Authorization: "Bearer test-token", // This might fail if auth is strict, but we check for 401/403 vs 404/500
      },
    };

    const req = http.request(options, (res) => {
      console.log(`Endpoint: ${path} - Status: ${res.statusCode}`);
      resolve(res.statusCode);
    });

    req.on("error", (e) => {
      console.error(`Endpoint: ${path} - Error: ${e.message}`);
      resolve(500);
    });

    req.end();
  });
};

async function run() {
  console.log("Starting backend route verification...");
  for (const ep of endpoints) {
    await checkEndpoint(ep);
  }
}

run();
