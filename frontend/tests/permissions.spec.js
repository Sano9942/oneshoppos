import { test, expect } from "@playwright/test";
import { STORE_CODE, USERNAME, PASSWORD, PIN, BACKEND, loginMT } from "./helpers/auth.js";
import { post, get } from "./helpers/api.js";
import { navigateTo } from "./helpers/nav.js";

test.describe("Permissions — Admin user", () => {
  test("admin sees inventory sidebar link", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(
      page.getByRole("link", { name: /inventory/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("admin sees employees sidebar link", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    await expect(
      page.getByRole("link", { name: /employee/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("admin can access employees page", async ({ page }) => {
    await navigateTo(page, "/employees");
    await expect(
      page.getByRole("heading", { name: /employee/i }).first()
    ).toBeVisible({ timeout: 15000 });
    expect(page.url()).toContain("/employees");
  });

  test("admin can access company settings", async ({ page }) => {
    await navigateTo(page, "/company-settings");
    await expect(
      page.getByRole("heading", { name: /company|settings/i }).first()
    ).toBeVisible({ timeout: 15000 });
    expect(page.url()).toContain("/company-settings");
  });

  test("admin can access import page", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(
      page.getByRole("heading", { name: /import/i }).first()
    ).toBeVisible({ timeout: 15000 });
    expect(page.url()).toContain("/import");
  });

  test("admin can access integrations settings", async ({ page }) => {
    await navigateTo(page, "/settings/integrations");
    await expect(
      page.getByRole("heading", { name: /integration/i }).first()
    ).toBeVisible({ timeout: 15000 });
    expect(page.url()).toContain("/settings/integrations");
  });

  test("admin can access roles page", async ({ page }) => {
    await navigateTo(page, "/roles");
    await expect(
      page.getByRole("heading", { name: /role/i }).first()
    ).toBeVisible({ timeout: 15000 });
    expect(page.url()).toContain("/roles");
  });

  test("admin can access all reports", async ({ page }) => {
    await navigateTo(page, "/reports");
    await expect(
      page.getByRole("heading", { name: /report/i }).first()
    ).toBeVisible({ timeout: 15000 });
    expect(page.url()).toContain("/reports");
  });
});

test.describe("Permissions — Cashier user", () => {
  // Fresh browser context with no stored auth
  test.use({ storageState: undefined });

  let cashierName;
  let roles;

  test.beforeAll(async () => {
    // Fetch roles to confirm IDs
    const rolesRes = await get("/api/roles");
    roles = rolesRes.data;

    // Find an existing active cashier
    const empRes = await get("/api/employees");
    const employees = Array.isArray(empRes.data) ? empRes.data : empRes.data?.employees || [];
    const cashierRoleId = Array.isArray(roles)
      ? roles.find(r => /cashier/i.test(r.name))?.id
      : 3;

    const cashier = employees.find(
      e => e.role_id === cashierRoleId && e.status === "active" && e.name !== USERNAME
    );
    if (cashier) {
      cashierName = cashier.name;
    }
  });

  test("cashier can access POS page", async ({ page }) => {
    test.skip(!cashierName, "No active cashier employee found");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCode = page.getByPlaceholder(/aceshardware/i);
    if (await storeCode.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCode.fill(STORE_CODE);
    }
    await page.getByPlaceholder(/employee name/i).fill(cashierName);
    await page.getByPlaceholder(/password/i).fill(PIN);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/pos");
  });

  test("cashier is blocked from employees page", async ({ page }) => {
    test.skip(!cashierName, "No active cashier employee found");

    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const storeCode = page.getByPlaceholder(/aceshardware/i);
    if (await storeCode.isVisible({ timeout: 5000 }).catch(() => false)) {
      await storeCode.fill(STORE_CODE);
    }
    await page.getByPlaceholder(/employee name/i).fill(cashierName);
    await page.getByPlaceholder(/password/i).fill(PIN);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|context/, { timeout: 30000 });
    await page.waitForLoadState("networkidle");

    await page.goto("/employees");
    await page.waitForLoadState("networkidle");
    // Should redirect to access-denied or dashboard, or show forbidden
    const url = page.url();
    const blocked =
      url.includes("access-denied") ||
      url.includes("dashboard") ||
      (await page.getByText(/access denied|forbidden|not authorized|permission/i).isVisible({ timeout: 5000 }).catch(() => false));
    expect(blocked).toBeTruthy();
  });
});
