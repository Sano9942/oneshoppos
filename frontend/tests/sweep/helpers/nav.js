/**
 * Navigation helpers for the sweep.
 *
 * Thin wrappers around page.goto + waitForLoadState that also dismiss
 * common interrupting overlays so the spec body doesn't have to.
 */

export async function navigateTo(page, path) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await dismissOverlays(page);
}

/**
 * Dismiss banners / dialogs that appear opportunistically and
 * obscure clickable elements:
 *  - Multi-outlet enabled informational banner
 *  - PWA install prompt (we never want it during a sweep)
 *  - Subscription banner (informational, X-button)
 *  - Announcement banner (X-button)
 *
 * Best-effort. Failures are silently swallowed.
 */
export async function dismissOverlays(page) {
  const dismissables = [
    'button[aria-label*="Dismiss" i]',
    'button[aria-label*="Close" i]',
    'button[aria-label*="dismiss banner" i]',
  ];
  for (const sel of dismissables) {
    try {
      const buttons = page.locator(sel);
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        if (await btn.isVisible({ timeout: 100 }).catch(() => false)) {
          await btn.click({ timeout: 1000 }).catch(() => {});
        }
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Click a sidebar nav link by its label. Re-uses the existing app
 * sidebar shape — each link has an accessible name matching its text.
 */
export async function clickSidebarLink(page, label) {
  await page.getByRole("link", { name: new RegExp(`^${label}$`, "i") }).first().click();
  await page.waitForLoadState("networkidle");
  await dismissOverlays(page);
}

/**
 * Wait for a page to be ready by waiting for its h1 / heading to render.
 * More reliable than waitForURL when routes redirect through context loading.
 */
export async function waitForPageHeading(page, headingText, timeout = 15000) {
  await page
    .getByRole("heading", { name: new RegExp(headingText, "i") })
    .first()
    .waitFor({ state: "visible", timeout });
}
