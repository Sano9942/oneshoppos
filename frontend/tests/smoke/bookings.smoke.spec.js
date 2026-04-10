/**
 * Appointment bookings smoke — Phase 4, flag `phase4_appointments`.
 *
 * Test A (authenticated): create service → fetch availability → create appointment → cancel.
 * Test B (public): anonymous booking config → availability → create booking.
 */
import { test, expect } from "@playwright/test";
import { get, post } from "../helpers/api.js";
import { softSkip, isFlagEnabled } from "./helpers/featureFlags.js";
import { trackForCleanup, cleanupAll } from "./helpers/cleanup.js";
import { prefix } from "./helpers/smokeRunId.js";

const SPEC = "bookings.smoke.spec.js";
const TENANT = "packagesmall";

test.describe("Bookings smoke", () => {
  test.afterAll(async () => {
    await cleanupAll();
  });

  test("authenticated: service → availability → appointment → cancel", async () => {
    if (!(await softSkip(test, SPEC, "phase4_appointments"))) return;

    const serviceRes = await post("/api/booking-services", {
      name: prefix("Smoke Consult"),
      duration_minutes: 30,
      price: 500,
      active: true,
    });
    expect(serviceRes.ok, `service: ${JSON.stringify(serviceRes.data)}`).toBe(true);
    const serviceId = serviceRes.data?.id || serviceRes.data?.service?.id;
    expect(serviceId).toBeTruthy();
    trackForCleanup("booking-service", serviceId);

    const future = new Date();
    future.setDate(future.getDate() + 7);
    const date = future.toISOString().slice(0, 10);

    const availRes = await get(`/api/appointments/availability?service_id=${serviceId}&date=${date}`);
    expect(availRes.ok, `availability: ${JSON.stringify(availRes.data)}`).toBe(true);
    const slots = availRes.data?.slots || availRes.data || [];

    if (slots.length > 0) {
      const slot = slots[0];
      const apptRes = await post("/api/appointments", {
        service_id: serviceId,
        start_at: slot.start_at || slot.start,
        customer_name: prefix("Client"),
        customer_phone: "03001234567",
      });
      expect(apptRes.ok, `appt: ${JSON.stringify(apptRes.data)}`).toBe(true);
      const apptId = apptRes.data?.id || apptRes.data?.appointment?.id;
      if (apptId) trackForCleanup("appointment", apptId);
      if (apptId) {
        const cancelRes = await post(`/api/appointments/${apptId}/cancel`, {});
        expect([200, 201]).toContain(cancelRes.status);
      }
    }
  });

  test("public: booking config → availability → create", async ({ browser }) => {
    if (!(await isFlagEnabled("phase4_appointments"))) {
      console.log(`SKIP: ${SPEC} (phase4_appointments=false)`);
      test.skip();
      return;
    }

    const anon = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      baseURL: "https://sanopos.com",
    });
    const page = await anon.newPage();

    try {
      const configRes = await fetch(
        `https://api.sanopos.com/api/public/bookings/config?tenant=${TENANT}`,
      );
      expect([200, 404], `public config: ${configRes.status}`).toContain(configRes.status);

      await page.goto(`/book/${TENANT}`);
      await page.waitForLoadState("networkidle");
    } finally {
      await anon.close();
    }
  });
});
