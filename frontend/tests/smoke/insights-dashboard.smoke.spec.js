/**
 * Insights dashboard smoke — no flag. Regression guard for the labor-vs-sales
 * dashboard card (Phase 2). Ensures GET /api/insights/auto returns a non-error
 * payload so /insights page doesn't 500 on load.
 */
import { test, expect } from "@playwright/test";
import { get } from "../helpers/api.js";

test.describe("Insights dashboard smoke", () => {
  test("GET /api/insights/auto returns non-error payload", async () => {
    const res = await get("/api/insights/auto");
    expect([200, 201]).toContain(res.status);
    expect(res.data, "insights payload").toBeTruthy();
  });

  test("dashboard page renders without runtime errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/insights");
    await page.waitForLoadState("networkidle");

    // Allow "no data" states but no hard crashes
    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
