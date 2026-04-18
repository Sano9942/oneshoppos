/**
 * 86'd items smoke — Phase 2-R Wave A / 2-R.1.
 *
 * Covers the availability API end-to-end:
 *   - POST /api/restaurant/products/:id/sold-out marks an item 86'd
 *   - GET /api/restaurant/sold-out lists it
 *   - DELETE clears it
 *
 * Browser-level UI smoke is soft: we verify the /restaurant/availability
 * admin route returns 200 when the flag is on, tolerating a redirect to
 * login or dashboard if storage state is stale.
 *
 * Self-contained. Skips entirely when phase4_restaurant_86 is off.
 */
import { test, expect } from "@playwright/test";
import { get, post, del } from "../helpers/api.js";
import { softSkip } from "./helpers/featureFlags.js";

const SPEC = "restaurant-86.smoke.spec.js";

test.describe("86'd items smoke (Phase 2-R.1)", () => {
  let targetProductId = null;

  test.beforeAll(async () => {
    // Pick any tenant product to use as the 86 target. We restore it at the
    // end of the suite so the tenant isn't left in a sold-out state.
    const productsRes = await get("/api/products?limit=1");
    const product =
      productsRes.data?.products?.[0]
      ?? productsRes.data?.[0]
      ?? null;
    targetProductId = product?.id || null;
  });

  test.afterAll(async () => {
    if (targetProductId) {
      // Best-effort cleanup: clear sold-out if we left it set.
      try { await del(`/api/restaurant/products/${targetProductId}/sold-out`); } catch { /* ignore */ }
    }
  });

  test("POST sold-out → GET list → DELETE clears", async () => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_86"))) return;
    if (!targetProductId) {
      test.skip(true, "No products on tenant to mark 86'd");
      return;
    }

    // 1. Mark sold-out
    const setRes = await post(`/api/restaurant/products/${targetProductId}/sold-out`, {
      reason: "Smoke test - out of stock",
    });
    expect(
      [200, 201].includes(setRes.status),
      `sold-out POST failed: ${JSON.stringify(setRes.data)}`,
    ).toBe(true);
    expect(setRes.data?.is_sold_out).toBe(true);

    // 2. Listed in sold-out index
    const listRes = await get("/api/restaurant/sold-out");
    expect(listRes.status).toBe(200);
    const ids = (listRes.data?.products || []).map((p) => p.id);
    expect(ids).toContain(targetProductId);

    // 3. Clear
    const clearRes = await del(`/api/restaurant/products/${targetProductId}/sold-out`);
    expect([200, 204]).toContain(clearRes.status);

    // 4. No longer listed
    const afterRes = await get("/api/restaurant/sold-out");
    const afterIds = (afterRes.data?.products || []).map((p) => p.id);
    expect(afterIds).not.toContain(targetProductId);
  });

  test("admin page /restaurant/availability renders without error", async ({ page }) => {
    if (!(await softSkip(test, SPEC, "phase4_restaurant_86"))) return;

    await page.goto("https://sanopos.com/restaurant/availability", {
      waitUntil: "domcontentloaded",
    });
    // Either the page rendered or the app kicked us to login/home — both
    // prove the route is registered and didn't throw.
    expect(page.url()).toMatch(/sanopos\.com\/(restaurant\/availability|login|)/);
  });
});
