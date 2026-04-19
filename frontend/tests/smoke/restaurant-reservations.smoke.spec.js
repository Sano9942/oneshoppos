/**
 * Reservations + waitlist smoke — Phase 2-R Wave D / 2-R.4.
 *
 * Covers:
 *   - POST /api/restaurant/reservations creates a pending row
 *   - PUT /api/restaurant/reservations/:id confirms it
 *   - POST /api/restaurant/waitlist + notify + seat cycle
 *   - Public /reserve/:tenantSlug renders without crashing
 *
 * Self-contained. Skips entirely when phase4_restaurant_reservations is off.
 */
import { test, expect } from "@playwright/test";
import { get, post, put, del } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";

const SPEC = "restaurant-reservations.smoke.spec.js";

test.describe("Reservations smoke (Phase 2-R.4)", () => {
  let createdReservationId = null;
  let createdWaitlistId = null;

  test.afterAll(async () => {
    // Best-effort cleanup.
    try {
      if (createdReservationId) {
        await put(`/api/restaurant/reservations/${createdReservationId}`, { status: "cancelled" });
        await del(`/api/restaurant/reservations/${createdReservationId}`);
      }
    } catch { /* ignore */ }
    try {
      if (createdWaitlistId) {
        await del(`/api/restaurant/waitlist/${createdWaitlistId}`);
      }
    } catch { /* ignore */ }
  });

  test("reservation: create → confirm", async () => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_reservations"))) return;

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createRes = await post("/api/restaurant/reservations", {
      customer_name: "Smoke Test Guest",
      phone: "03001234567",
      party_size: 2,
      reservation_start: future,
      notes: "smoke test — safe to delete",
    });
    expect(
      [200, 201].includes(createRes.status),
      `POST reservation failed: ${JSON.stringify(createRes.data)}`
    ).toBe(true);
    createdReservationId = createRes.data.id;

    const confirmRes = await put(
      `/api/restaurant/reservations/${createdReservationId}`,
      { status: "confirmed" }
    );
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.data.status).toBe("confirmed");
  });

  test("waitlist: add → notify → remove", async () => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_reservations"))) return;

    const addRes = await post("/api/restaurant/waitlist", {
      customer_name: "Smoke Walk-in",
      phone: "03009876543",
      party_size: 3,
      quoted_wait_minutes: 20,
    });
    expect(
      [200, 201].includes(addRes.status),
      `POST waitlist failed: ${JSON.stringify(addRes.data)}`
    ).toBe(true);
    createdWaitlistId = addRes.data.id;
    expect(addRes.data.position).toBeGreaterThan(0);

    const notifyRes = await put(
      `/api/restaurant/waitlist/${createdWaitlistId}/notify`,
      {}
    );
    expect(notifyRes.status).toBe(200);
    expect(notifyRes.data.status).toBe("notified");

    const removeRes = await del(`/api/restaurant/waitlist/${createdWaitlistId}`);
    expect([200, 204]).toContain(removeRes.status);
    createdWaitlistId = null;
  });

  test("public /reserve/:tenantSlug renders without crashing", async ({ page }) => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_reservations"))) return;

    await page.goto("https://sanopos.com/reserve/packagesmall", {
      waitUntil: "domcontentloaded",
    });
    const body = await page.textContent("body");
    expect(body).toMatch(/book|table|time|party/i);
  });
});
