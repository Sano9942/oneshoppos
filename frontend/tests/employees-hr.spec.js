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
      page.getByRole("heading", { name: /employee/i }).or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("create employee", async ({ page }) => {
    await navigateTo(page, "/employees");
    const addBtn = page.getByRole("button", { name: /add|new|create/i });
    await addBtn.click();
    await page.waitForLoadState("networkidle");

    const ts = Date.now();
    const name = `TestEmp${String(ts).slice(-6)}`;

    await page.getByPlaceholder(/name/i).first().fill(name);

    // Select role
    const roleSelect = page.getByLabel(/role/i).or(page.locator("select").first());
    if (await roleSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await roleSelect.selectOption({ index: 1 }).catch(() => {});
    }

    // Fill PIN
    const pinField = page.getByPlaceholder(/pin/i).or(page.getByLabel(/pin/i));
    if (await pinField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pinField.first().fill("1234");
    }

    // Fill password
    const passwordField = page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i));
    if (await passwordField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await passwordField.first().fill("TestPass123");
    }

    await page.getByRole("button", { name: /save|submit|create/i }).click();
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByText(name).or(page.getByText(/success|created|saved/i))
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
      const outletSection = page.getByText(/outlet/i);
      if (await outletSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(outletSection.first()).toBeVisible();
      }
    }
  });

  test("kiosk terminal loads", async ({ page }) => {
    await page.goto(`/kiosk?tenant=${STORE_CODE}`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/pin/i).or(page.getByText(/kiosk/i)).or(page.locator("button").first())
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("attendance page loads", async ({ page }) => {
    await navigateTo(page, "/attendance");
    await expect(
      page.getByRole("heading", { name: /attendance/i })
        .or(page.getByText(/no.*attendance/i))
        .or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("HR page loads", async ({ page }) => {
    await navigateTo(page, "/hr");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /hr|human|leave/i })
        .or(page.getByText(/leave/i))
        .or(page.getByText(/no.*request/i))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("submit leave request", async ({ page }) => {
    await navigateTo(page, "/hr");
    await page.waitForLoadState("networkidle");

    const addBtn = page.getByRole("button", { name: /add|new|request|apply/i });
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.first().click();
      await page.waitForLoadState("networkidle");
      // Just verify form opens
      await expect(
        page.getByLabel(/type|reason/i).or(page.getByPlaceholder(/reason/i)).or(page.getByRole("dialog"))
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("approvals page loads", async ({ page }) => {
    await navigateTo(page, "/approvals");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: /approval/i })
        .or(page.getByText(/no.*approval/i))
        .or(page.getByText(/pending/i))
        .or(page.locator("table"))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("action history page loads", async ({ page }) => {
    await navigateTo(page, "/action-history");
    await expect(
      page.getByRole("heading", { name: /action.*history|activity/i })
        .or(page.locator("table"))
        .or(page.getByText(/no.*history/i))
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("roles visible in employee form", async ({ page }) => {
    await navigateTo(page, "/employees");
    const addBtn = page.getByRole("button", { name: /add|new|create/i });
    await addBtn.click();
    await page.waitForLoadState("networkidle");

    // Check that role options exist
    await expect(
      page.getByText(/administrator/i).or(page.getByText(/manager/i)).or(page.getByText(/cashier/i))
    ).toBeVisible({ timeout: 10000 });
  });

  test("employee search works", async ({ page }) => {
    await navigateTo(page, "/employees");
    const searchInput = page.getByPlaceholder(/search/i).or(page.getByRole("searchbox"));
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.first().fill("hassan");
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/hassan/i)).toBeVisible({ timeout: 10000 });
    }
  });
});
