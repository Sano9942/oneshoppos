/**
 * Navigate to an app page via URL and wait for load.
 */
export async function navigateTo(page, path) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Wait for page shell heading to appear.
 */
export async function waitForPageShell(page, titleText) {
  await page.getByRole("heading", { name: titleText }).waitFor({ timeout: 15000 });
}

/**
 * Click a sidebar nav link by its visible text.
 */
export async function clickSidebarLink(page, linkText) {
  await page.getByRole("link", { name: linkText }).click();
  await page.waitForLoadState("networkidle");
}
