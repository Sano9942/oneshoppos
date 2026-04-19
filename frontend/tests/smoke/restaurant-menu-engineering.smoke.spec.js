/**
 * Menu engineering smoke — Phase 2-R Wave C / 2-R.10.
 *
 * Covers:
 *   - GET /api/reports/menu-engineering responds 200 with the expected shape
 *   - /reports/menu-engineering deep-link renders (or redirects to login)
 *
 * Self-contained. Skips entirely when phase4_restaurant_menu_engineering is off.
 */
import { test, expect } from "@playwright/test";
import { get } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";

const SPEC = "restaurant-menu-engineering.smoke.spec.js";

test.describe("Menu engineering smoke (Phase 2-R.10)", () => {
  test("GET /api/reports/menu-engineering returns thresholds + products", async () => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_menu_engineering"))) return;

    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const res = await get(`/api/reports/menu-engineering?from=${monthAgo}&to=${today}`);
    expect(res.status, `menu-engineering endpoint failed: ${JSON.stringify(res.data)}`).toBe(200);
    expect(res.data?.thresholds).toBeTruthy();
    expect(typeof res.data.thresholds.popularity_median).toBe("number");
    expect(typeof res.data.thresholds.margin_median).toBe("number");
    expect(Array.isArray(res.data?.products)).toBe(true);
    for (const p of res.data.products) {
      expect(["star", "plowhorse", "puzzle", "dog"]).toContain(p.classification);
    }
  });

  test("deep-link /reports/menu-engineering renders without error", async ({ page }) => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_menu_engineering"))) return;

    await page.goto("https://sanopos.com/reports/menu-engineering", {
      waitUntil: "domcontentloaded",
    });
    expect(page.url()).toMatch(
      /sanopos\.com\/(reports\/menu-engineering|login|)/
    );
  });
});
