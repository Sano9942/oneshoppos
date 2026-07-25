/**
 * The shared production test tenant. THE single source of truth for which
 * tenant every non-sweep spec runs against — import STORE_CODE here rather
 * than hardcoding a slug in a spec.
 *
 * History: this pointed at `packagesmall`, which was deleted from production in
 * Apr 2026. Because global-setup only *warned* on login failure, runs stayed
 * "green" while specs silently proceeded with no session — a regression net
 * that caught nothing. Two things fixed that: this file is now the only place
 * the slug lives, and global-setup hard-fails when login fails.
 *
 * Every value is env-overridable, so pointing a run at a different tenant needs
 * no code change:
 *   E2E_TENANT=mytenant E2E_USERNAME="Owner" E2E_PASSWORD=... E2E_PIN=1234 \
 *     npx playwright test
 *
 * NOTE: USERNAME is the employee's full display name (with spaces, case
 * sensitive), not a slug or an email.
 */
export const STORE_CODE = process.env.E2E_TENANT || "livetestauto";
export const USERNAME = process.env.E2E_USERNAME || "Sweep Operator";
export const PASSWORD = process.env.E2E_PASSWORD || "SweepRun123!";
export const PIN = process.env.E2E_PIN || "1234";
export const BACKEND = process.env.E2E_BACKEND || "https://api.sanopos.com";

/**
 * Locators here are the most fragile part of the suite — they key on the login
 * page's placeholder text, which the Square reskin has already changed once
 * (the username field says "Employee username", not "Employee name"; the old
 * /employee name/i locator silently timed out for months behind the
 * warn-and-continue global setup). Each field therefore matches a placeholder
 * OR its label, and `.first()` keeps a future duplicate match from throwing a
 * strict-mode error mid-run. Source of truth: frontend/src/pages/LoginPage.jsx.
 */
export async function loginMT(page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  const storeCodeInput = page
    .getByPlaceholder(/aceshardware/i)
    .or(page.getByLabel(/store code/i))
    .first();
  if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await storeCodeInput.fill(STORE_CODE);
  }

  await page
    .getByPlaceholder(/employee (username|name)/i)
    .or(page.getByLabel(/username/i))
    .first()
    .fill(USERNAME);
  await page
    .getByPlaceholder(/password/i)
    .or(page.getByLabel(/password/i))
    .first()
    .fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/.*dashboard/, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}
