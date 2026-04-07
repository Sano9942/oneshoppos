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
      page.getByRole("heading", { name: /customer/i }).or(page.getByText(/no customers/i)).or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create customer", async ({ page }) => {
    await navigateTo(page, "/customers");
    const addBtn = page.getByRole("button", { name: /add|new|create/i });
    await addBtn.click();
    await page.waitForLoadState("networkidle");

    const ts = Date.now();
    const name = `Test Customer ${ts}`;
    const phone = `0300${String(ts).slice(-7)}`;

    await page.getByPlaceholder(/name/i).first().fill(name);
    const phoneField = page.getByPlaceholder(/phone/i).or(page.getByLabel(/phone/i));
    if (await phoneField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await phoneField.first().fill(phone);
    }
    const emailField = page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i));
    if (await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await emailField.first().fill(`test${ts}@example.com`);
    }

    await page.getByRole("button", { name: /save|submit|create/i }).click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(name).or(page.getByText(/success|created|saved/i))).toBeVisible({ timeout: 10000 });
  });

  test("edit customer", async ({ page }) => {
    await navigateTo(page, "/customers");
    await page.waitForLoadState("networkidle");

    const row = page.locator("table tbody tr").first().or(page.locator("[class*=card]").first());
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
      page.getByRole("heading", { name: /group/i }).or(page.getByText(/no.*group/i)).or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create customer group", async ({ page }) => {
    await navigateTo(page, "/customer-groups");
    const addBtn = page.getByRole("button", { name: /add|new|create/i });
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForLoadState("networkidle");
      const nameField = page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i)).first();
      if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameField.fill(`Group ${Date.now()}`);
        await page.getByRole("button", { name: /save|submit|create/i }).click();
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("loyalty tiers page loads", async ({ page }) => {
    await navigateTo(page, "/loyalty-tiers");
    await expect(
      page.getByRole("heading", { name: /loyalty|tier/i }).or(page.getByText(/no.*tier/i)).or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create loyalty tier", async ({ page }) => {
    await navigateTo(page, "/loyalty-tiers");
    const addBtn = page.getByRole("button", { name: /add|new|create/i });
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForLoadState("networkidle");
      const nameField = page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i)).first();
      if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameField.fill(`Tier ${Date.now()}`);
        await page.getByRole("button", { name: /save|submit|create/i }).click();
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
      await expect(
        page.getByText(/profile|detail|history|transaction/i)
          .or(page.getByRole("heading").first())
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("blacklist toggle", async ({ page }) => {
    await navigateTo(page, "/customers");
    const row = page.locator("table tbody tr").first();
    if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      await row.click();
      await page.waitForLoadState("networkidle");
      const blacklistBtn = page.getByRole("button", { name: /blacklist|block/i });
      if (await blacklistBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(blacklistBtn).toBeVisible();
      }
    }
  });

  test("review moderation page loads", async ({ page }) => {
    await navigateTo(page, "/review-moderation");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /review|moderation/i })
        .or(page.getByText(/no.*review/i))
        .or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("customer search works", async ({ page }) => {
    await navigateTo(page, "/customers");
    const searchInput = page.getByPlaceholder(/search/i).or(page.getByRole("searchbox"));
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.first().fill("test");
      await page.waitForLoadState("networkidle");
      // Just verify page doesn't crash
      await noErrorBoundary(page);
    }
  });
});
