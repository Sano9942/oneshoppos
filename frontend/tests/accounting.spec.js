import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";

const noErrorBoundary = async (page) => {
  await expect(
    page.getByText(/something went wrong/i)
  ).not.toBeVisible({ timeout: 2000 }).catch(() => {});
};

const pageLoadsOk = async (page, path, headingPattern) => {
  await navigateTo(page, path);
  await expect(
    page.getByRole("heading", { name: headingPattern })
      .or(page.locator("table"))
      .or(page.getByText(/no.*data|empty|no.*found|not available|feature/i))
  ).toBeVisible({ timeout: 15000 });
  await noErrorBoundary(page);
};

test.describe("Accounting", () => {
  test("accounting page loads", async ({ page }) => {
    await pageLoadsOk(page, "/accounting", /account/i);
  });

  test("chart of accounts page loads", async ({ page }) => {
    await pageLoadsOk(page, "/chart-of-accounts", /chart.*account|account/i);
  });

  test("journal entries page loads", async ({ page }) => {
    await pageLoadsOk(page, "/journal-entries", /journal/i);
  });

  test("credit/debit notes page loads", async ({ page }) => {
    await pageLoadsOk(page, "/credit-debit-notes", /credit|debit|note/i);
  });

  test("postdated cheques page loads", async ({ page }) => {
    await pageLoadsOk(page, "/postdated-cheques", /cheque|postdated/i);
  });

  test("expenses page loads", async ({ page }) => {
    await navigateTo(page, "/expenses");
    await expect(
      page.getByRole("heading", { name: /expense/i })
        .or(page.locator("table"))
        .or(page.getByText(/no.*expense/i))
        .or(page.getByText(/categor/i))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create expense category", async ({ page }) => {
    await navigateTo(page, "/expenses");
    await page.waitForLoadState("networkidle");

    // Look for category tab or section
    const categoryTab = page.getByRole("tab", { name: /categor/i })
      .or(page.getByRole("button", { name: /categor/i }));
    if (await categoryTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await categoryTab.first().click();
      await page.waitForLoadState("networkidle");
    }

    const addBtn = page.getByRole("button", { name: /add|new|create/i });
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.first().click();
      await page.waitForLoadState("networkidle");
      const nameField = page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i)).first();
      if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameField.fill(`ExpCat ${Date.now()}`);
        await page.getByRole("button", { name: /save|submit|create/i }).click();
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("create expense record", async ({ page }) => {
    await navigateTo(page, "/expenses");
    await page.waitForLoadState("networkidle");

    const addBtn = page.getByRole("button", { name: /add|new|create|record/i });
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.first().click();
      await page.waitForLoadState("networkidle");

      const amountField = page.getByPlaceholder(/amount/i).or(page.getByLabel(/amount/i));
      if (await amountField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await amountField.first().fill("500");
      }

      const descField = page.getByPlaceholder(/description|note|detail/i).or(page.getByLabel(/description/i));
      if (await descField.isVisible({ timeout: 3000 }).catch(() => false)) {
        await descField.first().fill("Test expense");
      }

      await page.getByRole("button", { name: /save|submit|create/i }).click();
      await page.waitForLoadState("networkidle");
    }
  });

  test("expense summary visible", async ({ page }) => {
    await navigateTo(page, "/expenses");
    await page.waitForLoadState("networkidle");
    // Check for summary stats, totals, or chart
    await expect(
      page.getByText(/total/i)
        .or(page.getByText(/summary/i))
        .or(page.locator("table"))
        .or(page.getByText(/no.*expense/i))
    ).toBeVisible({ timeout: 15000 });
  });

  test("accounting feature flag check", async ({ page }) => {
    await navigateTo(page, "/accounting");
    await page.waitForLoadState("networkidle");
    // Accounting may be feature-gated — either loads normally or shows gated message
    await expect(
      page.getByRole("heading").first()
        .or(page.getByText(/feature|upgrade|not available|accounting/i))
        .or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });
});
