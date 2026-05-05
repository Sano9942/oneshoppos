// Customer order kiosk E2E — exercises the API end-to-end through the
// public-menu surface a tablet would hit.
//
// Scope: minimum viable check that token mint, public menu, public submit,
// and revocation all wire together. Does NOT assume the kiosk feature flag
// (phase4_restaurant_qr) is on for the test tenant — the manager-facing
// API flips test feature flags is gated separately, so this spec just
// verifies the shape and skips cleanly when the flag is off.

import { test, expect } from "@playwright/test";
import { api, get, post, del } from "./helpers/api.js";
import { STORE_CODE, BACKEND } from "./helpers/auth.js";

test.describe("Customer order kiosk", () => {
  let counterTokenId = null;
  let counterToken = null;

  test.beforeAll(async () => {
    // Skip the spec entirely if the kiosk flag is off — production-safe.
    const flagsRes = await get("/api/feature-flags");
    const flags = (flagsRes.data?.flags || []).reduce((m, f) => {
      m[f.key] = Number(f.enabled || 0) === 1;
      return m;
    }, {});
    test.skip(!flags.phase4_restaurant_qr, "phase4_restaurant_qr off on test tenant");
  });

  test.afterAll(async () => {
    if (counterTokenId) {
      try { await del(`/api/restaurant/kiosk-tokens/counter/${counterTokenId}`); } catch {}
    }
  });

  test("manager can mint, fetch, list, and revoke a counter kiosk", async () => {
    // 1. Mint a counter slot.
    const mint = await post("/api/restaurant/kiosk-tokens", {
      outlet_id: 1,
      label: "Playwright counter",
    });
    expect(mint.status).toBe(201);
    expect(mint.data.type).toBe("counter");
    expect(mint.data.token).toBeTruthy();
    counterTokenId = mint.data.id;
    counterToken = mint.data.token;

    // 2. Fetch public menu — uses the slot token, no auth.
    const menuRes = await fetch(
      `${BACKEND}/api/public/restaurant/menu/${counterToken}?tenant=${STORE_CODE}`,
    );
    expect(menuRes.status).toBe(200);
    const menu = await menuRes.json();
    expect(menu.mode).toBe("counter");
    expect(menu.table_label).toBeNull();
    expect(Array.isArray(menu.items)).toBe(true);

    // 3. List shows the new slot.
    const list = await get(`/api/restaurant/kiosk-tokens?outlet_id=1`);
    expect(list.status).toBe(200);
    const found = (list.data.counters || []).find((c) => c.id === counterTokenId);
    expect(found).toBeTruthy();

    // 4. Add an item if any product is available + place order.
    if (menu.items.length > 0) {
      const product = menu.items[0];
      const addRes = await fetch(
        `${BACKEND}/api/public/restaurant/checks/${counterToken}/items?tenant=${STORE_CODE}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: product.id, quantity: 1 }),
        },
      );
      expect(addRes.status).toBe(201);

      const submitRes = await fetch(
        `${BACKEND}/api/public/restaurant/checks/${counterToken}/submit?tenant=${STORE_CODE}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      expect(submitRes.status).toBe(200);
      const sub = await submitRes.json();
      expect(sub.mode).toBe("counter");
      expect(sub.order_number).toMatch(/^K-\d+$/);
    }

    // 5. Revoke the slot. Subsequent menu fetch returns 404.
    const revoke = await del(`/api/restaurant/kiosk-tokens/counter/${counterTokenId}`);
    expect(revoke.status).toBe(200);
    counterTokenId = null;

    const after = await fetch(
      `${BACKEND}/api/public/restaurant/menu/${counterToken}?tenant=${STORE_CODE}`,
    );
    expect(after.status).toBe(404);
  });

  test("public menu page renders the Place Order CTA after adding an item", async ({ page }) => {
    // Mint a fresh counter slot for the UI walk.
    const mint = await post("/api/restaurant/kiosk-tokens", { outlet_id: 1 });
    expect(mint.status).toBe(201);
    const token = mint.data.token;

    try {
      await page.goto(`/menu/${token}?tenant=${STORE_CODE}`);
      // Header reflects counter mode (no Table label).
      await expect(page.getByText(/^Table:/)).toHaveCount(0);

      // Wait for at least one menu item card; if the tenant has no products,
      // skip the cart interaction half — the surface itself is the assertion.
      const addButtons = page.getByRole("button", { name: /add to order/i });
      const count = await addButtons.count();
      if (count > 0) {
        await addButtons.first().click();
        await expect(page.getByTestId("place-order")).toBeVisible({ timeout: 5000 });
      }
    } finally {
      try { await del(`/api/restaurant/kiosk-tokens/counter/${mint.data.id}`); } catch {}
    }
  });
});
