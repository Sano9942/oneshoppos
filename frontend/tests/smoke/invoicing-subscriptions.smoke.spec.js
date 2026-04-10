/**
 * Customer invoicing + subscriptions smoke — Phase 3.
 *
 * Test A (`customer_invoicing`): create invoice draft → list invoices.
 * Test B (`subscription_billing`): create plan → subscription (trial) → pause → resume → cancel.
 *
 * IMPORTANT: `subscription_autocharge` is NOT tested — enabling it could charge
 * real cards. We only exercise the lifecycle state machine.
 */
import { test, expect } from "@playwright/test";
import { get, post, put } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "invoicing-subscriptions.smoke.spec.js";

test.describe("Invoicing + subscriptions smoke", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  test("customer invoicing: create → list", async () => {
    if (!(await softSkip(test, SPEC, "customer_invoicing"))) return;

    const customerRes = await post("/api/customers", {
      name: prefix("Invoice Buyer"),
      mobile: "03005556677",
      email: "invoice-smoke@example.com",
    });
    expect(customerRes.ok).toBe(true);
    const customerId = customerRes.data?.id;
    trackForCleanup("customer", customerId);

    const invoiceRes = await post("/api/customer-invoices", {
      customer_id: customerId,
      items: [{ description: prefix("Smoke line"), quantity: 1, unit_price: 1000 }],
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      notes: "smoke draft",
    });
    expect(invoiceRes.ok, `invoice: ${JSON.stringify(invoiceRes.data)}`).toBe(true);
    const invoiceId = invoiceRes.data?.id || invoiceRes.data?.invoice?.id;
    expect(invoiceId).toBeTruthy();
    trackForCleanup("customer-invoice", invoiceId);

    const listRes = await get("/api/customer-invoices");
    expect(listRes.ok).toBe(true);
  });

  test("subscriptions: plan → subscription → pause → resume → cancel", async () => {
    if (!(await softSkip(test, SPEC, "subscription_billing"))) return;

    const customerRes = await post("/api/customers", {
      name: prefix("Sub Buyer"),
      mobile: "03007778899",
      email: "sub-smoke@example.com",
    });
    const customerId = customerRes.data?.id;
    trackForCleanup("customer", customerId);

    const planRes = await post("/api/subscription-plans", {
      name: prefix("Monthly"),
      price: 500,
      billing_interval: "monthly",
      trial_days: 7,
    });
    expect(planRes.ok, `plan: ${JSON.stringify(planRes.data)}`).toBe(true);
    const planId = planRes.data?.id || planRes.data?.plan?.id;
    expect(planId).toBeTruthy();
    trackForCleanup("subscription-plan", planId);

    const subRes = await post("/api/customer-subscriptions", {
      customer_id: customerId,
      plan_id: planId,
      auto_charge: false,
    });
    expect(subRes.ok, `sub: ${JSON.stringify(subRes.data)}`).toBe(true);
    const subId = subRes.data?.id || subRes.data?.subscription?.id;
    expect(subId).toBeTruthy();
    trackForCleanup("customer-subscription", subId);

    const pauseRes = await post(`/api/customer-subscriptions/${subId}/pause`, {});
    expect(pauseRes.ok).toBe(true);

    const resumeRes = await post(`/api/customer-subscriptions/${subId}/resume`, {});
    expect(resumeRes.ok).toBe(true);

    const cancelRes = await post(`/api/customer-subscriptions/${subId}/cancel`, {});
    expect(cancelRes.ok).toBe(true);
  });
});
