const http = require("http");
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./oneshop.db");

db.get(
  "SELECT id FROM employees WHERE LOWER(name) = LOWER(?)",
  ["hassan"],
  (err, row) => {
    if (err || !row) {
      console.log("Could not find employee 'hassan', defaulting to id 1");
    }
    const employeeId = row ? row.id : 1;
    console.log("Using employee ID:", employeeId);

    const endpointList = [
      "/api/reports/comparative-trends",
      "/api/reports/heatmaps",
      "/api/reports/retail-matrix",
      "/api/reports/revenue-leaks",
      "/api/reports/labor-performance",
      "/api/reports/loss-prevention",
      "/api/reports/customer-retention",
      "/api/reports/customer-capture-rate",
      "/api/reports/product-mix",
    ];

    let pending = endpointList.length;

    endpointList.forEach((endpoint) => {
      http
        .get(
          {
            hostname: "localhost",
            port: 5000,
            path: endpoint,
            headers: { "x-employee-id": employeeId.toString() },
          },
          (res2) => {
            let reportData = "";
            res2.on("data", (chunk) => {
              reportData += chunk;
            });
            res2.on("end", () => {
              console.log(
                "\\n--- Status for " +
                  endpoint +
                  ": " +
                  res2.statusCode +
                  " ---",
              );
              console.log(
                reportData.substring(0, 300) +
                  (reportData.length > 300 ? "..." : ""),
              );
              pending--;
              if (pending === 0) {
                process.exit(0);
              }
            });
          },
        )
        .on("error", (e) => {
          console.error("Request to " + endpoint + " failed: " + e.message);
          pending--;
          if (pending === 0) {
            process.exit(0);
          }
        });
    });
  },
);
