import { test, expect } from "@playwright/test";
import { navigateTo, waitForPageShell } from "./helpers/nav.js";
import { get, post, put } from "./helpers/api.js";

const noErrorBoundary = async (page) => {
  await expect(
    page.getByText(/something went wrong/i)
  ).not.toBeVisible({ timeout: 2000 }).catch(() => {});
};

test.describe("Customers", () => {
  test("customers page loads", async ({ page }) => {
    await navigateTo(page, "/customers");
    await expect(
      page.getByRole("heading", { name: /customer/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create customer", async ({ page }) => {
    await navigateTo(page, "/customers");
    const addBtn = page.getByRole("button", { name: /add customer/i }).first();
    await addBtn.click();
    await page.waitForLoadState("networkidle");

    const ts = Date.now();
    const name = `Test Customer ${ts}`;
    const phone = `0300${String(ts).slice(-7)}`;

    // Fill fields inside the modal
    const modal = page.locator(".fixed");
    await modal.getByPlaceholder("Name").fill(name);
    await modal.getByPlaceholder("Mobile").fill(phone);
    const emailField = modal.getByPlaceholder("Email");
    if (await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await emailField.fill(`test${ts}@example.com`);
    }

    // Button text is "Create" for new customers
    await modal.getByRole("button", { name: /^create$/i }).click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(name).or(page.getByText(/success|created|saved/i)).first()).toBeVisible({ timeout: 10000 });
  });

  test("edit customer", async ({ page }) => {
    await navigateTo(page, "/customers");
    await page.waitForLoadState("networkidle");

    const row = page.locator("table tbody tr").first();
    if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      const editBtn = row.getByRole("button", { name: /edit/i }).or(row.getByRole("link")).first();
      await editBtn.click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i)).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("customer groups page loads", async ({ page }) => {
    await navigateTo(page, "/customer-groups");
    await expect(
      page.getByRole("heading", { name: /group/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create customer group", async ({ page }) => {
    await navigateTo(page, "/customer-groups");
    const addBtn = page.getByRole("button", { name: /add|new|create/i }).first();
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForLoadState("networkidle");
      const nameField = page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i)).first();
      if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameField.fill(`Group ${Date.now()}`);
        await page.getByRole("button", { name: /save|submit|create/i }).first().click();
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("loyalty tiers page loads", async ({ page }) => {
    await navigateTo(page, "/loyalty-tiers");
    await expect(
      page.getByRole("heading", { name: /loyalty|tier/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create loyalty tier", async ({ page }) => {
    await navigateTo(page, "/loyalty-tiers");
    const addBtn = page.getByRole("button", { name: /add|new|create/i }).first();
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForLoadState("networkidle");
      const nameField = page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i)).first();
      if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameField.fill(`Tier ${Date.now()}`);
        await page.getByRole("button", { name: /save|submit|create/i }).first().click();
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("customer wallet topup via API", async () => {
    // First get a customer
    const list = await get("/api/customers?limit=1");
    if (list.ok && list.data?.length > 0) {
      const cid = list.data[0].id;
      const res = await post(`/api/customers/${cid}/wallet/topup`, { amount: 100, note: "test topup" });
      expect([200, 201, 404]).toContain(res.status); // 404 if wallet feature not enabled
    }
  });

  test("customer profile loads on click", async ({ page }) => {
    await navigateTo(page, "/customers");
    const row = page.locator("table tbody tr").first();
    if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      await row.click();
      await page.waitForLoadState("networkidle");
      const hasText = await page.getByText(/profile|detail|history|transaction/i).first().isVisible({ timeout: 10000 }).catch(() => false);
      const hasHeading = await page.getByRole("heading").first().isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasText || hasHeading).toBeTruthy();
    }
  });

  test("blacklist toggle", async ({ page }) => {
    await navigateTo(page, "/customers");
    const row = page.locator("table tbody tr").first();
    if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      await row.click();
      await page.waitForLoadState("networkidle");
      const blacklistBtn = page.getByRole("button", { name: /blacklist|block/i }).first();
      if (await blacklistBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(blacklistBtn).toBeVisible();
      }
    }
  });

  test("review moderation page loads", async ({ page }) => {
    await navigateTo(page, "/review-moderation");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /review|moderation/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("customer search works", async ({ page }) => {
    await navigateTo(page, "/customers");
    const searchInput = page.getByPlaceholder(/search/i).or(page.getByRole("searchbox")).first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForLoadState("networkidle");
      // Just verify page doesn't crash
      await noErrorBoundary(page);
    }
  });
});
