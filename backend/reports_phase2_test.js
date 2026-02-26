const http = require("http");

const API = "http://localhost:5000";
const RUN_TAG = "PHASE2_" + new Date().toISOString().replace(/[:.]/g, "-");
const HEADERS = { "x-employee-id": "1" };

function req(path, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: { "Content-Type": "application/json", ...HEADERS },
    };
    const r = http.request(API + path, options, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    r.on("error", reject);
    if (data) r.write(JSON.stringify(data));
    r.end();
  });
}

async function run() {
  console.log("=== Reports Phase 2 Test ===");
  console.log("Run tag:", RUN_TAG);
  let pass = 0;
  let fail = 0;

  const created = { scheduleId: null, viewId: null };
  const check = (name, ok, info = "") => {
    if (ok) {
      pass += 1;
      console.log(`PASS: ${name}`);
    } else {
      fail += 1;
      console.log(`FAIL: ${name}${info ? " | " + info : ""}`);
    }
  };

  try {
    const health = await req("/api/health");
    check("Backend health reachable", health.status === 200, `status=${health.status}`);
    if (health.status !== 200) throw new Error("Backend not reachable");

    const flags = [
      "reports_enhanced_filters",
      "reports_profit_layer",
      "reports_inventory_health_plus",
      "reports_exceptions",
      "reports_scheduled_exports",
    ];
    for (const key of flags) {
      const up = await req(`/api/feature-flags/${key}`, "PUT", {
        enabled: true,
        description: "Phase 2 test enable",
        updated_by: "phase2_test",
      });
      check(`Enable flag ${key}`, up.status === 200, `status=${up.status}`);
    }

    const forecast = await req("/api/reports/forecast-demand?lookback_days=30");
    check("Forecast demand endpoint", forecast.status === 200, `status=${forecast.status}`);
    check("Forecast has rows array", Array.isArray(forecast.body?.rows));

    const repl = await req("/api/reports/replenishment-smart?forecast_days=14");
    check("Replenishment smart endpoint", repl.status === 200, `status=${repl.status}`);
    check("Replenishment has rows array", Array.isArray(repl.body?.rows));

    const schedCreate = await req("/api/reports/schedules", "POST", {
      name: `${RUN_TAG}_nightly_profit`,
      report_key: "profit-by-product",
      frequency: "daily",
      run_hour: 0,
      run_minute: 0,
      recipient: "ops@example.local",
      filters: { date_from: "2026-01-01" },
    });
    check("Create report schedule", schedCreate.status === 200, `status=${schedCreate.status}`);
    created.scheduleId = schedCreate.body?.id || null;
    check("Created schedule id exists", !!created.scheduleId);

    if (created.scheduleId) {
      const runNow = await req(`/api/reports/schedules/${created.scheduleId}/run-now`, "POST", {});
      check("Run schedule now", runNow.status === 200, `status=${runNow.status}`);
      check("Run-now returns file path", !!runNow.body?.run?.file_path);

      const runs = await req(`/api/reports/schedules/${created.scheduleId}/runs`);
      check("Schedule runs list", runs.status === 200, `status=${runs.status}`);
      check("Runs has at least 1 row", (runs.body?.runs || []).length >= 1, `runs=${(runs.body?.runs || []).length}`);
    }

    const log = await req("/api/reports/delivery-log");
    check("Delivery log endpoint", log.status === 200, `status=${log.status}`);
    check("Delivery log array", Array.isArray(log.body?.log));

    const viewCreate = await req("/api/reports/saved-views", "POST", {
      report_key: "overview",
      name: `${RUN_TAG}_view`,
      scope: "personal",
      filters: { outlet_id: "1", date_from: "2026-01-01" },
      is_default: false,
    });
    check("Create saved view", viewCreate.status === 200, `status=${viewCreate.status}`);
    created.viewId = viewCreate.body?.id || null;
    check("Saved view id exists", !!created.viewId);

    if (created.viewId) {
      const viewUpdate = await req(`/api/reports/saved-views/${created.viewId}`, "PUT", {
        name: `${RUN_TAG}_view_updated`,
        filters: { outlet_id: "2" },
        is_default: true,
      });
      check("Update saved view", viewUpdate.status === 200, `status=${viewUpdate.status}`);
    }

    const defCreate = await req("/api/reports/governance/definitions", "POST", {
      report_key: "forecast-demand",
      version: `v_${RUN_TAG}`,
      query_signature: "moving_avg_cover_gap_v1",
      notes: "Automated phase2 verification",
    });
    check("Create governance definition", defCreate.status === 200, `status=${defCreate.status}`);

    const defs = await req("/api/reports/governance/definitions");
    check("Definitions list endpoint", defs.status === 200, `status=${defs.status}`);
    check(
      "Definitions include created version",
      (defs.body?.definitions || []).some((d) => d.version === `v_${RUN_TAG}`),
    );
  } catch (e) {
    fail += 1;
    console.log("FAIL: Test execution error |", e.message);
  } finally {
    if (created.viewId) {
      const delView = await req(`/api/reports/saved-views/${created.viewId}`, "DELETE");
      check("Cleanup saved view", delView.status === 200 || delView.status === 404, `status=${delView.status}`);
    }
    if (created.scheduleId) {
      const delSched = await req(`/api/reports/schedules/${created.scheduleId}`, "DELETE");
      check("Cleanup schedule", delSched.status === 200 || delSched.status === 404, `status=${delSched.status}`);
    }
  }

  console.log("");
  console.log(`=== Results: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

run();

