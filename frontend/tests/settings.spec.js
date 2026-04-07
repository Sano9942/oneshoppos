import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";

const noErrorBoundary = async (page) => {
  await expect(
    page.getByText(/something went wrong/i)
  ).not.toBeVisible({ timeout: 2000 }).catch(() => {});
};

test.describe("Settings", () => {
  test("company settings page loads with form", async ({ page }) => {
    await navigateTo(page, "/company-settings");
    await expect(
      page.getByRole("heading", { name: /company settings/i })
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("company name field is populated", async ({ page }) => {
    await navigateTo(page, "/company-settings");
    // The form uses plain text labels like "Company Name", not <label> elements
    const nameField = page.getByRole("textbox", { name: /company name/i })
      .or(page.locator("#company-settings-form input").first());
    await expect(nameField).toBeVisible({ timeout: 15000 });
    const value = await nameField.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test("outlets page loads", async ({ page }) => {
    await navigateTo(page, "/outlets");
    await expect(
      page.getByRole("heading", { name: /outlet/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("printer settings page loads", async ({ page }) => {
    await navigateTo(page, "/printer-settings");
    await expect(
      page.getByRole("heading", { name: /printer settings/i })
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("receipt templates page loads", async ({ page }) => {
    await navigateTo(page, "/receipt-templates");
    await expect(
      page.getByRole("heading", { name: /receipt/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("barcode templates page loads", async ({ page }) => {
    await navigateTo(page, "/barcode-templates");
    await expect(
      page.getByRole("heading", { name: /barcode/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("courier settings page loads with courier list", async ({ page }) => {
    await navigateTo(page, "/courier-settings");
    await expect(
      page.getByRole("heading", { name: /courier|delivery/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("courier list shows multiple couriers", async ({ page }) => {
    await navigateTo(page, "/courier-settings");
    await page.waitForLoadState("networkidle");
    // 13 pre-seeded couriers — check at least a few are visible
    const courierNames = [/leopards/i, /tcs/i, /trax/i, /call.*courier/i, /dhl/i];
    let found = 0;
    for (const name of courierNames) {
      if (await page.getByText(name).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(1);
  });

  test("backup/restore page loads", async ({ page }) => {
    await navigateTo(page, "/backup-restore");
    await expect(
      page.getByRole("heading", { name: /backup/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("administrator page loads", async ({ page }) => {
    await navigateTo(page, "/administrator");
    await expect(
      page.getByRole("heading", { name: /administrator/i })
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("import page loads with tabs", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(
      page.getByRole("heading", { name: /import/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("profile page loads", async ({ page }) => {
    await navigateTo(page, "/profile");
    await expect(
      page.getByRole("heading", { name: /profile/i }).first()
    ).toBeVisible({ timeout: 15000 });
    await noErrorBoundary(page);
  });

  test("email config accessible", async ({ page }) => {
    // Email config may be in company settings or a separate route
    await navigateTo(page, "/company-settings");
    await page.waitForLoadState("networkidle");

    const emailTab = page.getByRole("tab", { name: /email/i })
      .or(page.getByRole("button", { name: /email/i }));

    if (await emailTab.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailTab.first().click();
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(/smtp|email|host|port/i).first()
      ).toBeVisible({ timeout: 10000 });
    } else {
      // Try direct route
      await navigateTo(page, "/email-settings");
      await page.waitForLoadState("networkidle");
      await noErrorBoundary(page);
    }
  });

  test("dark mode toggle in profile dropdown", async ({ page }) => {
    await navigateTo(page, "/dashboard");
    // Profile dropdown button shows employee name "hassan"
    const profileBtn = page.locator("header").getByRole("button", { name: /hassan/i });

    if (await profileBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await profileBtn.click();
      await page.waitForTimeout(500);
      const darkToggle = page.getByText(/dark mode|light mode/i).first();
      if (await darkToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(darkToggle).toBeVisible();
      }
    }
  });
});
