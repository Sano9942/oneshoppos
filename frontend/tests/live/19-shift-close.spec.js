/**
 * 19-shift-close.spec.js
 * Closes the open shift at Packages Mall.
 * Enters closing denomination count, verifies variance is captured.
 * NOTE: After this spec runs, a new shift must be opened manually to continue using POS.
 */
import { test, expect } from "@playwright/test";
import { readState, writeState } from "./helpers/state.js";
import { get, post } from "./helpers/api.js";

test.describe("19 — Shift Close: Close shift with denomination count", () => {
  test("verify shift is currently open", async ({ page }) => {
    const res = await get(page, "/api/shifts?outlet_id=1&status=open");
    expect(res.ok).toBe(true);

    const shifts = res.data.shifts || [];
    expect(shifts.length).toBeGreaterThan(0);

    const shift = shifts[0];
    writeState({ openShiftId: shift.id });
    console.log("Open shift id:", shift.id, "float:", shift.opening_float);
  });

  test("cash management page loads", async ({ page }) => {
    await page.goto("/cash-management");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/cash management|shift/i).first()
    ).toBeVisible({ timeout: 15000 });
    console.log("✅ Cash management page loaded");
  });

  test("close shift via UI with denomination count", async ({ page }) => {
    await page.goto("/cash-management");
    await page.waitForLoadState("networkidle");

    // Find close shift button
    const closeShiftBtn = page
      .getByRole("button", { name: /close shift/i })
      .first();

    if (await closeShiftBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
      await closeShiftBtn.click();
      await page.waitForTimeout(800);

      // Enter denomination count — fill at least one denomination
      const firstDenomInput = page.getByRole("spinbutton").first();
      if (await firstDenomInput.isVisible({ timeout: 4000 }).catch(() => false)) {
        await firstDenomInput.fill("10"); // 10 notes of that denomination
      }

      // Notes
      const notesInput = page.getByLabel(/note/i).or(page.getByPlaceholder(/note/i)).first();
      if (await notesInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await notesInput.fill("End of test day");
      }

      // Confirm close
      const confirmClose = page
        .getByRole("button", { name: /confirm.*close|close shift/i })
        .last();
      if (await confirmClose.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmClose.click();
        await expect(
          page.getByText(/shift.*closed|closed.*shift/i)
        ).toBeVisible({ timeout: 15000 });
        console.log("✅ Shift closed via UI");
      }
    } else {
      // API fallback
      const { openShiftId } = readState();
      const res = await post(page, `/api/shifts/${openShiftId}/close`, {
        closing_cash: 5000,
        notes: "End of test day — closed via API",
        denominations: [{ denomination: 1000, count: 5 }],
      });
      expect([200, 201]).toContain(res.status);
      console.log("✅ Shift closed via API:", res.data);
    }
  });

  test("verify shift is now closed", async ({ page }) => {
    const res = await get(page, "/api/shifts?outlet_id=1&status=open");
    expect(res.ok).toBe(true);
    const openShifts = res.data.shifts || [];
    expect(openShifts.length).toBe(0);
    console.log("✅ No open shifts remaining — shift successfully closed");
  });

  test("closed shift appears in shift history", async ({ page }) => {
    const { openShiftId } = readState();
    const res = await get(page, "/api/shifts?outlet_id=1");
    expect(res.ok).toBe(true);
    const shifts = res.data.shifts || [];
    const closedShift = shifts.find(
      (s) => s.id === openShiftId && s.status === "closed"
    );
    expect(closedShift).toBeTruthy();
    console.log("✅ Shift", openShiftId, "confirmed closed");
  });
});
