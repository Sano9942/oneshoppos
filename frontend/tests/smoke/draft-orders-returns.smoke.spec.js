/**
 * Draft orders + return policies smoke — Phase 2.
 *
 * Test A (`phase2_draft_orders`): create draft → claim → complete.
 * Test B (`phase2_returns_policy`): create policy → create reason → list both back.
 */
import { test, expect } from "@playwright/test";
import { get, post } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "draft-orders-returns.smoke.spec.js";

test.describe("Draft orders + return policies smoke", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  test("draft orders: create → claim → complete", async () => {
    if (!(await softSkip(test, SPEC, "phase2_draft_orders"))) return;

    const productRes = await post("/api/products", {
      name: prefix("Draft Product"),
      price: 750,
      cost_price: 300,
      gst: 0,
    });
    expect(productRes.ok).toBe(true);
    const productId = productRes.data?.id;
    trackForCleanup("product", productId);

    const outletsRes = await get("/api/outlets");
    const outlet = (outletsRes.data?.outlets || outletsRes.data || [])[0];

    const createRes = await post("/api/draft-orders", {
      outlet_id: outlet.id,
      items: [{ product_id: productId, quantity: 1, price: 750 }],
      notes: "smoke draft",
    });
    expect(createRes.ok, `draft create: ${JSON.stringify(createRes.data)}`).toBe(true);
    const draftId = createRes.data?.draftOrder?.id || createRes.data?.id;
    expect(draftId).toBeTruthy();
    trackForCleanup("draft-order", draftId);

    const claimRes = await post(`/api/draft-orders/${draftId}/claim`, {});
    expect(claimRes.ok, `claim: ${JSON.stringify(claimRes.data)}`).toBe(true);

    const completeRes = await post(`/api/draft-orders/${draftId}/complete`, {});
    expect(completeRes.ok, `complete: ${JSON.stringify(completeRes.data)}`).toBe(true);
  });

  test("return policies: create policy + reason → list", async () => {
    if (!(await softSkip(test, SPEC, "phase2_returns_policy"))) return;

    const policyRes = await post("/api/return-policies", {
      name: prefix("30-day policy"),
      window_days: 30,
      refund_percentage: 100,
      allow_exchange: true,
    });
    expect(policyRes.ok, `policy: ${JSON.stringify(policyRes.data)}`).toBe(true);
    const policyId = policyRes.data?.id || policyRes.data?.policy?.id;
    expect(policyId).toBeTruthy();
    trackForCleanup("return-policy", policyId);

    const reasonRes = await post("/api/return-reasons", {
      code: prefix("SMOKE_DEFECT"),
      label: "Smoke defective item",
      requires_photo: false,
    });
    expect(reasonRes.ok, `reason: ${JSON.stringify(reasonRes.data)}`).toBe(true);
    const reasonId = reasonRes.data?.id || reasonRes.data?.reason?.id;
    expect(reasonId).toBeTruthy();
    trackForCleanup("return-reason", reasonId);

    const listRes = await get("/api/return-policies");
    expect(listRes.ok).toBe(true);
  });
});
