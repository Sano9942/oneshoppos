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
 * SECRETS COME FROM THE ENVIRONMENT AND HAVE NO DEFAULTS. This file used to
 * carry the password and PIN as literals, which meant any clone of this repo —
 * including the private repo's read access, and anything that ever mirrored it —
 * yielded a working login to LIVE PRODUCTION, since E2E_BACKEND defaults to
 * api.sanopos.com. A test helper is not a credential store. Missing values
 * throw at import rather than falling through to `undefined`, because an
 * undefined password produces a failed login that reads like a broken locator
 * and sends the next person debugging the wrong thing.
 *
 * The non-secret values keep defaults: a tenant slug and a display name are
 * identifiers, not credentials, and hard-coding them is what makes this file
 * the single source of truth it was introduced to be.
 *
 *   E2E_PASSWORD=... E2E_PIN=... npx playwright test
 *   E2E_TENANT=mytenant E2E_USERNAME="Owner" E2E_PASSWORD=... E2E_PIN=... \
 *     npx playwright test        # different tenant, still no code change
 *
 * NOTE: USERNAME is the employee's full display name (with spaces, case
 * sensitive), not a slug or an email.
 */
function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. The Playwright suite authenticates against a real ` +
        `tenant and this repo deliberately stores no passwords. Set it in your ` +
        `shell (or a gitignored .env) before running:\n\n` +
        `  E2E_PASSWORD=<password> E2E_PIN=<pin> npx playwright test\n`
    );
  }
  return v;
}

export const STORE_CODE = process.env.E2E_TENANT || "livetestauto";
export const USERNAME = process.env.E2E_USERNAME || "Sweep Operator";
export const PASSWORD = required("E2E_PASSWORD");
export const PIN = required("E2E_PIN");
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
