export const STORE_CODE = "packagesmall";
export const USERNAME = "hassan";
export const PASSWORD = "Danish11";
export const PIN = "2580";
export const BACKEND = "https://api.sanopos.com";

export async function loginMT(page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  const storeCodeInput = page
    .getByPlaceholder(/aceshardware/i)
    .or(page.getByLabel(/store code/i));
  if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await storeCodeInput.fill(STORE_CODE);
  }

  await page.getByPlaceholder(/employee name/i).fill(USERNAME);
  await page.getByPlaceholder(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/.*dashboard/, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}
