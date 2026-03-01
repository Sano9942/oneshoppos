import { test, expect } from "@playwright/test";

test.describe("Attendance Kiosk Flow", () => {
  test("should clock in and out successfully", async ({ page }) => {
    // 0. Login as an Admin first to unlock the app
    await page.goto("/login");
    await page.getByPlaceholder(/Employee name/i).fill("Hassan");
    await page.locator('input[type="password"]').fill("2580");
    await page.getByRole("button", { name: /login/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);

    // 1. Go to Kiosk page
    await page.goto("/kiosk");

    // 2. Select Store
    await page.selectOption("select", { label: "Main Store" });

    // 3. Enter PIN (Cashier User: 3333)
    for (let i = 0; i < 4; i++) {
      await page
        .getByRole("button", { name: "3", exact: true })
        .click({ delay: 100 });
    }

    // 4. Submit PIN
    await page.getByRole("button", { name: "✓" }).click();

    // 5. Verify Employee status view
    await expect(page.getByText("Cashier User")).toBeVisible({
      timeout: 15000,
    });

    // 6. Perform Clock In/Out (depending on current state)
    // Wait for either button to be visible
    await expect(async () => {
      const inVis = await page
        .getByRole("button", { name: /clock in/i })
        .isVisible();
      const outVis = await page
        .getByRole("button", { name: /end of day clock out/i })
        .isVisible();
      expect(inVis || outVis).toBeTruthy();
    }).toPass({ timeout: 10000 });

    const clockInBtn = page.getByRole("button", { name: /clock in/i });
    const clockOutBtn = page.getByRole("button", {
      name: /end of day clock out/i,
    });

    if (await clockInBtn.isVisible()) {
      await clockInBtn.click();
      await expect(page.getByText(/Welcome, Cashier User/i)).toBeVisible();
    } else if (await clockOutBtn.isVisible()) {
      await clockOutBtn.click();
      await expect(page.getByText(/Goodbye, Cashier User/i)).toBeVisible();
    }
  });
});
