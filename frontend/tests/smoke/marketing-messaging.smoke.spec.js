/**
 * Marketing campaigns + messaging inbox smoke — Phase 3.
 *
 * Test A (`marketing_campaigns`): create draft campaign → preview audience → schedule (NEVER send).
 * Test B (`customer_messaging`): list threads → verify envelope shape.
 */
import { test, expect } from "@playwright/test";
import { get, post } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "marketing-messaging.smoke.spec.js";

test.describe("Marketing + messaging smoke", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  test("marketing campaigns: draft → audience preview → schedule", async () => {
    if (!(await softSkip(test, SPEC, "marketing_campaigns"))) return;

    const createRes = await post("/api/marketing/campaigns", {
      name: prefix("Spring Sale"),
      subject: prefix("Spring sale starts now"),
      body_html: "<p>Hello from the smoke suite — please ignore.</p>",
      audience_filter: { segment: "all" },
      status: "draft",
    });
    expect(createRes.ok, `campaign: ${JSON.stringify(createRes.data)}`).toBe(true);
    const id = createRes.data?.id || createRes.data?.campaign?.id;
    expect(id).toBeTruthy();
    trackForCleanup("marketing-campaign", id);

    const previewRes = await get("/api/marketing/audiences/preview?segment=all");
    expect(previewRes.ok).toBe(true);
    expect(previewRes.data?.count ?? previewRes.data?.size ?? 0).toBeGreaterThanOrEqual(0);

    // Schedule for a far-future date so it never actually fires. Do NOT call /send.
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const scheduleRes = await post(`/api/marketing/campaigns/${id}/schedule`, {
      scheduled_at: future.toISOString(),
    });
    expect([200, 201]).toContain(scheduleRes.status);
  });

  test("messaging inbox: list threads", async () => {
    if (!(await softSkip(test, SPEC, "customer_messaging"))) return;

    const res = await get("/api/messaging/threads");
    expect(res.ok, `threads: ${JSON.stringify(res.data)}`).toBe(true);
    expect(res.data?.threads ?? res.data).toBeTruthy();
  });
});
