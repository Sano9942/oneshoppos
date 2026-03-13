export const STORE_CODE = "packagesmall";
export const EMPLOYEE_NAME = "hassan";
export const EMPLOYEE_PIN = "2580";
export const BACKEND = "https://oneshoppos-production.up.railway.app";

/**
 * Performs MT login on sanopos.vercel.app.
 * Works for both global-setup (chromium browser) and individual specs.
 */
export async function loginMT(page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  // Store Code field — placeholder is "e.g. aces-hardware" in MT mode
  const storeCodeInput = page
    .getByPlaceholder(/aces-hardware/i)
    .or(page.getByLabel(/store code/i));
  if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await storeCodeInput.fill(STORE_CODE);
  }

  await page.getByPlaceholder(/employee name/i).fill(EMPLOYEE_NAME);
  await page.getByPlaceholder(/pin/i).fill(EMPLOYEE_PIN);
  await page.getByRole("button", { name: /login/i }).click();

  // After login may pass through /context-select before landing on /dashboard
  // context-select auto-redirects for admin (no button needed) — just wait for dashboard
  await page.waitForURL(/.*dashboard/, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}

/**
 * Reads the Bearer token from localStorage (set by AuthProvider after MT login).
 */
export async function getToken(page) {
  return page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("authSession") || "{}");
    return s.token || null;
  });
}
