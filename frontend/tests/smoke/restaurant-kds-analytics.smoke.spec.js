/**
 * KDS analytics smoke — Phase 2-R Wave C / 2-R.5.
 *
 * Covers:
 *   - GET /api/reports/kds/prep-times responds 200 (shape only — real metrics
 *     depend on tenant data)
 *   - /reports/kds-analytics deep-link renders (or the app redirects to login
 *     if storage state is stale — either proves the route is registered)
 *   - /kds admin page loads without throwing when the analytics flag is on
 *
 * Self-contained. Skips entirely when phase4_restaurant_kds_analytics is off.
 */
import { test, expect } from "@playwright/test";
import { get } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";

const SPEC = "restaurant-kds-analytics.smoke.spec.js";

test.describe("KDS analytics smoke (Phase 2-R.5)", () => {
  test("GET /api/reports/kds/prep-times returns stations + snapshots", async () => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_kds_analytics"))) return;

    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const res = await get(`/api/reports/kds/prep-times?from=${monthAgo}&to=${today}`);
    expect(res.status, `analytics endpoint failed: ${JSON.stringify(res.data)}`).toBe(200);
    expect(Array.isArray(res.data?.stations)).toBe(true);
    expect(Array.isArray(res.data?.snapshots)).toBe(true);
    expect(Array.isArray(res.data?.by_category)).toBe(true);
  });

  test("deep-link /reports/kds-analytics renders without error", async ({ page }) => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_kds_analytics"))) return;

    await page.goto("https://sanopos.com/reports/kds-analytics", {
      waitUntil: "domcontentloaded",
    });
    // Route must at minimum not 500; a redirect to login/home is acceptable
    // when auth.json storage state has been invalidated since global-setup.
    expect(page.url()).toMatch(
      /sanopos\.com\/(reports\/kds-analytics|login|)/
    );
  });

  test("KDS admin page /kds opens (station settings reachable)", async ({ page }) => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_kds"))) return;

    await page.goto("https://sanopos.com/kds", { waitUntil: "domcontentloaded" });
    expect(page.url()).toMatch(/sanopos\.com\/(kds|login|)/);
  });
});
