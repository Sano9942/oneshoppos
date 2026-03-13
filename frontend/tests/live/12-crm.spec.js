/**
 * 12-crm.spec.js
 * Creates a CRM lead for a school that wants bulk toys,
 * adds a Call activity, moves stage to Qualified.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { post, put, get } from "./helpers/api.js";

test.describe("12 — CRM: Lead → Activity → Stage", () => {
  test("create CRM lead: Sunshine School bulk order", async ({ page }) => {
    const res = await post(page, "/api/crm/leads", {
      name: "Sunshine School",
      contact_person: "Mrs. Fatima",
      phone: "04212345678",
      email: "sunshine.school@test.com",
      stage: "new",
      notes: "Interested in bulk LEGO sets for school event",
      value: 50000,
    });

    expect(res.status, `CRM lead failed: ${JSON.stringify(res.data)}`).toBe(201);
    const leadId = res.data.lead?.id || res.data.id;
    expect(leadId).toBeTruthy();
    writeState({ crmLeadId: leadId });
    console.log("CRM lead created:", leadId);
  });

  test("add Call activity to the lead", async ({ page }) => {
    const { crmLeadId } = readState();

    const res = await post(page, `/api/crm/leads/${crmLeadId}/activities`, {
      type: "Call",
      description: "Called Mrs. Fatima — confirmed interest in 50 LEGO sets. Follow up next week.",
      activity_date: new Date().toISOString().slice(0, 10),
    });

    expect([200, 201]).toContain(res.status);
    console.log("Activity added:", res.data);
  });

  test("move lead stage to Qualified", async ({ page }) => {
    const { crmLeadId } = readState();

    const res = await put(page, `/api/crm/leads/${crmLeadId}`, {
      stage: "qualified",
    });

    expect([200, 201]).toContain(res.status);
    console.log("Lead moved to qualified");
  });

  test("CRM page loads and shows Sunshine School lead", async ({ page }) => {
    await page.goto("/crm");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/crm|lead/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Sunshine School/i)).toBeVisible({ timeout: 10000 });
    console.log("✅ CRM page shows lead");
  });

  test("verify lead stage is Qualified via API", async ({ page }) => {
    const { crmLeadId } = readState();
    const res = await get(page, "/api/crm/leads");
    expect(res.ok).toBe(true);
    const lead = res.data.leads?.find((l) => l.id === crmLeadId);
    expect(lead?.stage).toMatch(/qualified/i);
    console.log("✅ Lead stage confirmed:", lead?.stage);
  });
});
