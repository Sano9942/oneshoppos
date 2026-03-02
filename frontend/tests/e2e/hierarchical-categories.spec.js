import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

const API = "http://127.0.0.1:5000/api";
const EMPLOYEE_HEADERS = {
  "Content-Type": "application/json",
  "x-employee-id": "1",
};

test.describe("Hierarchical Categories Smoke", () => {
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

  test("should render hierarchical categories across categories, inventory, promotions, and reports", async ({
    page,
    request,
  }) => {
    const ts = Date.now();
    const parentName = `Smoke Parent ${ts}`;
    const childName = `Smoke Child ${ts}`;
    const pathLabel = `${parentName} > ${childName}`;
    const productName = `Smoke Product ${ts}`;
    const promoName = `Smoke Promo ${ts}`;
    const barcode = `SMOKE-${ts}`;

    let parentId = null;
    let childId = null;
    let productId = null;
    let promoId = null;

    try {
      let res = await request.post(`${API}/categories`, {
        headers: EMPLOYEE_HEADERS,
        data: { name: parentName, description: "smoke parent" },
      });
      expect(res.ok()).toBeTruthy();
      parentId = (await res.json()).id;

      res = await request.post(`${API}/categories`, {
        headers: EMPLOYEE_HEADERS,
        data: {
          name: childName,
          description: "smoke child",
          parent_id: parentId,
        },
      });
      expect(res.ok()).toBeTruthy();
      childId = (await res.json()).id;

      res = await request.post(`${API}/products`, {
        headers: EMPLOYEE_HEADERS,
        data: {
          name: productName,
          barcode,
          price: 1234,
          cost_price: 900,
          category_id: childId,
          unit: "pcs",
        },
      });
      expect(res.ok()).toBeTruthy();
      productId = (await res.json()).id;

      res = await request.post(`${API}/promotions`, {
        headers: EMPLOYEE_HEADERS,
        data: {
          name: promoName,
          type: "percent",
          value: 10,
          applies_to: "category",
          category_id: childId,
        },
      });
      expect(res.ok()).toBeTruthy();
      promoId = (await res.json()).id;

      await loginAsAdmin(page);

      await navigateSpa(page, "/categories", "Categories");
      await expect(
        page.getByRole("heading", { name: "Categories" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(parentName, { exact: true })).toBeVisible();
      await expect(page.getByText(pathLabel, { exact: true })).toBeVisible();

      await navigateSpa(page, "/inventory", "Products");
      await expect(page).toHaveURL(/.*inventory/, { timeout: 15000 });
      await expect(page.getByText(productName, { exact: true })).toBeVisible();
      await expect(page.getByText(pathLabel, { exact: true }).last()).toBeVisible();

      await navigateSpa(page, "/promotions", "Promotions");
      await expect(page.getByText(promoName, { exact: true })).toBeVisible();

      await navigateSpa(page, "/reports/category-wise", "Category Wise Sales");
      await expect(page.getByText("Category Wise Sales")).toBeVisible({
        timeout: 15000,
      });
      await expect(page.locator("table").first()).toBeVisible();
    } finally {
      if (promoId) {
        await request.delete(`${API}/promotions/${promoId}`, {
          headers: { "x-employee-id": "1" },
        });
      }
      if (productId) {
        await request.delete(`${API}/products/${productId}`, {
          headers: { "x-employee-id": "1" },
        });
      }
      if (childId) {
        await request.delete(`${API}/categories/${childId}`, {
          headers: { "x-employee-id": "1" },
        });
      }
      if (parentId) {
        await request.delete(`${API}/categories/${parentId}`, {
          headers: { "x-employee-id": "1" },
        });
      }
    }
  });
});
