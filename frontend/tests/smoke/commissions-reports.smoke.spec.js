/**
 * Commissions + report builder smoke — Phase 2b.
 *
 * Test A (`phase2_commissions`): create plan → list earnings endpoint.
 * Test B (`phase2_report_builder`): list datasets → create definition → run.
 */
import { test, expect } from "@playwright/test";
import { get, post } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "commissions-reports.smoke.spec.js";

test.describe("Commissions + report builder smoke", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  test("commission plans: create → list earnings", async () => {
    if (!(await softSkip(test, SPEC, "phase2_commissions"))) return;

    const createRes = await post("/api/commission-plans", {
      name: prefix("Sales 5%"),
      type: "percentage",
      rules: [{ scope_type: "all", rate: 5 }],
    });
    expect(createRes.ok, `plan: ${JSON.stringify(createRes.data)}`).toBe(true);
    const id = createRes.data?.plan?.id;
    expect(id).toBeTruthy();
    trackForCleanup("commission-plan", id);

    const earningsRes = await get("/api/commissions/earnings");
    expect(earningsRes.ok).toBe(true);
  });

  test("report builder: datasets → definition → run", async () => {
    if (!(await softSkip(test, SPEC, "phase2_report_builder"))) return;

    const datasetsRes = await get("/api/reports/builder/datasets");
    expect(datasetsRes.ok, `datasets: ${JSON.stringify(datasetsRes.data)}`).toBe(true);
    const datasets = datasetsRes.data?.datasets || datasetsRes.data || [];
    expect(Array.isArray(datasets) && datasets.length > 0, "at least one dataset").toBe(true);

    const datasetKey = datasets[0].code || datasets[0].id || datasets[0].key || "sales";
    const defRes = await post("/api/reports/builder/definitions", {
      name: prefix("Sales by day"),
      dataset: datasetKey,
      dimensions: ["date"],
      measures: ["total"],
      filters: [],
    });
    expect(defRes.ok, `definition: ${JSON.stringify(defRes.data)}`).toBe(true);
    const defId = defRes.data?.id || defRes.data?.definition?.id;
    if (defId) trackForCleanup("report-definition", defId);

    const runRes = await post(`/api/reports/builder/run`, {
      dataset: datasetKey,
      dimensions: ["date"],
      measures: ["total"],
      filters: [],
    });
    expect([200, 201, 400], `run status: ${runRes.status} body: ${JSON.stringify(runRes.data)}`).toContain(runRes.status);
  });
});
