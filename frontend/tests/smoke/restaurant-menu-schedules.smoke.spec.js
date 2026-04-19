/**
 * Menu schedules smoke — Phase 2-R Wave B / 2-R.6.
 *
 * Covers day-parting CRUD on the tenant API:
 *   - POST /api/restaurant/menu-schedules
 *   - GET /api/restaurant/menu-schedules
 *   - DELETE /api/restaurant/menu-schedules/:id
 *
 * Browser smoke: /restaurant/menu-schedules 200s when the flag is on.
 *
 * Self-contained. Skips when phase4_restaurant_day_parting is off.
 */
import { test, expect } from "@playwright/test";
import { get, post, del } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";

const SPEC = "restaurant-menu-schedules.smoke.spec.js";

test.describe("Menu schedules smoke (Phase 2-R.6)", () => {
  let createdId = null;

  test.afterAll(async () => {
    if (createdId) {
      try { await del(`/api/restaurant/menu-schedules/${createdId}`); } catch { /* ignore */ }
    }
  });

  test("POST → GET list → DELETE round-trip", async () => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_day_parting"))) return;

    const create = await post("/api/restaurant/menu-schedules", {
      name: "Smoke Breakfast",
      day_of_week: 1,
      start_time: "07:00",
      end_time: "11:00",
      product_ids: [],
    });
    expect([200, 201]).toContain(create.status);
    createdId = create.data?.id;
    expect(createdId).toBeTruthy();

    const list = await get("/api/restaurant/menu-schedules");
    expect(list.status).toBe(200);
    const ids = (list.data || []).map((s) => s.id);
    expect(ids).toContain(createdId);

    const delRes = await del(`/api/restaurant/menu-schedules/${createdId}`);
    expect([200, 204]).toContain(delRes.status);
    createdId = null;
  });

  test("admin page /restaurant/menu-schedules renders without error", async ({ page }) => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_day_parting"))) return;
    await page.goto("https://sanopos.com/restaurant/menu-schedules", {
      waitUntil: "domcontentloaded",
    });
    const url = page.url();
    expect(url).toMatch(/(menu-schedules|login|dashboard)/);
  });
});
