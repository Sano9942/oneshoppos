import { expect } from "@playwright/test";

export async function loginAsAdmin(page) {
  await page.goto("/");
  await expect(page).toHaveURL(/.*login/, { timeout: 15000 });
  await page.locator('input[placeholder="Employee name"]').fill("Hassan");
  await page.locator('input[placeholder="PIN code"]').fill("2580");
  await page.getByRole("button", { name: /login/i }).click();
  await expect(page).toHaveURL(/.*dashboard/, { timeout: 20000 });
  await expect(page.getByText(/ONESHOPPOS/i)).toBeVisible({ timeout: 15000 });
}
