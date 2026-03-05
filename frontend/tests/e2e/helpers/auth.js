import { expect } from "@playwright/test";

export const ADMIN_EMPLOYEE = {
  id: "1",
  name: "Hassan",
  pin: "2580",
};

export const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-employee-id": ADMIN_EMPLOYEE.id,
};

export async function loginAsAdmin(page) {
  await page.goto("/login");
  const usernameInput = page.locator('input[placeholder="Employee name"]');
  const pinInput = page.locator('input[placeholder="PIN code"]');
  await expect(usernameInput).toBeVisible({ timeout: 15000 });
  await expect(pinInput).toBeVisible({ timeout: 15000 });
  await usernameInput.fill(ADMIN_EMPLOYEE.name);
  await pinInput.fill(ADMIN_EMPLOYEE.pin);
  await page.getByRole("button", { name: /login/i }).click();

  // Context Unification (March 2026): after login, may redirect to /context-select
  // if context_selection_required flag is on. Handle both paths.
  await page.waitForURL(/\/(dashboard|context-select)/, { timeout: 20000 });
  if (page.url().includes("context-select")) {
    // For admin: "All branches" scope is shown. Click Continue.
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });
  }

  await expect(page.getByText(/ONESHOPPOS/i)).toBeVisible({ timeout: 15000 });
}
