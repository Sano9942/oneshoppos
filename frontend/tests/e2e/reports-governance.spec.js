import { test, expect } from "@playwright/test";
import { ADMIN_HEADERS, loginAsAdmin } from "./helpers/auth";

const API = "http://127.0.0.1:5000/api";

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

test.describe("Reports Governance Smoke", () => {
  test("shows the governance domain and allows saving a view", async ({
    page,
    request,
  }) => {
    const viewName = `Playwright View ${Date.now()}`;
    let createdViewId = null;

    try {
      await request.put(`${API}/feature-flags/reports_scheduled_exports`, {
        headers: ADMIN_HEADERS,
        data: { enabled: true },
      });

      await loginAsAdmin(page);
      await navigateSpa(page, "/reports", "Reports");

      await page.getByRole("button", { name: /governance/i }).first().click();
      await page.getByRole("button", { name: /audit controls/i }).click();

      await expect(
        page.getByText("Reporting operations and control layer"),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Saved Views/i).first()).toBeVisible();
      await expect(page.getByText(/Schedules/i).first()).toBeVisible();

      await page.getByPlaceholder("View name").fill(viewName);
      await page.getByRole("button", { name: /save view/i }).click();
      await expect(page.getByText(viewName).first()).toBeVisible({
        timeout: 15000,
      });

      const viewsRes = await request.get(`${API}/reports/saved-views`, {
        headers: ADMIN_HEADERS,
      });
      expect(viewsRes.ok()).toBeTruthy();
      const viewsJson = await viewsRes.json();
      const created = (viewsJson.views || []).find((view) => view.name === viewName);
      expect(created).toBeTruthy();
      createdViewId = created.id;
    } finally {
      if (createdViewId) {
        await request.delete(`${API}/reports/saved-views/${createdViewId}`, {
          headers: ADMIN_HEADERS,
        });
      }
    }
  });
});
