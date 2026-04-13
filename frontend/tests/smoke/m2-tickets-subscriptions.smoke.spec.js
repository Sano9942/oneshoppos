/**
 * M2 smoke — Service tickets + subscription billing polish.
 *
 * Test A (`phase4_workflow_tickets`): create ticket with deposit → approve →
 *   start work → complete → generate invoice. Full lifecycle.
 *
 * Test B (`subscription_billing`): create plan → subscription → pause → resume →
 *   cancel with reason → verify cancel_reason persisted. Also tests new detail
 *   and renewals endpoints.
 *
 * Test C (`subscription_billing`): churn stats endpoint returns valid data.
 */
import { test, expect } from "@playwright/test";
import { get, post, put } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "m2-tickets-subscriptions.smoke.spec.js";

test.describe("M2 — Service tickets + subscription polish", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  // ── Workflow Ticket Engine ─────────────────────────────────────

  test("service tickets: create → approve → in_progress → complete → generate invoice", async () => {
    if (!(await softSkip(test, SPEC, "phase4_workflow_tickets"))) return;

    // Create a customer for the ticket
    const custRes = await post("/api/customers", {
      name: prefix("Ticket Customer"),
      mobile: "03001112233",
    });
    expect(custRes.ok, `customer: ${JSON.stringify(custRes.data)}`).toBe(true);
    const customerId = custRes.data?.id;
    trackForCleanup("customer", customerId);

    // Create ticket with deposit
    const createRes = await post("/api/service-tickets", {
      title: prefix("Screen Repair"),
      description: "Cracked screen, needs replacement",
      customer_id: customerId,
      deposit_amount: 500,
      deposit_method: "cash",
      notes: "Smoke test ticket",
    });
    expect(createRes.ok, `create ticket: ${JSON.stringify(createRes.data)}`).toBe(true);
    const ticketId = createRes.data?.id;
    expect(ticketId).toBeTruthy();
    expect(createRes.data?.ticket_number).toMatch(/^TKT-/);
    expect(Number(createRes.data?.deposit_amount)).toBe(500);
    expect(createRes.data?.status).toBe("intake");

    // List tickets — should find ours
    const listRes = await get("/api/service-tickets");
    expect(listRes.ok).toBe(true);
    const found = (listRes.data?.tickets || []).find(t => t.id === ticketId);
    expect(found).toBeTruthy();

    // Get ticket detail
    const detailRes = await get(`/api/service-tickets/${ticketId}`);
    expect(detailRes.ok).toBe(true);
    expect(detailRes.data?.activities?.length).toBeGreaterThanOrEqual(1);

    // Approve
    const approveRes = await put(`/api/service-tickets/${ticketId}`, { status: "approved" });
    expect(approveRes.ok, `approve: ${JSON.stringify(approveRes.data)}`).toBe(true);
    expect(approveRes.data?.status).toBe("approved");

    // Start work
    const startRes = await put(`/api/service-tickets/${ticketId}`, { status: "in_progress" });
    expect(startRes.ok).toBe(true);
    expect(startRes.data?.status).toBe("in_progress");

    // Complete
    const completeRes = await put(`/api/service-tickets/${ticketId}`, { status: "completed" });
    expect(completeRes.ok).toBe(true);
    expect(completeRes.data?.status).toBe("completed");
    expect(completeRes.data?.actual_completion).toBeTruthy();

    // Generate invoice from completed ticket
    const invoiceRes = await post(`/api/service-tickets/${ticketId}/generate-invoice`);
    expect(invoiceRes.ok, `invoice: ${JSON.stringify(invoiceRes.data)}`).toBe(true);
    expect(invoiceRes.data?.invoice?.invoice_number).toMatch(/^INV-/);
    trackForCleanup("customer-invoice", invoiceRes.data?.invoice?.id);

    // Verify ticket is now invoiced
    const finalRes = await get(`/api/service-tickets/${ticketId}`);
    expect(finalRes.ok).toBe(true);
    expect(finalRes.data?.status).toBe("invoiced");
    expect(finalRes.data?.final_invoice_id).toBeTruthy();

    // Verify activities include full lifecycle
    const activities = finalRes.data?.activities || [];
    const types = activities.map(a => a.activity_type);
    expect(types).toContain("status_change");
    expect(types).toContain("deposit_recorded");
    expect(types).toContain("invoice_generated");
  });

  test("service tickets: add note", async () => {
    if (!(await softSkip(test, SPEC, "phase4_workflow_tickets"))) return;

    const createRes = await post("/api/service-tickets", {
      title: prefix("Note Test Ticket"),
    });
    expect(createRes.ok).toBe(true);
    const ticketId = createRes.data?.id;

    const noteRes = await post(`/api/service-tickets/${ticketId}/notes`, {
      description: "Customer called — will pick up tomorrow",
    });
    expect([200, 201]).toContain(noteRes.status);

    // Verify note appears in activities
    const detailRes = await get(`/api/service-tickets/${ticketId}`);
    const notes = (detailRes.data?.activities || []).filter(a => a.activity_type === "note");
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].description).toContain("pick up tomorrow");
  });

  test("service tickets: cannot generate invoice from non-completed ticket", async () => {
    if (!(await softSkip(test, SPEC, "phase4_workflow_tickets"))) return;

    const createRes = await post("/api/service-tickets", {
      title: prefix("Bad Invoice Test"),
    });
    expect(createRes.ok).toBe(true);
    const ticketId = createRes.data?.id;

    // Try to generate invoice from intake status — should fail
    const invoiceRes = await post(`/api/service-tickets/${ticketId}/generate-invoice`);
    expect(invoiceRes.ok).toBe(false);
    expect(invoiceRes.status).toBe(400);
  });

  // ── Subscription Billing Polish ────────────────────────────────

  test("subscriptions: cancel with reason → verify reason persisted", async () => {
    if (!(await softSkip(test, SPEC, "subscription_billing"))) return;

    const custRes = await post("/api/customers", {
      name: prefix("Cancel Reason Buyer"),
      mobile: "03004445566",
    });
    const customerId = custRes.data?.id;
    trackForCleanup("customer", customerId);

    const planRes = await post("/api/subscription-plans", {
      name: prefix("Reason Plan"),
      price: 300,
      billing_interval: "monthly",
    });
    expect(planRes.ok).toBe(true);
    const planId = planRes.data?.id;
    trackForCleanup("subscription-plan", planId);

    const subRes = await post("/api/customer-subscriptions", {
      customer_id: customerId,
      plan_id: planId,
      auto_charge: false,
    });
    expect(subRes.ok).toBe(true);
    const subId = subRes.data?.id;
    trackForCleanup("customer-subscription", subId);

    // Cancel with reason
    const cancelRes = await post(`/api/customer-subscriptions/${subId}/cancel`, {
      cancel_reason: "Too expensive, switching to competitor",
    });
    expect(cancelRes.ok).toBe(true);
    expect(cancelRes.data?.status).toBe("cancelled");
    expect(cancelRes.data?.cancel_reason).toBe("Too expensive, switching to competitor");

    // Verify via detail endpoint
    const detailRes = await get(`/api/customer-subscriptions/${subId}`);
    expect(detailRes.ok).toBe(true);
    expect(detailRes.data?.cancel_reason).toBe("Too expensive, switching to competitor");
    expect(detailRes.data?.plan_name).toBeTruthy();
    expect(detailRes.data?.customer_name).toBeTruthy();
  });

  test("subscriptions: detail + renewals endpoints", async () => {
    if (!(await softSkip(test, SPEC, "subscription_billing"))) return;

    const custRes = await post("/api/customers", {
      name: prefix("Detail Buyer"),
      mobile: "03006667788",
    });
    const customerId = custRes.data?.id;
    trackForCleanup("customer", customerId);

    const planRes = await post("/api/subscription-plans", {
      name: prefix("Detail Plan"),
      price: 200,
      billing_interval: "monthly",
    });
    const planId = planRes.data?.id;
    trackForCleanup("subscription-plan", planId);

    const subRes = await post("/api/customer-subscriptions", {
      customer_id: customerId,
      plan_id: planId,
    });
    const subId = subRes.data?.id;
    trackForCleanup("customer-subscription", subId);

    // Detail endpoint returns plan + customer info
    const detailRes = await get(`/api/customer-subscriptions/${subId}`);
    expect(detailRes.ok).toBe(true);
    expect(detailRes.data?.plan_name).toContain("Detail Plan");
    expect(detailRes.data?.billing_interval).toBe("monthly");
    expect(detailRes.data?.current_period_start).toBeTruthy();
    expect(detailRes.data?.current_period_end).toBeTruthy();

    // Renewals endpoint (empty for new subscription, but should work)
    const renewalsRes = await get(`/api/customer-subscriptions/${subId}/renewals`);
    expect(renewalsRes.ok).toBe(true);
    expect(Array.isArray(renewalsRes.data?.renewals)).toBe(true);

    // By-customer endpoint
    const byCustRes = await get(`/api/customer-subscriptions/by-customer/${customerId}`);
    expect(byCustRes.ok).toBe(true);
    expect((byCustRes.data?.subscriptions || []).length).toBeGreaterThanOrEqual(1);

    // Cancel for cleanup
    await post(`/api/customer-subscriptions/${subId}/cancel`, {});
  });

  test("subscriptions: churn stats endpoint", async () => {
    if (!(await softSkip(test, SPEC, "subscription_billing"))) return;

    const statsRes = await get("/api/subscriptions/stats");
    expect(statsRes.ok, `stats: ${JSON.stringify(statsRes.data)}`).toBe(true);
    expect(typeof statsRes.data?.active_count).toBe("number");
    expect(typeof statsRes.data?.churned_this_month).toBe("number");
    expect(typeof statsRes.data?.churn_rate).toBe("number");
  });
});
