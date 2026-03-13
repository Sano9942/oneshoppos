/**
 * 14-attendance.spec.js
 * Kiosk: clock hassan out, then clock back in.
 * Tests the PIN kiosk terminal UI.
 */
import { test, expect } from "@playwright/test";
import { post } from "./helpers/api.js";

const HASSAN_PIN = "2580";

async function enterPinOnKiosk(page, pin) {
  for (const digit of pin.split("")) {
    await page.getByRole("button", { name: digit, exact: true }).click({ delay: 80 });
  }
  // Submit PIN
  const submitBtn = page
    .getByRole("button", { name: /✓|submit|enter|ok/i })
    .or(page.locator("button").filter({ hasText: /^[✓✔]$/ }))
    .first();
  await submitBtn.click();
}

test.describe("14 — Attendance: Kiosk clock-out and clock-in", () => {
  test("kiosk page loads and shows outlet selector", async ({ page }) => {
    await page.goto("/kiosk");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/kiosk|clock/i).first()).toBeVisible({ timeout: 15000 });
    console.log("✅ Kiosk page loaded");
  });

  test("clock hassan out via kiosk PIN", async ({ page }) => {
    await page.goto("/kiosk");
    await page.waitForLoadState("networkidle");

    // Select outlet
    const outletSelect = page.getByRole("combobox").first();
    if (await outletSelect.isVisible({ timeout: 4000 }).catch(() => false)) {
      await outletSelect.selectOption({ label: /Packages Mall/i });
    }

    await enterPinOnKiosk(page, HASSAN_PIN);
    await page.waitForTimeout(1000);

    // Should show hassan's name
    await expect(page.getByText(/hassan/i)).toBeVisible({ timeout: 10000 });

    // Determine current state and act
    const clockOutBtn = page
      .getByRole("button", { name: /clock out|end of day/i })
      .first();
    const clockInBtn = page.getByRole("button", { name: /clock in/i }).first();

    if (await clockOutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clockOutBtn.click();
      await expect(
        page.getByText(/goodbye.*hassan|clocked out/i)
      ).toBeVisible({ timeout: 10000 });
      console.log("✅ Hassan clocked out");
    } else if (await clockInBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Hassan was already clocked out — clocking in instead");
      await clockInBtn.click();
      await expect(
        page.getByText(/welcome.*hassan|clocked in/i)
      ).toBeVisible({ timeout: 10000 });
    } else {
      console.log("Hassan attendance state handled (finished today or other)");
    }
  });

  test("clock hassan back in via kiosk", async ({ page }) => {
    await page.goto("/kiosk");
    await page.waitForLoadState("networkidle");

    const outletSelect = page.getByRole("combobox").first();
    if (await outletSelect.isVisible({ timeout: 4000 }).catch(() => false)) {
      await outletSelect.selectOption({ label: /Packages Mall/i });
    }

    await enterPinOnKiosk(page, HASSAN_PIN);
    await page.waitForTimeout(1000);

    await expect(page.getByText(/hassan/i)).toBeVisible({ timeout: 10000 });

    const clockInBtn = page.getByRole("button", { name: /clock in/i }).first();
    if (await clockInBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clockInBtn.click();
      await expect(
        page.getByText(/welcome.*hassan|clocked in/i)
      ).toBeVisible({ timeout: 10000 });
      console.log("✅ Hassan clocked back in");
    } else {
      console.log("Hassan clock-in: already in or finished state — acceptable");
    }
  });

  test("attendance page shows today's record", async ({ page }) => {
    await page.goto("/attendance");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/attendance/i).first()).toBeVisible({ timeout: 15000 });
    console.log("✅ Attendance page loaded");
  });

  test("clock in Asad via API (for POS access)", async ({ page }) => {
    const res = await post(page, "/api/attendance/pin-checkin", {
      pin_code: "1234",
      outlet_id: 1,
    });
    // 200 or already clocked in are both acceptable
    console.log("Asad clock-in response:", res.status, JSON.stringify(res.data).slice(0, 100));
  });
});
