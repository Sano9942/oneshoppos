import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loginAsAdmin } from "./helpers/auth";

const API = "http://127.0.0.1:5000/api";
const EMPLOYEE_HEADERS = {
  "Content-Type": "application/json",
  "x-employee-id": "1",
};

async function navigateSpa(page, pathname, headingText) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, pathname);
  if (headingText) {
    await expect(page.getByText(headingText).first()).toBeVisible({
      timeout: 15000,
    });
  }
}

test.describe("Inventory and Reports Smoke", () => {
  test("should edit product metadata and export category-wise report", async ({
    page,
    request,
  }) => {
    const ts = Date.now();
    const productName = `UI Smoke Toy ${ts}`;
    const barcode = `UITOY-${ts}`;
    const updatedType = `STEM Puzzle Kit ${ts}`;
    const updatedVendor = "Melissa & Doug";
    const updatedTags = `Age 6+,Puzzle,Indoor,Gift,UI Smoke ${ts}`;
    let productId = null;

    try {
      const categoriesRes = await request.get(`${API}/categories`, {
        headers: EMPLOYEE_HEADERS,
      });
      expect(categoriesRes.ok()).toBeTruthy();
      const categoriesJson = await categoriesRes.json();
      const targetCategory = (categoriesJson.categories || []).find(
        (category) =>
          category.path_label ===
          "Toys & Games > Board Games & Puzzles > Jigsaw Puzzles",
      );
      expect(targetCategory).toBeTruthy();

      const createRes = await request.post(`${API}/products`, {
        headers: EMPLOYEE_HEADERS,
        data: {
          name: productName,
          barcode,
          price: 1999,
          cost_price: 1200,
          category_id: targetCategory.id,
          brand_id: 15,
          unit: "pcs",
          product_type: "Puzzle Set",
          vendor: "Melissa & Doug",
          tags: "Age 5+,Puzzle,Gift",
        },
      });
      expect(createRes.ok()).toBeTruthy();
      productId = (await createRes.json()).id;

      await loginAsAdmin(page);

      await navigateSpa(page, "/inventory", "Products");
      await page.getByPlaceholder("Search name, barcode, SKU").fill(barcode);
      await expect(page.getByText(productName, { exact: true })).toBeVisible({
        timeout: 15000,
      });
      await page.getByText(productName, { exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Edit Product" }),
      ).toBeVisible({ timeout: 15000 });

      await page
        .locator('input[placeholder="e.g. STEM Robotics Kit"]')
        .fill(updatedType);
      await page.locator('input[placeholder="e.g. LEGO"]').fill(updatedVendor);
      await page
        .locator('input[placeholder*="Comma-separated tags"]')
        .fill(updatedTags);
      await page.getByRole("button", { name: /save changes/i }).click();

      const verifyRes = await request.get(
        `${API}/products?search=${encodeURIComponent(barcode)}`,
        { headers: { "x-employee-id": "1" } },
      );
      expect(verifyRes.ok()).toBeTruthy();
      const verifyJson = await verifyRes.json();
      const saved = (verifyJson.products || []).find(
        (product) => product.id === productId,
      );
      expect(saved).toBeTruthy();
      expect(saved.product_type).toBe(updatedType);
      expect(saved.vendor).toBe(updatedVendor);
      expect(saved.tags).toBe(updatedTags);

      await navigateSpa(page, "/reports/category-wise", "Category Wise Sales");
      const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
      await page.getByRole("button", { name: /export csv/i }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("category-wise.csv");

      const savePath = path.join(
        process.cwd(),
        "test-results",
        "category-wise.csv",
      );
      await download.saveAs(savePath);
      const csv = fs.readFileSync(savePath, "utf8");
      expect(csv).toContain('"Category","Units Sold","Revenue"');

      const reportRes = await request.get(`${API}/reports/category-wise`, {
        headers: { "x-employee-id": "1" },
      });
      expect(reportRes.ok()).toBeTruthy();
      const reportJson = await reportRes.json();
      expect(Array.isArray(reportJson.data)).toBe(true);
    } finally {
      if (productId) {
        await request.delete(`${API}/products/${productId}`, {
          headers: { "x-employee-id": "1" },
        });
      }
    }
  });
});
