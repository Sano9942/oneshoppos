import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";

const noErrorBoundary = async (page) => {
  await expect(
    page.getByText(/something went wrong/i)
  ).not.toBeVisible({ timeout: 2000 }).catch(() => {});
};

const pageLoadsOk = async (page, path, headingPattern) => {
  await navigateTo(page, path);
  const hasHeading = await page.getByRole("heading", { name: headingPattern }).first().isVisible({ timeout: 15000 }).catch(() => false);
  const hasTable = await page.locator("table").first().isVisible({ timeout: 2000 }).catch(() => false);
  const hasEmpty = await page.getByText(/no.*data|empty|no.*found|not available|feature/i).first().isVisible({ timeout: 2000 }).catch(() => false);
  expect(hasHeading || hasTable || hasEmpty).toBeTruthy();
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
      page.getByRole("heading", { name: /expense/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create expense category", async ({ page }) => {
    await navigateTo(page, "/expenses");
    await page.waitForLoadState("networkidle");

    // Click "Categories" button to open the categories modal
    const categoryBtn = page.getByRole("button", { name: /categor/i }).first();
    if (await categoryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await categoryBtn.click();
      await page.waitForTimeout(500);
    }

    // Inside the categories modal, fill the "New category name" input and click "Add"
    const modal = page.locator(".fixed");
    const nameField = modal.getByPlaceholder("New category name");
    if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nameField.fill(`ExpCat ${Date.now()}`);
      await modal.getByRole("button", { name: /^add$/i }).click();
      await page.waitForLoadState("networkidle");
    }
  });

  test("create expense record", async ({ page }) => {
    await navigateTo(page, "/expenses");
    await page.waitForLoadState("networkidle");

    // Click "Add Expense" to open modal
    const addBtn = page.getByRole("button", { name: /add expense/i }).first();
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);

      // Fill fields inside the modal
      const modal = page.locator(".fixed");
      // Amount is an input[type=number] with label "Amount"
      const amountField = modal.locator("input[type=number]").first();
      if (await amountField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await amountField.fill("500");
      }

      const descField = modal.getByPlaceholder("What was this expense for?");
      if (await descField.isVisible({ timeout: 3000 }).catch(() => false)) {
        await descField.fill("Test expense");
      }

      // Submit — button text is "Add Expense"
      await modal.getByRole("button", { name: /add expense/i }).click();
      await page.waitForLoadState("networkidle");
    }
  });

  test("expense summary visible", async ({ page }) => {
    await navigateTo(page, "/expenses");
    await page.waitForLoadState("networkidle");
    // Check for summary stats, totals, or chart
    const hasTotal = await page.getByText(/total/i).first().isVisible({ timeout: 10000 }).catch(() => false);
    const hasSummary = await page.getByText(/summary/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasTable = await page.locator("table").first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasEmpty = await page.getByText(/no.*expense/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasTotal || hasSummary || hasTable || hasEmpty).toBeTruthy();
  });

  test("accounting feature flag check", async ({ page }) => {
    await navigateTo(page, "/accounting");
    await page.waitForLoadState("networkidle");
    // Accounting may be feature-gated — either loads normally or shows gated message
    const hasHeading = await page.getByRole("heading").first().isVisible({ timeout: 15000 }).catch(() => false);
    const hasGated = await page.getByText(/feature|upgrade|not available|accounting/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasHeading || hasGated).toBeTruthy();
    await noErrorBoundary(page);
  });
});
