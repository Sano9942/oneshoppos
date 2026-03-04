import { test, expect } from "@playwright/test";
import { ADMIN_EMPLOYEE, loginAsAdmin } from "./helpers/auth";

test.describe("Attendance Kiosk Flow", () => {
  test("should clock in and out successfully", async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto("/kiosk");
    await page.selectOption("select", { label: "Main Store" });

    for (const digit of ADMIN_EMPLOYEE.pin.split("")) {
      await page.getByRole("button", { name: digit, exact: true }).click({ delay: 100 });
    }

    await page.getByRole("button", { name: /✓|âœ“|check|submit|enter|ok/i }).click();

    await expect(page.getByText(ADMIN_EMPLOYEE.name)).toBeVisible({ timeout: 15000 });

    await expect(async () => {
      const inVis = await page.getByRole("button", { name: /clock in/i }).isVisible();
      const outVis = await page
        .getByRole("button", { name: /clock out \(end of day\)|end of day clock out/i })
        .isVisible();
      const finishedVis = await page.getByText(/finished today|day completed/i).isVisible();
      expect(inVis || outVis || finishedVis).toBeTruthy();
    }).toPass({ timeout: 10000 });

    const clockInBtn = page.getByRole("button", { name: /clock in/i });
    const clockOutBtn = page.getByRole("button", {
      name: /clock out \(end of day\)|end of day clock out/i,
    });
    const finishedState = page.getByText(/finished today|day completed/i);

    if (await clockInBtn.isVisible()) {
      await clockInBtn.click();
      await expect(
        page.getByText(new RegExp(`Welcome, ${ADMIN_EMPLOYEE.name}`, "i")),
      ).toBeVisible();
    } else if (await clockOutBtn.isVisible()) {
      await clockOutBtn.click();
      await expect(
        page.getByText(new RegExp(`Goodbye, ${ADMIN_EMPLOYEE.name}`, "i")).first(),
      ).toBeVisible();
    } else if (await finishedState.isVisible()) {
      await expect(page.getByRole("button", { name: /done/i })).toBeVisible();
    }
  });
});
