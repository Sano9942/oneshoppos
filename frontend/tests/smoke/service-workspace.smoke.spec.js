/**
 * Service workspace smoke — Phase 4. Projects, milestones, contracts, signatures.
 *
 * Test A (`phase4_service_projects`): create project → add milestone.
 * Test B (`phase4_service_contracts`): create template → create draft contract.
 *
 * Signed contracts are NOT tested — signing is irreversible on production.
 */
import { test, expect } from "@playwright/test";
import { get, post } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "service-workspace.smoke.spec.js";

test.describe("Service workspace smoke", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  test("projects: create project → add milestone", async () => {
    if (!(await softSkip(test, SPEC, "phase4_service_projects"))) return;

    const customerRes = await post("/api/customers", {
      name: prefix("Project Client"),
      mobile: "03009990000",
    });
    const customerId = customerRes.data?.id;
    trackForCleanup("customer", customerId);

    const projectRes = await post("/api/projects", {
      name: prefix("Smoke Website Build"),
      customer_id: customerId,
      status: "draft",
    });
    expect(projectRes.ok, `project: ${JSON.stringify(projectRes.data)}`).toBe(true);
    const projectId = projectRes.data?.id || projectRes.data?.project?.id;
    expect(projectId).toBeTruthy();
    trackForCleanup("project", projectId);

    const milestoneRes = await post(`/api/projects/${projectId}/milestones`, {
      name: prefix("Milestone 1"),
      amount: 1000,
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    });
    expect([200, 201]).toContain(milestoneRes.status);
  });

  test("contracts: create template → draft contract (unsigned)", async () => {
    if (!(await softSkip(test, SPEC, "phase4_service_contracts"))) return;

    const templateRes = await post("/api/contract-templates", {
      name: prefix("Smoke Template"),
      body_html: "<p>This is a smoke test template. {{customer_name}} agrees to nothing.</p>",
      variables: ["customer_name"],
    });
    expect(templateRes.ok, `template: ${JSON.stringify(templateRes.data)}`).toBe(true);
    const templateId = templateRes.data?.id;
    expect(templateId).toBeTruthy();
    trackForCleanup("contract-template", templateId);

    const customerRes = await post("/api/customers", {
      name: prefix("Contract Client"),
      mobile: "03008887777",
    });
    const customerId = customerRes.data?.id;
    trackForCleanup("customer", customerId);

    const contractRes = await post("/api/contracts", {
      template_id: templateId,
      customer_id: customerId,
      title: prefix("Draft Contract"),
    });
    expect(contractRes.ok, `contract: ${JSON.stringify(contractRes.data)}`).toBe(true);
    const contractId = contractRes.data?.id || contractRes.data?.contract?.id;
    if (contractId) trackForCleanup("contract", contractId);
    // Do NOT sign — it's irreversible.
  });
});
