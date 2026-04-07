import { test, expect } from "@playwright/test";
import { navigateTo } from "./helpers/nav.js";
import { get } from "./helpers/api.js";

test.describe("Import & Export", () => {
  test("import page loads at /import", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(
      page.getByRole("heading", { name: /import/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("products import tab visible", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(
      page.getByRole("tab", { name: /product/i })
        .or(page.getByRole("button", { name: /product/i }))
        .or(page.getByText(/product/i))
        .first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("customers import tab visible", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(
      page.getByRole("tab", { name: /customer/i })
        .or(page.getByRole("button", { name: /customer/i }))
        .or(page.getByText(/customer/i))
        .first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("suppliers import tab visible", async ({ page }) => {
    await navigateTo(page, "/import");
    await expect(
      page.getByRole("tab", { name: /supplier/i })
        .or(page.getByRole("button", { name: /supplier/i }))
        .or(page.getByText(/supplier/i))
        .first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("template download for products returns 200", async () => {
    const r = await get("/api/import/template/products");
    expect(r.status).toBe(200);
  });

  test("template download for customers returns 200", async () => {
    const r = await get("/api/import/template/customers");
    expect(r.status).toBe(200);
  });

  test("import page shows file upload area", async ({ page }) => {
    await navigateTo(page, "/import");
    // Look for a file input, drop zone, or upload button
    const uploadArea = page.locator("input[type=file]")
      .or(page.getByText(/drag|drop|upload|browse|choose file/i))
      .or(page.getByRole("button", { name: /upload|browse|choose/i }));
    await expect(uploadArea.first()).toBeAttached({ timeout: 15000 });
  });

  test("CSV export button visible on inventory page", async ({ page }) => {
    await navigateTo(page, "/inventory");
    await expect(
      page.getByRole("heading", { name: /products|inventory/i }).first()
    ).toBeVisible({ timeout: 15000 });
    const exportBtn = page.getByRole("button", { name: /export|csv|download/i })
      .or(page.getByText(/export csv|download csv/i));
    await expect(exportBtn.first()).toBeVisible({ timeout: 10000 });
  });
});
