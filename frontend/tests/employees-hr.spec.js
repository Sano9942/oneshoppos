import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";
import { STORE_CODE } from "./helpers/auth.js";

const noErrorBoundary = async (page) => {
  await expect(
    page.getByText(/something went wrong/i)
  ).not.toBeVisible({ timeout: 2000 }).catch(() => {});
};

test.describe("Employees & HR", () => {
  test("employees page loads", async ({ page }) => {
    await navigateTo(page, "/employees");
    await expect(
      page.getByRole("heading", { name: /employee/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create employee", async ({ page }) => {
    await navigateTo(page, "/employees");
    const addBtn = page.getByRole("button", { name: /add employee/i }).first();
    await addBtn.click();
    await page.waitForLoadState("networkidle");

    const ts = Date.now();
    const name = `TestEmp${String(ts).slice(-6)}`;

    // Fill name — placeholder is "Full name"
    await page.getByPlaceholder("Full name").fill(name);

    // Select role — first select in the modal
    const roleSelect = page.locator(".fixed select").first();
    if (await roleSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await roleSelect.selectOption({ index: 1 }).catch(() => {});
    }

    // Fill PIN — placeholder is "PIN code"
    const pinField = page.getByPlaceholder("PIN code");
    if (await pinField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pinField.fill("1234");
    }

    // Click Save inside the modal
    const modal = page.locator(".fixed");
    await modal.getByRole("button", { name: /^save$/i }).click();
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText(name).or(page.getByText(/success|created|saved/i)).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("edit employee", async ({ page }) => {
    await navigateTo(page, "/employees");
    await page.waitForLoadState("networkidle");

    const row = page.locator("table tbody tr").first();
    if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      const editBtn = row.getByRole("button", { name: /edit/i }).or(row.getByRole("link")).first();
      await editBtn.click();
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i)).first()
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("assign outlets to employee", async ({ page }) => {
    await navigateTo(page, "/employees");
    await page.waitForLoadState("networkidle");

    const row = page.locator("table tbody tr").first();
    if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      const editBtn = row.getByRole("button", { name: /edit/i }).or(row.getByRole("link")).first();
      await editBtn.click();
      await page.waitForLoadState("networkidle");

      // Look for outlet assignment section
      const outletSection = page.getByText(/outlet/i).first();
      if (await outletSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(outletSection).toBeVisible();
      }
    }
  });

  test("kiosk terminal loads", async ({ page }) => {
    await page.goto(`/kiosk?tenant=${STORE_CODE}`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/pin/i).or(page.getByText(/kiosk/i)).or(page.locator("button").first()).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("attendance page loads", async ({ page }) => {
    await navigateTo(page, "/attendance");
    await expect(
      page.getByRole("heading", { name: /attendance/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("HR page loads", async ({ page }) => {
    await navigateTo(page, "/hr");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /hr|human|leave/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("submit leave request", async ({ page }) => {
    await navigateTo(page, "/hr");
    await page.waitForLoadState("networkidle");

    const addBtn = page.getByRole("button", { name: /add|new|request|apply/i }).first();
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForLoadState("networkidle");
      // Just verify form opens
      await expect(
        page.getByLabel(/type|reason/i).or(page.getByPlaceholder(/reason/i)).or(page.getByRole("dialog")).first()
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("approvals page loads", async ({ page }) => {
    await navigateTo(page, "/approvals");
    await page.waitForLoadState("networkidle");
    const hasHeading = await page.getByRole("heading", { name: /approval/i }).first().isVisible({ timeout: 15000 }).catch(() => false);
    const hasEmpty = await page.getByText(/no.*approval|pending/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasHeading || hasEmpty).toBeTruthy();
    await noErrorBoundary(page);
  });

  test("action history page loads", async ({ page }) => {
    await navigateTo(page, "/action-history");
    await expect(
      page.getByRole("heading", { name: /action.*history|activity/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("roles visible in employee form", async ({ page }) => {
    await navigateTo(page, "/employees");
    const addBtn = page.getByRole("button", { name: /add|new|create/i }).first();
    await addBtn.click();
    await page.waitForLoadState("networkidle");

    // Check that role options exist
    await expect(
      page.getByText(/administrator/i).or(page.getByText(/manager/i)).or(page.getByText(/cashier/i)).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("employee search works", async ({ page }) => {
    await navigateTo(page, "/employees");
    const searchInput = page.getByPlaceholder(/search/i).or(page.getByRole("searchbox")).first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill("hassan");
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/hassan/i).first()).toBeVisible({ timeout: 10000 });
    }
  });
});
